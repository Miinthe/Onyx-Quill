/**
 * LOCAL PATCH (Miinthe, 2026-11-04) — each swipe keeps its own board: SillyTavern glue. Rules: swipe-board-pure.js (tested).
 *
 * What a swipe's board is: the chat's board data — the v2 state (positions, items, places, the clock, the Cast, the
 * log "What this changed" reads) and the trackers list. Flipping to a swipe puts its board back; no AI call, no board
 * turn runs. Re-evaluate (reevaluate.js) stores the board of the swipe on screen first, then evaluates fresh.
 */
import { chat_metadata, eventSource, event_types } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { STATE_KEY } from './board-live.js';
import { TRACKERS_KEY } from './trackers-pure.js';
import { notifyTrackersView } from './trackers.js';
import { SWIPE_BOARD_KEY, storeFor, onSwipe, keepShown, onSwipeDeleted } from './swipe-board-pure.js';

const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
/** The board as it is now. */
const snap = () => ({ s: clone(chat_metadata?.[STATE_KEY]), t: clone(chat_metadata?.[TRACKERS_KEY]) });
/** Put a swipe's board back. */
function put(b) {
    if (!b) return;
    if (b.s == null) delete chat_metadata[STATE_KEY]; else chat_metadata[STATE_KEY] = clone(b.s);
    if (b.t == null) delete chat_metadata[TRACKERS_KEY]; else chat_metadata[TRACKERS_KEY] = clone(b.t);
}

/** The newest reply, when the chat ends on one: { at, msg }. */
function newest() {
    const chat = getContext()?.chat || [];
    const at = chat.length - 1, msg = chat[at];
    return msg && !msg.is_user && !msg.is_system ? { at, msg } : null;
}
const swipeIdOf = msg => (Number.isInteger(msg?.swipe_id) ? msg.swipe_id : 0);

// which swipe is on screen — known before SillyTavern switches (its event comes after the switch)
let seen = { at: -1, id: null };
function noteSeen() { const n = newest(); seen = n ? { at: n.at, id: swipeIdOf(n.msg) } : { at: -1, id: null }; }

let skipSave = false;   // Re-evaluate stored the board already; the board now holds the fresh evaluation

function save(store) {
    chat_metadata[SWIPE_BOARD_KEY] = store;
    try { saveMetadataDebounced(); } catch { /* noop */ }
}

function swiped(mesId) {
    const n = newest();
    if (!n || Number(mesId) !== n.at) { noteSeen(); return; }
    const to = swipeIdOf(n.msg);
    // a chat without a board: nothing to keep (no entry written into every chat she swipes in — bug hunt 2026-11-05)
    if (chat_metadata?.[STATE_KEY] == null && chat_metadata?.[TRACKERS_KEY] == null && !chat_metadata?.[SWIPE_BOARD_KEY]) { skipSave = false; seen = { at: n.at, id: to }; return; }
    const store = storeFor(chat_metadata?.[SWIPE_BOARD_KEY], n.at, seen.at === n.at ? seen.id : null);
    const r = onSwipe(store, to, snap(), { skipSave });
    skipSave = false;
    seen = { at: n.at, id: to };
    if (!Object.keys(r.store.byId).length && !r.restore) return;   // nothing kept yet, nothing to change
    if (r.restore) put(r.restore);
    save(r.store);
    if (r.restore) { try { notifyTrackersView(); } catch { /* noop */ } }
}

function swipeDeleted(info) {
    const n = newest();
    if (!n || Number(info?.messageId) !== n.at) { noteSeen(); return; }
    const raw = chat_metadata?.[SWIPE_BOARD_KEY];
    if (!raw || raw.at !== n.at) { noteSeen(); return; }
    const r = onSwipeDeleted(storeFor(raw, n.at), Number(info.swipeId), swipeIdOf(n.msg));
    if (r.restore) put(r.restore);
    save(r.store);
    seen = { at: n.at, id: swipeIdOf(n.msg) };
    if (r.restore) { try { notifyTrackersView(); } catch { /* noop */ } }
}

/** Re-evaluate, before it rewinds: the board as it is belongs to the swipe on screen; its own swipe starts fresh. */
export function keepBoardForReevaluate() {
    const n = newest();
    if (!n) return;
    save(keepShown(storeFor(chat_metadata?.[SWIPE_BOARD_KEY], n.at, swipeIdOf(n.msg)), swipeIdOf(n.msg), snap()));
    seen = { at: n.at, id: swipeIdOf(n.msg) };
    skipSave = true;
}

let wired = false;
export function initSwipeBoard() {
    if (wired) return;
    wired = true;
    eventSource.on(event_types.MESSAGE_SWIPED, swiped);
    if (event_types.MESSAGE_SWIPE_DELETED) eventSource.on(event_types.MESSAGE_SWIPE_DELETED, swipeDeleted);
    for (const ev of [event_types.CHAT_CHANGED, event_types.MESSAGE_RECEIVED, event_types.MESSAGE_SENT, event_types.MESSAGE_DELETED]) if (ev) eventSource.on(ev, () => { skipSave = false; noteSeen(); });
    noteSeen();
}

/** Re-evaluate stopped before its swipe: the board of the swipe on screen comes back as it was. */
export function undoReevaluateKeep() {
    skipSave = false;
    const n = newest(), raw = chat_metadata?.[SWIPE_BOARD_KEY];
    const b = n && raw && raw.at === n.at ? raw.byId?.[swipeIdOf(n.msg)] : null;
    if (b) { put(b); try { saveMetadataDebounced(); notifyTrackersView(); } catch { /* noop */ } }
}
