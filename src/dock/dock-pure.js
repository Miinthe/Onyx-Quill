/**
 * Panel tabs (Miinthe, 2026-11-03; mock-up https://claude.ai/artifact/2rcyY7N1UDEvsMcWG1KLEK v6 — "okay I love it").
 * Pure: which panels sit on which side, in what order, and which one shows. Tested in test/dock.test.mjs.
 *
 * Three panels — DeepLore's side panel ('dl'), My notes ('notes'), World ('world') — each on the left or the right
 * (remembered per panel). The panels open on one side are tabs in a strip at the bottom of that side: one shows, the
 * others wait behind it. PC only: a phone keeps one panel at a time over the chat, as before.
 */

export const PANELS = ['dl', 'notes', 'world'];
export const NAMES = { dl: 'Onyx Quill', notes: 'My notes', world: 'World' };
export const ICONS = { dl: 'panel', notes: 'notebook', world: 'globe' };
export const COLORS = { dl: 'var(--dk-accent)', notes: 'var(--dk-wait)', world: 'var(--dk-good)' };

export const otherSide = s => (s === 'left' ? 'right' : 'left');
export const normSide = s => (s === 'left' ? 'left' : 'right');

/**
 * Each panel's side from the settings. DeepLore: `drawerSide` (default right). My notes: `notesSide` (default right,
 * as before). World: `worldSide`, and until she moves it, the side opposite DeepLore's (as before).
 */
export function sidesFrom(s = {}) {
    const dl = normSide(s.drawerSide);
    return { dl, notes: normSide(s.notesSide), world: s.worldSide === 'left' || s.worldSide === 'right' ? s.worldSide : otherSide(dl) };
}

/**
 * The tabs on each side: the open panels, in the order they were opened (`opened`: ids, oldest first; one not in it
 * goes last). → { left: [id], right: [id] }
 */
export function tabsBySide(open = {}, sides = {}, opened = []) {
    const rank = id => { const k = opened.indexOf(id); return k < 0 ? Infinity : k; };
    const out = { left: [], right: [] };
    for (const id of PANELS) if (open[id]) out[normSide(sides[id])].push(id);
    for (const k of ['left', 'right']) out[k].sort((a, b) => rank(a) - rank(b) || PANELS.indexOf(a) - PANELS.indexOf(b));
    return out;
}

/**
 * Which tab shows on a side: one just opened there wins; else the one that showed before, if still there; else the
 * newest (the last). `fresh`: the ids that opened since last time.
 */
export function shownTab(list = [], before = null, fresh = []) {
    const nu = list.filter(id => fresh.includes(id));
    if (nu.length) return nu[nu.length - 1];
    if (before && list.includes(before)) return before;
    return list.length ? list[list.length - 1] : null;
}

/** The open order after a change: closed panels leave, newly opened ones join at the end. */
export function nextOpened(opened = [], open = {}) {
    const keep = opened.filter(id => open[id]);
    for (const id of PANELS) if (open[id] && !keep.includes(id)) keep.push(id);
    return keep;
}

/** Where a dragged tab lands: the side whose half of the window the pointer is in. */
export const dropSide = (x, width) => (x < width / 2 ? 'left' : 'right');
