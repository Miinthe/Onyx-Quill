/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — notices, gathered (Miinthe: "holy fuck do I get a lot of notifications … put those
 * notifications as a side panel or something"). Pure rules; tested in test/notices.test.mjs. Glue: echo.js, changes-tab.js.
 *
 * Every echo (a notice that only tells what just happened) goes into the chat's "What changed" list, grouped by the
 * message it happened at, with its Undo while this page is open. In Director mode, instead of one popup per change, ONE
 * summary pops up per message ("🎭 Kettle turns up at Kitchen · 📍 Kitchen · +3 more") — or every change, if Miinthe picks
 * that. Immersion: no popups at all (as before); the list still keeps them. Warnings always pop up on their own.
 */

const arr = v => (Array.isArray(v) ? v : []);
/** How many changes the list keeps per chat. */
export const FEED_KEPT = 200;

/** Plain text of a notice's HTML (its first line — the change, without the quote, reason and "Undo"). */
export function firstLine(html) {
    const t = String(html ?? '').split(/<br\s*\/?>/i)[0];
    return t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** The summary's text for the changes of one message: the first two in full, then "+N more". */
export function summaryText(items) {
    const lines = arr(items).map(x => firstLine(x.html)).filter(Boolean);
    if (!lines.length) return '';
    const clip = s => (s.length > 70 ? s.slice(0, 68).replace(/\s\S*$/, '') + '…' : s);
    const shown = lines.slice(0, 2).map(clip);
    return `${shown.join(' · ')}${lines.length > 2 ? ` · +${lines.length - 2} more` : ''}`;
}

/** Add changes to a chat's list (newest last), kept to FEED_KEPT. */
export function addToFeed(feed, items) {
    return [...arr(feed), ...arr(items)].slice(-FEED_KEPT);
}

/** The list for showing: newest message first, its changes in the order they happened. */
export function groupFeed(feed) {
    const by = new Map();
    for (const x of arr(feed)) { const k = Number.isFinite(x.i) ? x.i : -1; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([i, items]) => ({ i, items }));
}
