/**
 * Lore gaps — the chat's saved list of "something the story needed that no entry had" (or "this entry needs an
 * update"). Mero ☆ shows them in her Requests (src/mero-window.js), and the board's "Write a new entry…" marks one
 * written (src/board-window.js).
 *
 * Moved here unchanged from the retired Librarian (2026-10-19, Miinthe's decision: the Librarian is gone, Mero replaced
 * it). The Librarian's reply takeover was what flagged new gaps; the ones already saved in a chat stay and keep
 * working. Stored in the chat's metadata: `deeplore_lore_gaps` (the list), `deeplore_lore_gaps_hidden` (hidden until
 * flagged again) and `deeplore_lore_gaps_dismissed` (gone for good).
 */
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { loreGaps, setLoreGaps } from './state.js';

/**
 * @returns {boolean} true if persisted, false if chatMetadata unavailable
 */
export function persistGaps(updatedGaps) {
    // BUG-304: check metadata BEFORE mutating in-memory state. Cold start /
    // between-chat states would otherwise commit setLoreGaps but never persist,
    // and the visible gap silently disappears on reload.
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta) return false;
    // BUG-AUDIT-C03: cap unbounded growth in long chats. Evict oldest by createdAt.
    // M-7: keep CHRONOLOGICAL order (oldest→newest); ascending sort + slice(-MAX) keeps the newest MAX in order.
    const MAX_GAPS = 200;
    let capped = updatedGaps;
    if (capped.length > MAX_GAPS) {
        capped = [...capped].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-MAX_GAPS);
    }
    setLoreGaps(capped);
    meta.deeplore_lore_gaps = capped;
    // BUG-AUDIT-H09: prune orphaned ids from hidden/dismissed arrays — they
    // would otherwise accumulate forever as gaps are evicted/dismissed.
    const activeIds = new Set(capped.map(g => g.id));
    const hidden = meta.deeplore_lore_gaps_hidden;
    if (Array.isArray(hidden) && hidden.length > 0) {
        const pruned = hidden.filter(id => activeIds.has(id));
        if (pruned.length !== hidden.length) meta.deeplore_lore_gaps_hidden = pruned;
    }
    const dismissed = meta.deeplore_lore_gaps_dismissed;
    if (Array.isArray(dismissed) && dismissed.length > 0) {
        const pruned = dismissed.filter(id => activeIds.has(id));
        if (pruned.length !== dismissed.length) meta.deeplore_lore_gaps_dismissed = pruned;
    }
    saveMetadataDebounced();
    return true;
}

// ── Soft-remove sibling-array helpers (mirrors deeplore_pins/blocks pattern) ──

function readGapIdArray(key) {
    const meta = getContext()?.chatMetadata;
    const raw = meta?.[key];
    return Array.isArray(raw) ? raw : [];
}

function writeGapIdArray(key, ids) {
    const meta = getContext()?.chatMetadata;
    if (!meta) return;
    meta[key] = ids;
    saveMetadataDebounced();
}

export function getHiddenGapIds() {
    return new Set(readGapIdArray('deeplore_lore_gaps_hidden'));
}

export function getDismissedGapIds() {
    return new Set(readGapIdArray('deeplore_lore_gaps_dismissed'));
}

/** First-tier: re-flag would resurface it. */
export function hideGap(id) {
    const arr = readGapIdArray('deeplore_lore_gaps_hidden');
    if (!arr.includes(id)) writeGapIdArray('deeplore_lore_gaps_hidden', [...arr, id]);
    setLoreGaps([...loreGaps]); // trigger render
}

/** Second-tier: gone for good. */
export function dismissGap(id) {
    const arr = readGapIdArray('deeplore_lore_gaps_dismissed');
    if (!arr.includes(id)) writeGapIdArray('deeplore_lore_gaps_dismissed', [...arr, id]);
    const hidden = readGapIdArray('deeplore_lore_gaps_hidden');
    if (hidden.includes(id)) writeGapIdArray('deeplore_lore_gaps_hidden', hidden.filter(x => x !== id));
    setLoreGaps([...loreGaps]);
}
