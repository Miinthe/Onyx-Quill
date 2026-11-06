/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero's 📬 mailbox, step 3: the requests in play (requests-pure.js has the rules).
 *
 * - An unsure move of the helper becomes a card that HOLDS THE REPLY: the helper runs before the writer, so the
 *   generation simply waits here until Miinthe answers (Miinthe, mock-up v9 — nothing expires). Accept / Deny / Re-check in N.
 * - Builder's notes from Miinthe's TunnelVision lesson: a card that holds a reply goes away when that reply is stopped,
 *   the chat changes or the page reloads (it is marked "Dropped" in Answered); a found item is read live from the
 *   board, so a delete or a swipe that takes it away takes its card too ("still true?").
 * - Answered cards stay, with their result, in the chat (chat_metadata.deeplore_requests, the last 50).
 */
import { chat_metadata, eventSource, event_types } from '../../../../../script.js';
import { saveMetadataDebounced, getContext } from '../../../../extensions.js';
import { REQ_KEY, asRequests, trimAnswered, resultText } from './requests-pure.js';
import { live } from './board-live.js';

const waiters = new Map();      // request id → resolve(answer) for a card that holds a reply
const listeners = new Set();
export function onRequestsChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function notify() { for (const cb of [...listeners]) { try { cb(); } catch (e) { console.warn('[Onyx Quill] requests listener:', e?.message); } } }

const store = () => asRequests(chat_metadata?.[REQ_KEY]);
function put(s) { chat_metadata[REQ_KEY] = trimAnswered(s); saveMetadataDebounced(); notify(); }

/** Something holds the reply right now (the amber dot, the wiggle, the ticker). */
export function replyWaits() { return store().list.some(r => r.now && !r.done && waiters.has(r.id)); }

/**
 * Ask, and wait: the cards hold the reply until each is answered — or the reply is stopped (`signal`), the chat
 * changes, the page reloads. Resolves to { [id]: { choice, n } } (choice 'dropped' when it went away unanswered).
 */
export function askAndWait(cards, signal = null) {
    if (!cards.length) return Promise.resolve({});
    return new Promise(resolve => {
        const answers = {};
        let left = cards.length, finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            for (const c of cards) waiters.delete(c.id);
            signal?.removeEventListener?.('abort', onAbort);
            notify();
            resolve(answers);
        };
        const onAbort = () => { markDropped(cards.map(c => c.id).filter(id => !answers[id])); for (const c of cards) answers[c.id] ||= { choice: 'dropped' }; finish(); };
        for (const c of cards) waiters.set(c.id, a => { answers[c.id] = a; if (--left === 0) finish(); });
        // stored (and announced) only now that they hold the reply — so the signals see "the reply waits" at once
        const s = store();
        s.list.push(...cards);
        put(s);
        if (signal?.aborted) onAbort(); else signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

function markDropped(ids) {
    const s = store();
    let any = false;
    for (const r of s.list) if (ids.includes(r.id) && !r.done) { r.done = resultText('dropped'); r.choice = 'dropped'; r.doneAt = new Date().toISOString(); any = true; }
    if (any) put(s);
}

/** The found items waiting on this chat's board, as cards (read live — gone with the message that found them). */
function findCards() {
    const L = live();
    if (!L) return [];
    const a = L.board.ask || {};
    if (a.found === false || a.level === 'rarely') return [];
    const out = [];
    for (const col of L.board.trackers) {
        if (col.kind !== 'collection') continue;
        for (const p of L.state.collections?.[col.id]?.pending || []) {
            out.push({ id: `find:${col.id}:${p.id}`, from: 'board', kind: 'find', title: `Keep ${p.name}?`, q: p.q || '', why: p.why || `found in the story · ${col.name}`, conf: p.conf || null, col: col.id, pend: p.id, made: { i: p.m } });
        }
    }
    return out;
}

/**
 * A card that waits without holding a reply (a date to add, …) — "still true?": gone once the message it came from
 * was deleted or swapped (a swipe / an edit: its text no longer starts the same).
 */
function stillTrue(r) {
    if (r.now || !Number.isFinite(r.made?.i)) return true;
    const m = getContext()?.chat?.[r.made.i];
    return !!m && (r.made.mes == null || String(m.mes ?? '').slice(0, 80) === r.made.mes);
}

/** Every request of this chat: waiting ones (unsure moves, dates, found items), and the answered ones. */
export function requestsHere() {
    const s = store();
    return { waiting: [...s.list.filter(r => !r.done && stillTrue(r)), ...findCards()], answered: s.list.filter(r => r.done).slice().reverse() };
}

/** Change a stored card in place (Mero's Undo on an answered entry change). Returns the card or null. */
export function updateRequest(id, fn) {
    const s = store();
    const r = s.list.find(x => x.id === id);
    if (!r) return null;
    fn(r);
    put(s);
    return r;
}

/** A card that waits for an answer without holding the reply (Miinthe, 2026-10-05: requests belong in the mailbox). */
export function addRequest(card) {
    const s = store();
    s.list.push(card);
    put(s);
}

const handlers = new Map();   // kind → (request, choice, n, extra) => ok — what an answer does (autotrack.js: dates; mero-lore.js: entries)
export function onAnswer(kind, fn) { handlers.set(kind, fn); }

/**
 * Miinthe's answer. A move: 'accept' | 'deny' | 'wait' (with `n` messages) — the reply goes on once every card it waits
 * for is answered. A found item: 'keep' | 'refuse' (board-grow.js, as from the Story tab). `extra`: what the card's
 * own handler needs (Mero's entry change: the text as Miinthe edited it). Returns true if answered, false if the
 * question is gone, or { ok: false, msg } when the handler says why not (the card stays).
 */
export async function answerRequest(id, choice, n = null, extra = null) {
    if (String(id).startsWith('find:')) {
        const [, col, pend] = String(id).split(':');
        const card = findCards().find(c => c.id === id);
        if (!card) return false;
        const G = await import('./board-grow.js');
        const ok = choice === 'keep' ? (await G.keepFoundWithNotice(col, pend)).ok : choice === 'refuse' ? G.refuseFound(col, pend) : false;
        if (!ok) return false;
        const s = store();
        s.list.push({ ...card, done: resultText(choice), choice, doneAt: new Date().toISOString() });
        put(s);
        return true;
    }
    const s = store();
    const r = s.list.find(x => x.id === id && !x.done);
    if (!r || !stillTrue(r)) return false;
    if (handlers.has(r.kind)) {
        const h = await handlers.get(r.kind)(r, choice, n, extra);
        if (h && typeof h === 'object' && h.ok === false) { put(s); return h; }   // the handler may have updated the card (re-shown)
        if (!h) return false;
    }
    r.done = resultText(choice, n);
    r.choice = choice;
    if (n) r.n = n;
    r.doneAt = new Date().toISOString();
    put(s);
    waiters.get(id)?.({ choice, n });
    return true;
}

/**
 * Wire once: a chat change (or a page that reloaded mid-question) leaves no card holding a reply that is gone —
 * the waiting generation of the old chat goes on without its answer (treated as Re-check later, see autotrack.js).
 */
export function initRequests() {
    const tidy = () => {
        for (const [id, w] of [...waiters]) { waiters.delete(id); w({ choice: 'dropped' }); }
        const s = store();
        const stale = s.list.filter(r => r.now && !r.done).map(r => r.id);
        if (stale.length) markDropped(stale); else notify();
    };
    try { eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(tidy, 0)); } catch { /* noop */ }
    setTimeout(tidy, 0);
}
