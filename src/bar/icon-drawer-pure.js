/**
 * The floating icon drawer (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/Kj4iETYq5q3pXYrTWEj2nq) — the rules,
 * no page. Tested in test/icon-drawer.test.mjs. Glue: icon-drawer.js.
 *
 * Other extensions' floating icons (today: CarrotKernel's 🥕 WorldBook Tracker) leave the chat and wait in one low tab
 * on top of DeepLore's bar, at its LEFT end (the right side is SillyTavern's swipe button). Tapping the tab opens them
 * in a row above the bar. Settings › Interface › The bar: Off (the start) · Phone only · Always, and a switch per icon.
 *
 * What counts as a floating icon: something fixed on the screen, icon-sized, that looks clickable, and isn't
 * SillyTavern's own or DeepLore's. It's never moved or rebuilt — only made invisible where it floated, and a tap or a
 * hold on its copy in the drawer is passed on to the original, so it keeps working the way its extension made it.
 */

export const MODES = ['off', 'phone', 'always'];

/** Is the drawer on right now? */
export const drawerActive = (mode, isPhone) => mode === 'always' || (mode === 'phone' && !!isPhone);

const MIN = 20, MAX = 100;

/**
 * Does this element look like a floating icon? info: { position, onBody, display, visibility, opacity, w, h, cursor,
 * role, tag, ours } — ours: inside SillyTavern's own UI or DeepLore's (the glue checks that). Fixed on the screen, or
 * pinned to the page itself (CarrotKernel's 🥕 sits at the page's bottom left until it's dragged: absolute, on <body>).
 */
export function looksFloating(i) {
    if (!i || i.ours) return false;
    if (i.position !== 'fixed' && !(i.position === 'absolute' && i.onBody)) return false;
    if (i.display === 'none' || i.visibility === 'hidden' || Number(i.opacity) === 0) return false;
    if (!(i.w >= MIN && i.w <= MAX && i.h >= MIN && i.h <= MAX)) return false;
    return /pointer|grab|move/.test(String(i.cursor || '')) || i.role === 'button' || i.tag === 'BUTTON';
}

/** A stable name for an icon, kept in the settings: its id, else its first class, else its title. */
export function iconKey({ id = '', cls = '', title = '' } = {}) {
    if (id) return '#' + id;
    const c = String(cls).trim().split(/\s+/).filter(x => x && !x.startsWith('dle-'))[0];
    if (c) return '.' + c;
    return title ? 't:' + String(title).split('\n')[0].trim().slice(0, 60) : '';
}

/** What the drawer calls it: the first line of its tooltip, else its label, else something from its id or class. */
export function iconName({ title = '', label = '', id = '', cls = '' } = {}) {
    const first = s => String(s || '').split('\n')[0].replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const t = first(title) || first(label);
    if (t) return t.slice(0, 40);
    const raw = id || String(cls).trim().split(/\s+/)[0] || '';
    const words = raw.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : 'Floating icon';
}

/**
 * The number an icon shows (CarrotKernel: data-ck-badge-count, drawn by its own CSS). attrs: [[name, value]];
 * texts: the text of its children that look like badges. 0 / nothing → ''.
 */
export function badgeOf(attrs = [], texts = []) {
    for (const [n, v] of attrs) if (/badge|count/i.test(n) && /^\d+$/.test(String(v).trim())) return String(v).trim() === '0' ? '' : String(v).trim();
    for (const t of texts) if (/^\d{1,4}\+?$/.test(String(t).trim()) && String(t).trim() !== '0') return String(t).trim();
    return '';
}

/** The tab's number: the sum of the docked icons' numbers ("99+" past that). */
export function tabBadge(badges = []) {
    const n = badges.map(b => parseInt(b, 10)).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    return n ? (n > 99 ? '99+' : String(n)) : '';
}

/** Which found icons go in the drawer: all of them, except the ones switched off. */
export const docked = (keys, off = []) => keys.filter(k => k && !off.includes(k));
