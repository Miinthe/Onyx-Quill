import { chat_metadata, getCurrentChatId } from '../../../../../../script.js';
import { escapeHtml } from '../../../../../utils.js';
import { getSettings } from '../../settings.js';
import { tr, trf, trPlural } from '../i18n/i18n.js';
import {
    vaultIndex, indexTimestamp,
    generationLock, indexing,
    cooldownTracker, decayTracker, chatInjectionCounts, chatInjectionCountsVersion, trackerKey,
    fieldDefinitions,
} from '../state.js';
import { getCurrentForChat as getCurrentVerdictForChat, getPrevious as getPreviousVerdict } from '../verdict/verdict-store.js';

// Local helper — UI consumers must read the CURRENT CHAT's verdict, not the
// ring-global newest. See docs/gotchas.md #46 ("UI consumer rule").
function _currentVerdictForChat() {
    let cid = null;
    try { cid = getCurrentChatId() ?? null; } catch { cid = null; }
    return getCurrentVerdictForChat(cid);
}
import { diffVerdicts } from '../verdict/verdict-pure.js';
import { DEFAULT_FIELD_DEFINITIONS } from '../fields.js';
import { splitGatingFields } from './gating-visibility-pure.js';   // LOCAL PATCH (Miinthe): hide unused fields
import { getTrackers } from '../trackers.js';
import { pendingFork } from '../forks-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): forks
import { live, boardOffHere } from '../board-live.js';   // LOCAL PATCH (Miinthe, 2026-10-05): collections; 2026-10-04: board off here
import { collectionsOf } from '../collections-pure.js';
import { placeTrackersOf, placeLabel } from '../places-pure.js';
import { stateTrackersOf, nowLine, datesOf, dueText } from '../state-pure.js';
import { itemState, itemAmount, purseValue, runOf, hereOf, stateNow } from '../board-model-pure.js';
import { stateOf, conditionText, hasStarts } from '../conditions-pure.js';   // LOCAL PATCH (Miinthe): storyboard conditions   // LOCAL PATCH (Miinthe): story trackers
import { autoTrackEnabled } from '../autotrack.js';
import { renderCharacterCard } from '../characters.js';   // LOCAL PATCH (Miinthe, 2026-10-04): characters own their folders
import { buildObsidianURI, categorizeRejections, resolveEntryVault, normalizePinBlock, comparePriority, parseMatchReason } from '../helpers.js';
import {
    ds, BROWSE_ROW_HEIGHT, BROWSE_OVERSCAN,
    getMatchLabel, computeEntryTemperatures, isDrawerVisible,
} from './drawer-state.js';
import { buildBrowseRowModel, topFolderOf, resolveNavTarget, listTopFolders } from './drawer-browse-pure.js';

let _cachedRejectionMap = new Map();
let _cachedRejectionTrace = null;
let _cachedExpandedPreviewHtml = null;
// BUG-360: trackerKey (vaultSource:title) — bare titles would collide across vaults.
let _cachedExpandedPreviewKey = null;
let _cachedFieldValues = null;
let _cachedFieldValuesIndexLen = -1;
// Hash of last renderInjectionTab inputs — skip render when unchanged.
let _lastInjectionRenderHash = null;
// Wave F: hash of last renderBrowseTab inputs — skip the full vault filter+sort+rowmodel
// rebuild when unchanged. Completeness rests on chatInjectionCountsVersion (covers ×N
// badges / temperature tints / count-dependent sorts) + the verdict signature + indexTimestamp.
let _lastBrowseRenderHash = null;
// #17: live container identity folded into both hash guards (mirrors _footerCache in
// drawer-render-footer.js). These module-level hashes survive destroyDrawerPanel();
// after a destroy+reinit the hash still matches but the drawer DOM is brand-new and
// empty — the early return would leave the tab permanently blank. Comparing the
// drawer root element identity makes the guard self-healing (destroy/recreate, HMR).
let _lastInjectionRenderRoot = null;
let _lastBrowseRenderRoot = null;

// Wave C: render-site pipeline-stage ranking for the "Filtered Out" groups. The shared
// categorizeRejections() contract is consumed by the cartographer + browse popups too, so we
// MUST NOT reorder it there — we sort a COPY here only. Lower rank = earlier in the pipeline.
// Order mirrors docs/generation-pipeline.md: match → AI-select → contextual gating → cooldown →
// requires/excludes(gated_out) → strip-dedup → budget → probability → warmup. (refine_key_blocked
// is a match-stage refinement, so it sits right after AI-select.) Unknown stages sort last.
const _WHY_STAGE_RANK = {
    ai_rejected: 0,
    refine_key_blocked: 1,
    contextual_gating: 2,
    cooldown: 3,
    gated_out: 4,
    strip_dedup: 5,
    budget_cut: 6,
    probability_skipped: 7,
    warmup_failed: 8,
};
function _whyStageRank(stage) {
    return Object.prototype.hasOwnProperty.call(_WHY_STAGE_RANK, stage) ? _WHY_STAGE_RANK[stage] : 99;
}

// Wave C: stage-aware Fix-It pin button copy. Each rejection stage gets a label that names the
// override the pin performs (i18n keys — values live in locales/dle.*.json). Falls back to the
// plain "Pin" key for stages without a tailored verb (strip_dedup / probability / warmup / other).
function _fixItPinLabel(stage) {
    switch (stage) {
        case 'cooldown': return tr('dle_fixit_pin_bypass');           // skip the cooldown
        case 'gated_out': return tr('dle_fixit_pin_override');         // requires/excludes
        case 'contextual_gating': return tr('dle_fixit_pin_override_gate');
        case 'budget_cut': return tr('dle_fixit_pin_force');
        case 'ai_rejected': return tr('dle_fixit_pin_ai_keep');
        default: return tr('dle_fixit_pin');                           // strip_dedup / probability / warmup / refine
    }
}

// Button-first call-to-action for the pre-setup empty states (Injection / Browse). Mirrors the
// static markup in drawer.html so the JS-rebuilt and static variants stay identical. data-empty-action
// is dispatched in drawer-events.js (executes the same /oq-setup, /oq-import as the Tools tab).
// Slash-command hint kept as small muted text below for power users (f082).
function emptyCtaHtml() {
    return '<div class="dle-empty-cta-row">'
        + `<button type="button" class="menu_button dle-empty-cta-btn" data-empty-action="setup" title="${escapeHtml(tr('dle_drawer_tool_setup_wizard_tooltip'))}">`
        + `<i class="fa-solid fa-hat-wizard" aria-hidden="true"></i> <span>${escapeHtml(tr('dle_empty_cta_setup'))}</span></button>`
        + `<button type="button" class="menu_button dle-empty-cta-btn" data-empty-action="import-wi" title="${escapeHtml(tr('dle_import_wi_tooltip'))}">`
        + `<i class="fa-solid fa-file-import" aria-hidden="true"></i> <span>${escapeHtml(tr('dle_empty_cta_import'))}</span></button>`
        + '</div>'
        + `<p class="dle-empty-commands dle-text-xs dle-muted">${tr('dle_empty_cta_hint')}</p>`;
}

// ════════════════════════════════════════════════════════════════════════════
// Why? Tab
// ════════════════════════════════════════════════════════════════════════════

export function renderInjectionTab() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    // Wave F: skip painting into a hidden drawer; replayed on open (drawer.js toggle handler).
    if (!isDrawerVisible()) return;
    // Verdict store is the single source of truth for "what did DLE decide this turn."
    // Empty verdict (injectedSources=[]) is a valid result; null means no verdict written yet.
    // UI consumers must read the CURRENT CHAT's verdict (not ring-global newest) so a
    // stale verdict from another chat in the ring can't flicker through on chat-switch.
    const currentVerdict = _currentVerdictForChat();
    const previousVerdict = getPreviousVerdict();
    const sources = currentVerdict?.injectedSources?.length ? currentVerdict.injectedSources : null;
    const trace = currentVerdict?.trace ?? null;

    // Content-hash guard — skip full re-render when inputs are unchanged. Hash inputs:
    // sources (title/tokens/matchedBy/vaultSource), filter state, trace's rejected-entry
    // summary. Counts are updated surgically via updateInjectionCountBadges() and are
    // intentionally excluded from the hash.
    const _hashParts = [
        ds.whyTabFilter || '',
        generationLock ? '1' : '0',
        sources ? sources.map(s => `${s.title}|${s.tokens}|${s.matchedBy}|${s.vaultSource || ''}`).join(';') : 'null',
        // Wave C: keyword-match count feeds the verdict funnel header, so it belongs in the hash.
        // (The field is keywordMatched — the prior `trace.matched` read was always undefined → 0.)
        trace ? `${trace.injected?.length ?? 0}:${trace.keywordMatched?.length ?? 0}:${trace.aiSelected?.length ?? 0}:${trace.budgetCut?.length ?? 0}` : 'null',
    ];
    const _hash = _hashParts.join('#');
    // #17: root identity check — see the guard-variable comment block above.
    if (_hash === _lastInjectionRenderHash && $drawer[0] === _lastInjectionRenderRoot) return;
    _lastInjectionRenderHash = _hash;
    _lastInjectionRenderRoot = $drawer[0];
    const $list = $drawer.find('.dle-why-list');
    const $empty = $drawer.find('#dle-panel-injection .dle-empty-state');
    const $diff = $drawer.find('.dle-section-diff');
    const $funnel = $drawer.find('.dle-why-funnel');
    const $whyNotSection = $drawer.find('.dle-why-not-section');
    const $whyNotList = $drawer.find('.dle-why-not-list');

    if (!sources || sources.length === 0) {
        $list.empty();
        $funnel.empty().prop('hidden', true);
        $whyNotSection.removeClass('dle-visible');
        $diff.empty();
        if (generationLock) {
            $empty.html(`<goo-spinner size="72" color="currentColor" aria-hidden="true"></goo-spinner><p>${tr('dle_empty_state_choosing')}</p>`).addClass('dle-visible');
        } else if (vaultIndex.length === 0) {
            // PRE-SETUP: no entries indexed → the full connect/keyword/setup onboarding guide.
            // Localized — mirrors the static empty-state in drawer.html. tr() returns the
            // _html keys' markup verbatim, so <code>/<a> render. See gotchas.md #72.
            $empty.html(
                '<i class="fa-solid fa-circle-question" aria-hidden="true"></i>'
                + `<p>${tr('dle_empty_injection')}</p>`
                + '<div class="dle-empty-guide">'
                + `<p>${tr('dle_empty_guide_intro')}</p>`
                + '<ol>'
                + `<li>${tr('dle_empty_guide_step_1')}</li>`
                + `<li>${tr('dle_empty_guide_step_2')}</li>`
                + `<li>${tr('dle_empty_guide_step_3')}</li>`
                + '</ol>'
                + emptyCtaHtml()
                + '</div>',
            ).addClass('dle-visible');
        } else {
            // POST-SETUP-IDLE: vault indexed, just nothing matched this turn. Don't re-pitch
            // the setup the user already finished — a calm one-liner pointing at Browse instead.
            $empty.html(
                '<i class="fa-solid fa-circle-question" aria-hidden="true"></i>'
                + `<p>${tr('dle_empty_injection')}</p>`
                + `<p class="dle-empty-guide-idle">${tr('dle_empty_injection_idle')}</p>`,
            ).addClass('dle-visible');
        }
        return;
    }

    $empty.removeClass('dle-visible');

    const $filterToggle = $drawer.find('.dle-why-filter-toggle');
    // BUG-AUDIT-C11: roving tabindex — only the active radio button is in tab order.
    $filterToggle.find('.dle-why-filter-btn').removeClass('active').attr('aria-checked', 'false').attr('tabindex', '-1');
    $filterToggle.find(`[data-filter="${ds.whyTabFilter}"]`).addClass('active').attr('aria-checked', 'true').attr('tabindex', '0');

    const diff = diffVerdicts(currentVerdict, previousVerdict);

    $diff.attr('aria-live', 'polite');
    const diffParts = [];
    if (diff.added.length) diffParts.push(`<span class="dle-diff-add">+${diff.added.length} new</span>`);
    if (diff.removed.length) diffParts.push(`<span class="dle-diff-remove">-${diff.removed.length} removed</span>`);
    $diff.html(diffParts.join(' '));

    const settings = getSettings();
    const addedTitles = new Set(diff.added.map(s => s.title));
    const removedTitles = new Set(diff.removed.map(s => s.title));
    // Source-vault chip only earns its space when more than one vault is enabled — single-vault
    // users get an uncluttered row. (Mirrors the v.enabled !== false convention used elsewhere.)
    const _multiVault = (settings.vaults || []).filter(v => v.enabled !== false).length > 1;

    // ── Verdict funnel header: N matched → N picked → N injected ──
    // A quiet pipeline readout derived from the trace already in scope: keywordMatched
    // (Stage 1 keyword pre-filter), aiSelected (Stage 2 AI pick), injected (final). Only
    // rendered when a trace exists; in keywords-only mode there is no AI pick, so the
    // "picked" segment is dropped and the funnel collapses to matched → injected.
    if (trace) {
        const matchedN = trace.keywordMatched?.length ?? 0;
        const pickedN = trace.aiSelected?.length ?? 0;
        const injectedN = trace.injected?.length ?? sources.length;
        const hasPick = trace.mode !== 'keywords-only';
        const arrow = '<span class="dle-funnel-arrow" aria-hidden="true">›</span>';
        const seg = (n, labelKey) =>
            `<span class="dle-funnel-seg"><span class="dle-funnel-n">${n}</span> <span class="dle-funnel-label">${escapeHtml(tr(labelKey))}</span></span>`;
        let funnelHtml = seg(matchedN, 'dle_why_funnel_matched');
        if (hasPick) funnelHtml += arrow + seg(pickedN, 'dle_why_funnel_picked');
        funnelHtml += arrow + seg(injectedN, 'dle_why_funnel_injected');
        const funnelAria = hasPick
            ? trf('dle_why_funnel_aria', matchedN, pickedN, injectedN)
            : trf('dle_why_funnel_aria_2', matchedN, injectedN);
        $funnel.html(funnelHtml).attr('aria-label', funnelAria).prop('hidden', false);
    } else {
        $funnel.empty().prop('hidden', true);
    }

    // BUG-AUDIT-H14: title→entry lookup once instead of vaultIndex.find() per entry — O(N+M) vs O(N*M).
    // trackerKey invariant (#50): key on vaultSource:title (not bare title) so cross-vault same-title
    // entries resolve to their own folderPath instead of the first vault's. Matches the `:` keys at L140/L158.
    const titleToEntry = new Map();
    for (const e of vaultIndex) {
        const k = `${e.vaultSource || ''}:${e.title}`;
        if (!titleToEntry.has(k)) titleToEntry.set(k, e);
    }

    function buildWhyHtml(srcs) {
        let h = '';
        for (let idx = 0; idx < srcs.length; idx++) {
            const src = srcs[idx];
            const isNew = addedTitles.has(src.title);
            const isConstant = src.constant || (src.matchedBy && src.matchedBy.toLowerCase().includes('constant'));
            const classes = ['dle-why-entry'];
            if (isNew) classes.push('dle-why-new');
            if (isConstant) classes.push('dle-why-constant');

            const { uri } = resolveEntryVault(src, settings.vaults);
            const matchLabel = getMatchLabel(src.matchedBy);

            const entryAriaLabel = `${escapeHtml(src.title)}, ${src.tokens != null ? src.tokens : 'unknown'} tokens, matched by ${matchLabel}${isNew ? ', newly added' : ''}`;
            const countKey = `${src.vaultSource || ''}:${src.title}`;
            h += `<div class="${classes.join(' ')}" style="--i:${idx}" role="listitem" aria-label="${entryAriaLabel}" data-title="${escapeHtml(src.title)}" data-count-key="${escapeHtml(countKey)}">`;
            h += `<span class="dle-why-title">`;
            if (uri) {
                h += `<a href="${escapeHtml(uri)}" class="dle-obsidian-link" target="_blank" rel="noopener noreferrer" aria-label="Open in Obsidian">${escapeHtml(src.title)}</a>`;
            } else {
                h += escapeHtml(src.title);
            }
            // Show folder path if entry has one
            const whyEntry = titleToEntry.get(`${src.vaultSource || ''}:${src.title}`);
            if (whyEntry?.folderPath) {
                h += ` <span class="dle-entry-folder" title="${escapeHtml(whyEntry.folderPath)}">${escapeHtml(whyEntry.folderPath)}</span>`;
            }
            h += `</span>`;
            h += `<span class="dle-why-meta">`;
            const tokVal = src.tokens || 0;
            const tokHue = Math.max(0, 120 - (tokVal / 5000) * 120); // hue 120=green (light), 0=red (heavy)
            h += `<span class="dle-why-tokens" style="color: hsl(${Math.round(tokHue)}, 80%, 50%)" aria-label="${tokVal} tokens">${tokVal} tokens</span>`;
            const whyChatCount = chatInjectionCounts.get(`${src.vaultSource || ''}:${src.title}`) || 0;
            if (whyChatCount > 0) h += `<span class="dle-inject-count" title="Injected ${whyChatCount} times this chat" aria-label="Injected ${whyChatCount} times this chat">${whyChatCount}×</span>`;
            // Source-vault chip — only when 2+ vaults enabled (keeps single-vault rows clean).
            if (_multiVault && src.vaultSource) {
                h += `<span class="dle-why-vault" title="From vault: ${escapeHtml(src.vaultSource)}" aria-label="From vault ${escapeHtml(src.vaultSource)}"><i class="fa-solid fa-database" aria-hidden="true"></i>${escapeHtml(src.vaultSource)}</span>`;
            }
            // Match provenance. Two-stage picks (keyword → AI) render as a KEY › AI breadcrumb so
            // the two stages read distinctly; everything else is a single chip. Both branches reuse
            // the existing .dle-why-match theme-derived chip styling (data-match-type drives color).
            const _matchTitle = `Matched via ${escapeHtml(src.matchedBy || '?')}`;
            if (parseMatchReason(src.matchedBy).type === 'keyword_ai') {
                h += `<span class="dle-why-breadcrumb" title="${_matchTitle}" aria-label="${_matchTitle}">`;
                h += `<span class="dle-why-match" data-match-type="key">KEY</span>`;
                h += `<span class="dle-why-bc-sep" aria-hidden="true">›</span>`;
                h += `<span class="dle-why-match" data-match-type="ai">AI</span>`;
                h += `</span>`;
            } else {
                h += `<span class="dle-why-match" data-match-type="${matchLabel.toLowerCase()}" title="${_matchTitle}">${matchLabel}</span>`;
            }
            if (isNew) h += `<span class="dle-why-new-badge" title="New this message — not injected in previous response" aria-label="New this message — not injected in previous response">NEW</span>`;
            h += `<button type="button" class="dle-browse-nav-btn" data-browse-title="${escapeHtml(src.title)}" data-browse-vault="${escapeHtml(src.vaultSource || '')}" title="Show in Browse" aria-label="Show ${escapeHtml(src.title)} in Browse tab"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i></button>`;
            h += `</span>`;
            h += `</div>`;
        }
        return h;
    }

    const showInjected = ds.whyTabFilter !== 'filtered';
    const showFiltered = ds.whyTabFilter !== 'injected';
    $list.toggle(showInjected);
    $diff.toggle(showInjected);

    // Animate-out removed entries, then swap; safety timeout in case animationend never fires.
    if (showInjected && removedTitles.size > 0 && $list.children().length > 0) {
        const exitEls = $list.find('.dle-why-entry').filter(function () {
            return removedTitles.has($(this).data('title'));
        });
        if (exitEls.length > 0) {
            exitEls.addClass('dle-why-exit');
            let swapped = false;
            const swap = () => { if (!swapped) { swapped = true; $list.html(buildWhyHtml(sources)); } };
            exitEls[0].addEventListener('animationend', swap, { once: true });
            setTimeout(swap, 250);
        } else {
            $list.html(buildWhyHtml(sources));
        }
    } else {
        $list.html(buildWhyHtml(sources));
    }

    // ── "Why Not" section — candidates that got filtered out ──
    if (!showFiltered) {
        $whyNotSection.removeClass('dle-visible');
    } else if (trace) {
        // BUG-AUDIT v2.5: trackerKey-shape keys so same-titled cross-vault entries don't collide.
        const injectedKeys = new Set(sources.map(s => `${s.vaultSource || ''}:${(s.title || '').toLowerCase()}`));
        const rejectedGroups = categorizeRejections(trace, injectedKeys);
        // Wave C: present groups in PIPELINE ORDER (match → AI-select → gating → cooldown →
        // requires/excludes → strip-dedup → budget → probability → warmup). Sort a COPY at the
        // render site — categorizeRejections is shared with the cartographer/popups, so its
        // emission order must stay untouched. Stable tiebreak on label for deterministic output.
        const nonEmpty = rejectedGroups
            .filter(g => g.entries.length > 0)
            .sort((a, b) => (_whyStageRank(a.stage) - _whyStageRank(b.stage)) || a.label.localeCompare(b.label));

        if (nonEmpty.length > 0) {
            let whyNotHtml = '';
            for (const group of nonEmpty) {
                const fixItLabel = _fixItPinLabel(group.stage);
                whyNotHtml += `<div class="dle-why-not-group-header" role="heading" aria-level="4" aria-label="Filtered entries — ${escapeHtml(group.label)}">`;
                // LOCAL PATCH 2026-08-04: was `${group.icon}`, which printed the Font Awesome
                // CLASS NAME as literal text — every group header read "fa-robot",
                // "fa-lock", "fa-filter" and so on. categorizeRejections() returns class
                // names, not glyphs; every other consumer (cartographer.js, the Browse
                // why-not badge) already wraps them in an <i>. This one didn't.
                whyNotHtml += `<span class="dle-why-not-group-icon"><i class="fa-solid ${escapeHtml(group.icon)}" aria-hidden="true"></i></span> `;
                whyNotHtml += `<span class="dle-why-not-group-label">${escapeHtml(group.label)}</span>`;
                whyNotHtml += `<span class="dle-why-not-group-count">${group.entries.length}</span>`;
                whyNotHtml += `</div>`;
                for (const e of group.entries) {
                    whyNotHtml += `<div class="dle-why-entry dle-why-not-entry dle-why-not-grouped" role="listitem" aria-label="Filtered out: ${escapeHtml(e.reason)}">`;
                    whyNotHtml += `<span class="dle-why-title dle-muted">${escapeHtml(e.title)}</span>`;
                    whyNotHtml += `<span class="dle-why-meta"><span class="dle-why-match dle-why-not-reason" title="${escapeHtml(e.reason)}" aria-label="${escapeHtml(e.reason)}">${escapeHtml(e.reason)}</span>`;
                    // Fix-It pin — hover/focus-reveal (CSS), keyboard-reachable. Stage-aware verb.
                    // Pins by trackerKey (data-title + data-vault); handler in drawer-events.js.
                    const _fixItAria = trf('dle_fixit_pin_aria', e.title);
                    whyNotHtml += `<button type="button" class="dle-why-fixit" data-title="${escapeHtml(e.title)}" data-vault="${escapeHtml(e.vaultSource || '')}" title="${escapeHtml(fixItLabel)}" aria-label="${escapeHtml(_fixItAria)}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i><span class="dle-why-fixit-label">${escapeHtml(fixItLabel)}</span></button>`;
                    whyNotHtml += `<button type="button" class="dle-browse-nav-btn" data-browse-title="${escapeHtml(e.title)}" data-browse-vault="${escapeHtml(e.vaultSource || '')}" title="Show in Browse" aria-label="Show ${escapeHtml(e.title)} in Browse tab"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i></button></span>`;
                    whyNotHtml += `</div>`;
                }
            }
            $whyNotList.html(whyNotHtml);
            $whyNotSection.addClass('dle-visible');
        } else {
            $whyNotSection.removeClass('dle-visible');
        }
    } else {
        $whyNotSection.removeClass('dle-visible');
    }
}

/**
 * Surgically update `×N` count badges on Why? tab entries without rebuilding DOM.
 * Called instead of renderInjectionTab when only chatInjectionCounts changed —
 * avoids replaying stagger-in animations and preserves DOM identity.
 */
export function updateInjectionCountBadges() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    const $entries = $drawer.find('.dle-why-list .dle-why-entry');
    if (!$entries.length) return;
    $entries.each(function () {
        const $entry = $(this);
        const key = $entry.attr('data-count-key');
        if (!key) return;
        const count = chatInjectionCounts.get(key) || 0;
        const $meta = $entry.find('.dle-why-meta');
        let $badge = $meta.find('.dle-inject-count');
        if (count > 0) {
            const label = `Injected ${count} times this chat`;
            if ($badge.length === 0) {
                // Order must match buildWhyHtml — the count sits just before the provenance cluster
                // (vault chip → breadcrumb/match badge). .first() pins a SINGLE anchor so the
                // two-segment KEY › AI breadcrumb (two .dle-why-match nodes) can't dupe the badge.
                const $anchor = $meta.find('.dle-why-vault, .dle-why-breadcrumb, .dle-why-match').first();
                const badgeHtml = `<span class="dle-inject-count" title="${label}" aria-label="${label}">${count}×</span>`;
                if ($anchor.length) $anchor.before(badgeHtml);
                else $meta.append(badgeHtml);
            } else {
                $badge.text(`${count}×`).attr('title', label).attr('aria-label', label);
            }
        } else if ($badge.length) {
            $badge.remove();
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════
// Browse Tab
// ════════════════════════════════════════════════════════════════════════════

// LOCAL PATCH 2026-08-02 (Miinthe): the virtual scroller hard-coded `.dle-drawer-inner` as its
// scroll container, but that element only sets overflow-x — whether IT scrolls, or
// `.dle-browse-list` (which does set overflow-y:auto), or an ST wrapper further up, depends
// on runtime layout. When the guess is wrong the wheel scrolls an element nobody measures,
// so rows never repaint and only dragging a scrollbar appears to work. Resolve it for real.
export function resolveBrowseScroller($drawer) {
    // `.dle-drawer-inner` is the drawer's real scroll viewport — confirmed from the live DOM
    // 2026-08-02: overflowY auto, scrollHeight 875 > clientHeight 586, scrollTop tracking the
    // wheel. Prefer it whenever it is actually scrollable.
    //
    // Do NOT cache the result, and do not simply take the first scrollable ancestor:
    // `.dle-tab-panel` also carries overflow-y:auto and can transiently report
    // scrollHeight > clientHeight mid-scroll. Latching onto it left the virtual scroller
    // measuring an element that never moves again — scrolling died until the outer bar was
    // dragged. The checks below are two getComputedStyle calls; re-running them per frame is
    // far cheaper than being wrong.
    const inner = $drawer.find('.dle-drawer-inner')[0];
    if (inner && inner.scrollHeight > inner.clientHeight + 1) return inner;

    const listEl = $drawer.find('.dle-browse-list')[0];
    if (listEl) {
        for (let el = listEl.parentElement; el && el !== document.body; el = el.parentElement) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
        }
    }
    return inner || null;
}

export function renderBrowseTab() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    // Wave F: skip painting into a hidden drawer; replayed on open (drawer.js toggle handler).
    if (!isDrawerVisible()) return;

    // Wave F: content-hash guard — skip the full vault filter + sort + row-model rebuild when
    // nothing that affects Browse output changed. Completeness: chatInjectionCountsVersion covers
    // the ×N badges / temperature tints / count-dependent sorts+filters; the verdict signature
    // covers injected/since-gen/rejection state; indexTimestamp+length cover vault content. Pins/
    // blocks, all filters, sort, grouping, expanded folders, selection, and field defs are hashed
    // directly. Bypassed when a nav target is pending (auto-expand must run). Computed before any
    // DOM/range-cache mutation so a skip leaves the virtual-scroll cache valid.
    const _bVerdict = _currentVerdictForChat();
    const _bPrev = getPreviousVerdict();
    const _browseHash = [
        indexTimestamp || 0,
        vaultIndex ? vaultIndex.length : 0,
        chatInjectionCountsVersion,
        indexing ? '1' : '0',
        ds.browseQuery || '',
        ds.browseStatusFilter || 'all',
        ds.browseTagFilter || '',
        ds.browseFolderFilter || '',
        JSON.stringify(chat_metadata?.deeplore_folder_filter || []),
        JSON.stringify(ds.browseCustomFieldFilters || {}),
        ds.browseQuickFilter ?? '',
        ds.browseSort || '',
        ds.browseFolderGrouping ? '1' : '0',
        ds.browseExpandedFolders instanceof Set ? [...ds.browseExpandedFolders].sort().join('|') : '',
        ds.browseSelectMode ? '1' : '0',
        ds.browseSelected instanceof Set ? [...ds.browseSelected].sort().join('|') : '',
        fieldDefinitions.length,
        JSON.stringify(chat_metadata?.deeplore_pins || []),
        JSON.stringify(chat_metadata?.deeplore_blocks || []),
        `${_bVerdict?.epoch ?? ''}.${_bVerdict?.msgIdx ?? ''}.${_bVerdict?.ts ?? ''}`,
        `${_bPrev?.epoch ?? ''}.${_bPrev?.msgIdx ?? ''}`,
    ].join('#');
    // #17: root identity check — see the guard-variable comment block above.
    if (!ds.browseNavigateTarget && _browseHash === _lastBrowseRenderHash && $drawer[0] === _lastBrowseRenderRoot) return;
    _lastBrowseRenderHash = _browseHash;
    _lastBrowseRenderRoot = $drawer[0];

    // Invalidate virtual scroll cache so stale entry references are never rendered.
    ds.browseLastRangeStart = -1;
    ds.browseLastRangeEnd = -1;
    const $list = $drawer.find('.dle-browse-list');
    const $emptyLoading = $drawer.find('#dle-browse-loading');
    const $emptyNoData = $drawer.find('#dle-browse-empty-no-data');
    const $emptyNoResults = $drawer.find('#dle-browse-empty-no-results');
    const $refreshSpinner = $drawer.find('.dle-browse-refresh-spinner');

    $refreshSpinner.toggle(!!indexing && vaultIndex.length > 0);

    $drawer.find('#dle-panel-browse').attr('aria-busy', indexing ? 'true' : 'false');

    if (!vaultIndex || vaultIndex.length === 0) {
        $list.empty();
        if (indexing) {
            $emptyLoading.addClass('dle-visible');
            $emptyNoData.removeClass('dle-visible');
        } else {
            $emptyLoading.removeClass('dle-visible');
            // Localized — mirrors the static #dle-browse-empty-no-data guide in drawer.html.
            $emptyNoData.html(
                `<p>${tr('dle_browse_no_data')}</p>`
                + '<div class="dle-empty-guide">'
                + `<p>${tr('dle_browse_no_data_intro')}</p>`
                + '<ul>'
                + `<li>${tr('dle_browse_no_data_step_tags')}</li>`
                + `<li>${tr('dle_browse_no_data_step_keys')}</li>`
                + '</ul>'
                + emptyCtaHtml()
                + '</div>',
            ).addClass('dle-visible');
        }
        $emptyNoResults.removeClass('dle-visible');
        return;
    }

    $emptyLoading.removeClass('dle-visible');
    $emptyNoData.removeClass('dle-visible');

    // Tag/folder caches are rebuilt on index update; reset stale filters when the tag/folder no longer exists.
    const $tagSelect = $drawer.find('[data-filter="tag"]');
    if (ds.cachedTagOptions) {
        $tagSelect.html(ds.cachedTagOptions);
        if (ds.browseTagFilter) $tagSelect.val(ds.browseTagFilter);
    }
    if (ds.browseTagFilter && ds.cachedTagSet && !ds.cachedTagSet.has(ds.browseTagFilter)) {
        ds.browseTagFilter = '';
    }

    const $folderSelect = $drawer.find('[data-filter="folder"]');
    if ($folderSelect.length) {
        if (ds.cachedFolderOptions) {
            $folderSelect.html(ds.cachedFolderOptions);
            if (ds.browseFolderFilter) $folderSelect.val(ds.browseFolderFilter);
        }
        // LOCAL PATCH 2026-08-02 (Miinthe): '__chat__' is a sentinel, not a real folder path —
        // exempt it from the "selected folder vanished from the vault" reset.
        if (ds.browseFolderFilter && ds.browseFolderFilter !== '__chat__'
            && ds.cachedFolderSet && !ds.cachedFolderSet.has(ds.browseFolderFilter)) {
            ds.browseFolderFilter = '';
        }
    }

    // P8: rebuild options with live entry counts each render (fast Map pass).
    if ($tagSelect.length && ds.cachedTagSet) {
        const tagCounts = new Map();
        for (const e of vaultIndex) {
            if (e.tags) for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
        $tagSelect.html('<option value="">' + escapeHtml(tr('dle_tags_all')) + '</option>' +
            [...ds.cachedTagSet].sort().map(t => `<option value="${escapeHtml(t)}"${ds.browseTagFilter === t ? ' selected' : ''}>${escapeHtml(t)} (${tagCounts.get(t) || 0})</option>`).join(''));
    }
    // LOCAL PATCH 2026-08-02 (Miinthe): keep the sort dropdown honest. Its markup lists
    // priority_asc first, so a <select> with no value set always *displays* "Default
    // (Priority)" — even when ds.browseSort says otherwise. Nothing synced it before,
    // which was harmless only while the default happened to match the markup.
    const $sortSelect = $drawer.find('.dle-browse-sort-select');
    if ($sortSelect.length && ds.browseSort && $sortSelect.val() !== ds.browseSort) {
        $sortSelect.val(ds.browseSort);
    }

    if ($folderSelect.length && ds.cachedFolderSet) {
        const folderCounts = new Map();
        for (const e of vaultIndex) {
            if (e.folderPath) {
                const parts = e.folderPath.split('/');
                for (let i = 1; i <= parts.length; i++) {
                    const seg = parts.slice(0, i).join('/');
                    if (ds.cachedFolderSet.has(seg)) folderCounts.set(seg, (folderCounts.get(seg) || 0) + 1);
                }
            }
        }
        // LOCAL PATCH 2026-08-02 (Miinthe): "This chat's folders" option. Browsing 1000+ entries
        // while sitting in one chat is noise — this scopes the list to whatever the Filters
        // tab has selected, without hiding anything permanently (pick "Folder (all)" to see
        // the whole vault again). It is the default whenever the chat HAS a folder filter.
        const chatFolders = chat_metadata?.deeplore_folder_filter || [];
        let chatScopedCount = 0;
        if (chatFolders.length) {
            for (const e of vaultIndex) {
                if (!e.folderPath || chatFolders.some(f => e.folderPath === f || e.folderPath.startsWith(f + '/'))) chatScopedCount++;
            }
            if (ds.browseFolderFilter === '' && !ds._browseScopeTouched) ds.browseFolderFilter = '__chat__';
        } else if (ds.browseFolderFilter === '__chat__') {
            ds.browseFolderFilter = '';
        }
        const chatOption = chatFolders.length
            ? `<option value="__chat__"${ds.browseFolderFilter === '__chat__' ? ' selected' : ''}>This chat's folders (${chatScopedCount})</option>`
            : '';
        $folderSelect.html('<option value="">' + escapeHtml(tr('dle_browse_filter_folder_all')) + '</option>' + chatOption +
            [...ds.cachedFolderSet].sort().map(f => `<option value="${escapeHtml(f)}"${ds.browseFolderFilter === f ? ' selected' : ''}>${escapeHtml(f)} (${folderCounts.get(f) || 0})</option>`).join(''));
    }

    // LOCAL PATCH 2026-08-03 (Miinthe): the inbox jump button. The inbox is where entries are
    // written and where they get moved OUT of, so it earns a one-tap shortcut next to the
    // folder filter. Resolved from `autoSuggestFolder` (the folder DeepLore itself writes
    // to) and only guessed by name as a fallback — so renaming "00 Inbox" doesn't break it,
    // as long as the setting still points at the right place.
    const $inboxBtn = $drawer.find('.dle-browse-inbox-btn');
    if ($inboxBtn.length && ds.cachedFolderSet) {
        // Follow the AI lorebook's own destination (`autoSuggestFolder`) — that is the folder new
        // suggestions land in and therefore the one that actually needs reviewing. Falls through
        // to a name guess, then hides — so a stale or blank setting degrades quietly instead of
        // pointing the button at the wrong place.
        const s = getSettings();
        const candidates = [s.autoSuggestFolder]
            .map(v => String(v || '').replace(/^\/+|\/+$/g, ''))
            .filter(Boolean);
        let inboxFolder = candidates.find(c => ds.cachedFolderSet.has(c)) || '';
        if (!inboxFolder) {
            inboxFolder = [...ds.cachedFolderSet]
                .filter(f => /(^|\/)\s*(\d+\s+)?inbox$/i.test(f))
                .sort()[0] || '';
        }
        if (inboxFolder) {
            // Count the folder AND its subfolders — "00 Inbox/Retired" is still the inbox.
            // Counted straight off vaultIndex on purpose: the `folderCounts` map above is
            // const-scoped INSIDE the folder-select block, and reaching for it from out here
            // threw a ReferenceError that aborted the whole Browse render (2026-08-03).
            let inboxCount = 0;
            for (const e of vaultIndex) {
                const fp = e.folderPath || '';
                if (fp === inboxFolder || fp.startsWith(inboxFolder + '/')) inboxCount++;
            }
            const active = ds.browseFolderFilter === inboxFolder;
            $inboxBtn
                .css('display', '')
                .attr('data-inbox-folder', inboxFolder)
                .attr('aria-pressed', active ? 'true' : 'false')
                .toggleClass('dle-inbox-active', active)
                .attr('title', active ? `Showing ${inboxFolder} — click to go back` : `Jump to ${inboxFolder} (${inboxCount})`);
            $inboxBtn.find('.dle-inbox-count').text(inboxCount > 0 ? ` ${inboxCount}` : '');
        } else {
            $inboxBtn.css('display', 'none');
        }
    }

    // Custom field filter dropdowns — values cached, recomputed when vault content changes.
    const browseFieldDefs = (fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS)
        .filter(fd => fd.gating?.enabled);
    const $cfContainer = $drawer.find('.dle-browse-custom-filters');
    if ($cfContainer.length && browseFieldDefs.length > 0) {
        // L-26: key the cache on length AND indexTimestamp — keying on length alone left the dropdown
        // options stale when field VALUES changed without changing the entry count (edit/rebuild).
        const _cfSig = `${vaultIndex.length}:${indexTimestamp || 0}`;
        if (_cachedFieldValuesIndexLen !== _cfSig) {
            _cachedFieldValues = {};
            for (const fd of browseFieldDefs) {
                const vals = new Set();
                for (const e of vaultIndex) {
                    const v = e.customFields?.[fd.name];
                    if (v == null) continue;
                    if (Array.isArray(v)) v.forEach(x => { if (x) vals.add(String(x)); });
                    else if (v !== '') vals.add(String(v));
                }
                if (vals.size > 0) _cachedFieldValues[fd.name] = [...vals].sort();
            }
            _cachedFieldValuesIndexLen = _cfSig;
        }
        const fieldValues = _cachedFieldValues;
        let cfHtml = '';
        for (const fd of browseFieldDefs) {
            const vals = fieldValues[fd.name];
            if (!vals || vals.length === 0) continue;
            const current = ds.browseCustomFieldFilters[fd.name] || '';
            cfHtml += `<select class="text_pole dle-browse-filter-select dle-browse-cf-filter" data-cf="${escapeHtml(fd.name)}" aria-label="Filter by ${escapeHtml(fd.label)}">`;
            cfHtml += `<option value="">${escapeHtml(fd.label)}</option>`;
            for (const v of vals) {
                cfHtml += `<option value="${escapeHtml(v)}"${current === v ? ' selected' : ''}>${escapeHtml(v)}</option>`;
            }
            cfHtml += '</select>';
        }
        // Don't replace HTML while a dropdown is open — would close it mid-interaction.
        const activeEl = document.activeElement;
        if (!(activeEl && $cfContainer[0]?.contains(activeEl) && (activeEl.tagName === 'SELECT' || activeEl.closest('.dle-browse-cf-filter')))) {
            $cfContainer.html(cfHtml);
        }
    }

    const settings = getSettings();

    const query = ds.browseQuery.toLowerCase();
    const statusFilter = ds.browseStatusFilter;
    const tagFilter = ds.browseTagFilter;
    const sortKey = ds.browseSort;

    // BUG-AUDIT-3: normalizePinBlock handles legacy bare-string entries alongside {title,vaultSource} objects.
    // Multi-vault key vaultSource:title (trackerKey invariant) — same-title cross-vault pins must not collide.
    const pins = chat_metadata?.deeplore_pins || [];
    const blocks = chat_metadata?.deeplore_blocks || [];
    const pinSet = new Set(pins.map(p => { const n = normalizePinBlock(p); return `${n.vaultSource || ''}:${n.title.toLowerCase()}`; }));
    const blockSet = new Set(blocks.map(b => { const n = normalizePinBlock(b); return `${n.vaultSource || ''}:${n.title.toLowerCase()}`; }));

    // Verdict carries both injectedSources and trace together; no post-render clear semantics.
    // BUG-AUDIT v2.5: key injectedSet by trackerKey (vaultSource:title) to honor the
    // multi-vault invariant. Bare title collapses Alice@vault-a + Alice@vault-b.
    const _browseVerdict = _currentVerdictForChat();
    const injectedSet = new Set();
    const injSources = _browseVerdict?.injectedSources?.length
        ? _browseVerdict.injectedSources
        : _browseVerdict?.trace?.injected;
    if (injSources) {
        for (const s of injSources) injectedSet.add(`${s.vaultSource || ''}:${s.title.toLowerCase()}`);
    }

    // Search syntax: bare tokens AND substring-match title+keys; prefixes (tag:/folder:/key:/summary:/field:name=val) are field-qualified.
    const _queryTokens = query ? query.split(/\s+/).filter(Boolean) : [];
    const _prefixFilters = [];
    const _bareTokens = [];
    for (const tok of _queryTokens) {
        const colonIdx = tok.indexOf(':');
        if (colonIdx > 0) {
            const prefix = tok.slice(0, colonIdx);
            const val = tok.slice(colonIdx + 1);
            if (val) _prefixFilters.push({ prefix, val });
        } else {
            _bareTokens.push(tok);
        }
    }

    let entries = vaultIndex.filter(e => {
        if (_bareTokens.length) {
            for (const bt of _bareTokens) {
                const titleMatch = e.title.toLowerCase().includes(bt);
                const keyMatch = e.keys && e.keys.some(k => k.toLowerCase().includes(bt));
                if (!titleMatch && !keyMatch) return false;
            }
        }
        for (const { prefix, val } of _prefixFilters) {
            const lv = val.toLowerCase();
            if (prefix === 'tag') {
                if (!e.tags || !e.tags.some(t => t.toLowerCase().includes(lv))) return false;
            } else if (prefix === 'folder') {
                if (!e.folderPath || !e.folderPath.toLowerCase().includes(lv)) return false;
            } else if (prefix === 'key') {
                if (!e.keys || !e.keys.some(k => k.toLowerCase().includes(lv))) return false;
            } else if (prefix === 'summary') {
                if (!e.summary || !e.summary.toLowerCase().includes(lv)) return false;
            } else if (prefix === 'field') {
                // field:name=value — exact (case-insensitive) field-value match.
                const eqIdx = val.indexOf('=');
                if (eqIdx < 0) return false;
                const fname = val.slice(0, eqIdx).toLowerCase();
                const fval = val.slice(eqIdx + 1).toLowerCase();
                const ev = e.customFields?.[fname] ?? e.customFields?.[Object.keys(e.customFields || {}).find(k => k.toLowerCase() === fname) || ''];
                if (ev == null) return false;
                const evStr = Array.isArray(ev) ? ev.map(v => String(v).toLowerCase()) : [String(ev).toLowerCase()];
                if (!evStr.includes(fval)) return false;
            }
            // Unknown prefixes pass through unfiltered.
        }

        const tl = e.title.toLowerCase();
        const pbKey = `${e.vaultSource || ''}:${tl}`;
        if (statusFilter === 'injected' && !injectedSet.has(pbKey)) return false;
        if (statusFilter === 'pinned' && !pinSet.has(pbKey)) return false;
        if (statusFilter === 'blocked' && !blockSet.has(pbKey)) return false;
        if (statusFilter === 'constant' && !e.constant) return false;
        if (statusFilter === 'seed' && !e.seed) return false;
        if (statusFilter === 'bootstrap' && !e.bootstrap) return false;
        if (statusFilter === 'never_injected') {
            const key = trackerKey(e);
            const allTime = settings.analyticsData?.[key];
            if (allTime && (allTime.injected || 0) > 0) return false;
        }

        if (tagFilter && (!e.tags || !e.tags.includes(tagFilter))) return false;

        if (ds.browseFolderFilter === '__chat__') {
            // LOCAL PATCH 2026-08-02 (Miinthe): mirror the pipeline's applyFolderFilter exactly —
            // exact match or slash-bounded prefix, and root-level entries always pass.
            const cf = chat_metadata?.deeplore_folder_filter || [];
            if (cf.length && e.folderPath
                && !cf.some(f => e.folderPath === f || e.folderPath.startsWith(f + '/'))) return false;
        } else if (ds.browseFolderFilter) {
            if (!e.folderPath) return false;
            if (e.folderPath !== ds.browseFolderFilter && !e.folderPath.startsWith(ds.browseFolderFilter + '/')) return false;
        }

        for (const [cfName, cfVal] of Object.entries(ds.browseCustomFieldFilters)) {
            if (!cfVal) continue;
            const ev = e.customFields?.[cfName];
            if (ev == null) return false;
            if (Array.isArray(ev)) {
                if (!ev.some(v => String(v).toLowerCase() === cfVal.toLowerCase())) return false;
            } else {
                if (String(ev).toLowerCase() !== cfVal.toLowerCase()) return false;
            }
        }

        return true;
    });

    entries = [...entries];
    switch (sortKey) {
        case 'priority_asc': entries.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50)); break;
        case 'priority_desc': entries.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50)); break;
        case 'alpha_asc': entries.sort((a, b) => a.title.localeCompare(b.title)); break;
        case 'alpha_desc': entries.sort((a, b) => b.title.localeCompare(a.title)); break;
        case 'tokens_desc': entries.sort((a, b) => (b.tokenEstimate || 0) - (a.tokenEstimate || 0)); break;
        case 'tokens_asc': entries.sort((a, b) => (a.tokenEstimate || 0) - (b.tokenEstimate || 0)); break;
        case 'injections_desc': entries.sort((a, b) => (chatInjectionCounts.get(trackerKey(b)) || 0) - (chatInjectionCounts.get(trackerKey(a)) || 0)); break;
        // #16: default sort honors settings.priorityReversed (explicit priority_asc/desc above bypass it).
        default: entries.sort((a, b) => comparePriority(a, b, getSettings().priorityReversed));
    }

    // P10: ds.browseQuickFilter = null | 'since-gen' | 'never-injected' (undefined = off).
    let $quickFilters = $drawer.find('.dle-browse-quick-filters');
    if (!$quickFilters.length) {
        const $browsePanel = $drawer.find('#dle-panel-browse');
        $browsePanel.find('.dle-browse-controls-row, .dle-browse-toolbar').first().after('<div class="dle-browse-quick-filters" role="group" aria-label="Quick filters"></div>');
        $quickFilters = $drawer.find('.dle-browse-quick-filters');
    }
    const activeQF = ds.browseQuickFilter ?? null;
    const sinceGenActive = activeQF === 'since-gen';
    const neverInjectedActive = activeQF === 'never-injected';
    $quickFilters.html(
        `<span class="dle-qf-pill${sinceGenActive ? ' dle-qf-active' : ''}" role="button" tabindex="0" aria-pressed="${sinceGenActive}" data-qf="since-gen">${escapeHtml(tr('dle_browse_qf_since_gen', 'Since last gen'))}</span>` +
        `<span class="dle-qf-pill${neverInjectedActive ? ' dle-qf-active' : ''}" role="button" tabindex="0" aria-pressed="${neverInjectedActive}" data-qf="never-injected">${escapeHtml(tr('dle_browse_filter_never_injected', 'Never Injected'))}</span>`
    );
    if (sinceGenActive && _browseVerdict && getPreviousVerdict()) {
        const diff = diffVerdicts(_browseVerdict, getPreviousVerdict());
        // L-25: key on trackerKey shape (vaultSource:title) — bare lowercased title collapsed
        // same-titled cross-vault entries, so "Since last gen" could surface the wrong vault's entry.
        const addedKeys = new Set(diff.added.map(s => `${s.vaultSource || ''}:${s.title.toLowerCase()}`));
        entries = entries.filter(e => addedKeys.has(`${e.vaultSource || ''}:${e.title.toLowerCase()}`));
    } else if (neverInjectedActive) {
        entries = entries.filter(e => !chatInjectionCounts.has(trackerKey(e)) || chatInjectionCounts.get(trackerKey(e)) === 0);
    }

    const $summary = $drawer.find('.dle-browse-summary');
    const isFiltered = query || statusFilter !== 'all' || tagFilter || ds.browseFolderFilter || Object.values(ds.browseCustomFieldFilters).some(v => v);
    $summary.attr('aria-live', 'polite');
    if (isFiltered && entries.length !== vaultIndex.length) {
        $summary.text(`Showing ${entries.length} of ${vaultIndex.length} entries`).show();
    } else {
        $summary.hide();
    }

    ds.browseFilteredEntries = entries;
    // Carto/Why nav into a collapsed folder must auto-expand that folder, otherwise the
    // re-expand block in renderBrowseWindow finds nothing and the nav silently no-ops.
    if (ds.browseFolderGrouping && ds.browseNavigateTarget) {
        // P3-9 (gotcha #50): resolve by title + vaultSource so cross-vault same-title nav
        // expands the RIGHT folder. browseNavigateVault is null for legacy/single-vault → title-only.
        const target = resolveNavTarget(entries, ds.browseNavigateTarget, ds.browseNavigateVault);
        if (target) {
            const folder = topFolderOf(target);
            if (!(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
            ds.browseExpandedFolders.add(folder);
        }
    }
    // #13: build row model — entries-only when grouping OFF, header+entry interleaved when ON.
    // Collapsed folders omit their entries from the model, so virtual-scroll math just walks rowModel.
    ds.browseRowModel = buildBrowseRowModel(entries, {
        grouping: !!ds.browseFolderGrouping,
        expandedFolders: ds.browseExpandedFolders instanceof Set ? ds.browseExpandedFolders : null,
    });
    ds.browseLastRangeStart = -1;
    ds.browseLastRangeEnd = -1;
    // Carto/Why? navigation target survives one filter run for auto-expand; otherwise collapse.
    if (ds.browseNavigateTarget) {
        // overhaul (2026-10-15): the Lore tab's All entries list selects the jumped-to entry from this note
        ds.lastBrowseNav = { title: ds.browseNavigateTarget, vaultSource: ds.browseNavigateVault ?? null };
        ds.browseExpandedEntry = ds.browseNavigateTarget;
        ds.browseExpandedVault = ds.browseNavigateVault; // P3-9: carry vaultSource into re-expand resolution.
        ds.browseNavigateTarget = null;
        ds.browseNavigateVault = null;
    } else {
        ds.browseExpandedEntry = null;
        ds.browseExpandedVault = null;
        ds.browseExpandedIdx = null;
        ds.browseExpandedExtraHeight = 0;
        _cachedExpandedPreviewKey = null;
        _cachedExpandedPreviewHtml = null;
    }

    // min-height so flex doesn't collapse the virtual-scroll container.
    const listEl = $list[0];
    if (!listEl) return;
    const totalHeight = ds.browseRowModel.length * BROWSE_ROW_HEIGHT + (ds.browseExpandedExtraHeight || 0);
    $list.css({ 'min-height': totalHeight + 'px' });

    // Sync batch-toolbar pressed/visibility state — render is the single source of truth.
    const $toolbar = $drawer.find('.dle-browse-batch-toolbar');
    if ($toolbar.length) {
        $toolbar.find('.dle-browse-group-toggle')
            .attr('data-pressed', ds.browseFolderGrouping ? 'true' : 'false')
            .attr('aria-pressed', ds.browseFolderGrouping ? 'true' : 'false');
        // Expand-all / collapse-all toggle: only meaningful while grouping is on.
        const $expandAll = $toolbar.find('.dle-browse-expand-all-toggle');
        if (ds.browseFolderGrouping) {
            const topFolders = listTopFolders(ds.browseFilteredEntries);
            const expandedSet = ds.browseExpandedFolders instanceof Set ? ds.browseExpandedFolders : null;
            // "All expanded" = every top folder is in the set (empty/null set means all collapsed,
            // matching the pure helper's "explicit Set lists the expanded folders" contract).
            const allExpanded = topFolders.length > 0 && expandedSet
                && topFolders.every(f => expandedSet.has(f));
            $expandAll
                .prop('hidden', false)
                .attr('aria-pressed', allExpanded ? 'true' : 'false')
                .attr('title', allExpanded ? tr('dle_collapse_all_tooltip') : tr('dle_expand_all_tooltip'));
            $expandAll.find('i').attr('class', allExpanded ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down');
            $expandAll.find('.dle-toolbar-label').text(allExpanded ? tr('dle_collapse_all_label') : tr('dle_expand_all_label'));
        } else {
            $expandAll.prop('hidden', true);
        }
        $toolbar.find('.dle-browse-select-toggle')
            .attr('data-pressed', ds.browseSelectMode ? 'true' : 'false')
            .attr('aria-pressed', ds.browseSelectMode ? 'true' : 'false');
        const selCount = ds.browseSelected?.size || 0;
        const $optBtn = $toolbar.find('.dle-browse-optimize-selected');
        const $clrBtn = $toolbar.find('.dle-browse-clear-selection');
        if (selCount > 0) {
            $optBtn.prop('hidden', false).find('.dle-browse-optimize-count').text(`Optimize Selected (${selCount})`);
            $clrBtn.prop('hidden', false);
        } else {
            $optBtn.prop('hidden', true);
            $clrBtn.prop('hidden', true);
        }
    }

    // Reset scroll to top only when the filter signature actually changed.
    // Resetting unconditionally on every render (e.g. pin/block toggle that re-renders) yanked the user back mid-scroll.
    const _filterSignature = JSON.stringify({
        q: query || '',
        s: statusFilter || 'all',
        t: tagFilter || '',
        f: ds.browseFolderFilter || '',
        cf: ds.browseCustomFieldFilters || {},
        qf: ds.browseQuickFilter ?? null,
        sort: sortKey || 'priority_asc',
        // #13: toggling grouping restructures the whole list, so it still resets scroll.
        grp: !!ds.browseFolderGrouping,
        // LOCAL PATCH 2026-08-02 (Miinthe): `exp` (the expanded-folder set) REMOVED from this
        // signature. Expanding a folder is an in-place accordion, not a filter change —
        // counting it here yanked the panel back to the top on every folder click.
    });
    const scrollContainer = resolveBrowseScroller($drawer);
    if (scrollContainer && ds._browseLastFilterSig !== _filterSignature) {
        // LOCAL PATCH 2026-08-03 (Miinthe): was `scrollTop = 0`. That was harmless while the
        // browse list scrolled itself, but Patch 12 made .dle-drawer-inner the drawer's one
        // scroller — so zeroing it yanks the WHOLE panel to the top, status zone and filters
        // included, every time a filter changes. Clicking the inbox button changes the folder
        // filter, so it snapped the panel upwards on every press.
        // Intent is "show me the start of the results", not "go to the top of everything":
        // scroll back only as far as the list's own top, and only if we are past it. Sitting
        // above the list (reading the header) is left alone.
        const listEl = $drawer.find('.dle-browse-list')[0];
        let listTop = 0;
        if (listEl) {
            const lr = listEl.getBoundingClientRect();
            const sr = scrollContainer.getBoundingClientRect();
            listTop = Math.max(0, scrollContainer.scrollTop + (lr.top - sr.top));
        }
        if (scrollContainer.scrollTop > listTop) scrollContainer.scrollTop = listTop;
        ds._browseLastScrollTop = undefined;
    }
    ds._browseLastFilterSig = _filterSignature;

    // LOCAL PATCH 2026-08-02 (Miinthe): expanding/collapsing changes the row model but not the
    // scroll position, and renderBrowseWindow() early-returns when scrollTop hasn't moved —
    // so clear the last-scroll marker to force one repaint, WITHOUT resetting the scroll.
    const _expSig = ds.browseExpandedFolders instanceof Set
        ? [...ds.browseExpandedFolders].sort().join('|') : '';
    if (ds._browseLastExpSig !== _expSig) {
        ds._browseLastScrollTop = undefined;
        ds._browseLastExpSig = _expSig;
    }

    renderBrowseWindow();

    if (entries.length === 0) {
        // Toggle the localized static empty-state node (drawer.html #dle-browse-empty-no-results)
        // instead of overwriting it — overwriting threw away the data-i18n'd heading + Clear button
        // and leaked machine-readable `status=value` strings to end users. We only populate the
        // active-filters list with humanized, localized chips.
        const statusLabelKeys = {
            injected: 'dle_analytics_col_injected',
            pinned: 'dle_common_pinned',
            blocked: 'dle_common_blocked',
            constant: 'dle_graph_filter_type_constant',
            seed: 'dle_graph_filter_type_seed',
            bootstrap: 'dle_browse_filter_bootstrap',
            never_injected: 'dle_browse_filter_never_injected',
        };
        const quickLabels = {
            'since-gen': tr('dle_browse_qf_since_gen', 'Since last gen'),
            'never-injected': tr('dle_browse_filter_never_injected', 'Never Injected'),
        };
        const chips = [];
        if (statusFilter && statusFilter !== 'all') {
            const label = statusLabelKeys[statusFilter] ? tr(statusLabelKeys[statusFilter]) : statusFilter;
            chips.push(trf('dle_browse_active_filter_status', label));
        }
        if (tagFilter) chips.push(trf('dle_browse_active_filter_tag', tagFilter));
        if (ds.browseFolderFilter) chips.push(trf('dle_browse_active_filter_folder', ds.browseFolderFilter));
        if (query) chips.push(trf('dle_browse_active_filter_search', query));
        for (const [k, v] of Object.entries(ds.browseCustomFieldFilters)) {
            if (v) chips.push(trf('dle_browse_active_filter_field', k, v));
        }
        if (activeQF) chips.push(trf('dle_browse_active_filter_quick', quickLabels[activeQF] || activeQF));

        const $filterList = $emptyNoResults.find('.dle-browse-active-filters-list');
        if (chips.length) {
            $filterList.html(chips.map(c => `<span class="dle-browse-active-filter-chip">${escapeHtml(c)}</span>`).join('')).show();
        } else {
            $filterList.empty().hide();
        }
        $emptyNoResults.addClass('dle-visible');
    } else {
        $emptyNoResults.removeClass('dle-visible');
    }
}

/** Render the visible window of browse entries (virtual scroll). */
export function renderBrowseWindow() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    const $list = $drawer.find('.dle-browse-list');
    const listEl = $list[0];
    if (!listEl) return;

    // #13: virtual scroll now walks the row model (headers + entries) rather than entries alone.
    const rowModel = ds.browseRowModel;
    if (!rowModel || !rowModel.length) { $list.empty(); return; }

    // Scroll container resolved at runtime (see resolveBrowseScroller).
    const scrollContainer = resolveBrowseScroller($drawer);
    if (!scrollContainer) return;
    // Drawer hidden — getBoundingClientRect would return zeros; bail.
    if (!scrollContainer.offsetParent && !scrollContainer.offsetHeight) return;

    const viewHeight = scrollContainer.clientHeight;
    // getBoundingClientRect tolerates intermediate positioned parents; relativeScroll is list-top
    // minus container-top (negative=list above viewport, positive=below).
    const containerRect = scrollContainer.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();
    const relativeScroll = containerRect.top - listRect.top;

    // LOCAL PATCH 2026-08-02 (Miinthe): guard on ACTUAL VISUAL MOVEMENT, not on one element's
    // scrollTop. The old guard compared scrollContainer.scrollTop; if the resolved container
    // stopped being the element that moves — which happens under fast scrolling, since row
    // heights change mid-flight and scrollability shifts between ancestors — that value froze
    // and every later frame early-returned. Symptom: scrolling works, then permanently stops,
    // sooner the harder you scroll. relativeScroll comes from getBoundingClientRect, so it is
    // correct no matter which ancestor is doing the scrolling.
    // _browseLastScrollTop is still honoured as the existing "force one repaint" signal.
    if (ds._browseLastScrollTop !== undefined && ds._browseLastRelScroll !== undefined
        && Math.abs(relativeScroll - ds._browseLastRelScroll) < 1) return;
    ds._browseLastRelScroll = relativeScroll;
    ds._browseLastScrollTop = scrollContainer.scrollTop;

    // BUG-350: rows after the expanded entry are shifted down by browseExpandedExtraHeight.
    // Subtract that offset from pixel offsets past the expanded-entry boundary before dividing by row height.
    const expandedOffset = (ds.browseExpandedIdx !== null && ds.browseExpandedExtraHeight > 0)
        ? ds.browseExpandedExtraHeight : 0;
    const expandedBoundary = ds.browseExpandedIdx !== null
        ? (ds.browseExpandedIdx + 1) * BROWSE_ROW_HEIGHT : Infinity;
    const adjustedStart = relativeScroll > expandedBoundary
        ? relativeScroll - expandedOffset : relativeScroll;
    const adjustedEnd = (relativeScroll + viewHeight) > expandedBoundary
        ? (relativeScroll + viewHeight) - expandedOffset : (relativeScroll + viewHeight);
    const startIdx = Math.max(0, Math.floor(adjustedStart / BROWSE_ROW_HEIGHT) - BROWSE_OVERSCAN);
    const endIdx = Math.min(rowModel.length, Math.ceil(adjustedEnd / BROWSE_ROW_HEIGHT) + BROWSE_OVERSCAN);

    if (startIdx === ds.browseLastRangeStart && endIdx === ds.browseLastRangeEnd) return;
    ds.browseLastRangeStart = startIdx;
    ds.browseLastRangeEnd = endIdx;

    // BUG-AUDIT-3: see renderBrowseTab note on normalizePinBlock and vaultSource:title key.
    const pins = chat_metadata?.deeplore_pins || [];
    const blocks = chat_metadata?.deeplore_blocks || [];
    const pinSet = new Set(pins.map(p => { const n = normalizePinBlock(p); return `${n.vaultSource || ''}:${n.title.toLowerCase()}`; }));
    const blockSet = new Set(blocks.map(b => { const n = normalizePinBlock(b); return `${n.vaultSource || ''}:${n.title.toLowerCase()}`; }));
    // Verdict carries injectedSources + trace together; one read covers both.
    // BUG-AUDIT v2.5: key injectedSet by trackerKey to honor multi-vault invariant.
    const _windowVerdict = _currentVerdictForChat();
    const _windowTrace = _windowVerdict?.trace ?? null;
    const injectedSet = new Set();
    const injSources = _windowVerdict?.injectedSources?.length
        ? _windowVerdict.injectedSources
        : _windowTrace?.injected;
    if (injSources) {
        for (const s of injSources) injectedSet.add(`${s.vaultSource || ''}:${s.title.toLowerCase()}`);
    }

    const tempMap = computeEntryTemperatures();

    // Rejection lookup is cached; rebuild only when the trace identity changes.
    if (_windowTrace !== _cachedRejectionTrace) {
        _cachedRejectionMap = new Map();
        _cachedRejectionTrace = _windowTrace;
        if (_windowTrace) {
            const rejGroups = categorizeRejections(_windowTrace, injectedSet);
            for (const group of rejGroups) {
                for (const entry of group.entries) {
                    // BUG-AUDIT v2.5: trackerKey-shape lookup so cross-vault same-titles don't collide.
                    const rkey = `${entry.vaultSource || ''}:${(entry.title || '').toLowerCase()}`;
                    if (!_cachedRejectionMap.has(rkey)) {
                        _cachedRejectionMap.set(rkey, { label: group.label, icon: group.icon, reason: entry.reason });
                    }
                }
            }
        }
    }
    const rejectionMap = _cachedRejectionMap;
    const selectMode = !!ds.browseSelectMode;
    const selectedSet = ds.browseSelected instanceof Set ? ds.browseSelected : new Set();

    let html = '';
    for (let i = startIdx; i < endIdx; i++) {
        const row = rowModel[i];
        if (!row) continue;

        let top = i * BROWSE_ROW_HEIGHT;
        if (ds.browseExpandedIdx !== null && i > ds.browseExpandedIdx) {
            top += ds.browseExpandedExtraHeight;
        }

        if (row.type === 'header') {
            // Folder header row — collapsible, hosts "select all in folder" checkbox in select mode.
            const folder = row.folder;
            // Tri-state: all-selected, partial, none.
            let selCount = 0;
            let totalInFolder = 0;
            if (selectMode) {
                for (const e of ds.browseFilteredEntries) {
                    if (topFolderOf(e) !== folder) continue;
                    totalInFolder++;
                    if (selectedSet.has(trackerKey(e))) selCount++;
                }
            }
            const allSelected = selectMode && totalInFolder > 0 && selCount === totalInFolder;
            const someSelected = selectMode && selCount > 0 && selCount < totalInFolder;
            const selectorHtml = selectMode
                ? `<input type="checkbox" class="dle-browse-folder-select" data-folder="${escapeHtml(folder)}"${allSelected ? ' checked' : ''}${someSelected ? ' data-indeterminate="true"' : ''} aria-label="Select all entries in ${escapeHtml(folder)}" />`
                : '';
            const bandClass = (row.groupIndex % 2) ? ' dle-band-b' : ' dle-band-a';
            html += `<div class="dle-browse-folder-header${bandClass}" data-folder="${escapeHtml(folder)}" data-expanded="${row.expanded ? 'true' : 'false'}" role="button" tabindex="0" aria-expanded="${row.expanded ? 'true' : 'false'}" aria-label="${escapeHtml(folder)} (${row.count} entries) — ${row.expanded ? 'expanded' : 'collapsed'}, click to toggle" style="position:absolute;top:${top}px;left:0;right:0;height:${BROWSE_ROW_HEIGHT}px;">`;
            html += `${selectorHtml}<span class="dle-browse-folder-caret"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>`;
            // LOCAL PATCH 2026-08-03 (Miinthe): show the folder's OWN name, with its parent path
            // as dim context that gives way first. Grouping by full path (Patch 15q) meant
            // headers like "05 Aldric; Between Duty and Envy/base/Rings & Sins" — and a
            // plain ellipsis cuts the TAIL, which is the only part that differs. Six sibling
            // folders all rendered as "05 Aldric; Between Duty and Env…". The leaf now
            // has priority and the parent truncates instead.
            // f036: surface a unit-aware count (and the already-computed selection tally in
            // select mode) instead of a bare floating integer. Chip is tinted to echo the
            // checkbox tri-state when the folder is partly/fully selected.
            let countLabel;
            let countClass = '';
            if (selectMode && totalInFolder > 0) {
                countLabel = trf('dle_browse_folder_selected', selCount, totalInFolder);
                countClass = allSelected ? ' dle-browse-folder-count-all' : (someSelected ? ' dle-browse-folder-count-partial' : '');
            } else {
                countLabel = trPlural('dle_popup_entry_count', row.count);
            }
            {
                const cut = folder.lastIndexOf('/');
                const parentPath = cut > 0 ? folder.slice(0, cut) : '';
                const leafName = cut > 0 ? folder.slice(cut + 1) : folder;
                // Two stacked lines (Miinthe's layout, 2026-08-03): the parent path on top in the
                // dim tone, the folder's own name below with the entry count beside it. Both
                // lines live inside .dle-browse-folder-name so they share one flex column and
                // the count stays on the name's line rather than floating centred against two.
                // Row height is unchanged — BROWSE_ROW_HEIGHT is fixed at 38px for the virtual
                // scroller, and entry rows already stack two lines in it.
                html += `<span class="dle-browse-folder-name" title="${escapeHtml(folder)}">`
                    + (parentPath ? `<span class="dle-browse-folder-parent">${escapeHtml(parentPath)}/</span>` : '')
                    + '<span class="dle-browse-folder-leafrow">'
                    +     `<span class="dle-browse-folder-leaf">${escapeHtml(leafName)}</span>`
                    +     `<span class="dle-browse-folder-count${countClass}">${escapeHtml(countLabel)}</span>`
                    + '</span>'
                    + '</span>';
            }
            html += `</div>`;
            continue;
        }

        const e = row.entry;
        if (!e) continue;
        const tl = e.title.toLowerCase();
        const pbKey = `${e.vaultSource || ''}:${tl}`;
        const isPinned = pinSet.has(pbKey);
        const isBlocked = blockSet.has(pbKey);
        // BUG-AUDIT v2.5: injectedSet + rejectionMap keyed by trackerKey (vaultSource:title.toLowerCase()).
        const isInjected = injectedSet.has(pbKey);
        const trk = trackerKey(e);
        const isSelected = selectedSet.has(trk);

        // LOCAL PATCH 2026-08-03 (Miinthe): band entries with their folder so the left edge reads
        // as one block per folder and the boundary between folders is visible. Parity comes
        // from the row model's groupIndex, never the render loop — the list is virtualised.
        const classes = ['dle-browse-entry', (row.groupIndex % 2) ? 'dle-band-b' : 'dle-band-a'];
        if (isInjected) classes.push('dle-browse-injected');
        if (isSelected) classes.push('dle-browse-selected');

        // Dot-join (f035) so the muted keys run reads as a distinct tier below the title
        // rather than a comma list that visually blurs into it.
        const keysStr = e.constant ? '(constant)' : (e.keys ? e.keys.slice(0, 4).join(' · ') : '');
        const prioLabel = e.constant ? 'CONST' : `P${e.priority ?? 50}`;
        const prioClass = e.constant ? ' dle-browse-constant' : '';

        const statusParts = [];
        if (isInjected) statusParts.push('Injected');
        if (isPinned) statusParts.push('pinned');
        if (isBlocked) statusParts.push('blocked');
        if (e.constant) statusParts.push('constant');
        const browseAriaLabel = `${escapeHtml(e.title)}, ${prioLabel}${statusParts.length ? ', ' + statusParts.join(', ') : ''}`;

        const tempKey = trk;
        const temp = tempMap.get(tempKey);
        const tempStyle = temp && temp.hue !== 'neutral' ? `--dle-temp:${temp.tempScore.toFixed(2)};` : '';
        const tempClass = temp && temp.hue !== 'neutral' ? ` dle-temp-${temp.hue}` : '';

        const previewId = `dle-preview-${CSS.escape(trk)}`;
        html += `<div class="${classes.join(' ')}${tempClass}" data-title="${escapeHtml(e.title)}" data-vault="${escapeHtml(e.vaultSource || '')}" data-tracker="${escapeHtml(trk)}" data-idx="${i}" role="listitem" aria-label="${browseAriaLabel}" aria-controls="${previewId}" aria-setsize="${rowModel.length}" aria-posinset="${i + 1}" style="position:absolute;top:${top}px;left:0;right:0;height:${BROWSE_ROW_HEIGHT}px;${tempStyle}">`;
        if (selectMode) {
            html += `<input type="checkbox" class="dle-browse-row-select" data-tracker="${escapeHtml(trk)}"${isSelected ? ' checked' : ''} aria-label="Select ${escapeHtml(e.title)} for batch action" />`;
        }
        const _hoverParts = [];
        if (e.summary) _hoverParts.push(escapeHtml(e.summary));
        if (e.keys && e.keys.length) _hoverParts.push(`Keys: ${escapeHtml(e.keys.join(', '))}`);
        if (e.tokenEstimate) _hoverParts.push(`Tokens: ${e.tokenEstimate}`);
        const _hoverTitle = _hoverParts.length ? ` title="${_hoverParts.join('&#10;&#10;')}"` : '';
        html += `<div class="dle-browse-info" role="button" tabindex="0" aria-expanded="false" aria-label="Expand ${escapeHtml(e.title)} (Enter or click)" aria-describedby="${previewId}"${_hoverTitle}>`;
        html += `<span class="dle-browse-title">${escapeHtml(e.title)}${e.guide ? ' <span class="dle-browse-guide-pill" title="A note for Mero ☆ — she reads it; never sent to the writing AI. The lorebook-guide tag makes one.">☆ for Mero</span>' : ''}</span>`;
        // LOCAL PATCH 2026-08-03: show the entry's origin on the COLLAPSED row.
        // `character` (and `instance`) previously appeared only in the expanded preview, so
        // triaging a folder of unsorted entries meant opening each one to find out where it
        // belonged. Shown inline after the keys, dimmed, so it reads as provenance rather
        // than content. Only rendered when the entry actually carries the field, so entries
        // outside a character's plot look exactly as before.
        const _origin = [e.customFields?.character, e.customFields?.instance]
            .map(v => Array.isArray(v) ? v[0] : v)
            .filter(v => v != null && v !== '')
            .join(' · ');
        // Keys and origin share ONE line: .dle-browse-info is a flex column, so two separate
        // children would become a third line and overflow the fixed 38px row height that the
        // virtual scroller positions against.
        html += '<div class="dle-browse-subline">';
        html += `<span class="dle-browse-keys" aria-label="Keywords: ${escapeHtml(keysStr || 'none')}">${escapeHtml(keysStr)}</span>`;
        if (_origin) html += `<span class="dle-browse-origin" title="Origin — where this entry came from">${escapeHtml(_origin)}</span>`;
        html += '</div>';
        html += `</div>`;
        html += `<div class="dle-browse-controls">`;
        // Status indicators stay always-visible (they're readouts, not actions): why-not,
        // injection count, priority badge. f035-kebab: the pin/block/copy ACTIONS are folded
        // into a hover-reveal cluster fronted by a ⋮ kebab so the row is calm by default and
        // an active pin/block still "pins open" the cluster (see CSS .dle-pin-active marker).
        const rejection = !isInjected ? rejectionMap.get(pbKey) : null;
        if (rejection) {
            html += `<span class="dle-browse-why-not" title="${escapeHtml(rejection.label)}: ${escapeHtml(rejection.reason)}" aria-label="${escapeHtml(rejection.label)}"><i class="fa-solid ${escapeHtml(rejection.icon)}" aria-hidden="true"></i></span>`;
        }
        const browseCount = chatInjectionCounts.get(trk) || 0;
        if (browseCount > 0) html += `<span class="dle-inject-count" title="Injected ${browseCount} times this chat" aria-label="Injected ${browseCount} times this chat">${browseCount}×</span>`;
        html += `<span class="dle-browse-priority${prioClass}" title="${e.constant ? 'Constant — always injected. Set via #lorebook-always tag.' : `Priority ${e.priority ?? 50} (lower = more important)`}" aria-label="${e.constant ? 'Constant entry, always injected' : `Priority ${e.priority ?? 50}`}">${prioLabel}</span>`;
        // Persistent state (pin/block active) forces the action cluster to stay visible so the
        // user can always see/undo it without hovering — class on the row, read by CSS.
        const actionsPinnedOpen = isPinned || isBlocked;
        html += `<div class="dle-browse-actions${actionsPinnedOpen ? ' dle-actions-pinned-open' : ''}">`;
        html += `<button type="button" class="dle-browse-kebab" aria-label="Entry actions" aria-expanded="false" aria-haspopup="true" title="Entry actions"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>`;
        html += `<div class="dle-browse-actions-cluster">`;
        html += `<button type="button" class="dle-browse-pin${isPinned ? ' dle-pin-active' : ''}" data-entry="${escapeHtml(e.title)}" data-vault="${escapeHtml(e.vaultSource || '')}" aria-label="${isPinned ? 'Unpin' : 'Pin'}" title="${isPinned ? 'Pinned — always inject' : 'Click to pin'}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i></button>`;
        html += `<button type="button" class="dle-browse-block${isBlocked ? ' dle-block-active' : ''}" data-entry="${escapeHtml(e.title)}" data-vault="${escapeHtml(e.vaultSource || '')}" aria-label="${isBlocked ? 'Unblock' : 'Block'}" title="${isBlocked ? 'Blocked — never inject' : 'Click to block'}"><i class="fa-solid fa-ban" aria-hidden="true"></i></button>`;
        html += `<button type="button" class="dle-browse-copy-title-btn" data-action="copy-title" data-title="${escapeHtml(e.title)}" aria-label="Copy title" title="Copy title"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>`;
        // LOCAL PATCH 2026-08-03 (Miinthe): move-to-folder. Filing an entry into an instance
        // folder previously required Obsidian on the desktop; this makes it possible from
        // the panel, and therefore from a phone. Handler lives in drawer-events.js.
        // Icon: fa-file-export, not fa-folder-tree. The tree glyph has too much detail to read
        // at the 28px cluster size — it rendered as a grey block. file-export ("a page leaving")
        // is a single clear shape at small sizes and says move-this-file rather than browse.
        // data-file carries the vault-relative path. The handler resolves the entry by THAT,
        // not by title: duplicate titles inside one vault are legal (the health check calls
        // them an error, but they exist), and a title lookup would return whichever came
        // first — i.e. it could move a different file than the row you clicked.
        html += `<button type="button" class="dle-browse-move-btn" data-entry="${escapeHtml(e.title)}" data-vault="${escapeHtml(e.vaultSource || '')}" data-file="${escapeHtml(e.filename || '')}" aria-label="Move to another folder" title="Move to another folder"><i class="fa-solid fa-file-export" aria-hidden="true"></i></button>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
    }

    $list.html(html);

    // Folder-selector indeterminate state has to be set in JS (HTML attribute is not honored by checkbox).
    $list.find('.dle-browse-folder-select[data-indeterminate="true"]').each(function () { this.indeterminate = true; });

    // Re-expand previously-expanded entry across re-renders, reusing cached preview HTML.
    if (ds.browseExpandedEntry) {
        // P3-9 (gotcha #50): when a vaultSource companion is known (carto/why nav), scope the
        // row selector + entry lookup to that vault so a cross-vault same-title entry resolves
        // the RIGHT row. Rows carry data-vault. null companion → title-only (back-compat).
        const navVault = ds.browseExpandedVault;
        const titleSel = `.dle-browse-entry[data-title="${CSS.escape(ds.browseExpandedEntry)}"]`;
        const $entry = navVault != null
            ? ($list.find(`${titleSel}[data-vault="${CSS.escape(navVault)}"]`).first().length
                ? $list.find(`${titleSel}[data-vault="${CSS.escape(navVault)}"]`).first()
                : $list.find(titleSel).first())
            : $list.find(titleSel).first();
        if ($entry.length) {
            const entry = resolveNavTarget(ds.browseFilteredEntries, ds.browseExpandedEntry, navVault);
            if (entry) {
                // BUG-360: trackerKey (vaultSource:title) — bare title collides across vaults.
                const expandedKey = trackerKey(entry);
                if (_cachedExpandedPreviewKey !== expandedKey) {
                    const preview = entry.summary || (entry.content ? entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '') : 'No content');
                    const tokens = entry.tokenEstimate ? `${entry.tokenEstimate} tokens` : '';
                    const settings = getSettings();
                    const srcVault = entry.vaultSource && settings.vaults ? settings.vaults.find(v => v.name === entry.vaultSource) : null;
                    const vaultName = srcVault ? srcVault.name : (settings.vaults?.[0]?.name || '');
                    const uri = entry.filename ? buildObsidianURI(vaultName, entry.filename) : null;
                    const linkHtml = uri ? ` <a href="${escapeHtml(uri)}" class="dle-obsidian-link" target="_blank" rel="noopener noreferrer" aria-label="Open in Obsidian">Open in Obsidian</a>` : '';
                    let fieldsHtml = '';
                    if (entry.customFields && Object.keys(entry.customFields).length > 0) {
                        const pairs = Object.entries(entry.customFields)
                            .filter(([, v]) => v != null && v !== '' && (!Array.isArray(v) || v.length > 0))
                            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}`);
                        if (pairs.length) fieldsHtml = `<div class="dle-browse-fields">${pairs.join(' &middot; ')}</div>`;
                    }
                    let relatedHtml = '';
                    const related = [];
                    for (const link of entry.resolvedLinks || []) {
                        if (!related.includes(link)) related.push(link);
                    }
                    if (related.length < 5) {
                        const entryKeys = new Set((entry.keys || []).map(k => k.toLowerCase()));
                        if (entryKeys.size > 0) {
                            for (const other of vaultIndex) {
                                if (other.title === entry.title) continue;
                                if (related.includes(other.title)) continue;
                                const overlap = (other.keys || []).filter(k => entryKeys.has(k.toLowerCase())).length;
                                if (overlap > 0) related.push(other.title);
                                if (related.length >= 5) break;
                            }
                        }
                    }
                    if (related.length > 0) {
                        relatedHtml = `<div class="dle-browse-related"><span class="dle-muted">Related:</span> `;
                        for (const r of related.slice(0, 5)) {
                            relatedHtml += `<span class="dle-browse-related-chip dle-browse-nav-btn" data-browse-title="${escapeHtml(r)}" title="Show in Browse">${escapeHtml(r)}</span>`;
                        }
                        relatedHtml += `</div>`;
                    }
                    _cachedExpandedPreviewHtml = `<div class="dle-browse-preview" id="dle-preview-${CSS.escape(expandedKey)}"><div class="dle-browse-preview-text">${escapeHtml(preview)}</div>${fieldsHtml}${relatedHtml}<div class="dle-browse-preview-meta">${escapeHtml(tokens)}${linkHtml}</div></div>`;
                    _cachedExpandedPreviewKey = expandedKey;
                }

                $entry.append(_cachedExpandedPreviewHtml);
                $entry.find('.dle-browse-info').attr('aria-expanded', 'true');
                $entry.css({ height: 'auto' });
                const expandedHeight = $entry[0].scrollHeight;
                ds.browseExpandedIdx = parseInt($entry.data('idx'), 10);
                ds.browseExpandedExtraHeight = Math.max(0, expandedHeight - BROWSE_ROW_HEIGHT);
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Gating Tab
// ════════════════════════════════════════════════════════════════════════════

const asList = v => (Array.isArray(v) ? v : v ? [String(v)] : []);

export function renderGatingTab() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    // Wave F: skip painting into a hidden drawer; replayed on open (drawer.js toggle handler).
    if (!isDrawerVisible()) return;
    const ctx = chat_metadata?.deeplore_context;
    try { renderCharacterCard(); } catch (err) { console.warn('[DLE] character card failed:', err?.message || err); }

    // ── Folder filter section ──
    const activeFolders = chat_metadata?.deeplore_folder_filter || [];
    const $folderSection = $drawer.find('.dle-gating-folder-section');
    if ($folderSection.length) {
        const hasFolders = activeFolders.length > 0;
        $folderSection.find('.dle-folder-dot')
            .toggleClass('dle-gating-dot-active', hasFolders)
            .toggleClass('dle-gating-dot-empty', !hasFolders);
        const $chips = $folderSection.find('.dle-folder-chips');
        const $empty = $folderSection.find('.dle-folder-empty');
        if (hasFolders) {
            let chipsHtml = '';
            for (const f of activeFolders) {
                chipsHtml += `<span class="dle-chip" title="${escapeHtml(f)}">${escapeHtml(f)} <button type="button" class="dle-chip-x dle-folder-chip-x" data-folder="${escapeHtml(f)}" aria-label="Remove ${escapeHtml(f)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`;
            }
            const excluded = vaultIndex.filter(e => {
                if (!e.folderPath) return false;
                return !activeFolders.some(f => e.folderPath === f || e.folderPath.startsWith(f + '/'));
            }).length;
            if (excluded > 0) {
                chipsHtml += `<span class="dle-gating-count" title="${excluded} entries outside selected folders will be filtered out" aria-label="Excluding ${excluded} entries">excluding ${excluded}</span>`;
            }
            $chips.html(chipsHtml).show();
            $empty.hide();
        } else {
            $chips.empty().hide();
            $empty.show();
        }
    }

    const fieldDefs = fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS;

    const $container = $drawer.find('.dle-gating-fields-container');
    const enabledDefs = fieldDefs.filter(fd => fd.gating?.enabled);
    // LOCAL PATCH (Miinthe, 2026-10-03): fields no entry uses are tucked away unless asked for.
    const { visible: shownDefs, hidden: hiddenDefs } = splitGatingFields(enabledDefs, vaultIndex, ctx, !!ds.gatingShowAll);
    if ($container.length) {
        $container.empty();
        for (const fd of shownDefs) {
            const hasValue = ctx && (fd.multi
                ? asList(ctx[fd.contextKey]).length > 0
                : !!ctx[fd.contextKey]);
            const dotClass = hasValue ? 'dle-gating-dot-active' : 'dle-gating-dot-empty';
            const setIcon = fd.multi ? 'fa-plus-circle' : 'fa-pen-to-square';
            const setLabel = fd.multi ? `Add to ${escapeHtml(fd.label)}` : `Set ${escapeHtml(fd.label)}`;
            const fieldHtml = `<div class="dle-gating-group" data-field="${escapeHtml(fd.name)}"${fd.multi ? ' data-multi="true"' : ''}>
                <span class="dle-gating-dot ${dotClass}" aria-hidden="true"></span>
                <span class="dle-gating-label" id="dle-gating-${escapeHtml(fd.name)}" title="${escapeHtml(fd.label)}">${escapeHtml(fd.label)}</span>
                <div class="dle-gating-value" aria-labelledby="dle-gating-${escapeHtml(fd.name)}">
                    <button type="button" class="menu_button menu_button_icon dle-gating-set" title="${setLabel}" aria-label="${setLabel}">
                        <i class="fa-solid ${setIcon}" aria-hidden="true"></i>
                    </button>
                </div>
            </div>`;
            $container.append(fieldHtml);
        }
        const anySet = enabledDefs.some(fd => {
            if (!ctx) return false;
            return fd.multi
                ? asList(ctx[fd.contextKey]).length > 0
                : !!ctx[fd.contextKey];
        });
        // LOCAL PATCH (Miinthe, 2026-10-03): toggle for the fields no entry uses.
        if (hiddenDefs.length || ds.gatingShowAll) {
            const label = ds.gatingShowAll ? 'Hide unused fields' : `Show ${hiddenDefs.length} unused field${hiddenDefs.length === 1 ? '' : 's'}`;
            $container.append(`<button type="button" class="dle-gating-unused-toggle" title="Fields no entry in the vault uses">${label}</button>`);
        }
        $container.find('.dle-gating-hint').remove();
        if (!anySet && enabledDefs.length > 0) {
            $container.append('<div class="dle-gating-hint">Set gating fields to filter which lore entries are included. Set via slash command (<code>/oq-set-field</code>) or click the field below.</div>');
        }
    }

    // Precompute per-field exclusion counts in a SINGLE pass over vaultIndex instead of one
    // vaultIndex.filter() per field (O(fields×entries) → O(entries)). Only fields with an active
    // gating value contribute a count; the predicate per field is identical to the inline filters
    // below (non-multi: entry's value present but != active; multi: entry's value(s) set but no
    // overlap with the active selection). Keyed by fd.name → count of excluded entries.
    const excludedCounts = new Map();
    const activeFields = [];
    for (const fd of fieldDefs) {
        if (!fd.gating?.enabled) continue;
        // a multi field can hold a single value (set before it became multi): read it as a list of one (Miinthe's
        // test-user chat threw "value.map is not a function" here, 2026-10-18)
        const raw = ctx ? ctx[fd.contextKey] : null;
        const value = fd.multi ? asList(raw) : raw;
        if (fd.multi) {
            if (value && value.length > 0) {
                activeFields.push({ name: fd.name, multi: true, activeSet: new Set(value.map(c => c.toLowerCase())) });
                excludedCounts.set(fd.name, 0);
            }
        } else if (value) {
            activeFields.push({ name: fd.name, multi: false, valueLower: value.toLowerCase() });
            excludedCounts.set(fd.name, 0);
        }
    }
    if (activeFields.length > 0) {
        for (const e of vaultIndex) {
            const cf = e.customFields;
            if (!cf) continue;
            for (const af of activeFields) {
                const val = cf[af.name];
                if (!val || (Array.isArray(val) && val.length === 0)) continue;
                let excluded;
                if (af.multi) {
                    // entry has value(s) set but none overlap the active selection
                    excluded = Array.isArray(val)
                        ? !val.some(v => af.activeSet.has(v.toLowerCase()))
                        : !af.activeSet.has(String(val).toLowerCase());
                } else {
                    // entry has a value but it doesn't match the active value
                    excluded = Array.isArray(val)
                        ? !val.some(v => v.toLowerCase() === af.valueLower)
                        : String(val).toLowerCase() !== af.valueLower;
                }
                if (excluded) excludedCounts.set(af.name, excludedCounts.get(af.name) + 1);
            }
        }
    }

    for (const fd of fieldDefs) {
        if (!fd.gating?.enabled) continue;
        const $group = $drawer.find(`.dle-gating-group[data-field="${fd.name}"]`);
        const $value = $group.find('.dle-gating-value');
        const value = ctx ? (fd.multi ? asList(ctx[fd.contextKey]) : ctx[fd.contextKey]) : null;
        const $setBtn = $value.find('.dle-gating-set');

        $value.find('.dle-chip, .dle-gating-empty, .dle-gating-count, .dle-gating-clear-btn').remove();

        if (!fd.multi) {
            if (value) {
                $setBtn.before(`<span class="dle-chip">${escapeHtml(value)} <button type="button" class="dle-chip-x" data-field="${escapeHtml(fd.name)}" data-value="${escapeHtml(value)}" aria-label="Remove ${escapeHtml(value)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span><button class="dle-gating-clear-btn" type="button" data-action="clear-gating-field" data-field="${escapeHtml(fd.name)}" aria-label="Clear ${escapeHtml(fd.label)}">×</button>`);
                // Impact count: entries with this field set that don't match the active value (precomputed above).
                const filtered = excludedCounts.get(fd.name) || 0;
                if (filtered > 0) {
                    $setBtn.before(`<span class="dle-gating-count" aria-label="Excluding ${filtered} entries" title="${filtered} entries don't match this value and will be filtered out">excluding ${filtered}</span>`);
                }
            } else {
                $setBtn.before(`<span class="dle-gating-empty" aria-label="${escapeHtml(fd.label)}: not set">Not set — click + to filter</span>`);
            }
        } else {
            // Array (multi-value) field.
            if (value && value.length > 0) {
                for (const c of value) {
                    $setBtn.before(`<span class="dle-chip">${escapeHtml(c)} <button type="button" class="dle-chip-x" data-field="${escapeHtml(fd.name)}" data-value="${escapeHtml(c)}" aria-label="Remove ${escapeHtml(c)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`);
                }
                // Impact count: entries with this field set but no value-overlap with the active selection (precomputed above).
                const filtered = excludedCounts.get(fd.name) || 0;
                if (filtered > 0) {
                    $setBtn.before(`<span class="dle-gating-count" aria-label="Excluding ${filtered} entries" title="${filtered} entries don't match this value and will be filtered out">excluding ${filtered}</span>`);
                }
                $setBtn.before(`<button class="dle-gating-clear-btn" type="button" data-action="clear-gating-field-all" data-field="${escapeHtml(fd.name)}" aria-label="Clear all ${escapeHtml(fd.label)}">Clear all</button>`);
            } else {
                $setBtn.before(`<span class="dle-gating-empty" aria-label="${escapeHtml(fd.label)}: none set">None set — click + to add</span>`);
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Timers
// ════════════════════════════════════════════════════════════════════════════

export function renderTimers() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    const $list = $drawer.find('.dle-timer-list');
    const $empty = $drawer.find('.dle-timer-empty');
    const rows = [];
    const settings = getSettings();

    let timerIdx = 0;
    for (const [key, remaining] of cooldownTracker) {
        const name = key.includes(':') ? key.split(':').slice(1).join(':') : key;
        rows.push(`<div class="dle-timer-row" style="--i:${timerIdx++}" role="listitem">
            <span class="dle-timer-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="dle-timer-badge dle-timer-cooldown">${remaining} message${remaining !== 1 ? 's' : ''} cooldown</span>
        </div>`);
    }

    // Decay: only render entries past the boost threshold.
    if (settings.decayEnabled) {
        const boostThreshold = settings.decayBoostThreshold || 5;
        for (const [key, staleness] of decayTracker) {
            if (staleness >= boostThreshold) {
                const name = key.includes(':') ? key.split(':').slice(1).join(':') : key;
                rows.push(`<div class="dle-timer-row" style="--i:${timerIdx++}" role="listitem">
                    <span class="dle-timer-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    <span class="dle-timer-badge dle-timer-stale">stale ${staleness} message${staleness !== 1 ? 's' : ''}</span>
                </div>`);
            }
        }
    }

    // Warmup is static config (entry.warmup threshold), not an active timer — intentionally not surfaced here.

    $list.html(rows.join(''));
    $empty.toggleClass('dle-visible', rows.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Story Tab — LOCAL PATCH (Miinthe, 2026-10-02): story trackers
// ════════════════════════════════════════════════════════════════════════════

/**
 * One card per tracker: name, ◀ dots step (n/m) ▶, the step list (click to
 * jump), and edit/remove. Trackers only tell — nothing here filters lore.
 */
export function renderStoryTab() {
    const $drawer = ds.$drawer;
    if (!$drawer) return;
    if (!isDrawerVisible()) return;
    const $list = $drawer.find('.dle-story-list');
    if (!$list.length) return;
    const auto = autoTrackEnabled();
    $drawer.find('.dle-autotrack-toggle')
        .toggleClass('dle-autotrack-on', auto)
        .attr('aria-pressed', String(auto))
        .html(`<i class="fa-solid ${auto ? 'fa-wand-magic-sparkles' : 'fa-hand'}" aria-hidden="true"></i> ${auto ? 'Follows the story' : 'By hand only'}`);
    const list = getTrackers();
    // LOCAL PATCH (Miinthe, 2026-10-04): the board switched off for this chat / character — say so, offer it back (WIP look)
    const offFor = boardOffHere();
    if (offFor) {
        $list.html(`<div class="dle-tracker-aside-note dle-board-offbar"><b>The board is switched off for ${escapeHtml(offFor)}</b> — nothing of it runs here: no trackers watched or told, no helper calls. <button type="button" class="dle-board-on">Switch on</button></div>`);
        return;
    }
    const colsHtml = collectionsHtml();
    if (!list.length && !colsHtml) {
        $list.html('<div class="dle-story-empty dle-muted">No trackers in this chat yet. Press + to make one — for example <b>Relationship</b> with its stages, one per line.</div>');
        return;
    }
    $list.html(list.map(t => {
        const n = escapeHtml(t.name);
        const i = Math.min(Math.max(t.index, 0), t.steps.length - 1);
        const dots = t.steps.map((_, k) => (k <= i ? '●' : '○')).join('');
        // Storyboard conditions: a waiting or paused tracker is shown dimmed, with why.
        const st = stateOf(t, list);
        const quiet = st !== 'running';
        // LOCAL PATCH (Miinthe, 2026-10-04): paused / abandoned by Miinthe in this chat — and lines waiting on an abandoned tracker
        const abandonedSrc = (t.starts || []).map(c => list.find(x => x.id === c.tracker || x.name === c.tracker)).filter(x => x?.run === 'abandoned');
        const runNote = t.run === 'paused' ? `<div class="dle-tracker-aside-note"><b>Paused</b> in this chat — keeps its step; not watched, not told, its lore hidden. <button type="button" class="dle-run" data-name="${escapeHtml(t.name)}" data-act="continue">Continue</button>${t.lastRun?.action === 'pause' ? ` <button type="button" class="dle-run-undo" data-name="${escapeHtml(t.name)}">Undo</button>` : ''}</div>`
            : t.run === 'abandoned' ? `<div class="dle-tracker-aside-note"><b>Abandoned</b> in this chat — back at the start, switched off. <button type="button" class="dle-run" data-name="${escapeHtml(t.name)}" data-act="reactivate">Reactivate</button>${t.lastRun?.action === 'abandon' ? ` <button type="button" class="dle-run-undo" data-name="${escapeHtml(t.name)}">Undo</button>` : ''}</div>`
                : t.lastRun && ['continue', 'reactivate'].includes(t.lastRun.action) ? `<div class="dle-tracker-aside-note">${t.lastRun.action === 'continue' ? 'Running again' : 'Reactivated'} <button type="button" class="dle-run-undo" data-name="${escapeHtml(t.name)}">Undo</button></div>` : '';
        // engine on v2, step 7c: paused by a block or because another holds the floor — say which
        const byLine = st === 'paused' && t.pausedWhy && t.pausedWhy !== 'its start no longer holds' ? t.pausedWhy : null;
        const condNote = t.run ? runNote : byLine ? `<div class="dle-tracker-aside-note"><b>Paused</b> — ${escapeHtml(byLine)}. Not watched, not told to the AI, its lore hidden.</div>` : hasStarts(t) && quiet
            ? `<div class="dle-tracker-aside-note"><b>${st === 'waiting' ? 'Waiting' : 'Paused'}</b> — starts when ${escapeHtml(t.starts.map(c => conditionText(c, list)).join(' and '))}${abandonedSrc.length ? ` (waits on abandoned ${escapeHtml(abandonedSrc.map(x => x.name).join(', '))})` : ''}. Not watched, not told to the AI, its lore hidden.</div>`
            : runNote;
        // Forks (forks-pure.js): waiting at one → its ways as buttons; decided ones as a quiet line.
        const pend = pendingFork(t);
        const took = t.took && typeof t.took === 'object' ? Object.entries(t.took) : [];
        const forkNote = t.ended
            ? `<div class="dle-tracker-aside-note"><b>Ended</b> — ${escapeHtml(t.ended.branch)} (after ${escapeHtml(t.ended.step)}). Not watched any more; its entries stay on the board but aren't sent.</div>`
            : pend
                ? `<div class="dle-tracker-aside-note dle-tracker-fork"><b>Waits at the fork</b> after ${escapeHtml(pend.step)}${pend.fork.by === 'roll' ? ' — decided by a roll' : ' — the story decides, or pick:'} ${pend.fork.branches.map(b => `<button type="button" class="dle-tracker-branch" data-name="${n}" data-branch="${escapeHtml(b.name)}" title="Take “${escapeHtml(b.name)}” by hand">${escapeHtml(b.name)}</button>`).join(' ')}</div>`
                : took.length ? `<div class="dle-tracker-aside-note">${took.map(([s, b]) => `after ${escapeHtml(s)}: <b>${escapeHtml(b)}</b>`).join(' · ')}</div>` : '';
        const steps = t.steps.map((s, k) => `<button type="button" class="dle-tracker-step${k === i ? ' dle-tracker-step--current' : ''}" data-name="${n}" data-index="${k}" title="Jump to ${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('<span class="dle-tracker-sep" aria-hidden="true">·</span>');
        return `<div class="dle-tracker" data-name="${n}"${quiet ? ' style="opacity:.6"' : ''}>
            <div class="dle-tracker-head">
                <span class="dle-tracker-name">${n}</span>
                <span class="dle-tracker-tools">
                    <button type="button" class="dle-tracker-tool dle-tracker-direction" data-name="${n}" title="${t.direction === 'forward' ? 'Forward only: it never moves back by itself (you still can). Click for both directions.' : 'Both directions: it may also move back when the story plainly says so. Click for forward only.'}" aria-label="${n}: direction">${t.direction === 'forward' ? '→ forward' : '⇄ both'}</button>
                    <button type="button" class="dle-tracker-tool dle-tracker-aside" data-name="${n}" title="Set or clear a detour beside the step (e.g. Nuisance)" aria-label="${n}: detour"><i class="fa-solid fa-code-branch" aria-hidden="true"></i></button>
                    <button type="button" class="dle-tracker-tool dle-tracker-edit" data-name="${n}" title="Edit steps" aria-label="${n}: edit steps"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    ${t.run === 'abandoned' ? '' : `<button type="button" class="dle-tracker-tool dle-run" data-name="${n}" data-act="${t.run === 'paused' ? 'continue' : 'pause'}" title="${t.run === 'paused' ? 'Continue (this chat)' : 'Pause in this chat: keeps its step; not watched, not told, its lore hidden'}" aria-label="${n}: ${t.run === 'paused' ? 'continue' : 'pause'}"><i class="fa-solid ${t.run === 'paused' ? 'fa-play' : 'fa-pause'}" aria-hidden="true"></i></button>`}
                    <button type="button" class="dle-tracker-tool dle-run" data-name="${n}" data-act="${t.run === 'abandoned' ? 'reactivate' : 'abandon'}" title="${t.run === 'abandoned' ? 'Reactivate: on again from the start' : 'Abandon in this chat: back to the start, switched off (Undo works)'}" aria-label="${n}: ${t.run === 'abandoned' ? 'reactivate' : 'abandon'}"><i class="fa-solid ${t.run === 'abandoned' ? 'fa-rotate-left' : 'fa-ban'}" aria-hidden="true"></i></button>
                    <button type="button" class="dle-tracker-tool dle-tracker-remove" data-name="${n}" title="Remove tracker" aria-label="${n}: remove"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </span>
            </div>
            <div class="dle-tracker-main">
                <button type="button" class="menu_button menu_button_icon dle-tracker-move" data-name="${n}" data-delta="-1" title="One step back" aria-label="${n}: one step back"${i === 0 ? ' disabled' : ''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                <span class="dle-tracker-dots" aria-hidden="true">${dots}</span>
                <span class="dle-tracker-value">${escapeHtml(t.steps[i])}</span>
                <span class="dle-tracker-pos">${i + 1}/${t.steps.length}</span>
                <button type="button" class="menu_button menu_button_icon dle-tracker-move" data-name="${n}" data-delta="1" title="One step on" aria-label="${n}: one step on"${i === t.steps.length - 1 ? ' disabled' : ''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            </div>
            ${t.lastAuto ? `<div class="dle-tracker-auto-note" title="Moved by itself at message ${escapeHtml(String(t.lastAuto.message ?? ''))}"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> “${escapeHtml(t.lastAuto.quote || '')}”${t.lastAuto.reason ? ` <span style="opacity:.75">— ${escapeHtml(t.lastAuto.reason)}${t.lastAuto.confidence ? ` (${escapeHtml(t.lastAuto.confidence)})` : ''}</span>` : ''} <button type="button" class="dle-tracker-undo" data-name="${n}" title="Put it back where it was">Undo</button></div>` : ''}
            ${t.aside ? `<div class="dle-tracker-aside-note">currently: <b>${escapeHtml(t.aside)}</b> <button type="button" class="dle-tracker-aside-clear" data-name="${n}" title="Clear the detour">clear</button></div>` : ''}
            ${condNote}
            ${forkNote}
            <div class="dle-tracker-steps">${steps}</div>
        </div>`;
    }).join('') + colsHtml + (live() ? '<div class="dle-tracker-aside-note dle-board-offrow"><button type="button" class="dle-board-offbtn" title="Nothing of the board runs in this chat until you switch it on again (WIP — also in the board window: Switched off for)">Switch the board off for this chat</button></div>' : ''));
}

// LOCAL PATCH (Miinthe, 2026-10-05): the board's collections (items, money) — read-only here; change them on
// the board. The last automatic change keeps its Undo, like a tracker's.
function collectionsHtml() {
    let L = null;
    try { L = live(); } catch { return ''; }
    if (!L) return '';
    const cols = collectionsOf(L.board);
    const lastOf = id => (L.state.log || []).filter(e => e.col === id && e.who === 'auto').at(-1);
    // LOCAL PATCH (Miinthe, 2026-10-04): pause / continue / abandon / reactivate in this chat (WIP look)
    const runCtl = t => {
        const r = runOf(L.state, t), n = escapeHtml(t.name);
        const b = (act, icon, title) => `<button type="button" class="dle-tracker-tool dle-run" data-name="${n}" data-act="${act}" title="${title}" aria-label="${n}: ${act}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
        return `${r ? `<span class="dle-muted dle-text-xs">${r === 'paused' ? 'paused' : 'abandoned'} — not watched, not told</span>` : ''}<span class="dle-tracker-tools">${r === 'abandoned' ? '' : r === 'paused' ? b('continue', 'fa-play', 'Continue (this chat)') : b('pause', 'fa-pause', 'Pause in this chat: not watched, not told')}${r === 'abandoned' ? b('reactivate', 'fa-rotate-left', 'Reactivate: on again from the start') : b('abandon', 'fa-ban', 'Abandon in this chat: back to the start, switched off (Undo works)')}${L.state.lastRun?.id === t.id ? `<button type="button" class="dle-run-undo" data-name="${n}">Undo</button>` : ''}</span>`;
    };
    const lastHtml = last => (last ? `<div class="dle-tracker-auto-note"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> “${escapeHtml(last.quote || '')}”${last.reason ? ` <span style="opacity:.75">— ${escapeHtml(last.reason)}${last.confidence ? ` (${escapeHtml(last.confidence)})` : ''}</span>` : ''} <button type="button" class="dle-col-undo" data-log="${escapeHtml(last.id)}" title="Put it back as it was">Undo</button></div>` : '');
    // state: time, weather, the calendar (round 4)
    const states = stateTrackersOf(L.board).map(t => {
        const paused = runOf(L.state, t) != null, day = stateNow(L.state, t).day;
        const up = datesOf(t, L.state).filter(d => d.due >= day);
        return `<div class="dle-tracker dle-collection"${paused ? ' style="opacity:.6"' : ''}>
            <div class="dle-tracker-head"><button type="button" class="dle-tracker-name dle-col-open" data-col="${escapeHtml(t.id)}" title="Change it on the board">${escapeHtml(t.icon || '🌦️')} ${escapeHtml(t.name)}</button>${runCtl(t)}</div>
            <div class="dle-tracker-aside-note"><b>${escapeHtml(nowLine(t, L.state))}</b>${up.length ? `<br>coming up: ${up.map(d => `${d.by === 'ai' ? '✨' : '📅'} ${escapeHtml(d.name)} (${escapeHtml(dueText(d, day))})`).join(' · ')}` : ''}</div>
            ${lastHtml(lastOf(t.id))}
        </div>`;
    }).join('');
    // places: where the scene is (round 3)
    const places = states + placeTrackersOf(L.board).map(t => {
        const paused = runOf(L.state, t) != null;
        return `<div class="dle-tracker dle-collection"${paused ? ' style="opacity:.6"' : ''}>
            <div class="dle-tracker-head"><button type="button" class="dle-tracker-name dle-col-open" data-col="${escapeHtml(t.id)}" title="Change it on the board">${escapeHtml(t.icon || '📍')} ${escapeHtml(t.name)}</button>${runCtl(t)}</div>
            <div class="dle-tracker-aside-note">the scene is at <b>${escapeHtml(placeLabel(t, hereOf(L.state, t)))}</b>${t.setsLocation !== false && !paused ? ' <span class="dle-muted">· sets the location filter</span>' : ''}</div>
            ${lastHtml(lastOf(t.id))}
        </div>`;
    }).join('');
    if (!cols.length) return places;
    return places + cols.map(col => {
        const paused = runOf(L.state, col) != null;
        const groups = col.states.map((stt, k) => {
            const its = col.items.filter(it => itemState(L.state, col, it.id) === stt.id);
            if (!its.length) return '';
            const names = its.map(it => `${escapeHtml(it.name)}${col.amounts && itemAmount(L.state, col, it.id) > 1 ? ` ×${itemAmount(L.state, col, it.id)}` : ''}`).join(', ');
            return `<span${k === 0 ? ' class="dle-muted"' : ''}>${escapeHtml(stt.label)}: ${k === 0 ? names : `<b>${names}</b>`}</span>`;
        }).filter(Boolean);
        const money = (col.purse || []).map(p => { const v = purseValue(L.state, col, p.id); return `<b>${escapeHtml(p.before ? `${p.unit}${v}` : `${v} ${p.unit}`)}</b>`; });
        const lastNote = lastHtml(lastOf(col.id));
        // collections that grow: new things the story found, waiting for Miinthe's answer (board-grow.js)
        const finds = (L.state.collections?.[col.id]?.pending || []).map(f => `<div class="dle-tracker-auto-note dle-find">❓ <b>${escapeHtml(f.name)}</b> — found in the story: “${escapeHtml(f.q || '')}”${f.about ? ` <span style="opacity:.75">— ${escapeHtml(f.about)}</span>` : ''}
            <span class="dle-find-acts"><button type="button" class="dle-find-keep" data-col="${escapeHtml(col.id)}" data-pend="${escapeHtml(f.id)}" title="Add it to ${escapeHtml(col.name)}, with its entry">Keep it</button><button type="button" class="dle-find-drop" data-col="${escapeHtml(col.id)}" data-pend="${escapeHtml(f.id)}" title="Don't ask about it again in this chat">Not worth keeping</button></span></div>`).join('');
        return `<div class="dle-tracker dle-collection"${paused ? ' style="opacity:.6"' : ''}>
            <div class="dle-tracker-head"><button type="button" class="dle-tracker-name dle-col-open" data-col="${escapeHtml(col.id)}" title="Change it on the board">${escapeHtml(col.icon || '🗂️')} ${escapeHtml(col.name)}</button>${runCtl(col)}</div>
            <div class="dle-tracker-aside-note">${[...groups, ...money].join(' · ') || '<span class="dle-muted">nothing yet</span>'}</div>
            ${finds}${lastNote}
        </div>`;
    }).join('');
}


