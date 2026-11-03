/**
 * LOCAL PATCH (Miinthe, 2026-11-03) — the bar's EXTRA ROW: a second bar that opens on top of DeepLore's bar, in the bar's
 * own look ("for the FID it should be an extra bar, which we technically also could repeat for the QR drawer").
 * One at a time: the floating icons (icon-drawer.js) or all Quick Replies (bar.js). It is its own layer on <body>
 * (inside the message box's area it would sit under the chat), placed by measuring the bar; a tap elsewhere or Esc
 * closes it.
 */
let row = null, owner = null, onClosed = null, lift = 0, follow = null, lastAt = '';
const bar = () => document.getElementById('dle-bar');

/** Is this row (by id) the open one? */
export const extraRowOpen = id => !!row && owner === id;
/** The open row's element (to redraw its content), or null. */
export const extraRowEl = id => (extraRowOpen(id) ? row : null);

/**
 * Open (or refill) the row `id`. `fill(el)` puts the buttons in. `above`: room to leave between the bar and the row
 * (the floating icons' tab sits there). `onClose` runs when it closes for any reason.
 */
export function openExtraRow(id, fill, { above = 0, onClose = null } = {}) {
    if (owner && owner !== id) closeExtraRow();
    if (!row) {
        row = document.createElement('div');
        row.className = 'dk dle-xrow';
        row.setAttribute('role', 'toolbar');
        document.body.appendChild(row);
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', esc, true);
        addEventListener('resize', placeExtraRow);
        // the bar also moves without a window resize (the message box grows, a phone turns and the chat animates):
        // follow it while the row is open (bug hunt 2026-11-03: the row stayed put over the message box)
        follow = setInterval(() => { const b = bar(); if (!b) return; const r = b.getBoundingClientRect(), k = `${r.left}|${r.top}|${r.width}`; if (k !== lastAt) placeExtraRow(); }, 200);
    }
    bar()?.classList.add('dle-xrow-open');   // the floating icons' tab steps aside under ANY row — the ⚡ row covered it
    owner = id; onClosed = onClose; lift = above;
    row.dataset.row = id;
    fill(row);
    placeExtraRow();
}

/** Close the open row (only if it is `id`, when given). */
export function closeExtraRow(id = null) {
    if (!row || (id && owner !== id)) return;
    const cb = onClosed;
    row.remove(); row = null; owner = null; onClosed = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
    removeEventListener('resize', placeExtraRow);
    clearInterval(follow); follow = null; lastAt = '';
    bar()?.classList.remove('dle-xrow-open');
    try { cb?.(); } catch { /* noop */ }
}

/** On top of the bar, as wide as the bar (measured: on a phone the theme can make <body> the frame "fixed" uses). */
export function placeExtraRow() {
    const b = bar();
    if (!row || !b) { if (row && !b) closeExtraRow(); return; }
    const r = b.getBoundingClientRect();
    lastAt = `${r.left}|${r.top}|${r.width}`;
    row.style.left = '0px'; row.style.top = '0px'; row.style.width = `${Math.round(r.width)}px`;
    const o = row.getBoundingClientRect();
    row.style.left = `${Math.round(r.left - o.left)}px`;
    row.style.top = `${Math.round(r.top - lift - o.height - o.top)}px`;
}

function outside(e) {
    if (!row) return;
    if (row.contains(e.target)) return;
    // the button that opened it toggles it itself
    if (e.target.closest?.(`[data-xrow="${owner}"]`)) return;
    closeExtraRow();
}
function esc(e) { if (e.key === 'Escape' && row) { e.stopPropagation(); closeExtraRow(); } }
