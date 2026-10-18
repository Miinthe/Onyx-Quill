/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the Cast's director: SillyTavern glue (`12 cast and agendas design.md` §2).
 *
 * Just before each reply, after the story helper (autotrack.js) has said who came in, who left and who learned what,
 * the director updates the inner life of the people IN THE SCENE: this moment's thought, their plans (kept, reworded,
 * finished, dropped, new), and — rarely — what they want. One call per turn, only when someone from the cast is here,
 * on the story helper's connection. Rules and prompt: cast-pure.js. Never throws into the generation.
 *
 * Miinthe, 2026-10-05: "the helper is the director, Mero is the actor".
 */
import { chat_metadata } from '../../../../../script.js';
import { escapeHtml } from '../../../../utils.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { resolveConnectionConfig } from '../settings.js';
import { callAI } from './ai/ai.js';
import { turnIndex } from './turn-index.js';
import { echo } from './echo.js';
import { replaying } from './cast-queue.js';   // a regenerate replaying the round: nobody new joins
import { live, saveLiveState, liveWriterLines } from './board-live.js';
import { autoTrackEnabled, undoCollection } from './autotrack.js';
import { placeOf, trackerOf } from './board-model-pure.js';
import { presentPeople, directorUser, DIRECTOR_SYSTEM, DIRECTOR_SCHEMA, parseDirectorAll, validateDirector, validateComes, applyCastChanges, describeCastChange, appearAtPlaces, awayCandidates, personOf, OFFSCREEN_SYSTEM, OFFSCREEN_SCHEMA, offscreenUser, parseOffscreen, offscreenChanges, leftAt, backFrom, EXIT_SYSTEM, EXIT_SCHEMA, exitUser, exitFrom, RETURN_SYSTEM, RETURN_SCHEMA, returnUser } from './cast-pure.js';

const SKIP_TYPES = new Set(['quiet', 'swipe', 'regenerate', 'continue', 'impersonate']);
/** How many recent messages the director reads (newest last). */
export const DIRECTOR_WINDOW = 6;
/** The director's answer cap (tokens) — at least this, whatever the story helper's connection says. */
export const DIRECTOR_MAX_TOKENS = 1500;
/** The director's time limit (ms) — at least this, whatever the story helper's connection says (its 20 s ran out live). */
export const DIRECTOR_TIMEOUT = 45000;

/** A person's character card as the director reads it: description and personality ({{char}} / {{user}} filled in). */
function cardText(p) {
    const ctx = getContext();
    const ch = p.card ? (ctx?.characters || []).find(c => c.avatar === p.card) : null;
    if (!ch) return '';
    const fill = s => String(s || '').replaceAll('{{char}}', p.name).replaceAll('{{user}}', ctx?.name1 || 'the user');
    return [fill(ch.description || ch.data?.description), ch.personality || ch.data?.personality ? `Personality: ${fill(ch.personality || ch.data?.personality)}` : ''].filter(Boolean).join('\n');
}

/**
 * Update the people in the scene. Returns the changes applied (for diagnostics).
 * @param {Array} chatMessages the chat as the generation sees it
 */
export const WISHES_KEY = 'deeplore_cast_wishes';
/** Who wants to walk out of the scene (the round gives them a last turn to say so — cast-queue.js). */
export const LEAVES_KEY = 'deeplore_cast_leaves';
/** Who wants to speak after the reply being written (the queue reads it once the reply is there — cast-queue.js). */
function setWishes(list) { chat_metadata[WISHES_KEY] = { at: turnIndex(getContext()?.chat), list }; saveMetadataDebounced(); }

export async function runDirector(chatMessages, type, signal) {
    if (SKIP_TYPES.has(type) || !autoTrackEnabled()) return [];
    if (chat_metadata) { delete chat_metadata[WISHES_KEY]; delete chat_metadata[LEAVES_KEY]; }   // a new turn: last turn's wishes are gone
    let L0 = live();
    if (!L0) return [];
    const at = turnIndex(getContext()?.chat);
    const applied = [], arrived = [];
    // 1. turning up at their places (step 2): a roll, once per visit — no AI call (not while a regenerate replays the round)
    const rolls = replaying() ? [] : appearAtPlaces(L0.board, L0.state);
    if (rolls.length) {
        saveLiveState(applyCastChanges(L0.board, L0.state, rolls, at, { who: 'roll' }));
        for (const ch of rolls.filter(c => c.field === 'here')) { notice(L0.board, ch); applied.push(ch); arrived.push({ cast: ch.col, person: ch.person, why: 'just turned up' }); }
        L0 = live();
    }
    // 2. back after a while away: what they did meanwhile (one call per return — step 4)
    for (const { cast, p, now } of presentPeople(L0.board, L0.state)) {
        const bk = backFrom(L0.state, cast, p);
        if (bk && cast.director !== false && !now.muted) { const ch = await writeOffscreen(cast.id, p.id, { from: bk.left, to: bk.back, who: 'director', signal }); if (ch) applied.push(...ch); }
    }
    L0 = live();
    // 3. the director: the people in the scene, and the people away who might come looking
    const here = presentPeople(L0.board, L0.state).filter(x => x.cast.director !== false && !x.now.muted);   // 🔇 muted: not thought for
    const away = awayCandidates(L0.board, L0.state);
    if (!here.length && !away.length) { if (arrived.length) setWishes(arrived); return applied; }
    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) { if (arrived.length) setWishes(arrived); return applied; }   // the story helper's notice already says how to set one
    // each message keeps its place in the chat (_i): someone learns only from what was said while they were there
    const chatNow = getContext()?.chat || [];
    const messages = (Array.isArray(chatMessages) ? chatMessages : []).filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-DIRECTOR_WINDOW)
        .map(m => {   // the generation hands DeepLore copies: find each one's place (live 2026-10-14: the check never ran)
            let i = chatNow.indexOf(m);
            if (i === -1) i = chatNow.findIndex(c => c && c.send_date === m.send_date && c.mes === m.mes);
            return i === -1 ? m : { ...m, _i: i };
        });
    if (!messages.length) return applied;
    const boardLines = (() => { try { return liveWriterLines().filter(l => !/^IN THE SCENE:|^JUST ARRIVED:|\(acts on this, never says it outright\)| knows: |'s own messages — never write them/.test(l)); } catch { return []; } })();
    const user = directorUser(L0.board, L0.state, messages, { cardText, boardLines, placeName: h => placeOf(trackerOf(L0.board, h.place), h.at)?.name ?? null, nowI: at });
    if (!user) return applied;
    let answer = { people: [], away: [] };
    try {
        // its own room to answer: the story helper's cap (400 by default) cut the director off mid-answer in live tests
        // (2026-10-13) — thoughts, plans and facts with their quotes are longer than tracker moves
        const result = await callAI(DIRECTOR_SYSTEM, user, { ...conn, timeout: Math.max(Number(conn.timeout) || 0, DIRECTOR_TIMEOUT), maxTokens: Math.max(Number(conn.maxTokens) || 0, DIRECTOR_MAX_TOKENS), caller: 'storyTracker', skipThrottle: true, jsonSchema: DIRECTOR_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.7, signal });
        answer = parseDirectorAll(result?.text ?? '');
        if (!answer.people.length && !answer.away.length && !/^\s*\{\s*\}\s*$/.test(String(result?.text ?? '')) && String(result?.text ?? '').trim()) console.warn('[DLE] cast director: answer unreadable (cut off?) —', String(result.text).slice(0, 200));
    } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[DLE] cast director failed:', err?.message || err);
        if (arrived.length) setWishes(arrived);
        return applied;
    }
    // re-read: the story helper or Miinthe may have changed someone meanwhile
    const L = live();
    if (!L) return applied;
    const { changes, rejected, wishes, leaves } = validateDirector(answer.people, L.board, L.state, messages);
    if (leaves.length && !replaying()) chat_metadata[LEAVES_KEY] = { at, list: leaves };
    if (rejected.length) console.debug('[DLE] cast director answers not applied:', rejected);
    // a plan sends someone looking (step 2) — not while a regenerate replays the round: that redoes it, nobody new joins
    const comes = replaying() ? [] : validateComes(answer.away, L.board, L.state, at);
    setWishes(replaying() ? [] : [...arrived, ...wishes, ...comes.filter(c => c.field === 'here').map(c => ({ cast: c.col, person: c.person, why: 'came looking' }))]);
    const all = [...changes, ...comes];
    if (!all.length) return applied;
    saveLiveState(applyCastChanges(L.board, L.state, all, at, { who: 'director' }));
    // a notice when plans or wants change, someone learned something, left or came (thoughts stay quiet, in the Cast tab)
    for (const ch of all.filter(c => c.field === 'plans' || c.field === 'wants' || (c.field === 'knows' && !c.add?.offscreen) || c.field === 'here' || c.field === 'offscreen')) {
        if (ch.field === 'plans' && !ch.added?.length && !ch.ended?.length) continue;   // only reworded
        notice(L.board, ch);
    }
    return [...applied, ...all];
}

/**
 * The off-screen entry for one person (step 4): one call — what they did while away — logged with Undo, a notice.
 * On their return (runDirector, before the director, so their plans can follow from it) or asked with 📜.
 */
async function writeOffscreen(castId, personId, { from = null, to = null, who = 'director', signal } = {}) {
    const L = live();
    const cast = L?.board?.trackers?.find(t => t.id === castId), p = personOf(cast, personId);
    if (!p) return null;
    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) return null;
    const chat = getContext()?.chat || [];
    const messages = chat.filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-DIRECTOR_WINDOW).map(m => ({ name: m.name, mes: m.mes }));
    const boardLines = (() => { try { return liveWriterLines().filter(l => !/^IN THE SCENE:|^JUST ARRIVED:|while away:|\(acts on this, never says it outright\)| knows: |'s own messages — never write them/.test(l)); } catch { return []; } })();
    let ans = null;
    try {
        const r = await callAI(OFFSCREEN_SYSTEM, offscreenUser(L.state, cast, p, messages, { cardText, boardLines }), { ...conn, timeout: Math.max(Number(conn.timeout) || 0, DIRECTOR_TIMEOUT), maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'storyTracker', skipThrottle: true, jsonSchema: OFFSCREEN_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.8, signal });
        ans = parseOffscreen(r?.text);
        if (!ans) console.warn('[DLE] cast off-screen: answer unreadable —', String(r?.text ?? '').slice(0, 300));
    } catch (err) { if (err?.name !== 'AbortError') console.warn('[DLE] cast off-screen failed:', err?.message || err); }
    if (!ans) return null;
    const L2 = live(), c2 = L2?.board?.trackers?.find(t => t.id === castId), p2 = personOf(c2, personId);
    if (!p2) return null;
    const changes = offscreenChanges(L2.state, c2, p2, ans, from, to, who);
    if (!changes.length) return null;
    saveLiveState(applyCastChanges(L2.board, L2.state, changes, turnIndex(getContext()?.chat), { who }));
    notice(L2.board, changes[0]);
    return changes;
}

/** "📜 What have they been up to?" (the Cast tab) for someone away. Returns the entry's text, or null. */
export async function askOffscreen(castId, personId) {
    const L = live();
    const cast = L?.board?.trackers?.find(t => t.id === castId), p = personOf(cast, personId);
    if (!p) return null;
    if (resolveConnectionConfig('storyTracker').mode !== 'profile') { try { toastr.info('The director needs the story helper\'s connection: DeepLore settings → AI Connections → Story Trackers.', 'Cast'); } catch { /* noop */ } return null; }
    const ch = await writeOffscreen(castId, personId, { from: leftAt(L.state, cast, p), to: turnIndex(getContext()?.chat), who: 'asked' });
    if (!ch) { try { toastr.info(`No answer about ${escapeHtml(p.name)} this time — try again.`, 'Cast'); } catch { /* noop */ } return null; }
    return ch[0].to?.at?.(-1)?.text ?? null;
}

/**
 * Did this NPC just walk out in their own message (theirs or one Miinthe wrote for them)? One short call; a yes with the
 * line that shows it takes them out of the scene now (logged, Undo, a notice). Returns true when they left.
 */
export async function checkExit(castId, personId, text) {
    const L = live();
    const cast = L?.board?.trackers?.find(t => t.id === castId), p = personOf(cast, personId);
    if (!p || !L.state.cast?.[castId]?.[personId]?.here) return false;
    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) return false;
    let quote = null;
    try {
        const r = await callAI(EXIT_SYSTEM, exitUser(p.name, text), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: EXIT_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0 });
        quote = exitFrom(r?.text, text);
    } catch (err) { if (err?.name !== 'AbortError') console.warn('[DLE] cast exit check failed:', err?.message || err); }
    if (!quote) return false;
    const L2 = live();
    if (!L2?.state?.cast?.[castId]?.[personId]?.here) return false;
    const ch = { kind: 'cast', col: castId, person: personId, field: 'here', from: true, to: false, who: 'npc', quote, reason: 'walks out in their own message' };
    saveLiveState(applyCastChanges(L2.board, L2.state, [ch], turnIndex(getContext()?.chat), { who: 'npc' }));
    notice(L2.board, ch);
    return true;
}

/** How many messages after someone left a message can still hold them back or bring them back. */
export const RETURN_WINDOW = 3;

/**
 * A new message (any speaker — the AI's, or a line Miinthe wrote for an NPC): does it stop someone who left in the last few
 * messages, or bring them back? Read from the change log, so it survives a reload (live 2026-10-14: the note was lost and
 * Kettle's "stops Spoon before she leaves" was never checked). One short call per such person; a yes with the words that
 * show it puts them back in the scene (logged, Undo, a notice).
 */
export async function checkReturns(index, speaker, text) {
    const L0 = live();
    if (!L0) return;
    const due = [];
    for (const cast of L0.board.trackers.filter(t => t.kind === 'cast')) {
        for (const p of cast.people || []) {
            if (L0.state.cast?.[cast.id]?.[p.id]?.here) continue;
            const left = (L0.state.log || []).filter(e => e.kind === 'cast' && e.col === cast.id && e.person === p.id && e.field === 'here').at(-1);
            if (left && left.to === false && index > left.i && index - left.i <= RETURN_WINDOW) due.push({ cast: cast.id, person: p.id });
        }
    }
    if (!due.length) return;
    const conn = resolveConnectionConfig('storyTracker');
    if (conn.mode !== 'profile' || !conn.profileId) return;
    for (const x of due) {
        const L = live();
        const cast = L?.board?.trackers?.find(t => t.id === x.cast), p = personOf(cast, x.person);
        if (!p || L.state.cast?.[x.cast]?.[x.person]?.here) continue;   // already back
        let quote = null;
        try {
            const r = await callAI(RETURN_SYSTEM, returnUser(p.name, speaker, text), { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 200), caller: 'storyTracker', skipThrottle: true, jsonSchema: RETURN_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0 });
            quote = exitFrom(r?.text, text, 'back');
        } catch (err) { if (err?.name !== 'AbortError') console.warn('[DLE] cast return check failed:', err?.message || err); }
        if (!quote) continue;
        const L2 = live();
        if (!L2 || L2.state.cast?.[x.cast]?.[x.person]?.here) continue;
        const ch = { kind: 'cast', col: x.cast, person: x.person, field: 'here', from: false, to: true, who: 'auto', quote, reason: 'held back — stays in the scene' };
        saveLiveState(applyCastChanges(L2.board, L2.state, [ch], index, { who: 'auto' }));
        notice(L2.board, ch);
    }
}

function notice(board, ch) {
    echo(() => toastr.info(`🎭 ${escapeHtml(describeCastChange(board, ch))}${ch.quote ? `<br><i>“${escapeHtml(ch.quote)}”</i>` : ''}<br><u>Undo</u>`, 'Cast', { escapeHtml: false, timeOut: 10000, extendedTimeOut: 6000, onclick: () => undoCollection(ch.logId) }));
}
