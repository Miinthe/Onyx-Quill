/**
 * LOCAL PATCH (Miinthe, 2026-11-04) — each swipe keeps its own board. Pure rules; tested in test/swipe-board.test.mjs.
 * The glue (SillyTavern's swipe events, the chat's board data) is src/swipe-board.js.
 *
 * Miinthe: "reevaluate doesn't delete anything, since it's a swipe each swipe should keep the info no? so no popup, but the
 * changes should show in the changes and be live when zapping through the swipes."
 *
 * The board's changes for a turn are recorded at her message (the helper runs before the reply), so every swipe of the
 * newest reply used to share one board — and Re-evaluate overwrote it. Now the newest reply remembers the board per
 * swipe: leaving a swipe stores the board as it is; arriving at a swipe that has a stored board puts that board back
 * (its moves, items, places, Cast, log — so "What this changed" shows that swipe's changes). A brand-new swipe starts
 * from the board of the swipe it came from (a normal swipe keeps the board, as before); Re-evaluate's swipe starts from
 * its fresh evaluation. Only the newest reply has swipes to flip through, so only its boards are kept.
 *
 * Store (chat_metadata[SWIPE_BOARD_KEY]): { v: 1, at: <the reply's index>, shown: <swipe id on screen>, byId: { [id]: snap } }
 * A snap is opaque here: the glue's copy of the board data.
 */
export const SWIPE_BOARD_KEY = 'onyxquill_swipe_board';

const int = v => (Number.isInteger(v) ? v : null);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** The store for reply `at` — a fresh one when it was for another message (a new reply came, or one was deleted). */
export function storeFor(raw, at, shown = null) {
    if (isObj(raw) && raw.v === 1 && raw.at === at && isObj(raw.byId)) return { v: 1, at, shown: int(raw.shown) ?? int(shown), byId: { ...raw.byId } };
    return { v: 1, at, shown: int(shown), byId: {} };
}

/**
 * The reply shows swipe `to` now (SillyTavern already switched). `current` = the board as it is right now, which is
 * the board of the swipe that was shown (`store.shown`) — unless `skipSave` (Re-evaluate already stored it before
 * rewinding, and the board now holds the fresh evaluation). Returns { store, restore }: `restore` = the board to put
 * back for `to`, or null (a new swipe: the board stays as it is).
 */
export function onSwipe(store, to, current, { skipSave = false } = {}) {
    const s = { ...store, byId: { ...store.byId } };
    const from = int(s.shown);
    if (!skipSave && from != null && from !== to && current) s.byId[from] = current;
    s.shown = int(to);
    const restore = from !== to && s.byId[to] ? s.byId[to] : null;
    return { store: s, restore };
}

/** Before Re-evaluate rewinds: the board as it is belongs to the swipe on screen. */
export function keepShown(store, shown, current) {
    const s = { ...store, byId: { ...store.byId } };
    const id = int(shown) ?? int(s.shown);
    if (id != null && current) s.byId[id] = current;
    s.shown = id;
    return s;
}

/**
 * A swipe was deleted (SillyTavern: { swipeId, newSwipeId }): its board goes, the later ones move down one, and the
 * swipe now on screen gets its board back. Returns { store, restore }.
 */
export function onSwipeDeleted(store, deleted, shownNow) {
    const byId = {};
    for (const [k, v] of Object.entries(store.byId || {})) {
        const n = Number(k);
        if (!Number.isInteger(n) || n === deleted) continue;
        byId[n > deleted ? n - 1 : n] = v;
    }
    const s = { ...store, byId, shown: int(shownNow) };
    return { store: s, restore: s.shown != null && byId[s.shown] ? byId[s.shown] : null };
}
