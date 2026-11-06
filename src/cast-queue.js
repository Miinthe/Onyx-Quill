/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the Cast's round: who speaks, in the order Miinthe arranges (rules: cast-voice-pure.js).
 *
 * Miinthe: "If I write the NPC, the sequence should be up to me … and then the AI characters after. Queueing up an AI reply
 * and a human reply in one go gives me no chance to reply to that AI reply." So ▶ Go plays ONE round: YOUR HALF first
 * (your message from the chat box, NPC lines you wrote — in your order), then the AI HALF (NPCs the AI writes, the main
 * character — in their order). Then it is your turn again: a new round, You → the main character, with the NPCs set to
 * "steps in by themselves" who want to speak in the AI half and the "suggests themselves" ones offered.
 *
 * The plain Send button still works: your message, the main character's reply (SillyTavern does that at once), then the
 * AI half's NPCs in order. ▶ Go is for the exact order. Kept per chat (chat_metadata.deeplore_cast_queue).
 *
 * Regenerate, like a group chat: the whole round after your last line is redone — a new main reply, then the round's
 * NPCs speak again in order.
 */
import { chat_metadata, sendMessageAsUser } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { live, sceneAway } from './board-live.js';
import { WISHES_KEY, LEAVES_KEY, runDirector } from './cast.js';
import { runAutoTrack } from './autotrack.js';
import { speakAs, postAs, generationDone, cannotSpeak, npcTurnActive, waitForIdle, holdBox } from './cast-voice.js';
import { normalizeQueue, newRound, isMine, aiNpcs, npcOfMessage, regenRound, addItem, speaksOf, SPEAKS_SYSTEM, SPEAKS_SCHEMA, speaksUser, parseSpeaks } from './cast-voice-pure.js';
import { resolveConnectionConfig } from '../settings.js';
import { callAI } from './ai/ai.js';
import { escapeHtml } from '../../../../utils.js';
import { presentPeople } from './cast-pure.js';

export const QUEUE_KEY = 'deeplore_cast_queue';
export const SUGGEST_KEY = 'deeplore_cast_suggest';
/** People Miinthe added to the AI half by hand: they stay in every round (while in the scene) until she takes them out (✕). */
export const STAY_KEY = 'deeplore_cast_stay';
export const getStay = () => (Array.isArray(chat_metadata?.[STAY_KEY]) ? chat_metadata[STAY_KEY] : []);
export function setStay(list) { if (!chat_metadata) return; if (list?.length) chat_metadata[STAY_KEY] = list; else delete chat_metadata[STAY_KEY]; saveMetadataDebounced(); }
/** Add someone to the AI half by hand: now, and in every round after (Miinthe, 2026-10-13: "Kettle did not reapply itself to the list"). */
export function addStaying(cast, person, why) {
    if (!getStay().some(x => x.cast === cast && x.person === person)) setStay([...getStay(), { cast, person }]);
    setQueue(addItem(getQueue(), { kind: 'npc', cast, person, ...(why ? { why } : {}) }));
}
/** Take someone out of the round (✕) — an AI-half person also stops staying. */
export function removeFromRound(id) {
    const x = getQueue().find(y => y.id === id);
    if (x?.kind === 'npc' && !isMine(x)) {
        setStay(getStay().filter(s => !(s.cast === x.cast && s.person === x.person)));
        chat_metadata[SKIP_KEY] = [...(Array.isArray(chat_metadata[SKIP_KEY]) ? chat_metadata[SKIP_KEY] : []), { cast: x.cast, person: x.person }];
    }
    setQueue(getQueue().filter(y => y.id !== id));
}
const listeners = new Set();
let running = false, stopAsked = false, wired = false;
/** The most AI turns one round may take — a safety net, whatever happens (live 2026-10-14: a bug made Spoon speak on and on). */
const MAX_TURNS = 8;
let sentDirect = false;         // you pressed Send: after the main reply, the AI half's NPCs go on
let regenSeq = null;            // the AI turns of a regenerated round, in their order — played again in that order
let replay = false;             // that replay is running (cast.js: no new arrivals or speakers meanwhile)
export const replaying = () => replay;
/**
 * The open chat — a round belongs to the chat it started in (bug hunt 2026-11-03: switching chats between two turns, or
 * while the helper thought, let the round go on in the new chat — its turns, its queue, the helper's moves written there).
 */
const chatNow = () => getContext()?.getCurrentChatId?.() ?? null;
let roundAbort = null;          // the round's helper calls: stopped by a chat change

export function onQueueChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const notify = () => { for (const cb of listeners) { try { cb(); } catch { /* noop */ } } };
export const queueRunning = () => running;

/** This chat's round. Never stored yet: the default — You, then the main character. */
export function getQueue() {
    const L = live();
    if (!L) return [];
    const raw = chat_metadata?.[QUEUE_KEY];
    let q = Array.isArray(raw) ? normalizeQueue(raw, L.board) : newRound(L.board, L.state, []).queue;
    // everyone set to "steps in by themselves" who is in the scene is in the round — also in a round saved before they
    // came in (live 2026-10-14: Spoon was missing) — unless you took them out of this round (✕)
    const skip = Array.isArray(chat_metadata?.[SKIP_KEY]) ? chat_metadata[SKIP_KEY] : [];
    for (const x of presentPeople(L.board, L.state)) {
        if (speaksOf(x.p) !== 'self' || x.now.muted || skip.some(s => s.cast === x.cast.id && s.person === x.p.id)) continue;
        if (!q.some(y => y.kind === 'npc' && y.cast === x.cast.id && y.person === x.p.id && !isMine(y))) q = addItem(q, { kind: 'npc', cast: x.cast.id, person: x.p.id, stay: true });
    }
    // you or the main character out of the scene: not in the round (they come back with their tile)
    const away = sceneAway();
    return q.filter(x => !(x.kind === 'you' && away.user) && !(x.kind === 'main' && away.main));
}

/**
 * Who Send writes as while you're out of the scene: one of the NPCs you write yourself (✍️) who is in it — the one you
 * picked, else the first. null when none of yours is here.
 */
const AS_KEY = 'deeplore_cast_as';
export function ownHere() {
    const L = live(); if (!L) return [];
    return presentPeople(L.board, L.state).filter(x => speaksOf(x.p) === 'mine' && !x.now.muted).map(x => ({ cast: x.cast.id, person: x.p.id, name: x.p.name }));
}
export function writingAs() {
    const own = ownHere(), k = chat_metadata?.[AS_KEY];
    return own.find(x => `${x.cast}:${x.person}` === k) || own[0] || null;
}
export function setWritingAs(cast, person) { if (!chat_metadata) return; chat_metadata[AS_KEY] = `${cast}:${person}`; saveMetadataDebounced(); notify(); }
/** People taken out of this round with ✕, or who already spoke in it — cleared when the next round starts. */
const SKIP_KEY = 'deeplore_cast_skip';
/**
 * Already part of this round — waiting in it, speaking or done speaking, or staying by hand: never offered as "wants to
 * join" (Miinthe, 2026-10-19: Kettle and Spoon showed as wanting to be added while they were in it).
 */
export function inRound(w) {
    const same = y => y.cast === w.cast && y.person === w.person;
    const spoke = Array.isArray(chat_metadata?.[SKIP_KEY]) ? chat_metadata[SKIP_KEY] : [];
    return spoke.some(same) || getStay().some(same) || getQueue().some(y => y.kind === 'npc' && same(y));
}
/**
 * Take an item off the round. An NPC of the AI half is crossed off for the rest of this round, so "steps in by
 * themselves" doesn't put them straight back (live 2026-10-14: Spoon spoke three times in a row).
 */
function takeOff(x) {
    if (x?.kind === 'npc' && !isMine(x)) chat_metadata[SKIP_KEY] = [...(Array.isArray(chat_metadata[SKIP_KEY]) ? chat_metadata[SKIP_KEY] : []), { cast: x.cast, person: x.person }];
    setQueue(getQueue().filter(y => y.id !== x.id));
}
export function setQueue(q) {
    if (!chat_metadata) return;
    chat_metadata[QUEUE_KEY] = Array.isArray(q) ? q : [];
    saveMetadataDebounced();
    notify();
}
/** "Kettle wants to say something" — people set to "suggests themselves"; one click adds them. */
export const getSuggestions = () => (Array.isArray(chat_metadata?.[SUGGEST_KEY]) ? chat_metadata[SUGGEST_KEY] : []);
export function setSuggestions(list) { if (!chat_metadata) return; if (list?.length) chat_metadata[SUGGEST_KEY] = list; else delete chat_metadata[SUGGEST_KEY]; saveMetadataDebounced(); notify(); }

/**
 * Right after the main character's reply: who wants to speak (the director decided while it was written). Those set to
 * "steps in by themselves" join this round's AI half now, after the main character; "suggests themselves" are offered.
 */
function takeWishes() {
    const L = live();
    const w = chat_metadata?.[WISHES_KEY];
    delete chat_metadata?.[WISHES_KEY];
    takeLeaves(L);
    if (!L || !w?.list?.length) return;
    const r = newRound(L.board, L.state, w.list);
    const q = getQueue();
    const spoke = Array.isArray(chat_metadata?.[SKIP_KEY]) ? chat_metadata[SKIP_KEY] : [];
    const auto = r.queue.filter(x => x.kind === 'npc' && !spoke.some(s => s.cast === x.cast && s.person === x.person) && !q.some(y => y.kind === 'npc' && y.cast === x.cast && y.person === x.person && !isMine(y)));
    if (auto.length) setQueue([...q, ...auto]);
    const offer = r.suggest.filter(x => !inRound(x));
    if (offer.length) setSuggestions(offer);
}
/**
 * Who wants to walk out (the director): "steps in by themselves" people get their turn in this round with a goodbye —
 * they say so in their own message and are gone right after; "suggests themselves" people are offered ("✨ Kettle wants
 * to leave — let her go"). Miinthe, 2026-10-14: "if a NPC wants to walk away they should say so in their reply".
 */
function takeLeaves(L) {
    const lv = chat_metadata?.[LEAVES_KEY];
    delete chat_metadata?.[LEAVES_KEY];
    if (!L || !lv?.list?.length) return;
    let q = getQueue();
    const offer = [];
    for (const x of lv.list) {
        const p = L.board.trackers.find(t => t.id === x.cast)?.people?.find(y => y.id === x.person);
        if (!p) continue;
        if (speaksOf(p) === 'self') {
            const it = q.find(y => y.kind === 'npc' && y.cast === x.cast && y.person === x.person && !isMine(y));
            q = it ? q.map(y => (y === it ? { ...y, exit: { why: x.why } } : y)) : addItem(q, { kind: 'npc', cast: x.cast, person: x.person, exit: { why: x.why } });
        } else if (speaksOf(p) === 'suggest') offer.push({ ...x, leave: true });
    }
    setQueue(q);
    if (offer.length) setSuggestions([...getSuggestions().filter(s => !offer.some(o => o.cast === s.cast && o.person === s.person)), ...offer]);
}

/**
 * The next round: You, then the people who stay — those you added by hand, and everyone set to "steps in by
 * themselves" (Miinthe, 2026-10-14: "spoon didn't stay in the list") — while they're in the scene, then the main character.
 * Suggestions stay offered.
 */
function nextRound() {
    const L = live();
    if (!L) return;
    delete chat_metadata[SKIP_KEY];
    let q = newRound(L.board, L.state, []).queue;
    const steppers = presentPeople(L.board, L.state).filter(x => speaksOf(x.p) === 'self' && !x.now.muted).map(x => ({ cast: x.cast.id, person: x.p.id }));
    for (const s of [...getStay(), ...steppers.filter(x => !getStay().some(y => y.cast === x.cast && y.person === x.person))]) {
        const cast = L.board.trackers.find(t => t.id === s.cast), p = cast?.people?.find(x => x.id === s.person);
        if (p && L.state.cast?.[s.cast]?.[s.person]?.here === true) q = addItem(q, { kind: 'npc', cast: s.cast, person: s.person, stay: true });
    }
    setQueue(q);
}
async function sitOuts(signal) {
    const L = live(); if (!L) return;
    const hand = getStay();
    const free = getQueue().filter(x => !isMine(x) && (x.kind === 'main' || (x.kind === 'npc' && x.stay && !x.why && !x.exit && !x.text && !writesOwn(x) && !hand.some(h => h.cast === x.cast && h.person === x.person))));
    if (free.length < 2 && !(free.length === 1 && getQueue().filter(x => !isMine(x)).length > 1)) return;   // one voice alone always speaks
    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) return;
    const nameOf = x => (x.kind === 'main' ? (getContext()?.name2 || 'The main character') : L.board.trackers.find(t => t.id === x.cast)?.people?.find(p => p.id === x.person)?.name || '');
    const people = free.map(x => ({ x, name: nameOf(x), main: x.kind === 'main', wants: x.kind === 'npc' ? L.state.cast?.[x.cast]?.[x.person]?.wants || '' : '' })).filter(p => p.name);
    const messages = (getContext()?.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string').slice(-6).map(m => ({ name: m.name, mes: m.mes }));
    let speak = null;
    try {
        const r = await callAI(SPEAKS_SYSTEM, speaksUser({ messages, people }), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: SPEAKS_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0, signal });
        speak = parseSpeaks(r?.text, people.map(p => p.name));
    } catch (err) { if (err?.name !== 'AbortError') console.warn('[Onyx Quill] cast round: who speaks — skipped:', err?.message || err); }
    if (!speak || signal?.aborted) return;   // unreadable: everyone speaks, as before
    const quiet = people.filter(p => !speak.includes(p.name));
    if (!quiet.length) return;
    // never an empty AI half
    if (getQueue().filter(x => !isMine(x)).length - quiet.length < 1) return;
    for (const p of quiet) takeOff(p.x);
    try { toastr.info(`${quiet.map(p => escapeHtml(p.name)).join(', ')} ${quiet.length === 1 ? 'has' : 'have'} nothing to add this time.`, 'Cast', { timeOut: 5000 }); } catch { /* noop */ }
}

/** Back to the default round (the tab's Reset). */
export function resetRound() { const L = live(); if (!L) return; setQueue(newRound(L.board, L.state, []).queue); }

/** Stop after the message being written now. */
export function stopQueue() { if (running) { stopAsked = true; notify(); } }
/** "Stop after this one" was pressed and the round has not stopped yet (overhaul: the new Cast view shows it). */
export const queueStopping = () => running && stopAsked;

/** A round item for someone set to "✍️ you write their lines" on the board — the AI never writes for them. */
function writesOwn(x) {
    if (x?.kind !== 'npc') return false;
    const p = live()?.board?.trackers?.find(t => t.id === x.cast)?.people?.find(y => y.id === x.person);
    return speaksOf(p) === 'mine';
}

async function aiItem(x, gone = () => false) {
    await waitForIdle();
    if (gone()) return false;
    const why = cannotSpeak();
    if (why) { try { toastr.info(why, 'Cast'); } catch { /* noop */ } return false; }
    if (x.kind === 'main') {
        const done = generationDone();
        const before = getContext().chat.length;
        const giveBack = holdBox();
        try { await getContext().generate('normal'); } catch (err) { console.warn('[Onyx Quill] cast round: the main reply failed:', err?.message || err); giveBack(); return false; }
        // generate() is back once the reply is written; a generation that never got going (no connection) sends no
        // GENERATION_ENDED — waiting for it alone hung the round and kept what she had typed (bug hunt 2026-11-03)
        await Promise.race([done, new Promise(r => setTimeout(r, 1500))]);
        giveBack();
        if (getContext().chat.length <= before || getContext().chat.at(-1)?.is_user) return false;   // no reply came: stop the round
        takeWishes();
        return true;
    }
    // someone who is in the round only because they stay, and has left the scene since: skipped (not called back in)
    if (x.stay && live()?.state?.cast?.[x.cast]?.[x.person]?.here !== true) return true;
    return speakAs(x.cast, x.person, { exit: x.exit || null });
}

/** ▶ Go: one round — your half, then the AI half. */
export async function runQueue() {
    if (running) return;
    running = true; stopAsked = false; notify();
    let finished = false;
    const chat0 = chatNow(), gone = () => chatNow() !== chat0;
    const ac = roundAbort = new AbortController();
    try {
        const box = document.getElementById('send_textarea');
        // your half: check first that your message is there (nothing is posted otherwise)
        const q0 = getQueue();
        for (const x of q0.filter(isMine)) {
            if (stopAsked || gone()) return;
            takeOff(x);
            if (x.kind === 'you') {
                const text = box?.value?.trim();
                if (!text) continue;   // nothing in the chat box: only your NPC lines this round (Miinthe: "I cannot just speak as Kettle")
                box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
                try { await sendMessageAsUser(text, ''); } catch (err) {   // not sent: her text goes back in the box, the round stops
                    console.warn('[Onyx Quill] cast round: your message could not be sent:', err?.message || err);
                    box.value = text + (box.value ? ` ${box.value}` : ''); box.dispatchEvent(new Event('input', { bubbles: true }));
                    return;
                }
                try { await getContext().saveChat?.(); } catch { /* noop */ }
            } else await postAs(x.cast, x.person, x.text);
        }
        // who actually has something to add now (Miinthe, 2026-10-19: "they should sit out at times … that counts for the
        // main character"): those in the round only because they step in by themselves, and the main character, may sit
        // this one out. People you added by hand, lines you wrote, someone saying goodbye or who asked to speak stay in.
        if (!replay && !stopAsked && !gone()) await sitOuts(ac.signal);
        // no main character this round: DeepLore's helper and director only run inside his reply, so they run now —
        // who came or left, what people know, plans, who wants to leave (live 2026-10-14: with the Toaster out, Spoon
        // never got to think, so she never left)
        if (!gone() && !getQueue().some(y => y.kind === 'main')) {
            await waitForIdle();
            const chat = getContext()?.chat || [];
            if (!gone()) { try { await runAutoTrack(chat, 'normal', ac.signal); } catch (err) { console.warn('[Onyx Quill] cast round: the helper skipped:', err?.message || err); } }
            if (!gone()) { try { await runDirector(chat, 'normal', ac.signal); } catch (err) { console.warn('[Onyx Quill] cast round: the director skipped:', err?.message || err); } }
            if (gone()) return;
            takeWishes();
        }
        // the AI half, in its order
        for (let guard = 0; guard < MAX_TURNS; guard++) {
            if (stopAsked || gone()) return;
            const x = getQueue().find(y => !isMine(y));
            if (!x) break;
            takeOff(x);
            if (writesOwn(x)) continue;   // ✍️ you write their lines: left empty, they say nothing this round
            if (!await aiItem(x, gone)) return;
        }
        finished = !gone();
    } finally {
        if (roundAbort === ac) roundAbort = null;
        // another chat now: the chat change already reset the round (and a round there may be running) — touch nothing
        if (!gone()) {
            running = false; stopAsked = false; notify();
            if (finished) nextRound();
        }
    }
}

/**
 * Send (or Enter) while someone is in the round plays the round, like ▶ Go (Miinthe, 2026-10-13: Send had already posted
 * her message and started the main reply, so the lines she wrote for Kettle never went out). Called from DeepLore's
 * generate interceptor, before anything else runs: the main reply is stopped, your message goes back to the chat box,
 * and the round runs in its order. Returns true when it took the send over.
 */
export function takeOverSend(type, abort) {
    if (type !== 'normal' || running || npcTurnActive() || regenSeq) return false;
    const L = live();
    if (!L) return false;
    const q = getQueue();
    // the plain round (You → the main character, nobody else): an ordinary send. Anything else — someone in it, or the
    // main character taken out of it — plays the round (Miinthe: "make toaster … also skip a round")
    const away = sceneAway();
    if (!away.user && !q.some(x => x.kind === 'npc') && q.some(x => x.kind === 'main')) return false;
    const c = getContext(), last = c?.chat?.at(-1);
    if (!last?.is_user) return false;                          // only a send with your message
    try { abort(true); } catch { return false; }
    sentDirect = false;
    const text = last.mes, chat0 = chatNow();
    setTimeout(async () => {
        await waitForIdle();
        if (chatNow() !== chat0) return;   // she went to another chat meanwhile: her message stays where she sent it
        const now = getContext(), m = now.chat?.at(-1);
        if (m?.is_user && m.mes === text) { try { await now.deleteLastMessage(); } catch { /* noop */ } }
        const box = document.getElementById('send_textarea');
        // you're out of the scene: what you typed is your NPC's line (✍️), never your own
        if (away.user) {
            const as = writingAs();
            if (!as) {
                if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); }
                try { toastr.info('You are out of this scene and none of the people you write yourself is in it. Bring one in, or come back with your own tile in the Cast.', 'Cast', { timeOut: 9000 }); } catch { /* noop */ }
                return;
            }
            setQueue(addItem(getQueue(), { kind: 'npc', cast: as.cast, person: as.person, text }));
            runQueue();
            return;
        }
        if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); }
        if (!getQueue().some(x => x.kind === 'you')) setQueue(addItem(getQueue(), { kind: 'you' }));
        runQueue();
    }, 300);
    return true;
}

/**
 * Regenerate with NPCs in the round: SillyTavern was about to write the main reply first; the round is replayed in its
 * own order instead (the main character and the NPCs as they came). Called from DeepLore's generate interceptor.
 */
export function takeOverRegen(type, abort) {
    if (type !== 'regenerate' || !regenSeq || running) return false;
    const seq = regenSeq; regenSeq = null;
    try { abort(true); } catch { return false; }
    const chat0 = chatNow();
    setTimeout(async () => {
        await waitForIdle();
        if (chatNow() !== chat0) return;   // another chat now: the old chat's round is not replayed here
        const L = live(); if (!L) return;
        const keep = getQueue().filter(x => x.kind === 'npc' && isMine(x));   // lines you wrote for the next round wait
        setQueue(normalizeQueue(seq.map((x, k) => ({ id: `r${k}${Date.now().toString(36)}`, ...x })), L.board));
        replay = true;
        try { await runQueue(); } finally { replay = false; }
        if (keep.length && chatNow() === chat0) setQueue(normalizeQueue([...keep, ...getQueue()], L.board));
    }, 300);
    return true;
}

/** After a plain Send and the main reply: the AI half's NPCs, in order; then the next round. */
async function runAfterSend(chat0 = chatNow()) {
    if (running || chatNow() !== chat0) return;
    running = true; notify();
    const gone = () => chatNow() !== chat0;
    try {
        takeWishes();   // the main reply is there: who steps in after it
        for (let guard = 0; guard < MAX_TURNS; guard++) {
            const x = aiNpcs(getQueue())[0];
            if (!x || stopAsked || gone()) break;
            takeOff(x);
            if (!await aiItem(x, gone)) break;
        }
    } finally { if (!gone()) { running = false; stopAsked = false; notify(); nextRound(); } }
}

function wire() {
    if (wired) return;
    const ctx = getContext(), es = ctx?.eventSource, et = ctx?.eventTypes;
    if (!es || !et) return;
    wired = true;
    // you pressed Send (not ▶ Go): your message and the main character are done by SillyTavern; the AI half's NPCs follow
    es.on(et.MESSAGE_SENT, () => { if (!running) sentDirect = true; });
    es.on(et.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        if (running || npcTurnActive() || regenSeq) return;
        // a regenerate we didn't take over is a plain reply (e.g. the first one never came) — the round goes on as usual
        if (type && !['normal', 'regenerate', undefined].includes(type)) return;
        const m = getContext()?.chat?.[Number(id)];
        if (!m || m.is_user || npcOfMessage(m)) return;
        if (sentDirect) { sentDirect = false; const chat0 = chatNow(); setTimeout(() => runAfterSend(chat0), 600); return; }
        takeWishes();
    });
    // regenerate, like a group chat: the whole round after your last line is redone — in the same order (takeOverRegen)
    es.on(et.GENERATION_STARTED, async (type, _o, dryRun) => {
        if (dryRun || type !== 'regenerate' || npcTurnActive() || running) return;
        const c = getContext(), r = regenRound(c?.chat);
        if (!r) return;
        // leave the round's first message: SillyTavern's regenerate deletes that one itself (the rest goes now)
        while ((c.chat?.length ?? 0) > r.from + 1) { try { await c.deleteLastMessage(); } catch { break; } }
        regenSeq = r.seq;
    });
    // SillyTavern's Stop ends the whole round, not just the message being written (live 2026-10-14: the round went on and on)
    es.on(et.GENERATION_STOPPED, () => {
        sentDirect = false;
        if (running) { stopAsked = true; try { toastr.info('Stopped — the rest of this round is skipped. Press ▶ Go to play it again.', 'Cast'); } catch { /* noop */ } notify(); }
    });
    es.on(et.CHAT_CHANGED, () => { roundAbort?.abort(); roundAbort = null; running = false; stopAsked = false; sentDirect = false; regenSeq = null; notify(); });
}

/** Wire the hooks (index.js at start-up). */
export function initCastQueue() { wire(); }
