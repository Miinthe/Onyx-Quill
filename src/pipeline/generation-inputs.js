/**
 * Onyx Quill — the inputs a real reply's lore pick uses, for the previews (/oq-why, /oq-simulate).
 *
 * LOCAL PATCH (Miinthe, 2026-11-05): /oq-why previewed without the board's narrowing (steps, branches, items), the board's
 * pins and the per-chat budget, and /oq-simulate replayed over the whole vault (Secrets for Mero and other stories'
 * folders included). This reads the same inputs index.js onGenerate builds — KEEP IN STEP: index.js keeps its own copy
 * (search "KEEP IN STEP" there), so a change to how a reply builds its inputs needs the same change here.
 * Read-only: it never runs the board's turn (boardTick / syncLiveLocation), so a preview changes nothing.
 * Every piece is optional and falls back the way onGenerate does (a failing piece is skipped, not fatal).
 */
import { chat_metadata } from '../../../../../../script.js';
import { getWriterVisibleEntries } from '../state.js';
import { normalizePinBlock, matchesNormalizedPinBlock } from '../helpers.js';

/**
 * @param {{ board?: boolean }} [opts] board: false leaves out the board's narrowing and pins (/oq-simulate: past board
 *   states can't be known, so today's would be wrong for earlier messages).
 * @returns {Promise<{ snapshot: Array, pins: Array, blocks: Array, folderFilter: string[]|null, budget: object, ctx: object, on: boolean, why: string }>}
 */
export async function generationInputs({ board = true } = {}) {
    let on = true, why = '';
    let folderFilter = chat_metadata?.deeplore_folder_filter || null;
    try {
        const ch = await import('../characters.js');
        const st = ch.chatStatus();
        on = st.on !== false; why = st.why || '';
        folderFilter = ch.effectiveFolderFilter();
    } catch { /* no character: the chat's own folders */ }

    let budget = {};
    try { budget = (await import('../budget.js')).budgetOverlay(); } catch { /* Everywhere's budget */ }

    let snapshot = getWriterVisibleEntries();   // no Secrets for Mero (guide entries)
    let boardPins = [];
    if (board) {
        try {
            const bl = await import('../board-live.js');
            try { boardPins = bl.liveBoardPins(); } catch { /* no board */ }
            const tr = await import('../trackers.js');
            const { filterByStoryStep } = await import('../trackers-pure.js');
            const { filterByBranch } = await import('../forks-pure.js');
            const p = [...(chat_metadata?.deeplore_pins || []), ...boardPins].map(normalizePinBlock);
            const isPinned = e => p.some(pb => matchesNormalizedPinBlock(pb, e));
            const all = tr.readTrackers();
            const active = new Set(tr.readActiveTrackers().filter(t => !t.ended).map(t => t.name));
            snapshot = filterByStoryStep(snapshot, all, isPinned, t => active.has(t.name));
            snapshot = filterByBranch(snapshot, all, isPinned, t => active.has(t.name));
            snapshot = bl.filterLiveEntries(snapshot, isPinned);
        } catch (err) { console.warn('[Onyx Quill] preview: board narrowing skipped:', err?.message || err); }
    }

    return {
        snapshot,
        pins: [...(chat_metadata?.deeplore_pins || []), ...boardPins],
        blocks: chat_metadata?.deeplore_blocks || [],
        folderFilter: Array.isArray(folderFilter) && folderFilter.length ? folderFilter : null,
        budget: budget || {},
        ctx: chat_metadata?.deeplore_context || {},
        on,
        why,
    };
}
