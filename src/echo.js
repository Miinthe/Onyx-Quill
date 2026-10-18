/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Immersion = no echoes, nothing else: "immersion is just meant to shut up echo
 * everything. requests are different. the echoes are not to be turned off for warnings."
 * An echo is a notice that only tells what just happened (a move, a start, a roll, a trigger, an item / place / clock /
 * date change, "kept", a roll back). In Immersion it stays quiet (the timeline still has it, with Undo).
 * Requests (📬) still ask; warnings and the answers to Miinthe's own clicks always show.
 *
 * LOCAL PATCH (Miinthe, 2026-10-13) — gathered (notices-pure.js): every echo goes into the chat's "What changed" list
 * (changes-tab.js), and in Director mode ONE summary pops up per message instead of one notice per change (or every one,
 * with noticeStyle 'each'). Immersion: no popup, the list still keeps it.
 */
import { getContext } from '../../../../extensions.js';
import { escapeHtml } from '../../../../utils.js';
import { getSettings } from '../settings.js';
import { live } from './board-live.js';
import { turnIndex } from './turn-index.js';
import { addToFeed, summaryText } from './notices-pure.js';

export const immersed = () => { try { return live()?.board?.mode === 'immersion'; } catch { return false; } };

// the list lives for the page's life, per chat (the Undo of a notice is a function — it can't outlive the page)
const feeds = new Map();
const listeners = new Set();
let pending = [], timer = null;
const chatKey = () => getContext()?.getCurrentChatId?.() || '';
export const feedOf = () => feeds.get(chatKey()) || [];
export function onFeedChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function clearFeed() { feeds.delete(chatKey()); listeners.forEach(cb => { try { cb(); } catch { /* noop */ } }); }

/**
 * Run `show`, catching the notices it would pop up instead of showing them: [{ html, title, onclick }] — or null when
 * toastr can't be caught (no toastr, or one that won't take a stand-in): then nothing was run.
 */
function capture(show) {
    const got = [];
    const t = globalThis.toastr;
    if (!t) return null;
    const orig = t.info;
    const stand = (html, title, opts) => { got.push({ html: String(html ?? ''), title: String(title ?? ''), onclick: typeof opts?.onclick === 'function' ? opts.onclick : null }); return null; };
    try { t.info = stand; } catch { /* a frozen or proxied toastr */ }
    if (t.info !== stand) return null;
    try { show(); } catch { /* noop */ } finally { t.info = orig; }
    return got;
}

/** Show an echo — into the list always; as a popup per the notice style, and never in Immersion. */
export function echo(show) {
    const items = capture(show);
    if (items === null) { if (!immersed()) { try { show(); } catch { /* noop */ } } return; }   // couldn't catch it: the old way
    if (!items.length) return;
    const i = turnIndex(getContext()?.chat);
    const stamped = items.map(x => ({ ...x, i, at: Date.now() }));
    const k = chatKey();
    feeds.set(k, addToFeed(feeds.get(k), stamped));
    listeners.forEach(cb => { try { cb(); } catch { /* noop */ } });
    if (immersed()) return;
    if ((getSettings()?.noticeStyle || 'summary') === 'each') {
        for (const x of stamped) { try { globalThis.toastr?.info(x.html, x.title, { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, ...(x.onclick ? { onclick: x.onclick } : {}) }); } catch { /* noop */ } }
        return;
    }
    // one summary for everything this message brought (they arrive over a few seconds: the helper, the director, the turn)
    pending.push(...stamped);
    clearTimeout(timer);
    timer = setTimeout(() => {
        const list = pending; pending = [];
        if (!list.length) return;
        const one = list.length === 1 ? list[0] : null;
        try {
            if (one) globalThis.toastr?.info(one.html, one.title, { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, ...(one.onclick ? { onclick: one.onclick } : {}) });
            else globalThis.toastr?.info(`${escapeHtml(summaryText(list))}<br><u>See what changed</u>`, `${list.length} changes`, { escapeHtml: false, timeOut: 10000, extendedTimeOut: 6000, onclick: () => window.__dleOpenChanges?.() });
        } catch { /* noop */ }
    }, 1500);
}
