/**
 * Onyx Quill — /oq-simulate's replay, pure (no ST imports; tests: test/simulate.test.mjs).
 *
 * LOCAL PATCH (Miinthe, 2026-11-05): the replay used the whole vault — Secrets for Mero (guide entries) and other stories'
 * folders included — and no pins, field values or budget, so it showed lore a real reply never gets. Now it starts from
 * the entries a real reply starts from (the caller passes the writer-visible snapshot) and applies, as they are now:
 * the chat's folders, pins / blocks, field gating, requires / excludes and the budget. It can't replay the board's past
 * states, AI search, cooldown, warmup or probability — the window says so.
 */
import { buildExemptionPolicy, applyFolderFilter, applyPinBlock, applyContextualGating, applyRequiresExcludesGating } from '../stages.js';
import { testEntryMatch, formatAndGroup } from '../../core/matching.js';
import { buildScanText } from '../../core/utils.js';
import { comparePriority } from '../helpers.js';

/**
 * @param {Array} chatMsgs
 * @param {{ snapshot: Array, pins?: Array, blocks?: Array, folderFilter?: string[]|null, budget?: object, ctx?: object,
 *   settings: object, fieldDefs: Array, promptTagPrefix?: string }} inp
 * @returns {Array<{ messageIndex: number, speaker: string, active: string[], newlyActivated: string[], deactivated: string[] }>}
 */
export function simulateTimeline(chatMsgs, inp) {
    const settings = inp.settings;
    const snapshot = (inp.snapshot || []).filter(e => e && !e.guide);
    const pins = inp.pins || [], blocks = inp.blocks || [];
    const policyStart = buildExemptionPolicy(snapshot, pins, blocks, true);
    const policyLater = buildExemptionPolicy(snapshot, pins, blocks, false);
    const entries = applyFolderFilter(snapshot, inp.folderFilter || null, policyLater, false);
    const ctx = inp.ctx && typeof inp.ctx === 'object' ? inp.ctx : {};
    const hasCtx = Object.keys(ctx).length > 0;
    const budgetSettings = { ...settings, ...(inp.budget || {}) };
    const key = e => `${e.vaultSource || ''}:${e.title}`;

    const timeline = [];
    let previousActive = new Set();
    for (let i = 1; i <= chatMsgs.length; i++) {
        const slicedChat = chatMsgs.slice(0, i);
        const scanText = buildScanText(slicedChat, settings.scanDepth);
        const starting = i <= settings.newChatThreshold;
        const policy = starting ? policyStart : policyLater;
        const picked = new Map();
        for (const entry of entries) {
            if (entry.constant || (starting && entry.bootstrap)) { picked.set(key(entry), entry); continue; }
            if (settings.scanDepth > 0) {
                const entryText = entry.scanDepth !== null && entry.scanDepth !== undefined ? buildScanText(slicedChat, entry.scanDepth) : scanText;
                if (testEntryMatch(entry, entryText, settings)) picked.set(key(entry), entry);
            }
        }
        let list = applyPinBlock([...picked.values()], snapshot, policy, new Map());
        if (hasCtx) list = applyContextualGating(list, ctx, policy, false, settings, inp.fieldDefs || []);
        list = applyRequiresExcludesGating(list, policy, false, settings.priorityReversed).result;
        list.sort((a, b) => comparePriority(a, b, settings.priorityReversed) || a.title.localeCompare(b.title));
        const { count, acceptedEntries } = formatAndGroup(list, budgetSettings, inp.promptTagPrefix || 'deeplore_');
        const kept = acceptedEntries || list.slice(0, count);
        const currentActive = new Set(kept.map(e => e.title));

        const msg = chatMsgs[i - 1];
        timeline.push({
            messageIndex: i - 1,
            speaker: msg.is_user ? 'User' : (msg.name || 'AI'),
            active: [...currentActive],
            newlyActivated: [...currentActive].filter(t => !previousActive.has(t)),
            deactivated: [...previousActive].filter(t => !currentActive.has(t)),
        });
        previousActive = currentActive;
    }
    return timeline;
}
