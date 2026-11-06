/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — story trackers that follow the story: SillyTavern glue.
 *
 * Called from DeepLore's generate interceptor just before the lore pipeline, so a
 * move lands before the judge reads the story state and before the writer block is
 * built — "I'm your new neighbour" already counts for the reply that answers it.
 * Rules and prompt: src/autotrack-pure.js. Design: `6 merge roadmap.md` §4 A+.
 */
import { chat_metadata } from '../../../../../script.js';
import { turnIndex } from './turn-index.js';
import { getContext } from '../../../../extensions.js';
import { escapeHtml } from '../../../../utils.js';
import { resolveConnectionConfig } from '../settings.js';
import { callAI } from './ai/ai.js';
import { getTrackers, getActiveTrackers, saveTrackers, applyOnV2 } from './trackers.js';
import { askLevel, asks, targetStepId, moveRequest } from './requests-pure.js';   // Mero's 📬 (2026-10-05)
import { askAndWait, addRequest, onAnswer } from './requests.js';
import { echo } from './echo.js';   // Immersion = no echoes (Miinthe, 2026-10-05)
import { helperMoveV2, takeBranchAtV2, undoAutoV2 } from './movers-pure.js';   // engine on v2, step 3b part 3
import { unmetNeeds, conditionText } from './conditions-pure.js';
import { moveTo, recordRefusal, record } from './trackers-pure.js';
import { describeTake } from './forks-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): forks
import {
    AUTOTRACK_WINDOW, autoTrackSystemPrompt, autoTrackSchema, parseHelperAnswerAll,
    buildAutoTrackUser, validateChanges, describeMove, describeReason, rememberUndo,
} from './autotrack-pure.js';
// LOCAL PATCH (Miinthe, 2026-10-05): collections and the purse (storyboard stage 3, round 2)
import { live, saveLiveState, entryText, liveStepJudgeSection, worldChatPaused } from './board-live.js';
import { worldOf } from './world/world-pure.js';                 // the world layer (2026-10-19): the helper also reads the moment
import { parseMoment } from './world/alive-pure.js';
import { placesHelperSection, validatePlaceChanges, applyPlaceChanges, describePlaceChange, placeFromUserMessage } from './places-pure.js';   // round 3: places
import { stateHelperSection, validateStateChanges, applyStateChanges, describeStateChange } from './state-pure.js';   // round 4: state + dates
import { metersHelperSection, validateMeterChanges, applyMeterChanges, describeMeterChange, driftChanges, crossesBand } from './meters-pure.js';   // meters (2026-10-12)
import { castHelperSection, validateCastChanges, applyCastChanges, describeCastChange, splitPeopleEvents, leftBehind } from './cast-pure.js';   // the Cast (2026-10-13): who comes and goes, who learns what
import { placeOf, trackerOf } from './board-model-pure.js';
import { handleFinds } from './board-grow.js';   // collections that grow (2026-10-04)
import { helperSection, validateCollectionChanges, applyCollectionChanges, undoCollectionChange, describeCollectionChange } from './collections-pure.js';

const OFF_KEY = 'deeplore_autotrack_off';
const SKIP_TYPES = new Set(['quiet', 'swipe', 'regenerate', 'continue', 'impersonate']);

let warnedNoProfile = false;

/** Per chat: on unless Miinthe switched it off in the Story tab. */
export function autoTrackEnabled() {
    return !chat_metadata?.[OFF_KEY];
}

export function setAutoTrackEnabled(on) {
    if (on) delete chat_metadata[OFF_KEY]; else chat_metadata[OFF_KEY] = true;
    // saveTrackers() with the unchanged list saves metadata and redraws the Story tab.
    saveTrackers(getTrackers());
}

function lastMessageIndex() {
    return turnIndex(getContext()?.chat);   // the newest message, or the turn Re-evaluate re-runs (turn-index.js)
}

/**
 * Ask the helper whether the newest messages plainly moved any tracker, and apply
 * the moves that pass every check. Never throws into the generation: a failure
 * only means no move this turn.
 *
 * @returns {Promise<Array>} the moves applied (for diagnostics)
 */
export async function runAutoTrack(chatMessages, type, signal) {
    if (SKIP_TYPES.has(type)) return [];
    if (!autoTrackEnabled()) return [];
    // Waiting and paused trackers are not watched (storyboard conditions).
    // An ended tracker (its last fork decided it) is not watched any more.
    const trackers = getActiveTrackers().filter(t => !t.ended);
    // Collections on this chat's board are watched in the same call.
    const L0 = live();
    const colSection = L0 ? helperSection(L0.board, L0.state, { judgeText: entryText }) : '';
    const placeSection = L0 ? placesHelperSection(L0.board, L0.state, { judgeText: entryText }) : '';
    const stateSection = L0 ? stateHelperSection(L0.board, L0.state) : '';
    const meterSection = L0 ? metersHelperSection(L0.board, L0.state, { judgeText: entryText }) : '';
    const castSection = L0 ? castHelperSection(L0.board, L0.state, { judgeText: entryText, placeName: h => placeOf(trackerOf(L0.board, h.place), h.at)?.name ?? null }) : '';
    const stepRules = L0 && trackers.length ? liveStepJudgeSection() : '';   // ⚖ judge entries on steps (2026-10-04)
    if (!trackers.length && !colSection && !placeSection && !stateSection && !meterSection && !castSection) return [];
    const wl = L0 ? worldOf(L0.board, worldChatPaused()) : null;   // world layer on, with big or quiet moments in its mix → one more field
    const want = { collections: !!colSection, places: !!placeSection, state: !!stateSection, meters: !!meterSection, cast: !!castSection, world: !!(wl && !wl.paused && (wl.alive.big || wl.alive.quiet)) };

    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) {
        if (!warnedNoProfile) {
            warnedNoProfile = true;
            try { toastr.info('Story trackers can follow the story by themselves once they have a connection: Settings › AI & connections › Story helper.', 'Onyx Quill', { timeOut: 12000 }); } catch { /* noop */ }
        }
        return [];
    }

    // Each message keeps its place in the chat (_i), so a line older than a tracker's
    // last move — including a move by hand — can never move it again.
    const chat = getContext()?.chat || [];
    const messages = (Array.isArray(chatMessages) ? chatMessages : [])
        .filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim())
        .slice(-AUTOTRACK_WINDOW)
        .map(m => {
            let i = chat.indexOf(m);
            if (i === -1) i = chat.findIndex(c => c && c.send_date === m.send_date && c.mes === m.mes);
            return i === -1 ? m : { ...m, _i: i };
        });
    if (!messages.length) return [];

    // Mero's 📬 "Re-check in N": once due, the helper looks again — with the original line (it has scrolled out of the
    // newest messages by then) and what came since; once only (the entry is used up after this run)
    const nowI0 = Math.max(-1, ...messages.map(m => (Number.isFinite(m._i) ? m._i : -1)));
    const due = [];
    for (const t of trackers) for (const u of t.undone || []) if (Number.isFinite(u.until) && u.until <= nowI0) due.push({ t, u });
    for (const { u } of due) if (Number.isFinite(u.at) && chat[u.at] && !messages.some(x => x._i === u.at)) messages.push({ ...chat[u.at], _i: u.at });
    messages.sort((a, b) => (a._i ?? 0) - (b._i ?? 0));
    const recheckSection = due.length ? `\nLOOK AGAIN — the author asked to re-check these after a few messages:\n${due.map(({ t, u }) => `- ${t.name} → ${u.branch ? `"${u.branch}"` : `"${t.steps[u.toIndex]}"`}, from the line: "${u.quote}". Report it again only if the messages make it plain now.`).join('\n')}` : '';
    const usedUp = list => list.map(t => { const d = due.filter(x => x.t.id === t.id).map(x => x.u); return d.length ? { ...t, undone: (t.undone || []).filter(u => !d.some(x => x.quote === u.quote && x.until === u.until)) } : t; });

    let changes = [], items = [], money = [], places = [], state = [], dates = [], meters = [], people = [], cast = [], learns = [];
    try {
        const result = await callAI(autoTrackSystemPrompt(want), buildAutoTrackUser(trackers, messages, [stepRules, stateSection, placeSection, castSection, colSection, meterSection, recheckSection].filter(Boolean).join('\n')), {
            ...conn, caller: 'storyTracker', skipThrottle: true, jsonSchema: autoTrackSchema(want),
            disableThinkingOnClaude: true, noReasoning: true, temperature: 0, signal,
        });
        ({ changes, items, money, places, state, dates, meters, people, cast, learns } = parseHelperAnswerAll(result?.text ?? ''));
        if (want.world) { const moment = parseMoment(result?.text); if (moment) window.dispatchEvent(new CustomEvent('dle-world-moment', { detail: { moment, i: nowI0 } })); }
        ({ presence: cast, learns } = splitPeopleEvents(people, cast, learns));   // the Cast: one "people" list of events
    } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[Onyx Quill] story tracker check failed:', err?.message || err);
        return [];
    }

    // Re-read: Miinthe may have moved a tracker by hand while the helper was thinking.
    let current = usedUp(getTrackers());
    const active = new Set(getActiveTrackers().map(t => t.name));
    const { moves, rejected } = validateChanges(changes, current.filter(t => active.has(t.name) && !t.ended), messages, (t, k) => unmetNeeds(t, k, current));
    if (rejected.length) console.debug('[Onyx Quill] story tracker changes not applied:', rejected);
    // Refused jumps go into the timeline (the other refusals are housekeeping:
    // repeats, no change, unknown names).
    const at0 = lastMessageIndex();
    let refusedAny = false;
    for (const r of rejected.filter(x => x.reason === 'skips steps')) {
        const k = current.findIndex(t => t.name === r.tracker);
        if (k === -1) continue;
        current[k] = recordRefusal(current[k], at0, { toIndex: current[k].steps.indexOf(r.skipped.to), why: `${r.skipped.to} skips ${r.skipped.between.join(', ')} — stayed at ${r.skipped.from}`, quote: r.skipped.quote, reason: r.skipped.why || null, at: new Date().toISOString() });
        refusedAny = true;
    }
    for (const r of rejected.filter(x => x.reason === 'needs')) {
        const k = current.findIndex(t => t.name === r.tracker);
        if (k === -1) continue;
        const cond = r.needs.unmet.map(n => (n.text ? n.text : `once ${conditionText({ tracker: n.tracker, step: n.reach }, current)}`)).join(' and ');
        const why = `${r.needs.to} is only possible ${cond} — stayed at ${r.needs.from}`;
        current[k] = recordRefusal(current[k], at0, { toIndex: current[k].steps.indexOf(r.needs.to), why, quote: r.needs.quote, reason: r.needs.why || null, at: new Date().toISOString() });
        refusedAny = true;
        try { toastr.warning(`${escapeHtml(r.tracker)}: ${escapeHtml(why)}.<br><i>“${escapeHtml(r.needs.quote)}”</i>`, 'Story tracker', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ }
    }
    // A move past a fork that isn't decided yet: the tracker waits there (forks-pure.js).
    for (const r of rejected.filter(x => x.reason === 'waits at a fork')) {
        const k = current.findIndex(t => t.name === r.tracker);
        if (k === -1) continue;
        const why = `waits at the fork after ${r.fork.at} — ${r.fork.to} comes after the story takes a way there`;
        current[k] = recordRefusal(current[k], at0, { toIndex: current[k].steps.indexOf(r.fork.to), why, quote: r.fork.quote, reason: r.fork.why || null, at: new Date().toISOString() });
        refusedAny = true;
        try { toastr.warning(`${escapeHtml(r.tracker)}: ${escapeHtml(why)}.<br><i>“${escapeHtml(r.fork.quote)}”</i>`, 'Story tracker', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ }
    }
    // A refused jump is shown, so Miinthe can move it by hand if the story really meant it.
    for (const r of rejected.filter(x => x.reason === 'skips steps')) {
        const sk = r.skipped;
        try {
            toastr.warning(
                `${escapeHtml(r.tracker)}: ${escapeHtml(sk.to)} skips ${escapeHtml(sk.between.join(', '))} — stayed at ${escapeHtml(sk.from)}.<br><i>“${escapeHtml(sk.quote)}”</i>`,
                'Story tracker', { escapeHtml: false, timeOut: 12000 },
            );
        } catch { /* noop */ }
    }
    // Collections: checked against the state as it is now (Miinthe may have changed it meanwhile).
    const finds = [];   // collections that grow: new things (board-grow.js)
    const Lq = live();   // the places safety net: her own message moves the scene when the helper said nothing (Miinthe, 2026-10-19)
    const placesIn = Lq ? [...places, ...placeFromUserMessage(Lq.board, Lq.state, messages, places)] : places;
    const stateApplied = applyState(state, dates, messages), placesApplied = applyPlaces(placesIn, messages);
    // people stay behind when the scene moves without them (Miinthe, 2026-10-19) — after the place move, before the Cast's own changes
    const Lp = placesApplied.length ? live() : null;
    const behind = Lp ? leftBehind(Lp.board, Lp.state, placesApplied, messages, cast, ch => describePlaceChange(Lp.board, ch).replace(/^.*the scene is now at\s*/, '')) : [];
    const colApplied = [...stateApplied, ...placesApplied, ...applyCast([...cast, ...behind], learns, messages), ...applyCollections(items, money, messages, finds), ...applyMeters(meters, messages)];
    if (finds.length) colApplied.push(...await handleFinds(finds, lastMessageIndex()));
    // LOCAL PATCH (Miinthe, 2026-10-05) — Mero's 📬: a move the board says to ask about (requests-pure.js askLevel: the
    // step's own asking, else the tracker's "Ask me at"; low by default) is not applied — it becomes a card, and the
    // reply waits for Miinthe's answer (the helper runs before the writer; nothing expires). Accept applies it; Deny is
    // remembered like an Undo; Re-check in N only until N messages later; a stopped reply drops the question.
    let answeredAny = false;
    if (moves.length) {
        const L1 = live();
        const ask = L1 ? moves.filter(m => { const t = current.find(x => x.name === m.name); return t && asks(askLevel(L1.board, t.id, targetStepId(L1.board, t, m)), m.confidence); }) : [];
        if (ask.length) {
            const cards = ask.map(m => moveRequest(current.find(x => x.name === m.name), m, lastMessageIndex(), `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`));
            const answers = await askAndWait(cards, signal);
            current = usedUp(getTrackers());   // Miinthe may have moved something while answering
            const nowI = lastMessageIndex();
            for (const c of cards) {
                const a = answers[c.id] || { choice: 'dropped' };
                if (a.choice === 'accept') continue;
                moves.splice(moves.indexOf(c.move), 1);
                if (a.choice !== 'deny' && a.choice !== 'wait') continue;
                const k = current.findIndex(t => t.id === c.tracker);
                if (k === -1) continue;
                current[k] = { ...current[k], undone: rememberUndo(current[k].undone, c.move, a.choice === 'wait' ? nowI + (Number(a.n) || 3) : null) };
                answeredAny = true;
            }
        }
    }
    if (!moves.length) { if (refusedAny || colApplied.length || answeredAny || due.length) saveTrackers(current); return colApplied; }

    const at = lastMessageIndex();
    const taken = new Map();   // tracker name → what its branch did (for the notice)
    // engine on v2, step 3b part 3: the helper's moves are made on the v2 state where they can be
    const v2 = applyOnV2(current, (board, st, J) => {
        for (const m of moves.filter(x => x.branch)) {
            const before = current.find(t => t.name === m.name);
            const meta = { who: 'auto', at: new Date().toISOString(), quote: m.quote, reason: m.reason || null, confidence: m.confidence || null };
            const r = takeBranchAtV2(board, st, board.trackers.find(t => t.id === before.id), m.step, m.branch, at, meta);
            if (r.error) { console.debug('[Onyx Quill] branch not taken:', r.error); continue; }
            const startedOther = r.effect.started ? { name: r.effect.started } : null;
            J.set(before.id, n => ({ ...n, journal: record(n.journal, at, n.index, n.aside, { ...meta, took: { ...(n.took || {}) }, ...(n.ended ? { ended: n.ended } : {}) }),
                lastAuto: { ...m, fromTook: before.took || {}, fromEnded: before.ended || null, fromLog: (before.branchLog || []).length, startedOther, at: new Date().toISOString(), message: at } }));
            taken.set(m.name, r.effect);
        }
        for (const m of moves.filter(x => !x.branch)) {
            const t0 = current.find(t => t.name === m.name);
            const meta = { who: 'auto', at: new Date().toISOString(), quote: m.quote, reason: m.reason || null, confidence: m.confidence || null };
            helperMoveV2(board, st, board.trackers.find(t => t.id === t0.id), m.toIndex, m.toAside);
            const prior = J.get(t0.id);
            J.set(t0.id, n => ({ ...moveTo(prior ? prior(n) : n, n.index, at, meta), lastAuto: { ...m, at: new Date().toISOString(), message: at } }));
        }
    });
    if (!v2) { console.warn('[Onyx Quill] story tracker: this chat has no storyboard — moves not applied'); return colApplied; }
    current.splice(0, current.length, ...v2.list);
    saveTrackers(current);

    for (const m of moves) {
        if (m.branch && !taken.has(m.name)) continue;
        const t = current.find(x => x.name === m.name);
        const text = m.branch ? describeTake(taken.get(m.name)) : describeMove(t, m);
        echo(() => toastr.info(
            `${escapeHtml(text)}<br><i>“${escapeHtml(m.quote)}”</i>${m.reason ? `<br>${escapeHtml(describeReason(m))}` : ''}<br><u>Undo</u>`,
            'Story tracker',
            { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoAutoMove(m.name) },
        ));
    }
    return moves;
}

/** Check and apply the helper's item and money changes; notices with Undo. Returns what was applied; new things go into `finds`. */
function applyCollections(items, money, messages, finds = []) {
    if (!items.length && !money.length) return [];
    const L = live();
    if (!L) return [];
    const checked = validateCollectionChanges(items, money, L.board, L.state, messages);
    const { rejected } = checked;
    let { changes } = checked;
    if (rejected.length) console.debug('[Onyx Quill] collection changes not applied:', rejected);
    for (const r of rejected) {
        const say = r.reason === 'needs' ? `${r.what} — only possible once ${r.needs.join(' and ')}.`
            : r.reason === 'cannot afford' ? `${r.what} — costs ${r.cost}, there is only ${r.have}.`
                : r.reason === 'not there to be found' ? `${r.what} — not there to be found right now, so it was left alone.`
                : r.reason === 'not on the list' ? `found “${r.found.item}” — not on the ${r.found.collection} list, so it was left alone (on the board, “the story can add new items” lets it grow).` : null;
        if (!say) continue;
        try { toastr.warning(`${escapeHtml(say)}${r.quote || r.found?.quote ? `<br><i>“${escapeHtml(r.quote || r.found.quote)}”</i>` : ''}`, 'Storyboard', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ }
    }
    finds.push(...changes.filter(c => c.kind === 'find'));
    changes = changes.filter(c => c.kind !== 'find');
    if (!changes.length) return [];
    const next = applyCollectionChanges(L.board, L.state, changes, lastMessageIndex(), { who: 'auto' });
    saveLiveState(next);
    // one notice per collection for this turn, one Undo for all of it (micro fix 2026-10-04 — like state)
    const byCol = new Map();
    for (const ch of changes) { if (!byCol.has(ch.col)) byCol.set(ch.col, []); byCol.get(ch.col).push(ch); }
    for (const list of byCol.values()) {
        const one = list.length === 1 ? list[0] : null;
        const body = list.map(ch => `${escapeHtml(describeCollectionChange(L.board, ch))}<br><i>“${escapeHtml(ch.quote)}”</i>`).join('<br>');
        echo(() => toastr.info(`${body}${one?.reason ? `<br>${escapeHtml(describeReason(one))}` : ''}<br><u>Undo${one ? '' : ' all'}</u>`,
            'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => (one ? undoCollection(one.logId) : undoCollections(list.map(c => c.logId))) }));
    }
    return changes;
}

/** Check and apply the helper's state changes and new dates; notices with Undo; dates on "ask me first" ask. */
function applyState(stateList, dateList, messages) {
    if (!stateList.length && !dateList.length) return [];
    const L = live();
    if (!L) return [];
    const { changes, rejected } = validateStateChanges(stateList, dateList, L.board, L.state, messages);
    if (rejected.length) console.debug('[Onyx Quill] state changes not applied:', rejected);
    if (!changes.length) return [];
    saveLiveState(applyStateChanges(L.board, L.state, changes, lastMessageIndex(), { who: 'auto' }));
    const at = lastMessageIndex();
    // one notice per state tracker for this turn (Miinthe doesn't want to be flooded): the changes, their lines, one Undo for all
    const byTracker = new Map();
    for (const ch of changes.filter(c => c.kind === 'state')) { if (!byTracker.has(ch.col)) byTracker.set(ch.col, []); byTracker.get(ch.col).push(ch); }
    for (const list of byTracker.values()) {
        const t = L.board.trackers.find(x => x.id === list[0].col);
        const f = id => t.fields.find(x => x.id === id)?.name ?? id;
        const dayFrom = Math.min(...list.map(c => c.dayFrom)), dayTo = Math.max(...list.map(c => c.dayTo));
        const parts = [...(dayTo !== dayFrom ? [`Day ${dayFrom} → Day ${dayTo}`] : []), ...list.filter(c => c.to !== undefined).map(c => `${f(c.field)}: ${c.from ?? '—'} → ${c.to}`)];
        const skipped = [...new Set(list.flatMap(c => c.skipped || []))];
        const quotes = [...new Set(list.map(c => c.quote))].map(q => `<i>“${escapeHtml(q)}”</i>`).join('<br>');
        const show = () => (skipped.length ? toastr.warning : toastr.info)(`${escapeHtml(t.name)}: ${escapeHtml(parts.join(', '))}${skipped.length ? `<br>⚠️ skipped past ${escapeHtml(skipped.join(', '))}` : ''}<br>${quotes}<br><u>Undo</u>`,
            'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoCollections(list.map(c => c.logId)) });
        if (skipped.length) { try { show(); } catch { /* noop */ } } else echo(show);   // a warning always shows
    }
    for (const ch of changes.filter(c => c.kind === 'date')) {
        const text = describeStateChange(L.board, ch);
        const quote = `<br><i>“${escapeHtml(ch.quote)}”</i>`;
        if (ch.ask) {
            // "ask me first": a 📬 card (Miinthe, 2026-10-05 — requests belong in the mailbox, not in a toast)
            const msg = getContext()?.chat?.[at];
            addRequest({ id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from: 'board', kind: 'date', title: `Add “${ch.date.name}” to the calendar (Day ${ch.date.due})?`,
                q: ch.quote || '', why: ch.reason || text, ch, made: { i: at, at: new Date().toISOString(), mes: String(msg?.mes ?? '').slice(0, 80) } });
            echo(() => toastr.info(`📬 ${escapeHtml(text)} — waiting in the mailbox.`, 'Storyboard — add this date?', { escapeHtml: false, timeOut: 8000, onclick: () => window.__dleOpenRequests?.() }));
        } else echo(() => toastr.info(`📅 ${escapeHtml(text)}${quote}<br><u>Undo</u>`, 'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoCollection(ch.logId) }));
    }
    return changes.filter(c => !c.ask);
}

// 📬: "Add it" on a date card
onAnswer('date', (r, choice) => { if (choice === 'add') addAskedDate(r.ch, r.made?.i ?? lastMessageIndex()); return true; });

/** A date the helper found while the calendar says "ask me first" — added on Miinthe's click. */
function addAskedDate(ch, at) {
    const L = live();
    if (!L) return;
    const next = applyStateChanges(L.board, L.state, [{ ...ch, ask: false }], at, { who: 'auto' });
    saveLiveState(next);
    saveTrackers(getTrackers());
    echo(() => toastr.info(`📅 ${escapeHtml(ch.date.name)} — on the calendar for Day ${ch.date.due}.`, 'Storyboard', { escapeHtml: false }));
}

/** Check and apply the helper's meter changes, then drift; notices with Undo (a band change is a warning-free "big" notice). */
function applyMeters(list, messages) {
    const L = live();
    if (!L) return [];
    const at = lastMessageIndex();
    const { changes, rejected } = validateMeterChanges(list, L.board, L.state, messages);
    if (rejected.length) console.debug('[Onyx Quill] meter changes not applied:', rejected);
    for (const r of rejected.filter(x => x.held)) {
        try { toastr.warning(`${escapeHtml(r.what.split(':')[0])} stays below ${escapeHtml(r.held.band)} — only reachable once ${escapeHtml(r.held.why)}.${r.quote ? `<br><i>“${escapeHtml(r.quote)}”</i>` : ''}`, 'Storyboard', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ }
    }
    let st = changes.length ? applyMeterChanges(L.board, L.state, changes, at, { who: 'auto' }) : L.state;
    // drift: meters left alone long enough move one slight step back toward their resting value
    const drift = driftChanges(L.board, st, at, Number.isFinite(st.v2since) ? st.v2since : 0).filter(d => !changes.some(c => c.col === d.col));
    if (drift.length) st = applyMeterChanges(L.board, st, drift, at, { who: 'drift' });
    if (!changes.length && !drift.length) return [];
    saveLiveState(st);
    for (const ch of [...changes, ...drift]) {
        const text = describeMeterChange(L.board, ch);
        const show = () => toastr.info(`${crossesBand(ch) ? '📊 ' : ''}${escapeHtml(text)}${ch.quote ? `<br><i>“${escapeHtml(ch.quote)}”</i>` : ''}${ch.reason && ch.who !== 'drift' ? `<br>${escapeHtml(describeReason(ch))}` : ''}<br><u>Undo</u>`,
            'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoCollection(ch.logId) });
        echo(show);
    }
    return [...changes, ...drift];
}

/** Check and apply the helper's cast changes (someone comes in or leaves, someone learns something); notices with Undo. */
function applyCast(presence, learns, messages) {
    if (!presence.length && !learns.length) return [];
    const L = live();
    if (!L) return [];
    const { changes, rejected } = validateCastChanges(presence, learns, L.board, L.state, messages);
    if (rejected.length) console.debug('[Onyx Quill] cast changes not applied:', rejected);
    if (!changes.length) return [];
    saveLiveState(applyCastChanges(L.board, L.state, changes, lastMessageIndex(), { who: 'auto' }));
    for (const ch of changes) {
        echo(() => toastr.info(`🎭 ${escapeHtml(describeCastChange(L.board, ch))}<br><i>“${escapeHtml(ch.quote)}”</i>${ch.reason ? `<br>${escapeHtml(describeReason(ch))}` : ''}<br><u>Undo</u>`,
            'Cast', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoCollection(ch.logId) }));
    }
    return changes;
}

/** Check and apply the helper's place moves; notices with Undo. */
function applyPlaces(places, messages) {
    if (!places.length) return [];
    const L = live();
    if (!L) return [];
    const { changes, rejected } = validatePlaceChanges(places, L.board, L.state, messages);
    if (rejected.length) console.debug('[Onyx Quill] place moves not applied:', rejected);
    for (const r of rejected.filter(x => x.reason === 'not one of its places')) {
        try { toastr.warning(`${escapeHtml(r.unknown.tracker)}: “${escapeHtml(r.unknown.place)}” isn't one of its places — the scene stays where it was.${r.unknown.quote ? `<br><i>“${escapeHtml(r.unknown.quote)}”</i>` : ''}`, 'Storyboard', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ }
    }
    if (!changes.length) return [];
    saveLiveState(applyPlaceChanges(L.board, L.state, changes, lastMessageIndex(), { who: 'auto' }));
    for (const ch of changes) {
        echo(() => toastr.info(`📍 ${escapeHtml(describePlaceChange(L.board, ch))}<br><i>“${escapeHtml(ch.quote)}”</i>${ch.reason ? `<br>${escapeHtml(describeReason(ch))}` : ''}<br><u>Undo</u>`,
            'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoCollection(ch.logId) }));
    }
    return changes;
}

/** Undo several logged changes at once (newest first) — one notice's Undo. */
export function undoCollections(logIds) {
    const L = live();
    if (!L) return false;
    let st = L.state;
    for (const id of [...logIds].reverse()) { const r = undoCollectionChange(L.board, st, id); if (!r.error) st = r.state; }
    saveLiveState(st);
    saveTrackers(getTrackers());
    try { toastr.info('Put back as it was.', 'Storyboard'); } catch { /* noop */ }
    return true;
}

/** Undo one collection change (its notice, or the Story tab). */
export function undoCollection(logId) {
    const L = live();
    if (!L) return false;
    const r = undoCollectionChange(L.board, L.state, logId);
    if (r.error) { try { toastr.info(`Nothing to undo — ${r.error}.`, 'Storyboard'); } catch { /* noop */ } return false; }
    saveLiveState(r.state);
    saveTrackers(getTrackers());          // lines waiting on it may close again
    try { toastr.info('Put back as it was.', 'Storyboard'); } catch { /* noop */ }
    return true;
}

/**
 * Undo a tracker's last automatic move: back to where it was, and remember the
 * move so the same line does not re-apply it on the next turn.
 */
export function undoAutoMove(name) {
    const list = getTrackers();
    const i = list.findIndex(t => t.name === name);
    if (i === -1 || !list[i].lastAuto) return false;
    const m = list[i].lastAuto;
    const at = lastMessageIndex();
    const t = list[i];
    const meta = { who: 'undo', at: new Date().toISOString() };
    // engine on v2, step 3b part 3: on the v2 state (journalled like before: only if step or detour change)
    const moves = t.index !== m.fromIndex || (t.aside || null) !== (m.fromAside || null);
    const v2 = applyOnV2(list, (board, st, J) => {
        const other = m.branch && m.startedOther ? list.find(x => x.name === m.startedOther.name) : null;
        undoAutoV2(board, st, board.trackers.find(x => x.id === t.id), m, other ? board.trackers.find(x => x.id === other.id) : null);
        J.set(t.id, n => ({ ...(moves ? moveTo(n, n.index, at, meta) : n), lastAuto: null, undone: rememberUndo(t.undone, m) }));
    });
    if (!v2) return false;
    saveTrackers(v2.list);
    const n = getTrackers().find(x => x.id === t.id);
    try { toastr.info(`${name}: back to ${n.steps[n.index]}${n.aside ? ` (${n.aside})` : ''}.`, 'Story tracker'); } catch { /* noop */ }
    return true;
}
