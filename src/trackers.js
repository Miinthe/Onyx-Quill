/**
 * LOCAL PATCH (Miinthe, 2026-10-02) — Story trackers: SillyTavern glue.
 *
 * The rules live in trackers-pure.js. This file reads and writes chat
 * metadata, runs the slash commands, reacts to deletes, branches and New Run,
 * and tells the Story tab when to redraw. It never touches gating fields.
 */
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, saveMetadataDebounced, extension_settings } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { escapeHtml } from '../../../../utils.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../../slash-commands/SlashCommandArgument.js';
import { resetAiSearchCache } from './state.js';
import {
    TRACKERS_KEY, asList, findIndex, newTracker, moveTo, withSteps, currentStep, describe, RUN_WORDS, withBaseline,
    pruneAfter, resetForNewRun, parseTrackerSpec, parseStepsText,
    record,
} from './trackers-pure.js';
import { activeOnly, unmetNeeds, conditionText } from './conditions-pure.js';
import { unbranchAfter, describeTake, pendingFork } from './forks-pure.js';
import { rewindLiveTo, live, STATE_KEY, boardOffHere, setBoardOff, recordSteps, logSteps } from './board-live.js';
import { stepTurn, hasStarts as hasStartsV2 } from './turn-pure.js';
import { boardStore, getBoard, putBoard, engineBoard, engineBoards, saveDefs } from './board-store.js';   // step 5: one board store
import { completeStepLog } from './convert-pure.js';   // step 6: stored chats
import { echo } from './echo.js';   // Immersion = no echoes (Miinthe, 2026-10-05)   // engine on v2, step 3b: the turn on the v2 state
import { moveStepV2, setAsideV2, runStepV2, undoRunStepV2, takeBranchAtV2, helperMoveV2 } from './movers-pure.js';   // step 3b part 2/3: moves by hand, branches
import { rewindCollections as rewindCollectionsV2 } from './collections-pure.js';   // engine on v2, step 3: one roll back   // LOCAL PATCH (Miinthe, 2026-10-05): collections roll back with the trackers; triggers + odds (2026-10-04)
import { denyTrigger, hasRollsOrTriggers, describeRoll, describeTrigger } from './rolls-pure.js';
import { turnIndex } from './turn-index.js';
import { runOf as runOfV2, setRun as setRunV2, engineDiff, normalizeBoard as normalizeBoardV2, normalizeState as normalizeStateV2, toEngineList as toEngineListV2, fromEngineList as fromEngineListV2, freshState as freshStateV2, trackerOf as trackerOfV2, migrateV1, isActive as isActiveV2, isWaiting as isWaitingV2, pausedBy as pausedByV2, unmetNeeds as unmetNeedsV2, condText as condTextV2, blockClause as blockClauseV2 } from './board-model-pure.js';   // pause / abandon of collections, places, state (2026-10-04)
import { forgetTurnUndo } from './reevaluate-pure.js';
import {
    BOARD_KEY, withIds, defOf, makeBoard, freeBoardName, mergeBoard, defsDiffer, boardSummary, resolveBoardName, wasDeleted, STORE_KEY,
} from './storyboard-pure.js';

export { parseStepsText };

// ─── Storyboards (LOCAL PATCH, Miinthe, 2026-10-03 — roadmap §4 G) ───────────────
// A chat may use a named board stored on the SillyTavern side; then the board owns
// the trackers' definitions and the chat keeps only its place. Without a board,
// everything below works exactly as before (per-chat trackers).

// LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 5: one board store (board-store.js). The engine's list still
// reads a tracker's definitions in the older shape; `engineBoard` makes that from the stored board, never stores it.
export function listBoards() {
    return engineBoards();
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 6: a chat from before the v2 log was complete gets its early
 * part rebuilt from the list's history on opening (convert-pure.js), once. The list as it was is kept under
 * `deeplore_trackers_v1_backup` (roadmap cleanup list). Returns how many entries were added, or 0.
 */
export function completeChat(name = currentBoardName()) {
    const board = getBoard(name);
    const list = legacyTrackers();
    if (!board || !list.length || !list.every(t => trackerOfV2(board, t.id)?.kind === 'steps')) return 0;
    const raw = chat_metadata?.[STATE_KEY];
    const prev = raw ? normalizeStateV2(raw, board) : freshStateV2(board);
    if (prev.stepsRebuilt) return 0;   // once per chat
    // the WHOLE step log is rebuilt from the list's history (kept right all along): the part logged since step 1 can miss
    // moves made in a save that also rolled or fired a trigger (the old turn stored the board's state first — found by
    // the step 6 test); the history's rules equal the old roll back at every message (tested)
    const st = fromEngineListV2(board, prev, list);
    st.log = (st.log || []).filter(e => e.kind !== 'step');
    const r = completeStepLog(board, st, list);
    r.state.stepsRebuilt = 1;
    if (!chat_metadata.deeplore_trackers_v1_backup) chat_metadata.deeplore_trackers_v1_backup = structuredClone(asList(chat_metadata?.[TRACKERS_KEY]));
    chat_metadata[STATE_KEY] = r.state;
    saveMetadataDebounced();
    return r.added.length;
}

/**
 * /dle-tracker-rewind (engine on v2, step 7): where the trackers stood at message `idx` (the v2 log), made a move by
 * hand now — the messages after it and the board's items / places stay as they are. Returns { moved } or { error }.
 */
export function rewindTrackersTo(idx) {
    const at = v2Rewind(idx);
    if (!at) return { error: 'The board\'s log doesn\'t reach back to that message.' };
    const meta = { who: 'hand', at: new Date().toISOString() };
    const moved = [];
    const list = getTrackers().map(t => {
        const n = at.list.find(x => x.id === t.id);
        if (!n || placeKey(n) === placeKey(t)) return t;
        moved.push(`${t.name}: ${describe(t)} → ${describe(n)}`);
        return moveTo({ ...t, index: n.index, aside: n.aside ?? null, took: n.took || {}, ended: n.ended, run: n.run, started: n.started, startedAt: n.startedAt }, n.index, lastMessageIndex(), meta);
    });
    if (moved.length) save(list);
    return { moved };
}

const NO_BOARD = { error: 'This chat has no storyboard — open it again (its trackers become a board of their own).' };

/** The name of the board this chat uses, or null. */
export function currentBoardName() {
    return chat_metadata?.[BOARD_KEY] || null;
}

function boardOf() {
    const name = currentBoardName();
    return name ? engineBoard(name) : null;
}

function characterKey() {
    const ctx = getContext();
    if (ctx?.groupId) return null;
    const ch = ctx?.characters?.[ctx?.characterId];
    return ch?.avatar || null;
}

/** @type {Set<() => void>} */
const listeners = new Set();
export function onTrackersChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function changed() {
    // The judge's cached picks were made against the old story state.
    try { resetAiSearchCache(); } catch { /* noop */ }
    for (const cb of [...listeners]) { try { cb(); } catch (e) { console.warn('[DLE] tracker listener:', e?.message); } }
}

/** Redraw views and drop stale judge picks — e.g. after switching chats. */
export function notifyTrackersView() { changed(); }

/** This chat's trackers, in display order: the board's definitions with this chat's place. */
export function getTrackers() {
    return viewFromV2() ?? legacyTrackers();
}

/** The list as stored (a chat not yet on the v2 state, or the old engine in the tests). */
function legacyTrackers() {
    const stored = asList(chat_metadata?.[TRACKERS_KEY]);
    const board = boardOf();
    // every tracker carries its starting point in its journal (withBaseline — the delete roll-back needs it)
    return (board ? mergeBoard(board, stored, newTracker).list : stored).map(withBaseline);
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 7: this chat's trackers in the list's shape, made from the v2
 * state (positions, its memory) and the v2 log (`lastMoveAt`) — the stored list is no longer written once a chat is
 * on the v2 state (`stepsRebuilt`). A chat not there yet is converted here, once (step 6). Null: the old way.
 */
let converting = false;
function viewFromV2() {
    const name = currentBoardName();
    const board = name ? getBoard(name) : null;
    if (!board) return null;
    if (!chat_metadata?.[STATE_KEY]?.stepsRebuilt && !converting) { converting = true; try { completeChat(name); } finally { converting = false; } }
    const raw = chat_metadata?.[STATE_KEY];
    if (!raw?.stepsRebuilt) return null;
    return viewOf(board, normalizeStateV2(raw, board));
}
function viewOf(board, st) {
    const last = {};
    for (const e of st.log || []) if (e.kind === 'step') last[e.col] = Math.max(last[e.col] ?? 0, e.i);
    return toEngineListV2(board, st, []).map(v => {
        const t = trackerOfV2(board, v.id), p = st.trackers[v.id] || {};
        const n = { ...v, ...(p.started ? { started: true } : {}), ...(p.startedAt ? { startedAt: p.startedAt } : {}), lastMoveAt: last[v.id] ?? 0 };
        if (!p.started && hasStartsV2(board, t)) { n.started = false; delete n.startedAt; }
        return { ...n, ...verdictOf(board, st, t) };
    });
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 7c: the board's own verdict on a tracker, carried on the
 * list's tracker for the readers (conditions-pure.js reads it): `state` running / waiting / paused / abandoned,
 * `active`, why it is paused (by you, its start fell, a block, another holds the floor — Miinthe, 2026-10-05: "make
 * them work"), and `unmet`: per step index, what keeps that step closed (needs, and blocks that lock it).
 */
function verdictOf(board, st, t) {
    const run = st.trackers?.[t.id]?.run;
    const state = run === 'abandoned' ? 'abandoned' : run === 'paused' ? 'paused' : isWaitingV2(board, st, t) ? 'waiting' : isActiveV2(board, st, t) ? 'running' : 'paused';
    const unmet = {};
    // a need not met reads "once …"; a block that locks the step reads "while …" (as the window says them)
    t.steps.forEach((s, k) => { const u = unmetNeedsV2(board, st, t, s.id); if (u.length) unmet[k] = u.map(c => ({ text: (s.blocks || []).includes(c) ? blockClauseV2(board, c) : `once ${condTextV2(board, c)}` })); });
    return { state, active: state === 'running', pausedWhy: state === 'paused' ? pausedByV2(board, st, t) : null, unmet };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 2: what the READERS see (the writer's and judge's lines, the
 * step- and branch-linked lore, Mero). Built from the v2 chat state once it is kept there (`v2steps`, step 1) — the
 * same shape as the engine's list, so the readers don't change; only where the positions come from. Falls back to
 * the engine's list while a chat has no v2 copy yet. The helper and the Story tab still read the list (step 3).
 */
export function readTrackers() {
    return getTrackers();   // engine on v2, step 7: getTrackers is the v2 view (with the board's verdict) — one reading
}
/** The running trackers as the readers see them (step 2). */
export function readActiveTrackers() {
    if (boardOffHere()) return [];
    return activeOnly(readTrackers());
}

/** Only the running trackers (not waiting, not paused) — what the helper, writer and judge get. */
export function getActiveTrackers() {
    if (boardOffHere()) return [];    // the board is switched off for this chat / character (board-live.js)
    return activeOnly(getTrackers());
}

/** Save trackers (also used by automatic moves) and redraw. */
export function saveTrackers(list) { save(list); }

/**
 * Undo a trigger's move (its notice): the tracker goes back, and the trigger never fires again
 * in this chat (Miinthe, 2026-10-04 — "Undo means don't fire this again", like Deny).
 */
export function undoTrigger(logId) {
    const L = live();
    if (!L) return false;
    const r = denyTrigger(L.state, logId);
    if (r.error) { try { toastr.info(`Nothing to undo — ${r.error}.`, 'Storyboard'); } catch { /* noop */ } return false; }
    chat_metadata[STATE_KEY] = r.state;
    // engine on v2, step 3b part 3: the move back on the v2 state where it can be (journalled as before)
    const cur = getTrackers(), hit = cur.find(t => t.id === r.entry.col && t.lastTrigger?.logId === logId);
    const v2 = hit ? applyOnV2(cur, (board, st, J) => {
        const lt = hit.lastTrigger;
        helperMoveV2(board, st, board.trackers.find(x => x.id === hit.id), lt.fromIndex, lt.fromAside || hit.aside || '');
        J.set(hit.id, n => { const { lastTrigger: _l, ...rest } = moveTo(n, n.index, lastMessageIndex(), lt.fromAside ? { who: 'undo' } : { who: 'undo', at: new Date().toISOString() }); return rest; });
    }) : null;
    save(v2 ? v2.list : cur);   // (no Undo memory on it: the trigger is still stopped, the tracker stays)
    const t = getTrackers().find(x => x.id === r.entry.col);
    try { toastr.info(`${escapeHtml(t?.name ?? '')}: back to ${escapeHtml(t ? t.steps[t.index] : '')}. That trigger won't fire again in this chat.`, 'Storyboard', { escapeHtml: false }); } catch { /* noop */ }
    return true;
}

let quietBoard = false;   // Re-evaluate's rewind: no rolls or triggers while going back

/**
 * Re-evaluate (reevaluate.js): undo everything recorded at message `start` or later — tracker moves,
 * branches, starts, the board's changes (items, places, the clock, dates, rolls, triggers) — and keep
 * what came before (up to `keep`). Undo memory pointing at those moves is dropped. No board turn runs.
 */
export function rewindTurn(keep, start) {
    quietBoard = true;
    try {
        // engine on v2, step 3: from the v2 log where it holds every move
        const v2 = v2Rewind(keep);
        if (v2) { chat_metadata[STATE_KEY] = v2.state; save(v2.list.map(t => forgetTurnUndo(t, start))); return; }
        // the log doesn't reach back that far (over its cap): the board's own changes go back, the trackers stay
        rewindLiveTo(keep);
        save(getTrackers().map(t => forgetTurnUndo(t, start)));
    } finally { quietBoard = false; }
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 3: ONE roll back. Deleting messages, opening a branch and
 * Re-evaluate undo the v2 log's changes from later messages — the step moves (logged since step 1) with the
 * items, places, clock, dates, rolls and triggers — and the engine's list then takes its places from the v2 state.
 * Only where the v2 log holds every move back to `idx` (from `v2since`, and nothing dropped by the cap after it);
 * otherwise null, and the journal does it as before. The list's own memory (journal, refusals, branch log) is pruned
 * as before. Returns { state, list, undone } without storing anything.
 */
function v2Rewind(idx, keep = null) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    const raw = chat_metadata?.[STATE_KEY];
    if (!rec?.board || !raw?.v2steps || !Number.isFinite(raw.v2since) || idx < raw.v2since || idx < (Number.isFinite(raw.logDropped) ? raw.logDropped : -1)) return null;
    const board = normalizeBoardV2(rec.board, name);
    const r = rewindCollectionsV2(board, normalizeStateV2(raw, board), idx, keep);
    const list = getTrackers();
    // ended / started-at come from the rolled-back v2 state alone (the list's own copy may be from after idx)
    const own = t => { const p = r.state.trackers?.[t.id] || {}; return { ended: p.ended ? { ...p.ended } : undefined, startedAt: p.startedAt ?? undefined }; };
    const view = toEngineListV2(board, r.state, list).map(t => unbranchAfter({ ...t, ...own(t), journal: pruneAfter(t.journal, idx, keep), refused: (t.refused || []).filter(x => x.i <= idx) }, idx));
    return { state: r.state, list: [...view, ...list.filter(t => !view.some(v => v.id === t.id))], undone: r.undone };
}
const placeKey = t => JSON.stringify([describe(t), t.took && Object.keys(t.took).length ? t.took : {}, t.ended || null, t.run || null, !!t.started]);
async function reconcileFromV2(v2, idx, { prune, confirm }) {
    const before = getTrackers();
    const plans = before.map(t => { const n = v2.list.find(x => x.id === t.id) || t; return placeKey(n) === placeKey(t) ? { name: t.name, change: false } : { name: t.name, change: true, from: describe(t), to: describe(n) }; });
    if (confirm && !prune && plans.some(p => p.change)) {
        if (confirmOpen) return [];
        confirmOpen = true;
        let ok = false;
        try {
            const rows = plans.filter(p => p.change).map(p => `<p>${escapeHtml(p.name)}: <b>${escapeHtml(p.from)}</b> → <b>${escapeHtml(p.to)}</b></p>`).join('');
            ok = !!await callGenericPopup(
                `<h3>This chat ends at message ${idx}</h3>
                 <p>Its story trackers are further along than the story here — usually because this is a branch, which inherits the state from where it was made.</p>
                 ${rows}
                 <p style="opacity:.7;font-size:.9em;margin-top:1em">You can apply it later with <code>/dle-tracker-rewind</code>.</p>`,
                POPUP_TYPE.CONFIRM, '', { okButton: 'Roll back to message ' + idx, cancelButton: 'Leave as is' },
            );
        } finally { confirmOpen = false; }
        if (!ok) return plans.map(p => ({ ...p, change: false, reason: 'declined' }));
    }
    const other = v2.undone.filter(e => e.kind !== 'step');
    if (prune && other.length) echo(() => { toastr.info(`${other.length} change${other.length > 1 ? 's' : ''} on the board rolled back with the deleted messages.`, 'Storyboard'); });
    chat_metadata[STATE_KEY] = v2.state;
    save(v2.list);
    return plans;
}

/** On each reply: give the board its turn even when nothing moved (a failed roll may roll again after N messages). */
export function boardTick() {
    const L = live();
    if (!L || !hasRollsOrTriggers(L.board)) return;
    save(getTrackers());
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 3b: the turn after a move runs on the v2 state (turn-pure.js
 * stepTurn); the engine's list is then taken from it (positions) with its own memory added for what the turn did
 * (journal entries for rolls and trigger moves, the trigger's Undo). Returns false where it can't (no board from
 * the window, a tracker only this chat has, or the old turn forced by the tests) — save() then runs the old loop.
 */
/** The window board and this chat's stored v2 state, when the engine can work on v2 here (else null — the old way). */
function v2Here(list) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    if (!rec?.board) return null;
    const board = normalizeBoardV2(rec.board, name);
    if (!withIds(list).every(t => trackerOfV2(board, t.id)?.kind === 'steps')) return null;
    const raw = chat_metadata?.[STATE_KEY];
    return { board, prev: raw ? normalizeStateV2(raw, board) : freshStateV2(board) };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 3b part 2: a move by hand made on the v2 state (movers-pure.js).
 * `edit(board, state, t)` changes a copy of this chat's state (current with the list); the list then takes the
 * tracker from it, journalled with `meta` like before, `memo(n, before)` adds the list's own memory (the Undo), and
 * save() runs the turn and stores both. Returns { t } / { error }, or null where the engine can't work on v2 here.
 */
function moveOnV2(list, i, edit, meta, memo = n => n) {
    const r = applyOnV2(list, (board, st, J) => {
        const err = edit(board, st, trackerOfV2(board, list[i].id));
        if (err?.error) return err;
        J.set(list[i].id, n => memo(moveTo(n, n.index, lastMessageIndex(), meta), list[i]));
    });
    if (!r || r.error) return r;
    save(r.list);
    return { t: r.list.find(x => x.id === list[i].id) };
}

/**
 * Engine on v2, step 3b part 3: change the v2 state with `edit(board, state, J)` (a copy, current with `list`), then
 * take the list from it — every tracker's place from v2, and for each id in `J` its list memory by `J.get(id)(n)`
 * (a journal entry, an Undo). Returns { list, state, result } (not stored — the caller saves), { error }, or null
 * where the engine can't work on v2 here.
 */
export function applyOnV2(list, edit) {
    const ctx = v2Here(list);
    if (!ctx) return null;
    const st = fromEngineListV2(ctx.board, ctx.prev, list);
    const J = new Map();
    const result = edit(ctx.board, st, J);
    if (result?.error) return result;
    const out = toEngineListV2(ctx.board, st, list).map(v => {
        const t = trackerOfV2(ctx.board, v.id), p = st.trackers[v.id] || {};
        let n = { ...v, ...(p.started ? { started: true } : {}), ...(p.startedAt ? { startedAt: p.startedAt } : {}) };
        if (!p.started && hasStartsV2(ctx.board, t)) { n.started = false; delete n.startedAt; }
        return J.has(v.id) ? J.get(v.id)(n) : n;
    });
    return { list: out, state: st, result };
}

function saveOnV2(list) {
    const ctx = v2Here(list);
    if (!ctx) return false;
    const { board, prev } = ctx;
    const list0 = withIds(list);
    const i = lastMessageIndex(), at = new Date().toISOString();
    const r = stepTurn(board, fromEngineListV2(board, prev, list0), i, { quiet: quietBoard, off: boardOffHere(), at });
    const last = new Map(), trig = new Map();
    for (const e of r.events) {
        if (e.kind === 'roll' || e.kind === 'trigger') last.set(e.id, e);
        if (e.kind === 'trigger') trig.set(e.id, { logId: e.logId, fromIndex: e.fromIndex, fromAside: e.fromAside, message: i });
    }
    const out = toEngineListV2(board, r.state, list0).map(t => {
        const p = r.state.trackers?.[t.id] || {};
        let n = { ...t, ...(p.started ? { started: true } : {}), ...(p.startedAt ? { startedAt: p.startedAt } : {}) };
        const e = last.get(t.id);
        if (e?.kind === 'roll') n = { ...n, journal: record(n.journal, i, n.index, n.aside, { who: 'roll', at, took: { ...(n.took || {}) }, ...(n.ended ? { ended: n.ended } : {}) }) };
        if (e?.kind === 'trigger') n = moveTo(n, n.index, i, { who: 'trigger', at, reason: `because ${e.why}` });
        if (trig.has(t.id)) n.lastTrigger = trig.get(t.id);
        return n;
    });
    // what to tell — as before: who started, the rolls (lines and forks), the triggers' moves with their Undo
    // all of these are echoes: quiet in Immersion (Miinthe, 2026-10-05: "immersion is just meant to shut up echo everything")
    const quiet = board.mode === 'immersion';
    if (!quiet) for (const e of r.events) if (e.kind === 'start') { try { toastr.info(`${escapeHtml(e.name)} has started — ${escapeHtml(e.why)}.`, 'Storyboard', { escapeHtml: false }); } catch { /* noop */ } }
    for (const e of r.events) {
        const text = quiet ? null : e.kind === 'roll' ? `🎲 ${describeTake(e.effect)} (rolled ${e.effect.odds})` : e.kind === 'line-roll' ? describeRoll(board, e.x) : null;
        if (text) { try { toastr.info(escapeHtml(text), 'Storyboard', { escapeHtml: false, timeOut: 12000 }); } catch { /* noop */ } }
    }
    if (!quiet) for (const e of r.events) if (e.kind === 'trigger') {
        try { toastr.info(`${escapeHtml(describeTrigger(board, e.x))}<br><u>Undo</u> (it won't fire again)`, 'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => undoTrigger(e.logId) }); } catch { /* noop */ }
    }
    // the list's memory (the turn's trigger Undo …) into the state; the list itself is stored only until a chat is on v2
    const done = fromEngineListV2(board, r.state, out);
    if (!done.stepsRebuilt) chat_metadata[TRACKERS_KEY] = out;
    chat_metadata[STATE_KEY] = logSteps(board, prev, done, out, i);
    saveMetadataDebounced();
    changed();
    return true;
}

function save(list) {
    // a tracker renamed / its steps edited / added / removed here (Story tab, commands): into the stored board first
    const bname = currentBoardName(), eb = bname ? engineBoard(bname) : null;
    if (eb && defsDiffer(eb, withIds(list))) saveDefs(bname, withIds(list).map(defOf));
    if (saveOnV2(list)) return;
    // no board (only a chat from before boards, until it is opened — syncBoardOnOpen makes it one): stored as it is
    chat_metadata[TRACKERS_KEY] = withIds(list);
    saveMetadataDebounced();
    changed();
}

/** Use board `name` in this chat. Trackers already here keep their place (matched by id or name). */
export function applyBoard(name) {
    const board = engineBoard(name);
    if (!board) return { error: `No storyboard called "${name}".` };
    const before = getTrackers();   // as this chat has them now (from v2 once it is there — the stored list may be old)
    chat_metadata[BOARD_KEY] = name;
    const { list, lost } = mergeBoard(board, before, newTracker);
    chat_metadata[TRACKERS_KEY] = list;
    try { recordSteps(list, lastMessageIndex(), { silent: true }); } catch { /* no v2 board */ }   // engine on v2, step 1
    saveMetadataDebounced();
    changed();
    return { name, lost };
}

/** Save this chat's trackers as a new board and use it here. The old board stays as it was. */
export function saveBoardAs(wanted) {
    const name = freeBoardName(boardStore(), wanted);
    // the board this chat uses, copied whole (its links, forks, collections …); else one made from the chat's own trackers
    const cur = getBoard(currentBoardName());
    putBoard(name, cur ? { ...structuredClone(cur), name, applied: [], off: [] } : migrateV1(makeBoard(name, getTrackers()), name));
    chat_metadata[BOARD_KEY] = name;
    chat_metadata[TRACKERS_KEY] = withIds(getTrackers());
    saveMetadataDebounced();
    changed();
    return name;
}

/**
 * Stop using a board here; the chat keeps its own copy of the trackers — as a board of its own, named after the chat
 * (engine on v2, step 7: there are no trackers without a board any more; opening the chat did this before).
 */
export function detachBoard() {
    if (!currentBoardName()) return;
    saveBoardAs(getContext()?.getCurrentChatId?.() || 'Storyboard');
}

/** This chat stops using any board: its trackers, place on the board and board name go (a deleted board). */
function clearChatBoard() {
    delete chat_metadata[BOARD_KEY];
    delete chat_metadata[STATE_KEY];
    chat_metadata[TRACKERS_KEY] = [];
    saveMetadataDebounced();
}

/**
 * Delete board `name` everywhere (Miinthe, 2026-10-17). Chats that used it end up with no board: this one now,
 * the others when they next open (the name is remembered in `deleted`, so they don't rebuild it from their own copy).
 */
export function deleteBoard(name) {
    const s = boardStore();
    if (!s.boards[name]) return { error: `No storyboard called "${name}".` };
    delete s.boards[name];
    const old = extension_settings?.[STORE_KEY];
    if (old?.boards) delete old.boards[name];   // the old store must not bring it back
    for (const [k, v] of Object.entries(s.characters)) if (v === name) delete s.characters[k];
    s.deleted = [...new Set([...(Array.isArray(s.deleted) ? s.deleted : []).filter(n => n !== name), name])].slice(-100);
    saveSettingsDebounced();
    if (currentBoardName() === name) clearChatBoard();
    notifyTrackersView();
    return { ok: true };
}

/** Default board for new chats with the current character (null clears it). */
export function setCharacterBoard(name) {
    const key = characterKey();
    if (!key) return { error: 'Open a chat with a single character first.' };
    const s = boardStore();
    if (name && !s.boards[name]) return { error: `No storyboard called "${name}".` };
    if (name) s.characters[key] = name; else delete s.characters[key];
    saveSettingsDebounced();
    return { ok: true };
}

export function characterBoardName() {
    const key = characterKey();
    return key ? boardStore().characters[key] || null : null;
}

/**
 * On opening a chat: a chat that still has per-chat trackers (from before boards)
 * gets them turned into a board of its own — positions and history kept; a fresh
 * chat with a character that has a default board gets that board; a chat whose
 * board changed meanwhile is brought up to date, and a tracker whose step was
 * removed from the board is reported, not moved silently.
 */
export function syncBoardOnOpen() {
    const ctx = getContext();
    if (!ctx?.chatId && !ctx?.getCurrentChatId?.()) return null;
    const stored = asList(chat_metadata?.[TRACKERS_KEY]);
    let name = currentBoardName();
    // the board was renamed since this chat last opened: follow it (cloud bug hunt, 2026-10-04)
    const now = resolveBoardName(boardStore(), name);
    if (name && now && now !== name) { chat_metadata[BOARD_KEY] = now; saveMetadataDebounced(); name = now; }
    if (name && !boardStore().boards[name] && wasDeleted(boardStore(), name)) {
        // deleted on purpose (the board's Delete board…): this chat has no board any more — no copy rebuilt from its trackers
        try { toastr.info(`The storyboard "${name}" was deleted — this chat has no board now.`, 'DeepLore'); } catch { /* noop */ }
        clearChatBoard();
        return null;
    }
    if (name && !boardStore().boards[name]) {
        // Board deleted or from another account: keep the chat's own copy.
        try { toastr.warning(`This chat's storyboard "${name}" no longer exists — it keeps its own copy of the trackers.`, 'DeepLore'); } catch { /* noop */ }
        delete chat_metadata[BOARD_KEY];
        saveMetadataDebounced();
        return null;
    }
    if (!name && stored.length) {
        const chatName = ctx.getCurrentChatId?.() || 'Storyboard';
        const made = saveBoardAs(`${chatName}`);
        return { migrated: made };
    }
    if (!name && !stored.length) {
        const def = characterBoardName();
        const chat = ctx.chat || [];
        if (def && chat.filter(m => m && !m.is_system).length <= 1) {
            applyBoard(def);
            return { applied: def };
        }
        return null;
    }
    if (chat_metadata?.[STATE_KEY]?.stepsRebuilt) return syncOnV2(name);
    // a chat from before (step 6): a step it stood at that the board no longer has is said out loud, then it is
    // converted (its history into the step log) and synced like any other
    const { lost } = mergeBoard(engineBoard(name), stored, newTracker);
    if (lost.length) {
        try {
            toastr.warning(lost.map(l => `${escapeHtml(l.name)}: this chat stood at "${escapeHtml(l.step)}", which is no longer on the board — now at step 1. Move it where it belongs.`).join('<br>'),
                'Storyboard', { escapeHtml: false, timeOut: 0, extendedTimeOut: 0, closeButton: true });
        } catch { /* noop */ }
    }
    try { completeChat(name); } catch (err) { console.warn('[DLE] v2 log not completed:', err?.message || err); }
    if (chat_metadata?.[STATE_KEY]?.stepsRebuilt) syncOnV2(name);
    return { synced: name, lost };
}

/**
 * Opening a chat that is on the v2 state (step 7): a step the chat stood at that is no longer on the board is said
 * out loud (it goes back to the start), and start lines the board gained that already hold start now.
 */
function syncOnV2(name) {
    const board = getBoard(name), raw = chat_metadata?.[STATE_KEY];
    const lost = board.trackers.filter(t => t.kind === 'steps' && raw.trackers?.[t.id]?.at != null && !t.steps.some(s => s.id === raw.trackers[t.id].at)).map(t => ({ name: t.name }));
    if (lost.length) {
        try {
            toastr.warning(lost.map(l => `${escapeHtml(l.name)}: this chat stood at a step that is no longer on the board — now at step 1. Move it where it belongs.`).join('<br>'),
                'Storyboard', { escapeHtml: false, timeOut: 0, extendedTimeOut: 0, closeButton: true });
        } catch { /* noop */ }
    }
    const st = normalizeStateV2(raw, board);
    if (lost.length || stepTurn(board, st, lastMessageIndex(), { quiet: true }).events.some(e => e.kind === 'start')) {
        quietBoard = true;
        try { save(getTrackers()); } finally { quietBoard = false; }
    }
    return { synced: name, lost };
}

function lastMessageIndex() {
    return turnIndex(getContext()?.chat);   // the newest message, or the turn Re-evaluate re-runs (turn-index.js)
}

/** Create a tracker, or replace the steps of an existing one (keeping its position when possible). */
export function setTracker(name, steps, { direction = null, rename = null, skip = null } = {}) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i === -1) {
        list.push({ ...newTracker((rename || name).trim(), steps), direction: direction === 'forward' ? 'forward' : 'both', skip: skip === true });
    } else {
        let t = withSteps(list[i], steps);
        if (direction) t = { ...t, direction: direction === 'forward' ? 'forward' : 'both' };
        if (skip !== null) t = { ...t, skip: skip === true };
        if (rename && rename.trim() && rename.trim() !== t.name) t = { ...t, name: rename.trim() };
        list[i] = t;
    }
    save(list);
}

export function moveTracker(name, { delta = null, toIndex = null, who = 'hand' } = {}) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i === -1) return { error: `No tracker called "${name}" in this chat.` };
    const target = toIndex !== null ? toIndex : list[i].index + (delta || 0);
    const to = Math.min(Math.max(Math.floor(target), 0), list[i].steps.length - 1);
    const unmet = unmetNeeds(list[i], to, list);
    // news and rumors never push past what the board allows (bug hunt 2026-10-19); only a hand move may
    if (unmet.length && who === 'world') return { error: `${list[i].steps[to]} isn't possible yet.` };
    if (unmet.length && who === 'hand') {
        // By hand the author decides — allowed, but said out loud (a need not met, or a block locking the step).
        try { toastr.warning(`${escapeHtml(list[i].steps[to])} is normally only possible ${escapeHtml(unmet.map(n => n.text ? n.text : `once ${conditionText({ tracker: n.tracker, step: n.reach }, list)}`).join(' and '))}. Moved anyway, by hand.`, 'Storyboard', { escapeHtml: false }); } catch { /* noop */ }
    }
    // engine on v2, step 3b part 2: the move is made on the v2 state where it can be
    // `who: 'world'`: a rumor or news moved it (world layer stage 5, only where the tracker's switch is on) — logged as the world's
    const v2 = moveOnV2(list, i, (b, s, t) => moveStepV2(b, s, t, target), { who, at: new Date().toISOString() });
    if (!v2) return NO_BOARD;
    const n = getTrackers().find(x => x.id === v2.t.id) || v2.t;
    return { name: n.name, value: currentStep(n), index: n.index, count: n.steps.length };
}

/** Set or clear (empty text) a tracker's aside — a detour such as Nuisance. */
export function setTrackerAside(name, aside) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i === -1) return { error: `No tracker called "${name}" in this chat.` };
    const v2 = moveOnV2(list, i, (b, s, t) => setAsideV2(b, s, t, aside), { who: 'hand', at: new Date().toISOString() });
    if (!v2) return NO_BOARD;
    const n = getTrackers().find(x => x.id === v2.t.id) || v2.t;
    return { name: n.name, value: describe(n) };
}

/**
 * Take a fork's branch by hand (Story tab buttons, /dle-tracker-branch). The tracker must
 * stand at that fork. Afterwards as the branch says (on / back / end / next).
 */
export function chooseBranch(name, branch) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i === -1) return { error: `No tracker called "${name}".` };
    const pend = pendingFork(list[i]);
    if (!pend) return { error: `${list[i].name} is not waiting at a fork.` };
    // engine on v2, step 3b part 3: on the v2 state where it can be
    const meta = { who: 'hand', at: new Date().toISOString() };
    const v2 = applyOnV2(list, (board, st, J) => {
        const r = takeBranchAtV2(board, st, trackerOfV2(board, list[i].id), pend.step, branch, lastMessageIndex(), meta);
        if (r.error) return r;
        J.set(list[i].id, n => ({ ...n, journal: record(n.journal, lastMessageIndex(), n.index, n.aside, { ...meta, took: { ...(n.took || {}) }, ...(n.ended ? { ended: n.ended } : {}) }) }));
        return r;
    });
    if (!v2) return NO_BOARD;
    if (v2.error) return { error: v2.error };
    save(v2.list);
    return { ok: true, text: describeTake(v2.result.effect) };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — pause / continue / abandon / reactivate, in this chat only.
 * A step tracker: on the engine's list (trackers-pure.js runTracker), journalled, with Undo.
 * A collection, place or state tracker: on the board's chat state (board-model-pure.js setRun);
 * Undo puts its whole state back (abandon resets its items / place / values).
 * Returns { ok, text } or { error }.
 */
export function setTrackerRun(name, action) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i !== -1) {
        // engine on v2, step 3b part 2: on the v2 state where it can be; the list keeps what it was for the Undo
        const t0 = list[i];
        const before = { index: t0.index ?? 0, aside: t0.aside || null, took: t0.took ? { ...t0.took } : {}, ended: t0.ended || null, run: t0.run || null, started: !!t0.started, startedAt: t0.startedAt || null };
        const v2 = moveOnV2(list, i, (b, s, t) => runStepV2(b, s, t, action), { who: 'hand', at: new Date().toISOString(), why: action },
            n => ({ ...n, lastRun: { action, from: before, i: Math.floor(lastMessageIndex() ?? 0) } }));
        if (!v2) return NO_BOARD;
        if (v2.error) return { error: `${t0.name}: ${v2.error}.` };
        return { ok: true, name: t0.name, text: `${t0.name}: ${RUN_WORDS[action]}.` };
    }
    const L = live();
    const t = L?.board.trackers.find(x => x.kind !== 'steps' && x.name.toLowerCase() === String(name).trim().toLowerCase());
    if (!t) return { error: `No tracker called "${name}" in this chat.` };
    const run = runOfV2(L.state, t);
    const want = { pause: 'paused', abandon: 'abandoned', continue: null, reactivate: null }[action];
    if (want === undefined) return { error: `unknown: ${action}` };
    if ((action === 'continue' && run !== 'paused') || (action === 'reactivate' && run !== 'abandoned') || (want && run)) return { error: `${t.name}: ${run ? `it is ${run}` : 'it is running'}.` };
    const before = structuredClone(L.state);
    const next = setRunV2(L.board, L.state, t, want);
    next.lastRun = { id: t.id, action, before: { collections: before.collections?.[t.id], places: before.places?.[t.id], states: before.states?.[t.id], counters: before.counters?.[t.id], run } };
    chat_metadata[STATE_KEY] = next;
    save(getTrackers());
    return { ok: true, name: t.name, text: `${t.name}: ${RUN_WORDS[action]}.` };
}

/** Undo the last pause / abandon / … of `name`. */
export function undoTrackerRun(name) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i !== -1) {
        if (!list[i].lastRun) return { error: 'nothing to undo' };
        const v2 = moveOnV2(list, i, (b, s, t) => undoRunStepV2(b, s, t, list[i].lastRun.from), { who: 'undo' }, n => { const { lastRun: _l, ...rest } = n; return rest; });
        if (!v2) return NO_BOARD;
        return { ok: true, text: `${v2.t.name}: put back as it was.` };
    }
    const L = live();
    const t = L?.board.trackers.find(x => x.name.toLowerCase() === String(name).trim().toLowerCase());
    const lr = L?.state.lastRun;
    if (!t || !lr || lr.id !== t.id) return { error: 'nothing to undo' };
    const next = structuredClone(L.state);
    for (const k of ['collections', 'places', 'states', 'counters']) { if (lr.before[k] !== undefined) next[k][t.id] = lr.before[k]; }
    next.runs ||= {};
    if (lr.before.run) next.runs[t.id] = lr.before.run; else delete next.runs[t.id];
    delete next.lastRun;
    chat_metadata[STATE_KEY] = next;
    save(getTrackers());
    return { ok: true, text: `${t.name}: put back as it was.` };
}

/** Switch the board off (or on) for this chat — or for the character. */
export function switchBoard(off, opts = {}) {
    if (!setBoardOff(off, opts)) return { error: 'This chat has no board saved from the board window.' };
    changed();
    return { ok: true, text: off ? `The board is switched off for ${opts.forCharacter ? 'this character' : 'this chat'} — nothing of it runs here.` : 'The board is switched on again.' };
}

export function removeTracker(name) {
    const list = getTrackers();
    const i = findIndex(list, name);
    if (i === -1) return false;
    list.splice(i, 1);
    save(list);
    return true;
}

let confirmOpen = false;

/**
 * Bring trackers in line with where the chat now ends. After a delete this
 * applies at once; on opening a chat it asks first, because a branch arrives
 * carrying its parent's newest state.
 */
export async function reconcileTrackers({ prune = false, confirm = false, keep = null } = {}) {
    // engine on v2, step 3 (2026-10-05): where the v2 log holds every move, the roll back comes from it alone
    // keep: a regenerate's delete keeps hand and world changes (regen-pure.js, 2026-10-19)
    const v2 = v2Rewind(lastMessageIndex(), keep);
    if (v2) return reconcileFromV2(v2, lastMessageIndex(), { prune, confirm });
    // the log doesn't reach back that far (over its cap) or there is no board: the board's own changes from later
    // messages go back; the trackers stay where they are
    if (prune) {
        try {
            const undone = rewindLiveTo(lastMessageIndex(), keep);
            if (undone.length) echo(() => toastr.info(`${undone.length} change${undone.length > 1 ? 's' : ''} on the board rolled back with the deleted messages.`, 'Storyboard'));
        } catch (err) { console.warn('[DLE] board rewind skipped:', err?.message || err); }
    }
    else if (confirm) { try { rewindLiveTo(lastMessageIndex()); } catch { /* noop */ } }
    return [];
}

/** New Run, before the switch: what will be reset, for the confirmation dialog. */
export function describeNewRunReset(list) {
    return list.map(t => `${t.name}: ${describe(t)} → ${t.steps[0]}`);
}

/** New Run, after the new chat is open: same board, every tracker back at step 1. */
export function startTrackersForNewRun(oldList, boardName = null) {
    if (boardName) chat_metadata[BOARD_KEY] = boardName;
    if (!oldList.length) return;
    chat_metadata[TRACKERS_KEY] = withIds(resetForNewRun(oldList)).map(t => ({ ...t, id: oldList.find(o => o.name === t.name)?.id || t.id }));
    // a new run starts with a fresh board state (a new chat has none; said explicitly, so nothing of the old run comes along)
    try { const b = getBoard(currentBoardName()); if (b) chat_metadata[STATE_KEY] = freshStateV2(b); } catch { /* no board */ }
    try { recordSteps(chat_metadata[TRACKERS_KEY], 0, { silent: true }); } catch { /* no v2 board */ }   // engine on v2, step 1
    changed();
}

// ─── Slash commands ──────────────────────────────────────────────────────────

/** The tracker a command means: the one named, or the only one in the chat. */
function pick(arg) {
    const named = String(arg || '').trim();
    if (named) return named;
    const list = getTrackers();
    return list.length === 1 ? list[0].name : null;
}

function statusText() {
    const list = getTrackers();
    if (!list.length) return 'No story trackers in this chat. Make one in DeepLore\'s Story tab, or: /dle-tracker Relationship = Strangers, Neighbours, Friends';
    return list.map(t => `${t.name}: ${describe(t)} (${t.index + 1}/${t.steps.length})\n    ${t.steps.map((s, i) => (i === t.index ? `[${s}]` : s)).join(' · ')}`).join('\n');
}

export function registerTrackerCommands() {
    const toast = (msg, kind = 'info') => { try { toastr[kind](msg, 'DeepLore'); } catch { /* noop */ } };
    const add = (props) => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ returns: ARGUMENT_TYPE.STRING, ...props }));
    const arg = (description) => [SlashCommandArgument.fromProps({ description, typeList: [ARGUMENT_TYPE.STRING] })];

    add({
        name: 'dle-tracker',
        callback: async (_a, value) => {
            const text = String(value || '').trim();
            if (!text) return statusText();
            const spec = parseTrackerSpec(text);
            if (!spec.ok) {
                const m = spec.error === 'usage' ? 'Usage: /dle-tracker Name = Step 1, Step 2, Step 3' : `Tracker not saved: ${spec.error}.`;
                toast(m, 'warning'); return m;
            }
            setTracker(spec.name, spec.steps);
            toast(`Tracker "${spec.name}": ${spec.steps.length} steps.`, 'success');
            return statusText();
        },
        unnamedArgumentList: arg('Name = Step 1, Step 2, …'),
        helpString: 'Make or edit a story tracker: /dle-tracker Relationship = Strangers, Neighbours, Friends. No argument lists this chat\'s trackers.',
    });

    const step = (name, delta, help) => add({
        name,
        callback: async (_a, value) => {
            const t = pick(value);
            if (!t) { const m = `Which tracker? e.g. /${name} Relationship`; toast(m, 'warning'); return m; }
            const r = moveTracker(t, { delta });
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            toast(`${r.name}: ${r.value} (${r.index + 1}/${r.count})`);
            return r.value;
        },
        unnamedArgumentList: arg('tracker name (optional with one tracker)'),
        helpString: help,
    });
    step('dle-tracker-next', 1, 'Move a story tracker one step on.');
    step('dle-tracker-back', -1, 'Move a story tracker one step back.');

    add({
        name: 'dle-tracker-go',
        callback: async (_a, value) => {
            const [name, want] = String(value || '').split('=').map(s => s.trim());
            const list = getTrackers();
            const i = findIndex(list, name);
            if (i === -1 || !want) { const m = 'Usage: /dle-tracker-go Name = Step (or step number)'; toast(m, 'warning'); return m; }
            const idx = /^\d+$/.test(want) ? Number(want) - 1 : list[i].steps.findIndex(s => s.toLowerCase() === want.toLowerCase());
            if (idx < 0 || idx >= list[i].steps.length) { const m = `"${want}" is not a step of ${list[i].name}.`; toast(m, 'warning'); return m; }
            const r = moveTracker(list[i].name, { toIndex: idx });
            toast(`${r.name}: ${r.value} (${r.index + 1}/${r.count})`);
            return r.value;
        },
        unnamedArgumentList: arg('Name = Step'),
        helpString: 'Jump a story tracker to a step: /dle-tracker-go Relationship = Friends',
    });

    add({
        name: 'dle-tracker-aside',
        callback: async (_a, value) => {
            const raw = String(value || '');
            const eq = raw.indexOf('=');
            const name = (eq === -1 ? raw : raw.slice(0, eq)).trim();
            const aside = eq === -1 ? '' : raw.slice(eq + 1).trim();
            if (!name) { const m = 'Usage: /dle-tracker-aside Name = Nuisance   (nothing after = clears it)'; toast(m, 'warning'); return m; }
            const r = setTrackerAside(name, aside);
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            toast(`${r.name}: ${r.value}`);
            return r.value;
        },
        unnamedArgumentList: arg('Name = aside (empty clears)'),
        helpString: 'Set a detour beside a tracker\'s step, e.g. /dle-tracker-aside Relationship = Nuisance. Nothing after = clears it.',
    });
    // LOCAL PATCH (Miinthe, 2026-10-05): engine on v2, step 1 — do the engine's list and the v2 state agree?
    add({
        name: 'dle-engine-check',
        callback: async () => {
            const name = chat_metadata?.[BOARD_KEY];
            const rec = name ? boardStore()?.boards?.[name] : null;
            if (!rec?.board) { const m = 'This chat has no board from the board window — nothing to compare.'; toast(m); return m; }
            const board = normalizeBoardV2(rec.board, name);
            const raw = chat_metadata?.[STATE_KEY];
            if (!raw?.v2steps) { const m = 'Not compared yet: the v2 copy starts with the next save of the trackers (a move, a reply).'; toast(m); return m; }
            const diff = engineDiff(board, getTrackers(), normalizeStateV2(raw, board));
            const steps = (raw.log || []).filter(e => e.kind === 'step').length;
            const m = diff.length ? `They disagree:\n${diff.map(d => `${d.tracker} · ${d.field}: v2 ${JSON.stringify(d.v2)} — engine ${JSON.stringify(d.engine)}`).join('\n')}` : `The engine's list and the v2 state agree about every step tracker (${steps} step move${steps === 1 ? '' : 's'} in the v2 log).`;
            toast(m.split('\n')[0], diff.length ? 'warning' : 'success');
            if (diff.length) console.warn('[DLE] engine check:', diff);
            return m;
        },
        helpString: 'Engine on v2 (step 1): compare the step trackers in the engine\'s list with the v2 state — they should always agree.',
    });

    // LOCAL PATCH (Miinthe, 2026-10-04): pause / continue / abandon / reactivate, and the board on/off for this chat (WIP controls)
    add({
        name: 'dle-tracker-run',
        callback: async (_a, value) => {
            const m0 = String(value || '').trim().match(/^(.+?)\s+(pause|continue|abandon|reactivate|undo)$/i);
            if (!m0) { const m = 'Usage: /dle-tracker-run Name pause|continue|abandon|reactivate|undo'; toast(m, 'warning'); return m; }
            const r = m0[2].toLowerCase() === 'undo' ? undoTrackerRun(m0[1]) : setTrackerRun(m0[1], m0[2].toLowerCase());
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            toast(r.text);
            return r.text;
        },
        unnamedArgumentList: arg('Name action'),
        helpString: 'In this chat only: /dle-tracker-run Relationship pause (keeps its step; not watched, not told, its lore hidden) · continue · abandon (back to the start, switched off) · reactivate (on again from the start) · undo.',
    });
    add({
        name: 'dle-board-off',
        callback: async (_a, value) => {
            const v = String(value || '').trim().toLowerCase();
            const r = v === 'on' ? switchBoard(false) : v === 'character' ? switchBoard(true, { forCharacter: true }) : v === '' || v === 'chat' ? switchBoard(true) : { error: 'Usage: /dle-board-off [chat|character|on]' };
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            toast(r.text);
            return r.text;
        },
        unnamedArgumentList: arg('chat | character | on'),
        helpString: 'Switch this chat\'s board off for this chat (default) or for its character — nothing of the board runs there; "on" switches it back on.',
    });

    // LOCAL PATCH (Miinthe, 2026-10-05): forks — pick the way by hand.
    add({
        name: 'dle-tracker-branch',
        callback: async (_a, value) => {
            const raw = String(value || '');
            const eq = raw.indexOf('=');
            if (eq === -1) { const m = 'Usage: /dle-tracker-branch Name = Branch   (the tracker must wait at that fork)'; toast(m, 'warning'); return m; }
            const r = chooseBranch(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim());
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            toast(r.text);
            return r.text;
        },
        unnamedArgumentList: arg('Name = branch'),
        helpString: 'Take a fork\'s branch by hand, e.g. /dle-tracker-branch Relationship = Confesses. The tracker must be waiting at that fork.',
    });

    add({
        name: 'dle-tracker-remove',
        callback: async (_a, value) => {
            const name = String(value || '').trim();
            const m = removeTracker(name) ? `Tracker "${name}" removed.` : `No tracker called "${name}".`;
            toast(m); return m;
        },
        unnamedArgumentList: arg('tracker name'),
        helpString: 'Remove a story tracker from this chat.',
    });

    // ── storyboards ──
    add({
        name: 'dle-board',
        callback: async (_a, value) => {
            const name = String(value || '').trim();
            if (name) {
                const r = applyBoard(name);
                if (r.error) { toast(r.error, 'warning'); return r.error; }
                const m = `Storyboard "${r.name}" applied to this chat.${r.lost.length ? ' Some steps were not on it: ' + r.lost.map(l => `${l.name} (${l.step})`).join(', ') : ''}`;
                toast(m, 'success'); return m;
            }
            // LOCAL PATCH (Miinthe, 2026-10-05): no name → the board window (stage 2).
            try { (await import('./board-window.js')).openBoardWindow(); } catch (e) { console.warn('[DLE] board window:', e?.message); }
            const cur = currentBoardName();
            const all = listBoards();
            const ch = characterBoardName();
            const m = [
                `This chat: ${cur ? `"${cur}"` : 'no storyboard (its own trackers)'}`,
                `This character's default: ${ch ? `"${ch}"` : 'none'}`,
                'Storyboards:', ...(all.length ? all.map(b => `  ${b.name} — ${boardSummary(b)}`) : ['  (none yet)']),
            ].join('\n');
            return m;
        },
        unnamedArgumentList: arg('storyboard name (empty: open the board window)'),
        helpString: 'Open the storyboard window, or apply a board to this chat: /dle-board My Story',
    });
    add({
        name: 'dle-board-saveas',
        callback: async (_a, value) => {
            const name = saveBoardAs(String(value || '').trim() || 'Storyboard');
            const m = `Saved as storyboard "${name}" and applied to this chat.`;
            toast(m, 'success'); return m;
        },
        unnamedArgumentList: arg('new storyboard name'),
        helpString: 'Save this chat\'s trackers as a new storyboard and use it here. The old one stays as it was.',
    });
    add({
        name: 'dle-board-character',
        callback: async (_a, value) => {
            const raw = String(value || '').trim();
            const name = raw && raw.toLowerCase() !== 'off' ? raw : null;
            const r = setCharacterBoard(name);
            if (r.error) { toast(r.error, 'warning'); return r.error; }
            const m = name ? `New chats with this character start on "${name}".` : 'This character has no default storyboard now.';
            toast(m, 'success'); return m;
        },
        unnamedArgumentList: arg('storyboard name, or off'),
        helpString: 'Default storyboard for new chats with this character: /dle-board-character My Story (off clears it).',
    });
    add({
        name: 'dle-board-detach',
        callback: async () => {
            const cur = currentBoardName();
            if (!cur) return 'This chat uses no storyboard.';
            detachBoard();
            const m = `This chat no longer uses "${cur}"; it keeps its own copy of the trackers.`;
            toast(m); return m;
        },
        helpString: 'Stop using the storyboard in this chat (it keeps its own copy of the trackers).',
    });

    add({
        name: 'dle-tracker-rewind',
        callback: async (_a, value) => {
            const raw = String(value || '').trim();
            const idx = raw ? Number(raw) : lastMessageIndex();
            if (!Number.isFinite(idx)) return 'Usage: /dle-tracker-rewind [message number]';
            const r = rewindTrackersTo(idx);
            const m = r.error || (r.moved.length ? r.moved.join('\n') : 'Trackers already match that point.');
            toast(m); return m;
        },
        unnamedArgumentList: arg('message number (default: end of chat)'),
        helpString: 'Put every story tracker back to where it was at a message.',
    });
}
