/**
 * Guided swipe (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/ByQff64nfdyDB4acfqYm7N, view 3) — the rules, no
 * page. Tested in test/guided-swipe.test.mjs. Glue: guided-swipe.js.
 *
 * On the newest reply, DeepLore's 📖 → Guided swipe… → she types what should change ("colder, fewer words") → a new
 * swipe is written with that direction among the author's notes (a 🧭 for this reply only; no extra AI call).
 * The direction STAYS for every swipe of that reply ("you press it and then you can type corrections"), shown as a chip
 * above the message box (✎ edit · Keep · ✕). It clears itself once she sends her next message — or Keep turns it into
 * one of Mero's 🧭 notes, which stay until switched off. Each swipe written with a direction remembers it, for
 * Compare swipes.
 *
 * Stored in chat_metadata.deeplore_guide: { text, i (the reply's message index), tags: { [swipe index]: text } }.
 */

export const GUIDE_KEY = 'deeplore_guide';
const str = v => (typeof v === 'string' ? v : '');

export function asGuide(raw) {
    const g = raw && typeof raw === 'object' ? raw : {};
    const tags = {};
    for (const [k, v] of Object.entries(g.tags && typeof g.tags === 'object' ? g.tags : {})) if (/^\d+$/.test(k) && str(v).trim()) tags[k] = str(v).trim().slice(0, 400);
    return { text: str(g.text).trim().slice(0, 400), i: Number.isInteger(g.i) ? g.i : -1, tags };
}

/** Is the direction in play for the reply at `last` (the chat's newest message index)? */
export const guideActive = (g, last) => !!g.text && g.i === last;

/** The writer's line while a swipe (or a regenerate) of that reply is written. → [{ kind: 'steer', text }] */
export function guideLines(g, type, last) {
    if (!guideActive(g, last) || !['swipe', 'regenerate'].includes(type)) return [];
    return [{ kind: 'steer', text: `For this reply only, change this: ${g.text}` }];
}

/** A new direction for the reply at `i`; swipes already tagged on that reply keep their tags. */
export const setGuide = (g, text, i) => ({ text: str(text).trim().slice(0, 400), i, tags: g.i === i ? { ...g.tags } : {} });

/** A swipe of that reply was written with the direction: remember it. */
export const tagSwipe = (g, i, swipeId) => (guideActive(g, i) && Number.isInteger(swipeId) ? { ...g, tags: { ...g.tags, [swipeId]: g.text } } : g);

/** She sent her next message (or dropped it): the direction is done; the tags stay with their swipes. */
export const clearGuide = g => ({ ...g, text: '' });

/** The swipes of a message, for Compare: [{ k, text, showing, tag }]. */
export function swipesOf(msg, g, i) {
    const list = Array.isArray(msg?.swipes) && msg.swipes.length ? msg.swipes : [str(msg?.mes)];
    const cur = Number.isInteger(msg?.swipe_id) ? msg.swipe_id : 0;
    return list.map((t, k) => ({ k, text: str(t), showing: k === cur, tag: g.i === i ? str(g.tags[k]) : '' }));
}
