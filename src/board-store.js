/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 5 (`13 engine on v2 plan.md`): ONE board store.
 *
 *   extension_settings.onyxquill_storyboards = { boards: { [name]: { board } }, characters: { [avatar]: name },
 *                                                  renamed: { [old]: new }, oneStore: 1 }
 *
 * Every board is kept here only, in the v2 shape the window edits. The engine's older parts still read a tracker's
 * definitions in the v1 shape (names, steps by name) — `engineBoard()` makes that from the v2 board when asked, it is
 * never stored. Edits from the Story tab and the /oq-tracker commands go into the v2 board (`saveDefs`).
 *
 * Once, on first use: every board that so far lived only in the old store (`deeplore_storyboards`, made by commands
 * before the window existed), and any edit made there since the window last saved, comes in; so do the character
 * defaults and renames. The old store is left exactly as it was — a backup (roadmap cleanup list).
 */
import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { STORE_KEY, asStore } from './storyboard-pure.js';
import { normalizeBoard } from './board-model-pure.js';
import { toV1Board, reconcile, mergeDefs } from './board-window-pure.js';

export const V2_KEY = 'onyxquill_storyboards';   // was deeplore_storyboards_v2
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** The store (created and filled from the old one on first use). */
export function boardStore() {
    let s = extension_settings[V2_KEY];
    if (!isObj(s) || !isObj(s.boards)) s = extension_settings[V2_KEY] = { boards: {} };
    if (!isObj(s.characters)) s.characters = {};
    if (!s.oneStore) bringOver(s);
    return s;
}

function bringOver(s) {
    const old = asStore(extension_settings[STORE_KEY]);
    for (const [name, v1] of Object.entries(old.boards)) {
        const rec = s.boards[name];
        // a board only the old store had is converted; one edited there since the window last saved takes the edit
        const r = reconcile(rec?.board, rec?.sig, v1, name);
        s.boards[name] = { board: r.board };
    }
    for (const [k, v] of Object.entries(old.characters)) if (!(k in s.characters)) s.characters[k] = v;
    if (isObj(old.renamed)) s.renamed = { ...old.renamed, ...(isObj(s.renamed) ? s.renamed : {}) };
    for (const rec of Object.values(s.boards)) if (isObj(rec)) delete rec.sig;   // only the old store needed it
    s.oneStore = 1;
    try { saveSettingsDebounced(); } catch { /* noop */ }
}

/** A board (v2, tidied) or null. */
export function getBoard(name) {
    const rec = name ? boardStore().boards[name] : null;
    return rec?.board ? normalizeBoard(rec.board, name) : null;
}

/** Store a board (v2). */
export function putBoard(name, board) {
    // the record keeps what lives beside the board (Mero's summary, mero-map.js) — the board itself is replaced
    const old = boardStore().boards[name];
    boardStore().boards[name] = { ...(old && typeof old === 'object' ? old : {}), board };
    try { saveSettingsDebounced(); } catch { /* noop */ }
}

const views = new WeakMap();   // stored board object → its engine view (a board is replaced, never edited in place)
/** The board's step trackers as the engine's older parts read them (v1 shape) — made, never stored. */
export function engineBoard(name) {
    const rec = name ? boardStore().boards[name] : null;
    if (!rec?.board) return null;
    if (!views.has(rec.board)) views.set(rec.board, toV1Board(normalizeBoard(rec.board, name)));
    return views.get(rec.board);
}

/** Every board's engine view (for lists and commands). */
export function engineBoards() {
    return Object.keys(boardStore().boards).map(engineBoard).filter(Boolean);
}

/** The Story tab / a command changed tracker definitions (`defs`, v1 shape): into the v2 board. */
export function saveDefs(name, defs) {
    const board = getBoard(name);
    if (!board) return false;
    putBoard(name, mergeDefs(board, defs, name));
    return true;
}

/**
 * Mero's summary of a board (mero-map.js): { text, hash, at, edited, stale } beside the board, never inside it — the
 * board window's saves replace the board and cannot drop it.
 */
export function getMeroMap(name) {
    const m = name ? boardStore().boards[name]?.meroMap : null;
    return m && typeof m === 'object' && typeof m.text === 'string' ? m : null;
}
export function setMeroMap(name, map) {
    const rec = name ? boardStore().boards[name] : null;
    if (!rec) return;
    if (map) rec.meroMap = map; else delete rec.meroMap;
    try { saveSettingsDebounced(); } catch { /* noop */ }
}
