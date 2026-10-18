/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — which message a change belongs to.
 * Normally the newest message. Re-evaluate (reevaluate.js) runs the helper and the board again for
 * the newest reply's turn, and their changes must be recorded where they were the first time — at
 * the message before the reply — not at the reply itself (deleting the reply would then undo them).
 */
let override = null;
export function setTurnIndex(i) { override = Number.isFinite(i) ? Math.floor(i) : null; }
export function turnIndex(chat) {
    if (override != null) return override;
    return Array.isArray(chat) && chat.length ? chat.length - 1 : 0;
}
