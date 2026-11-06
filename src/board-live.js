/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — the storyboard as it stands in this chat, for the engine
 * (storyboard stage 3). The step trackers still run on the engine's list (trackers.js); what
 * only the v2 board knows — collections, the purse, counters, places, state — is read here
 * from the stored v2 board and this chat's v2 state (both written by the board window,
 * board-window.js), and changed here by the helper (autotrack.js).
 *
 * It also answers the engine's lines that wait for those kinds ("starts once 3 clues are
 * uncovered", "only possible once the stash has $5"): conditions-pure.js asks through
 * setExternalConditions, so the pure rules stay pure.
 */
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { saveMetadataDebounced, getContext } from '../../../../extensions.js';
import { user_avatar } from '../../../../personas.js';
import { BOARD_KEY } from './storyboard-pure.js';
import { setExternalConditions } from './conditions-pure.js';
import { normalizeBoard, normalizeState, freshState, holds, condText, fromEngineList, certain, stepEntries, capLog } from './board-model-pure.js';
import { TRACKERS_KEY, asList } from './trackers-pure.js';
import { lineHolds, justHappenedLines, toFindLines } from './rolls-pure.js';   // triggers + odds
import { collectionLines, filterByItems, rewindCollections } from './collections-pure.js';
import { placeLines, filterByPlace, pinnedHere, locationValue } from './places-pure.js';   // round 3: places
import { stateLines } from './state-pure.js';   // round 4: state + dates
import { meterLines } from './meters-pure.js';   // meters (2026-10-12): the band, never the number
import { castLines, castJudgeLines, castPins, presentNames, arrivalLines, offscreenLines } from './cast-pure.js';   // the Cast (2026-10-13): who is here, their plans and knowledge
import { filterByBoardLinks, boardLinkPins, guidanceLines, stepJudgeSection, steerLines } from './board-links-pure.js';   // what the writer gets (2026-10-04)
import { vaultIndex } from './state.js';
import { boardStore } from './board-store.js';   // engine on v2, step 5: one board store

export const V2_KEY = 'onyxquill_storyboards';   // was deeplore_storyboards_v2
export const STATE_KEY = 'deeplore_board_state';

/**
 * This chat's v2 board and state, or null when the chat has no board saved by the window.
 * `list` — the engine's list to read step positions from (default: the stored one; during a
 * save, the list being saved, so lines see this very save's moves).
 */
export function live(list = null) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    if (!rec?.board) return null;
    if (offFor(rec.board)) return null;   // the board is switched off for this chat / its character
    const board = normalizeBoard(rec.board, name);
    const raw = chat_metadata?.[STATE_KEY];
    const state = raw ? normalizeState(raw, board) : freshState(board);
    // The step trackers move on the engine's list (trackers.js); the stored v2 state only learns
    // their positions when the window saves. Read them in, so a line here that waits for a step
    // ("the ring can only be had once Relationship reaches Married") sees where the story is now
    // (cloud bug hunt, 2026-10-04 — before, it saw the step of the last window save).
    if (!list && state.stepsRebuilt) return { board, state };   // engine on v2, step 7: the v2 state is the only truth
    return { board, state: fromEngineList(board, state, asList(list ?? chat_metadata?.[TRACKERS_KEY])) };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — a board switched off for a chat or a character (the window's "Switched
 * off for", the Story tab): nothing of it runs there — no trackers watched or told, no helper calls, no
 * collections / places / state, no triggers; entries tied to its steps stay hidden (like a waiting tracker's).
 * The board's `off` holds chat names and "Name (character)", as the window writes them.
 */
const chatLabel = () => getContext()?.getCurrentChatId?.() || '';
const charLabel = () => { const c = getContext(); const n = c?.groupId ? null : c?.characters?.[c?.characterId]?.name; return n ? `${n} (character)` : ''; };
function offFor(board) {
    const off = Array.isArray(board?.off) ? board.off : [];
    if (!off.length) return null;
    return [chatLabel(), charLabel()].find(x => x && off.includes(x)) || null;
}
/** Is this chat's board switched off here? Returns what it is off for ("this chat" / the character label), or null. */
export function boardOffHere() {
    const name = chat_metadata?.[BOARD_KEY];
    const b = name ? boardStore()?.boards?.[name]?.board : null;
    const why = b ? offFor(b) : null;
    return why ? (why === chatLabel() ? 'this chat' : why) : null;
}
/** Switch this chat's board off (or back on) — for this chat, or (`forCharacter`) for the character. */
export function setBoardOff(off, { forCharacter = false } = {}) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    if (!rec?.board) return false;
    const label = forCharacter ? charLabel() : chatLabel();
    if (!label) return false;
    const list = (Array.isArray(rec.board.off) ? rec.board.off : []).filter(x => off || (x !== chatLabel() && x !== charLabel()));
    if (off && !list.includes(label)) list.push(label);
    rec.board.off = list;
    saveSettingsDebounced();
    return true;
}

/**
 * You (the persona) and the main character can leave the scene too (Miinthe, 2026-10-19: "I do have NPC I fully write on my
 * own, and sometimes I do have a scene with only that NPC and the main character or that NPC with another NPC"). Kept
 * per chat. Away: the round goes without them, and everyone writing is told they aren't there.
 */
export const AWAY_KEY = 'deeplore_scene_away';
export function sceneAway() { const a = chat_metadata?.[AWAY_KEY]; return { user: a?.user === true, main: a?.main === true }; }
export function setSceneAway(who, away) {
    if (!chat_metadata || !['user', 'main'].includes(who)) return;
    const a = { ...sceneAway(), [who]: !!away };
    if (a.user || a.main) chat_metadata[AWAY_KEY] = a; else delete chat_metadata[AWAY_KEY];
    saveMetadataDebounced();
    notifyLive();
}
function awayLines() {
    const a = sceneAway(), c = getContext();
    return [a.user ? `NOT IN THIS SCENE: ${c?.name1 || 'the player'} (the player's own character) — they aren't here. Nobody talks to them, looks at them or answers them; write the scene without them.` : '',
        a.main && c?.name2 ? `NOT IN THIS SCENE: ${c.name2} — they aren't here. Nobody talks to them or answers them.` : ''].filter(Boolean);
}

/**
 * The world's pause, kept per chat (Miinthe, 2026-11-05) — the World panel's rail button. true / false once set in this chat;
 * undefined: never set here, the board's old `world.paused` flag counts (world-pure.js worldPaused).
 */
export const WORLD_PAUSE_KEY = 'onyxquill_world_paused';
export function worldChatPaused() { const v = chat_metadata?.[WORLD_PAUSE_KEY]; return typeof v === 'boolean' ? v : undefined; }
/** Pause the world layer (or wake it) in this chat only. */
export function setWorldPaused(paused) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    if (!rec?.board || !chat_metadata) return false;
    chat_metadata[WORLD_PAUSE_KEY] = !!paused;
    saveMetadataDebounced();
    return true;
}

/**
 * Engine on v2, step 1 (2026-10-05, `13 engine on v2 plan.md`): every save of the engine's list also writes the step
 * trackers' places into the v2 chat state and logs each move there (kind 'step', with who / quote from the journal).
 * Nothing reads them yet — the engine still runs on its list. The first time in a chat (no `v2steps` yet) the places are
 * only copied over, so old, stale v2 places don't show up as moves. `silent`: copy without logging (New Run, a new board).
 */
export function recordSteps(list, i, { silent = false } = {}) {
    const name = chat_metadata?.[BOARD_KEY];
    const rec = name ? boardStore()?.boards?.[name] : null;
    if (!rec?.board) return;
    const board = normalizeBoard(rec.board, name);
    const raw = chat_metadata?.[STATE_KEY];
    const prev = raw ? normalizeState(raw, board) : freshState(board);
    chat_metadata[STATE_KEY] = logSteps(board, prev, fromEngineList(board, prev, asList(list)), list, i, { silent });
}

/** `next` with its step moves since `prev` logged (who / quote from the list's journal entry at message i); marks v2steps. */
export function logSteps(board, prev, next, list, i, { silent = false } = {}) {
    next.log = Array.isArray(next.log) ? next.log : [];
    if (prev.v2steps && !silent) {
        const meta = id => {
            const e = asList(list).find(x => x.id === id);
            // only a journal entry made at this very message says who moved it (a start or a fork roll has none of its own)
            const j = Array.isArray(e?.journal) ? e.journal.at(-1) : null;
            return j && j.i === Math.floor(i || 0) ? { who: j.who, why: j.why, quote: j.quote, reason: j.reason, confidence: j.confidence } : {};
        };
        next.log.push(...stepEntries(board, prev, next, i, meta));
        capLog(next);
    }
    if (!prev.v2steps) next.v2since = Math.floor(i || 0);   // from here on the v2 log holds every step move
    next.v2steps = true;
    return next;
}

// who wants to hear that the live state changed (the Cast tab, 2026-10-13)
const liveListeners = new Set();
export function onLiveChanged(cb) { liveListeners.add(cb); return () => liveListeners.delete(cb); }
export function notifyLive() { for (const cb of liveListeners) { try { cb(); } catch (err) { console.warn('[Onyx Quill] live listener failed:', err?.message || err); } } }

/** Store this chat's v2 state (the caller then re-runs the trackers' starts: saveTrackers). */
export function saveLiveState(state) {
    chat_metadata[STATE_KEY] = state;
    syncLiveLocation();
    syncLivePresent();
    notifyLive();
    saveMetadataDebounced();
}

/**
 * Places: "here" sets DeepLore's own location filter (deeplore_context.location — what
 * /oq-set-location sets by hand) to the place's id. Only while a place tracker runs and
 * the board doesn't say otherwise; a paused one leaves the filter as it is. Returns the value set.
 */
export function syncLiveLocation() {
    const L = live();
    if (!L) return null;
    const v = locationValue(L.board, L.state);
    if (!v) return null;
    const ctx = (chat_metadata.deeplore_context ||= {});
    if (String(ctx.location ?? '') !== v) { ctx.location = v; saveMetadataDebounced(); }
    return v;
}

/**
 * The Cast (2026-10-13): a cast with "sets Characters present" on writes who is in the scene into DeepLore's own
 * Characters Present filter (deeplore_context.character_present) — the main character always, plus the people here.
 */
export function syncLivePresent() {
    const L = live();
    if (!L) return null;
    const names = presentNames(L.board, L.state);
    if (!names) return null;
    const main = getContext()?.name2;
    const want = [...new Set([...(main ? [main] : []), ...names])];
    const ctx = (chat_metadata.deeplore_context ||= {});
    if (JSON.stringify(ctx.character_present ?? []) !== JSON.stringify(want)) { ctx.character_present = want; saveMetadataDebounced(); }
    return want;
}

/** The judge entries' text (a place tracker's rules for the helper). */
export const entryText = title => {
    const e = (vaultIndex || []).find(x => x.title === title);
    return e ? fillNames(e.content || e.summary || '') : '';
};

// LOCAL PATCH (Miinthe, 2026-10-19): the helper got judge notes with a literal {{user}} and had to guess who that is —
// writing a scene as Mei could have moved the Ladder. {{user}} is found by the chat's persona ID (names repeat, IDs
// don't: she has four personas called "Lucan"), its name looked up from that ID; {{char}} is the chat's character.
export function playerName(ctx = getContext(), avatar = user_avatar) {
    const byId = ctx?.powerUserSettings?.personas?.[avatar];
    return String(byId ?? ctx?.name1 ?? '').trim();
}
export function fillNames(text, user = playerName(), char = String(getContext()?.name2 ?? '').trim()) {
    let t = String(text ?? '');
    if (user) t = t.replace(/\{\{user\}\}/gi, user);
    if (char) t = t.replace(/\{\{char\}\}/gi, char);
    return t;
}

/** The tracker helper's step rules: judge entries of the next steps, the detours of the current ones. */
export function liveStepJudgeSection() {
    const L = live();
    return L ? stepJudgeSection(L.board, L.state, entryText) : '';
}

/** Entries pinned by the board right now (the place the scene is at) — added to the chat's own pins at generation, never saved into them. */
export function liveBoardPins() {
    const L = live();
    return L ? [...new Set([...pinnedHere(L.board, L.state), ...boardLinkPins(L.board, L.state), ...castPins(L.board, L.state)])] : [];
}

/**
 * Lines for the writer's block: the kept items by name (and state), money — no entry text.
 * Miinthe, 2026-10-05: DeepLore's AI search does the rest — an item's entry becomes available once
 * the item is kept (filterLiveEntries), the search reads these lines in the story state and its
 * summary in the manifest, and picks the entry when it fits the scene; its content then reaches
 * the writer like any other lore. No text twice, and only when it matters.
 */
export function liveWriterLines() {
    const L = live();
    return L ? [...stateLines(L.board, L.state), ...placeLines(L.board, L.state), ...castLines(L.board, L.state), ...awayLines(), ...arrivalLines(L.board, L.state, lastIndex()), ...offscreenLines(L.board, L.state, lastIndex()), ...meterLines(L.board, L.state, lastIndex()), ...collectionLines(L.board, L.state), ...toFindLines(L.board, L.state), ...justHappenedLines(L.board, L.state, lastIndex()), ...guidanceLines(L.board, L.state, entryText), ...steerLines(L.board, L.state)] : [];
}
/** The last AI reply before the one being written (a final AI message is the one a swipe redoes). */
const lastIndex = () => {
    const c = getContext()?.chat;
    if (!Array.isArray(c) || !c.length) return 0;
    const isAi = m => m && !m.is_user && !m.is_system;
    let k = isAi(c[c.length - 1]) ? c.length - 2 : c.length - 1;
    while (k >= 0 && !isAi(c[k])) k--;
    return Math.max(0, k);
};
/** Lines for the judge: names and states only. */
export function liveJudgeLines() {
    const L = live();
    return L ? [...stateLines(L.board, L.state), ...placeLines(L.board, L.state), ...castJudgeLines(L.board, L.state), ...meterLines(L.board, L.state, lastIndex()), ...collectionLines(L.board, L.state, { forJudge: true }), ...toFindLines(L.board, L.state)] : [];
}
/** Entries linked on items exist once the item is past its first state. */
export function filterLiveEntries(entries, isPinned) {
    const L = live();
    return L ? filterByBoardLinks(filterByPlace(filterByItems(entries, L.board, L.state, isPinned), L.board, L.state, isPinned), L.board, L.state, isPinned) : entries;
}
/** After a delete / a branch: changes from later messages are rolled back. Returns what was undone. */
export function rewindLiveTo(messageIndex, keep = null) {
    const L = live();
    if (!L) return [];
    const r = rewindCollections(L.board, L.state, messageIndex, keep);   // items, money and places (one log)
    if (r.undone.length) saveLiveState(r.state);
    return r.undone;
}


// lines of the engine that wait for a collection, counter, place or state: { ext: <v2 condition> };
// a start with odds carries its line key and holds once its roll came up (rolls-pure.js)
setExternalConditions(
    (c, list) => { const L = live(list); return !!L && (c.line ? lineHolds(L.board, L.state, c, c.line) : holds(L.board, L.state, certain(c))); },
    c => { const L = live(); return L ? condText(L.board, c) : '(a condition on the board)'; },
);
