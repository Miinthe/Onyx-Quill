/**
 * LOCAL PATCH (Miinthe, 2026-10-14) — Mero ☆'s 💡 pitches, the upgraded Pathweaver: SillyTavern glue. Rules: pitches-pure.js.
 * Design: `10 co-writer design.md` §9, mock-up v4. The drawer is in mero/mero.html (via window.__dleMeroHost).
 *
 * Calls: a batch / a hidden pitch / Miinthe's drafted line — the Co-writer connection (Mero's). "Did it land?" and "has the
 * moment come?" — the Story Trackers helper's connection (a quote check, like a tracker move).
 * Storage: chat_metadata[PITCHES_KEY] (this chat's pitches); taste lives in Mero's "just for our talks" notes.
 */
import { chat_metadata, eventSource, event_types } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { escapeHtml } from '../../../../utils.js';
import { resolveConnectionConfig } from '../settings.js';
import { callAI } from './ai/ai.js';
import { vaultIndex } from './state.js';
import { live, saveLiveState } from './board-live.js';
import { echo, immersed } from './echo.js';
import { turnIndex } from './turn-index.js';
import { getCurrentForChat } from './verdict/verdict-store.js';
import { runningCasts, personNow, handChange, MAX_PLANS } from './cast-pure.js';
import { quietThreads } from './mero-glow-pure.js';
import { meroKnows, meroNotes, addNote, removeNote, updateNote, setPitchSink, meroTalks, noteTalkPitches } from './mero.js';
import {
    PITCHES_KEY, asPitches, normMenu, addBatch, dropPicking, bringBack, setPitch, removePitch, trimPitches, pitchPrompt, parsePitches,
    parseHidden, directionText, surpriseText, LAND_SYSTEM, LAND_SCHEMA, landUser, MOMENT_SYSTEM, MOMENT_SCHEMA, momentUser, checkFrom,
    fallbackDue, ownPitch, boardEntryTitles, quietLore, castForPitches, tasteText, tasteOverflow, pitchLine, KINDS,
    parsePlans, startPlan, planLines, repliesSince, BEAT_SYSTEM, BEAT_SCHEMA, beatUser, beatDue, tickBeat, rewindPlan, timerDue,
    lingerPatch, rewritePrompt, parseRewrite, applyReview, talkPitchPrompt, parseTalkPitches, editedPitch,
    usedDraft,
} from './pitches-pure.js';
import { addRequest, onAnswer } from './requests.js';

const listeners = new Set();
export function onPitchesChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const changed = () => { for (const cb of listeners) { try { cb(); } catch { /* noop */ } } };

const store = () => asPitches(chat_metadata?.[PITCHES_KEY]);
function save(s) { chat_metadata[PITCHES_KEY] = trimPitches(s); saveMetadataDebounced(); changed(); }
const chatNow = () => getContext()?.chat || [];
const lastIndex = () => chatNow().length - 1;

let busy = null;   // 'batch' | 'more' | 'hidden' | 'draft' — what Mero is doing right now
export const pitchesBusy = () => busy;

// ── the cast ─────────────────────────────────────────────────────────────────

/** Everyone in the running casts: [{ cast, p, now }]. */
function castAll() {
    const L = live();
    if (!L) return [];
    const out = [];
    for (const cast of runningCasts(L.board, L.state)) for (const p of cast.people || []) out.push({ cast, p, now: personNow(L.state, cast, p) });
    return out;
}
export const castNames = () => castAll().map(x => x.p.name);

/** What the drawer shows: the pitches, the menu, who a pitch can be given to. */
export function pitchesView() {
    const s = store();
    return { ...s, busy, cast: castAll().map(({ cast, p, now }) => ({ cast: cast.id, person: p.id, name: p.name, here: now.here })), canPitch: !!resolveConnectionConfig('mero').profileId };
}
export function setMenu(patch) { const s = store(); save({ ...s, menu: normMenu({ ...s.menu, ...patch }) }); }

// ── what Mero is told ────────────────────────────────────────────────────────

function pitchContext(fromMsg) {
    const { pkg, who, where, user, names } = meroKnows();
    const L = live();
    const chat = chatNow();
    const notes = meroNotes();
    const immersion = immersed();
    let quiet = [], lore = [];
    try { if (L) quiet = quietThreads(L.board, L.state, chat.length - 1).map(m => m.text); } catch { /* no board */ }
    try {
        const titles = new Set(L ? boardEntryTitles(L.board) : []);
        for (const x of getCurrentForChat(getContext()?.getCurrentChatId?.())?.injectedSources || []) if (x?.title) titles.add(x.title);
        const entries = [...titles].map(t => (vaultIndex || []).find(e => e.title === t)).filter(Boolean);
        lore = quietLore(entries, chat).map(e => `- ${e.title} (${e.last === -1 ? 'not in this chat yet' : `last came up at #${e.last}`})${e.text ? `: ${e.text}` : ''}`);
    } catch { /* no vault */ }
    const cast = castForPitches(castAll().map(({ p, now }) => ({ name: p.name, here: now.here, wants: now.wants, plans: now.plans.map(x => x.text), thoughts: now.thoughts?.text, knows: now.knows.map(k => k.fact), hidden: p.hidden })), { immersion });
    const s = store();
    return {
        persona: who, character: where.character, user, names,
        taste: notes.filter(n => n.taste && n.on && !n.ended).map(n => n.text),
        donts: notes.filter(n => n.inForce && n.kind === 'dont' && !n.hidden).map(n => n.text),
        notes: notes.filter(n => n.inForce && n.kind !== 'dont' && !n.hidden).map(n => n.text),
        board: pkg.board, quiet, cast, lore, world: pkg.world, guides: pkg.guides || [],
        cards: [pkg.cards, pkg.persona].filter(Boolean).join('\n\n'),
        replies: pkg.replies, fromMsg,
        already: s.list.filter(p => p.st !== 'hidden' && p.st !== 'fired').slice(0, 12).map(p => p.text),
    };
}

const noConn = 'Mero has no connection yet — pick one in Settings › AI & connections › Mero ☆';

/**
 * 💡 Pitch (or 🎲 Roll when the menu says hidden). opts: { comment, fromMsg (index), like: [ids] — "more like these"
 * (added to the batch instead of replacing it) }. Returns { ok, n } or { ok: false, error }.
 */
export async function pitch({ comment = '', fromMsg = null, like = [] } = {}) {
    if (busy) return { ok: false, error: 'Mero is still on the last one.' };
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: noConn };
    const s = store(), menu = s.menu;
    const hidden = menu.vis === 'hide' && !like.length;
    const multi = menu.shape === 'multi' || s.list.some(p => like.includes(p.id) && p.plan);
    const chat = chatNow();
    const fm = Number.isInteger(fromMsg) && chat[fromMsg] ? { i: fromMsg, name: chat[fromMsg].is_user ? (meroKnows().user) : chat[fromMsg].name, text: chat[fromMsg].mes } : null;
    const likeP = s.list.filter(p => like.includes(p.id));
    const m = likeP.length ? { ...menu, vis: 'show', n: 3, shape: multi ? 'multi' : 'one' } : menu;
    const { system, user } = pitchPrompt(m, pitchContext(fm), { comment, like: likeP.map(pitchLine) });
    busy = likeP.length ? 'more' : hidden ? 'hidden' : 'batch'; changed();
    try {
        const r = await callAI(system, user, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, maxTokens: Math.max(Number(conn.maxTokens) || 0, 1500) });
        const names = castNames();
        const s2 = store();
        if (multi) {
            const plans = parsePlans(r?.text, hidden ? 1 : m.n, names);
            if (!plans.length) { console.warn('[Onyx Quill] plans: nothing usable in the answer', r?.text); return { ok: false, error: 'Mero\'s answer had no plan in it — try again.' }; }
            if (hidden) {   // a hidden plan starts at once — the writer is led through it, Miinthe doesn't see it
                const p = { ...plans[0], hide: true };
                save(addBatch(s2, [{ ...p, ...startPlan(p, { i: chat.length - 1, sees: menu.sees, timer: menu.timer }) }], { made: chat.length - 1, tone: menu.tone, replace: false }));
                return { ok: true, n: 1, hidden: true };
            }
            save(addBatch(s2, plans, { made: chat.length - 1, msg: fm?.i ?? null, tone: m.tone, replace: !likeP.length }));
            return { ok: true, n: plans.length };
        }
        if (hidden) {
            const h = parseHidden(r?.text, names, menu.moment);
            if (!h || !h.moment) return { ok: false, error: 'Mero\'s answer had no hidden pitch in it — try 🎲 Roll again.' };
            save(addBatch(s2, [{ ...h, st: 'hidden', armed: chat.length - 1, fb: menu.fbOn ? menu.fb : 0, mine: !!menu.moment }], { made: chat.length - 1, tone: menu.tone, replace: false }));
            return { ok: true, n: 1, hidden: true };
        }
        const list = parsePitches(r?.text, m.n, names);
        if (!list.length) { console.warn('[Onyx Quill] pitches: nothing usable in the answer', r?.text); return { ok: false, error: 'Mero\'s answer had no pitches in it — try again.' }; }
        save(addBatch(s2, list, { made: chat.length - 1, msg: fm?.i ?? null, tone: m.tone, replace: !likeP.length }));
        return { ok: true, n: list.length };
    } catch (err) {
        console.warn('[Onyx Quill] pitches failed:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    } finally { busy = null; changed(); }
}

/**
 * 💡 Pitch from a talk (Miinthe, 2026-11-02): what Miinthe and Mero worked out in this talk, written up as real pitches / plans.
 * They are kept ideas at once (a new batch from the 💡 drawer must never sweep them away) and show in the talk with
 * their buttons. Nothing settled yet: Mero says what is missing instead. Returns { ok, n } or { ok: false, error }.
 */
export async function pitchFromTalk(talkId, { ask = true } = {}) {
    if (busy) return { ok: false, error: 'Mero is still on the last one.' };
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: noConn };
    const t = meroTalks().find(x => x.id === talkId);
    if (!t) return { ok: false, error: 'That talk is gone.' };
    if (!t.msgs.some(m => m.who === 'author') || !t.msgs.some(m => m.who === 'mero')) return { ok: false, error: 'Nothing in this talk to pitch from yet.' };
    const c = pitchContext(null), names = castNames();
    // what this talk already made (in this chat): Mero writes those again only when the talk changed them
    const ids = new Set(t.msgs.flatMap(m => m.pitchIds || []));
    // with what the card parked as still open — else a second press asks about it again (bug hunt 2026-11-03)
    const already = store().list.filter(p => ids.has(p.id)).map(p => (p.plan ? `${p.plan.goal || p.text} (plan: ${p.plan.beats.map(b => b.text).join(' → ')})` : p.text) + (p.open ? ` — Still open (parked on the card, don't ask again): ${p.open}` : ''));
    const { system, user } = talkPitchPrompt(t, { persona: c.persona, character: c.character, user: c.user, names: c.names, board: c.board, castNames: names, donts: c.donts, guides: c.guides, replies: c.replies, already }, { ask });
    busy = 'talk'; changed();
    try {
        const r = await callAI(system, user, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, maxTokens: Math.max(Number(conn.maxTokens) || 0, 4000) });   // room for thinking + the cards (2026-11-04)
        const { list, why, asks: allAsks } = parseTalkPitches(r?.text, names, t.title);
        const asks = allAsks.slice(0, 1);   // one question at most (Miinthe, 2026-11-04: build first, don't interrogate)
        // something important still open: Mero asks first, as question cards (Miinthe 2026-11-02: "multi selection to wrap up the plan")
        if (asks.length && ask) {
            noteTalkPitches(talkId, { text: `Before I write it up — ${asks.length === 1 ? 'one thing is' : `${asks.length} things are`} still open:`, asks });
            return { ok: true, n: 0, asking: true };
        }
        if (!list.length) {
            if (!String(r?.text || '').trim()) return { ok: false, error: 'Mero sent back an empty answer — try 💡 Pitch again.' };
            noteTalkPitches(talkId, { text: why ? `Nothing to pitch yet — ${why}` : 'Nothing concrete to pitch yet. Let\'s settle it a bit more first.' });
            return { ok: true, n: 0 };
        }
        const s = store(), from = s.next;
        const s2 = addBatch(s, list.map(p => ({ ...p, st: 'kept' })), { made: lastIndex(), replace: false });
        save(s2);
        const made = s2.list.filter(p => p.no >= from && p.no < from + list.length).sort((a, b) => a.no - b.no);
        noteTalkPitches(talkId, {
            text: made.length > 1 ? `Here's what we worked out, as ${made.length} cards:` : 'Here\'s what we worked out:',
            pitchNos: made.map(p => p.no), planNos: made.filter(p => p.plan).map(p => p.no), pitchIds: made.map(p => p.id),
        });
        return { ok: true, n: made.length };
    } catch (err) {
        console.warn('[Onyx Quill] pitch from a talk failed:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    } finally { busy = null; changed(); }
}

/** ✏ Write my own: her own pitch, straight into the list — no AI, works while Mero is busy or has no connection. */
export function addOwn(fields = {}) {
    const p = ownPitch(fields, lastIndex());
    if (p.error) return { ok: false, error: p.error };
    const s = store(), no = s.next;
    save(addBatch(s, [p], { made: lastIndex(), replace: false }));
    return { ok: true, no, waits: p.st === 'hidden', plan: !!p.plan };
}

/** ✏ Edit a pitch that isn't out in the story yet: new words (a plan: goal + beats). */
export function editPitch(id, fields = {}) {
    const p = get(id);
    if (!p) return { ok: false, error: 'That pitch is gone.' };
    if (!['fresh', 'kept', 'skipped'].includes(p.st)) return { ok: false, error: 'It\'s out in the story already — take it back first.' };
    const patch = editedPitch(p, fields);
    if (!patch) return { ok: false, error: p.plan ? 'A plan needs at least two beats.' : 'The pitch can\'t be empty.' };
    save(setPitch(store(), id, patch));
    return { ok: true };
}

// ── what Miinthe does with a pitch ───────────────────────────────────────────────

const get = id => store().list.find(p => p.id === id) || null;
function taste(p, up, why = '') {
    if (p?.own) return;   // her own pitch says nothing about Mero's — no taste line
    addNote({ kind: 'fact', text: tasteText(p, up, why), story: false, last: 'pinned', scope: 'char', taste: up ? 'up' : 'down' }, { from: null });
    for (const id of tasteOverflow(meroNotes())) removeNote(id);
}
/** Forget a 👍 / 👎 taste line, or change its words. */
export const editTaste = (id, text) => (text == null ? removeNote(id) : updateNote(id, { text }));

/** ✍️ Next reply: one at a time — another one waiting goes back to the kept ideas. */
export function useNextReply(id) {
    const p = get(id); if (!p || p.kind === 'ask') return { ok: false, error: 'not a pitch to send' };
    let s = store();
    for (const o of s.list.filter(x => x.st === 'dir' && x.id !== id)) { if (o.noteId) removeNote(o.noteId); s = setPitch(s, o.id, { st: 'kept', noteId: '' }); }
    const n = addNote({ kind: 'steer', text: directionText(p), last: 'flash', scope: 'chat', story: true }, { from: null });
    save(setPitch(s, id, { st: 'dir', noteId: n?.id || '', made: lastIndex() }));
    taste(p, true);
    return { ok: true };
}
/** Take ✍️ back: the note goes, the pitch is kept as an idea. */
export function takeBack(id) {
    const p = get(id); if (!p) return;
    if (p.st === 'dir' && p.noteId) removeNote(p.noteId);
    if (p.st === 'given' && p.gaveTo) {
        const L = live(), cast = L?.board?.trackers?.find(t => t.id === p.gaveTo.cast), person = cast?.people?.find(x => x.id === p.gaveTo.person);
        if (L && person) {
            const now = personNow(L.state, cast, person);
            if (now.plans.some(x => x.id === p.gaveTo.planId)) saveLiveState(handChange(L.board, L.state, cast.id, person.id, 'plans', now.plans.filter(x => x.id !== p.gaveTo.planId), turnIndex(chatNow())));
        }
    }
    save(setPitch(store(), id, { st: 'kept', noteId: '', gaveTo: null }));
}

/** 🎭 Give to…: the pitch becomes one of their plans (the director works it from there). A full list drops its oldest. */
export function giveTo(id, castId, personId) {
    const p = get(id), L = live();
    const cast = L?.board?.trackers?.find(t => t.id === castId), person = cast?.people?.find(x => x.id === personId);
    if (!p || !person) return { ok: false, error: 'That person is not on the board.' };
    const now = personNow(L.state, cast, person);
    const planId = `pp${Date.now().toString(36)}`;
    const plans = [...now.plans, { id: planId, text: p.text }];
    const dropped = plans.length > MAX_PLANS ? plans.shift() : null;
    saveLiveState(handChange(L.board, L.state, castId, personId, 'plans', plans, turnIndex(chatNow())));
    save(setPitch(store(), id, { st: 'given', gaveTo: { cast: castId, person: personId, name: person.name, planId } }));
    taste(p, true);
    return { ok: true, name: person.name, dropped: dropped?.text || null };
}

export function keep(ids) { let s = store(); for (const id of ids) s = setPitch(s, id, { st: 'kept' }); save(s); }
export function letGo(id) { const p = get(id); if (p?.noteId && p.st === 'dir') removeNote(p.noteId); save(removePitch(store(), id)); }
/** 👎 Not my thing (with an optional reason): Mero remembers, the pitch goes. */
export function notMine(ids, why = '') { let s = store(); for (const id of ids) { const p = s.list.find(x => x.id === id); if (p) taste(p, false, why); s = removePitch(s, id); } save(s); }
export const back = () => save(dropPicking(store()));
export const bringBackDropped = () => save(bringBack(store()));
/** 🗑 The dropped pitches, gone for good (Miinthe, 2026-11-03: "I cannot delete those pitches"). Not a 👎. */
export const forgetDropped = () => save({ ...store(), dropped: [] });
export const peek = (id, on) => save(setPitch(store(), id, { peek: !!on }));

/** The pitches handed to a 🗺 Planning talk ("💬 Talk about these") — the text Miinthe starts the talk with. */
export function talkOpener(ids) {
    const list = store().list.filter(p => ids.includes(p.id));
    return list.length ? `About ${list.length > 1 ? 'these pitches' : 'this pitch'}:\n${list.map(p => `#${p.no} ${p.text}`).join('\n')}\n\n` : '';
}

/** 📝 My line: Mero drafts Miinthe's next message from the pitch, in her voice — into SillyTavern's message box. */
export async function draftLine(id) {
    const p = get(id); if (!p) return { ok: false, error: 'no such pitch' };
    if (busy) return { ok: false, error: 'Mero is still on the last one.' };
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: noConn };
    const { pkg, user } = meroKnows();
    const mine = chatNow().filter(m => m.is_user && !m.is_system && m.mes).slice(-6).map(m => m.mes);
    const system = `You draft ${user}'s next message in her roleplay — her own character's actions and words only, in HER voice and style: match her recent messages (person, tense, length, how she marks actions and speech). Play the idea below from her side: set it up or react to it — never decide what other characters do or say. Return only the message, nothing else.`;
    const userMsg = `THE IDEA: ${p.text}\n\n${user.toUpperCase()}'S RECENT MESSAGES (her style):\n${mine.join('\n---\n') || '(none yet)'}\n\nTHE LATEST MESSAGES:\n${pkg.replies.slice(-6).map(r => `#${r.i} ${r.name}: ${r.text}`).join('\n\n')}`;
    busy = 'draft'; changed();
    try {
        const r = await callAI(system, userMsg, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
        const text = String(r?.text ?? '').replace(/^["“]|["”]$/g, '').trim();
        if (!text) return { ok: false, error: 'Mero sent back an empty draft.' };
        const box = document.getElementById('send_textarea');
        if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); }
        save(setPitch(store(), id, { st: 'draft', draft: text, made: lastIndex() }));
        taste(p, true);
        return { ok: true };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
    finally { busy = null; changed(); }
}

/** 📝 The line Mero drafted, back into the message box (Miinthe, 2026-11-03: deleted from the box, "no way to reapply"). */
export function putDraftBack(id) {
    const p = get(id); if (!p?.draft) return { ok: false, error: 'There is no drafted line to put back.' };
    const box = document.getElementById('send_textarea');
    if (!box) return { ok: false, error: 'The message box is not there.' };
    box.value = p.draft; box.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
}

// ── 🪜 plans ────────────────────────────────────────────────────────────────

const isAiAt = k => { const m = chatNow()[k]; return !!m && !m.is_user && !m.is_system; };
const planOf = id => { const p = get(id); return p?.plan ? p : null; };

/** The writer's lines for every running plan (into Mero's [Author's notes] block). */
export function planWriterLines() {
    const last = lastIndex();
    return store().list.filter(p => p.st === 'running').flatMap(p => planLines(p, repliesSince(p.plan.since, last, isAiAt)));
}

/** Start a plan (picked, or kept): beat 1 from now, with the menu's "writer sees" and timer. */
export function startPlanFor(id) {
    const p = planOf(id); if (!p) return { ok: false, error: 'not a plan' };
    const m = store().menu;
    save(setPitch(store(), id, startPlan(p, { i: lastIndex(), sees: m.sees, timer: m.timer })));
    taste(p, true);
    return { ok: true };
}
/** Change a running plan: how much the writer sees, the timer, a beat's floor. */
export function planSet(id, { sees, timer, floor } = {}) {
    const p = planOf(id); if (!p) return;
    const pl = { ...p.plan };
    if (sees) pl.sees = sees;
    if (timer != null) pl.timer = Number(timer);
    if (floor) pl.beats = pl.beats.map((b, k) => (k === floor.k ? { ...b, floor: Math.max(0, Math.min(40, Number(floor.n) || 0)) } : b));
    save(setPitch(store(), id, { plan: pl }));
}
export function abandonPlan(id) { const p = planOf(id); if (p) save(setPitch(store(), id, { st: 'abandoned', plan: { ...p.plan, review: undefined } })); }
/** ⏳ Linger: stay on this beat longer. */
export function lingerPlan(id) { const p = planOf(id); if (p) save(setPitch(store(), id, lingerPatch(p, lastIndex(), isAiAt))); }
/** ⏳ More time: the timer starts again from now. */
export function moreTime(id) { const p = planOf(id); if (p) save(setPitch(store(), id, { plan: { ...p.plan, since: lastIndex(), asked: undefined } })); }

/** ↩️ Redirect · 🌱 Evolve · Extend: Mero rewrites; the answer waits on the plan for Miinthe's review. */
export async function rewritePlan(id, mode) {
    const p = planOf(id); if (!p) return { ok: false, error: 'not a plan' };
    if (busy) return { ok: false, error: 'Mero is still on the last one.' };
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: noConn };
    const { system, user } = rewritePrompt(p, mode, pitchContext(null));
    busy = 'rewrite'; changed();
    try {
        const r = await callAI(system, user, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, maxTokens: Math.max(Number(conn.maxTokens) || 0, 1000) });
        const rv = parseRewrite(r?.text, mode);
        if (!rv) return { ok: false, error: 'Mero\'s answer had no beats in it — try again.' };
        const p2 = planOf(id); if (!p2) return { ok: false, error: 'the plan is gone' };
        save(setPitch(store(), id, { plan: { ...p2.plan, review: rv } }));
        return { ok: true };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
    finally { busy = null; changed(); }
}
export function useReview(id) { const p = planOf(id); const patch = p && applyReview(p, lastIndex()); if (patch) save(setPitch(store(), id, patch)); }
export function dropReview(id) { const p = planOf(id); if (p) save(setPitch(store(), id, { plan: { ...p.plan, review: undefined } })); }

/** Ticks after the chat's end (deleted messages) or at a swiped message go back. */
function rewindFrom(from) {
    let s = store(), any = false;
    for (const p of s.list) { const patch = rewindPlan(p, from); if (patch) { s = setPitch(s, p.id, patch); any = true; } }
    if (any) save(s);
}

/** A new AI reply at `idx`: does it make a running plan's current beat happen? (After its floor; a quote word for word.) */
async function checkPlans(idx) {
    rewindFrom(idx);   // a swipe: its old tick goes first
    const m = chatNow()[idx];
    if (!m || m.is_user || m.is_system || !String(m.mes || '').trim()) return;
    const conn = helperConn();
    for (const p of store().list.filter(x => x.st === 'running')) {
        if (conn && beatDue(p, idx, isAiAt)) {
            let quote = null;
            try {
                const r = await callAI(BEAT_SYSTEM, beatUser(p, m.mes), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: BEAT_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0 });
                quote = checkFrom(r?.text, [m.mes], 'happened');
            } catch (err) { if (err?.name !== 'AbortError') console.warn('[Onyx Quill] plan beat check failed:', err?.message || err); }
            if (chatNow()[idx]?.mes !== m.mes) return;
            const p2 = get(p.id);
            if (quote && p2?.st === 'running' && p2.plan.at === p.plan.at) {
                const patch = tickBeat(p2, idx, quote);
                save(setPitch(store(), p.id, patch));
                const beatNo = p.plan.at + 1, all = p.plan.beats.length;
                if (p.hide) echo(() => toastr.info('📝 A hidden plan moved on.', '🪜 Plans', { timeOut: 6000 }));
                else notice(patch.st === 'done' ? `🪜 <b>${escapeHtml(p.plan.goal)}</b> — the last beat happened. The plan is done.` : `🪜 Beat ${beatNo} of ${all} happened: <i>“${escapeHtml(quote)}”</i><br>Next: ${escapeHtml(p.plan.beats[beatNo]?.text || '')}`);
                continue;
            }
        }
        const p3 = get(p.id);
        if (timerDue(p3, idx, isAiAt)) {
            const n = repliesSince(p3.plan.since, idx, isAiAt);
            addRequest({ id: `plan:${p3.id}:${idx}`, from: 'plan', kind: 'plan', plan: p3.id, title: `🪜 ${p3.hide ? 'A hidden plan' : p3.plan.goal} — on beat ${p3.plan.at + 1} for ${n} replies`, why: 'The story went elsewhere — what now?', made: { i: idx } });
            save(setPitch(store(), p3.id, { plan: { ...p3.plan, asked: idx } }));
        }
    }
}

// ── after the reply: did it land? ────────────────────────────────────────────

const helperConn = () => { const c = resolveConnectionConfig('storyTracker'); return c.mode === 'profile' && c.profileId ? c : null; };
const notice = (html) => echo(() => toastr.info(html, '💡 Pitches', { escapeHtml: false, timeOut: 10000, extendedTimeOut: 6000, onclick: () => window.__dleOpenPitches?.() }));

/** A new AI message at `idx`: the ✍️ pitch that went with it — did the writer use it? (Swipes check again.) */
async function checkLanded(idx) {
    const m = chatNow()[idx];
    if (!m || m.is_user || m.is_system || !String(m.mes || '').trim()) return;
    const due = store().list.filter(p => (p.st === 'dir' && p.made < idx) || ((p.st === 'landed' || p.st === 'skipped') && p.at === idx));
    if (!due.length) return;
    const conn = helperConn();
    for (const p of due) {
        let quote = null;
        if (conn) {
            try {
                const r = await callAI(LAND_SYSTEM, landUser(p, m.mes), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: LAND_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0 });
                quote = checkFrom(r?.text, [m.mes], 'landed');
            } catch (err) { if (err?.name !== 'AbortError') console.warn('[Onyx Quill] pitch check failed:', err?.message || err); continue; }
        }
        if (chatNow()[idx]?.mes !== m.mes) return;   // swiped meanwhile — the next MESSAGE_RECEIVED checks again
        const was = get(p.id); if (!was) continue;
        if (!conn) { save(setPitch(store(), p.id, { st: 'landed', at: idx, quote: '' })); continue; }   // no helper: can't tell — count it as sent
        save(setPitch(store(), p.id, quote ? { st: 'landed', at: idx, quote } : { st: 'skipped', at: idx, quote: '' }));
        if (was.st === 'dir') notice(quote ? `✓ #${p.no} landed: <i>“${escapeHtml(quote)}”</i>` : `✗ The writer skipped #${p.no} — <u>try again?</u>`);
    }
}

/** Miinthe sent a message: a 📝 draft was played. */
function onSent(idx) {
    const s = store();
    const drafts = s.list.filter(p => p.st === 'draft' && p.made < idx);
    if (!drafts.length) return;
    // played only when what she sent looks like the draft (Miinthe, 2026-11-03: a draft she never used was marked played);
    // otherwise it goes back to her kept ideas
    const sent = String(chatNow()[idx]?.mes || '');
    let s2 = s;
    for (const p of drafts) s2 = setPitch(s2, p.id, usedDraft(p.draft, sent) ? { st: 'played', at: idx } : { st: 'kept', draft: '' });
    save(s2);
}

// ── before the reply: has a hidden pitch's moment come? ──────────────────────

/**
 * In the generate interceptor (index.js, before the [Author's notes] block is built): every 🙈 hidden pitch whose moment
 * shows in the newest messages — or whose fallback is due — goes to the writer now, as a hidden ⚡ flash note. Swipes and
 * regenerates keep the note they already had (a flash note lasts for the reply's swipes).
 */
export async function pitchTurn(chatMessages, type, signal) {
    if (type === 'swipe' || type === 'regenerate' || type === 'continue' || type === 'quiet' || type === 'impersonate') return;
    const s = store(), waiting = s.list.filter(p => p.st === 'hidden');
    if (!waiting.length) return;
    const chat = Array.isArray(chatMessages) ? chatMessages : chatNow();
    const last = chat.length - 1;
    const newest = chat.filter(m => m && !m.is_system && String(m.mes || '').trim()).slice(-2).map(m => ({ name: m.name, mes: m.mes }));
    const conn = helperConn();
    for (const p of waiting) {
        let quote = null, why = null;
        if (fallbackDue(p, last)) why = `after ${p.fb} messages`;
        else if (conn && p.moment && newest.length) {
            try {
                const r = await callAI(MOMENT_SYSTEM, momentUser(p.moment, newest), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: MOMENT_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0, signal, timeout: 30000 });
                quote = checkFrom(r?.text, newest.map(m => m.mes), 'came');
            } catch (err) { if (err?.name !== 'AbortError') console.warn('[Onyx Quill] pitch moment check failed:', err?.message || err); }
        }
        if (!quote && !why) continue;
        const n = addNote({ kind: 'steer', text: surpriseText(p), last: 'flash', scope: 'chat', story: true, hidden: true }, { from: null });
        save(setPitch(store(), p.id, { st: 'fired', firedAt: last + 1, firedQ: quote || why, noteId: n?.id || '' }));
        echo(() => toastr.info('📝 A hidden pitch was used.', '💡 Pitches', { timeOut: 6000 }));
    }
}

// ── 💡 on a message: pitch from here ─────────────────────────────────────────

// overhaul 2a (2026-10-15): "Pitch from here" moved into the one DeepLore ⋯ on each reply (src/reply-menu.js);
// the click handler below stays for any old 💡 still on the page.
function addButtons() { /* the ⋯ adds itself */ }

/** Wire once. */
export function initPitches() {
    // 📬 the plan timer's card: 🗑 Abandon · ↩️ Redirect · 🌱 Evolve · ⏳ More time
    onAnswer('plan', async (r, choice) => {
        const p = planOf(r.plan);
        if (!p || p.st !== 'running') return true;   // gone or over — the card just closes
        if (choice === 'abandon') abandonPlan(p.id);
        else if (choice === 'more') moreTime(p.id);
        else if (choice === 'redirect' || choice === 'evolve') { const x = await rewritePlan(p.id, choice); if (!x.ok) return { ok: false, msg: x.error }; window.__dleOpenPitches?.(); }
        else return false;
        return true;
    });
    setPitchSink({
        castNames, writerLines: planWriterLines, fromTalk: pitchFromTalk,
        add: list => { const s = store(), from = s.next; save(addBatch(s, list, { made: lastIndex(), replace: false })); return list.map((_, k) => from + k); },
    });
    try {
        eventSource.on(event_types.MESSAGE_RECEIVED, id => { setTimeout(async () => { await checkLanded(Number(id)).catch(() => {}); await checkPlans(Number(id)).catch(err => console.warn('[Onyx Quill] plans:', err?.message || err)); }, 0); });
        eventSource.on(event_types.MESSAGE_SENT, id => { try { onSent(Number(id)); } catch { /* noop */ } });
        eventSource.on(event_types.CHAT_CHANGED, () => { setTimeout(addButtons, 200); changed(); });
        eventSource.on(event_types.MESSAGE_DELETED, () => { rewindFrom(chatNow().length); changed(); });
    } catch { /* noop */ }
    setTimeout(addButtons, 1000);
    document.addEventListener('click', e => {
        const b = e.target.closest('.mes_dle_pitch'); if (!b) return;
        const idx = Number(b.closest('.mes')?.getAttribute('mesid'));
        if (Number.isInteger(idx)) window.__dleOpenPitches?.(idx);
    });
}

export { KINDS };
