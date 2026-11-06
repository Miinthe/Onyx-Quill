/**
 * Where a floating box (a ⋯ menu, a picker) goes next to what opened it — inside the part of the page you can SEE.
 * On a phone with the keyboard open the visible part is smaller and shifted (window.visualViewport): placing against
 * the whole page sent a tall menu to the very top, out of sight (Miinthe's bug report, 2026-11-06).
 *
 * @param {{left:number, right:number, top:number, bottom:number}} r  the anchor's rectangle
 * @param {number} bw, bh  the box's width and height
 * @param {{x:number, y:number, w:number, h:number}} view  the visible part (page coordinates of position: fixed)
 * @returns {{left:number, top:number, maxHeight:number|null}}  maxHeight when it fits neither below nor above (it scrolls)
 */
export function placeBox(r, bw, bh, view, m = 8) {
    const minX = view.x + m, maxX = view.x + view.w - m, minY = view.y + m, maxY = view.y + view.h - m;
    const flushRight = r.right - bw > minX && r.left + bw > maxX;
    const left = Math.max(minX, Math.min(maxX - bw, flushRight ? r.right - bw : r.left));
    const below = Math.max(minY, r.bottom + 4), above = Math.min(maxY, r.top - 4);
    if (below + bh <= maxY) return { left, top: below, maxHeight: null };
    if (above - bh >= minY) return { left, top: above - bh, maxHeight: null };
    // fits neither way: the side with more room, and the box scrolls
    const roomBelow = maxY - below, roomAbove = above - minY;
    return roomAbove > roomBelow
        ? { left, top: minY, maxHeight: Math.max(80, roomAbove) }
        : { left, top: below, maxHeight: Math.max(80, roomBelow) };
}
