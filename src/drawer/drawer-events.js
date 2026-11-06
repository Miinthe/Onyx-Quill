import { chat_metadata, saveSettingsDebounced, getCurrentChatId } from '../../../../../../script.js';
import { saveMetadataDebounced } from '../../../../../extensions.js';
import { accountStorage } from '../../../../../util/AccountStorage.js';
import { escapeHtml } from '../../../../../utils.js';
import { getSettings, invalidateSettingsCache } from '../../settings.js';
import {
    vaultIndex, indexTimestamp, indexEverLoaded,
    aiSearchStats,
    generationLock, indexing,
    notifyGatingChanged, notifyPinBlockChanged,
    fieldDefinitions, folderList,
    resetAiSearchCache,
    aiSearchCache, lastGenerationTrackerSnapshot,
    generationCount, chatEpoch,
    getWriterVisibleEntries,
    scribeInProgress,   // LOCAL PATCH 2026-08-04 (Miinthe): real signal for the scribe watchdog
} from '../state.js';
import { getCurrentForChat as getCurrentVerdictForChat } from '../verdict/verdict-store.js';

// Local helper — UI consumers must read the CURRENT CHAT's verdict, not the
// ring-global newest. See docs/gotchas.md #46 ("UI consumer rule").
function _currentVerdictForChat() {
    let cid = null;
    try { cid = getCurrentChatId() ?? null; } catch { cid = null; }
    return getCurrentVerdictForChat(cid);
}
import { DEFAULT_FIELD_DEFINITIONS } from '../fields.js';
import { normalizePinBlock, buildObsidianURI, openObsidianUri } from '../helpers.js';
import { buildIndex } from '../vault/vault.js';
import { openRuleBuilder } from '../ui/rule-builder.js';
import {
    ds, TAB_LABELS, TOOL_ACTIONS, EXPAND_ACTIONS, BROWSE_ROW_HEIGHT,
    scheduleRender, announceToScreenReader,
} from './drawer-state.js';
import { renderInjectionTab, renderBrowseTab, renderBrowseWindow, renderStatusZone, renderGatingTab } from './drawer-render.js';
import { resolveNavTarget, listTopFolders } from './drawer-browse-pure.js';
import { nextInstanceLetter, swapInstanceFolders } from './new-run-pure.js';
import { getTrackers, setTracker, moveTracker, removeTracker, setTrackerAside, saveTrackers, parseStepsText, describeNewRunReset, startTrackersForNewRun, currentBoardName } from '../trackers.js';
import { autoTrackEnabled, setAutoTrackEnabled, undoAutoMove } from '../autotrack.js';   // LOCAL PATCH (Miinthe): story trackers
import { dedupError, dedupWarning, notify } from '../toast-dedup.js';
import { tr, trf, trPlural } from '../i18n/i18n.js';

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Shortcut keys (d, Delete, Backspace) must not fire while the user is editing.
 * INPUT/TEXTAREA/SELECT alone misses contenteditable surfaces (rich-text notebook,
 * CKEditor) — those keys would stomp the drawer selection instead of the text.
 * @param {Element|null} el
 */
function _isSafeShortcutTarget(el) {
    if (!el) return true;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return false;
    if (el.isContentEditable) return false;
    // isContentEditable already covers inheritance; closest() check is belt-and-braces.
    try { if (el.closest && el.closest('[contenteditable="true"]')) return false; } catch { /* ignore selector errors */ }
    return true;
}

export function updateFilterActiveIndicators($drawer) {
    let active = 0;
    $drawer.find('.dle-browse-filter-select').each(function () {
        const $sel = $(this);
        const isDefault = $sel.val() === '' || $sel.val() === 'all';
        $sel.toggleClass('dle-filter-active', !isDefault);
        if (!isDefault) active++;
    });
    // LOCAL PATCH 2026-08-03 (Miinthe): the collapsed filter bar reports how many filters are on.
    // A filter you cannot see is exactly what left three chats injecting nothing for weeks
    // (the dead folder filters, repaired the same day), so collapsing this row must never
    // hide the fact that it is filtering.
    const $count = $drawer.find('.dle-filters-count');
    if ($count.length) {
        $count.text(active > 0 ? String(active) : '');
        $count.toggleClass('dle-filters-count-on', active > 0);
        $drawer.find('.dle-filters-toggle').attr('aria-label',
            active > 0 ? `Show or hide filters — ${active} active` : 'Show or hide filters');
    }
}

function executeCommand(cmd) {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
    if (ctx?.executeSlashCommands) {
        ctx.executeSlashCommands(cmd).catch(err => {
            console.error('[Onyx Quill] Command error:', cmd, err);
            dedupError('A drawer command failed. Check the browser console for details.', 'drawer_cmd_error');
        });
    } else {
        console.warn('[Onyx Quill] Cannot execute command — SillyTavern.getContext() unavailable');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Tab Switching
// ════════════════════════════════════════════════════════════════════════════

export function switchTab($drawer, tabName) {
    const $tabs = $drawer.find('.dle-tab');
    const $panels = $drawer.find('.dle-tab-panel');
    const $label = $drawer.find('.dle-tab-label');

    // Roving tabindex: only the active tab is in the tab order.
    // overhaul 2b (2026-10-15): Injection and Browse are one Lore tab — the Lore button stays lit for both
    const buttonFor = tabName === 'browse' ? 'injection' : tabName;
    $tabs.each(function () {
        const $t = $(this);
        const isActive = $t.data('tab') === buttonFor;
        $t.toggleClass('active', isActive)
            .attr('aria-selected', isActive ? 'true' : 'false')
            .attr('tabindex', isActive ? '0' : '-1');
    });

    $panels.each(function () {
        const $p = $(this);
        const isActive = $p.data('tab') === tabName;
        $p.toggleClass('active', isActive);
    });

    // Tab-name split fix: the active-tab label MIRRORS the active tab button's already-localized
    // .dle-tab-text (which ST's i18n MutationObserver translates via data-i18n). The old
    // TAB_LABELS[tabName] write was hardcoded English ("Why?") AND fought the observer that set the
    // label to "Injection" via its own data-i18n — a flip-flop. We removed that data-i18n from the
    // label in drawer.html so nothing fights this write. TAB_LABELS stays only as a last-resort
    // fallback if the active button or its text node isn't found.
    const activeTabText = $drawer.find('.dle-tab.active .dle-tab-text').text();
    $label.text(activeTabText || TAB_LABELS[tabName] || tabName);

    if (ds.browseScrollRAF) {
        cancelAnimationFrame(ds.browseScrollRAF);
        ds.browseScrollRAF = null;
    }

    if (tabName === 'browse') {
        ds.browseLastRangeStart = -1;
        ds.browseLastRangeEnd = -1;
        ds._browseLastScrollTop = undefined;
        // BUG-FIX-5: renderBrowseTab() populates ds.browseFilteredEntries; defer
        // renderBrowseWindow() via rAF until the panel's .active class has painted —
        // otherwise the visibility guard (!offsetParent && !offsetHeight) early-returns
        // on a still-hidden panel.
        renderBrowseTab();
        requestAnimationFrame(() => renderBrowseWindow());
    }

    // BUG-042: accountStorage syncs across browsers; localStorage fallback for migration grace period.
    try { accountStorage.setItem('dle-last-drawer-tab', tabName); } catch { /* noop */ }
}

// ════════════════════════════════════════════════════════════════════════════
// Wire Functions (one-time event binding)
// ════════════════════════════════════════════════════════════════════════════

// Onyx Quill starts switched off until setup is done, so the setup wizard and the
// World Info import must still open while it is off (the master-off gate skips them).
const SETUP_ACTIONS_WHILE_OFF = new Set(['setup', 'import-wi']);

export function wireToolsTab($drawer) {
    // BUG-354: Delegate from $drawer (not #dle-panel-tools) so binding survives container replacement.
    $drawer.on('click', '#dle-panel-tools .dle-tool-btn[data-action]', function () {
        const action = $(this).data('action');
        const cmd = TOOL_ACTIONS[action];
        if (!cmd) return;
        // BUG-359: gate on generation lock, indexing, or master-disabled.
        const settings = getSettings();
        if (!settings.enabled && !SETUP_ACTIONS_WHILE_OFF.has(action)) {
            toastr.warning(tr('dle_toast_disabled'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        if (generationLock) {
            toastr.warning(tr('dle_toast_gen_in_progress'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        if (indexing) {
            toastr.warning(tr('dle_toast_indexing'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        executeCommand(cmd);
    });

    $drawer.on('keydown', '#dle-panel-tools .dle-tool-btn[data-action]', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });
}

export function wireTabExpand($drawer) {
    $drawer.on('click', '[data-expand]', async function () {
        try {
            const target = $(this).data('expand');
            // Why tab "Full View" → Context Cartographer popup (no API call).
            if (target === 'injection') {
                const currentVerdict = _currentVerdictForChat();
                let sources = currentVerdict?.injectedSources?.length ? currentVerdict.injectedSources : null;
                let msgIdx = currentVerdict?.injectedSources?.length ? currentVerdict.msgIdx : null;
                // Verdict ring buffer can miss a turn after reload before hydrate finishes —
                // fall back to deeplore_sources on the last AI message for resume continuity.
                if (!sources || sources.length === 0) {
                    const { chat } = await import('../../../../../../script.js');
                    if (chat) {
                        for (let i = chat.length - 1; i >= 0; i--) {
                            if (!chat[i].is_user && chat[i].extra?.deeplore_sources?.length > 0) {
                                sources = chat[i].extra.deeplore_sources;
                                // messageId of the AI message === chat.length at gen start
                                // (see verdictMsgIdx in index.js onGenerate). Thread it so
                                // cartographer's diff anchors on the right verdict.
                                msgIdx = i;
                                break;
                            }
                        }
                    }
                }
                if (sources && sources.length > 0) {
                    const { showSourcesPopup } = await import('../ui/cartographer.js');
                    const _opts = {};
                    if (typeof msgIdx === 'number' && Number.isFinite(msgIdx)) _opts.msgIdx = msgIdx;
                    showSourcesPopup(sources, _opts);
                } else {
                    toastr.info(tr('dle_toast_no_sources'), 'Onyx Quill', { timeOut: 3000 });
                }
                return;
            }
            const cmd = EXPAND_ACTIONS[target];
            if (cmd) executeCommand(cmd);
        } catch (err) {
            console.error('[Onyx Quill] Tab expand error:', err);
            toastr.error(tr('dle_toast_expand_failed'), 'Onyx Quill');
        }
    });
}

export function wireStatusActions($drawer) {
    $drawer.on('click', '.dle-action-btn[data-action]', function () {
        const action = $(this).data('action');
        // V-M2 (2026-05-22): mirror wireToolsTab's indexing gate (L140-148).
        // 'refresh' itself triggers buildIndex and has its own ds.refreshing latch,
        // so let it through; everything else races the in-flight build commit (BUG-016
        // zombie-build territory) when indexing is true.
        if (action !== 'refresh' && indexing) {
            dedupWarning('Indexing in progress — try again in a moment.', 'index_busy');
            return;
        }
        switch (action) {
            // LOCAL PATCH 2026-08-03: start a new run in one action.
            //
            // A restart used to be three manual steps (set the instance letter, re-pick the
            // folders, start a chat) plus vault-side folder creation. The friction is that a
            // fresh SillyTavern chat carries NO DeepLore context and NO folder filter, so the
            // entire setup was re-entered by hand every time.
            //
            // This captures the current chat's setup, works out the next instance letter from
            // what already exists in the vault, SHOWS the result for confirmation, then opens
            // a new chat and writes the carried setup into it.
            //
            // The confirmation is not politeness: step 3 has to recognise which selected folder
            // is "the instance one", which means encoding a naming convention. Conventions
            // change — these did, twice, on 2026-08-02. A wrong guess applied silently is how
            // three chats ended up injecting nothing at all. So it always shows its work.
            case 'new-run': {
                // Async work in an IIFE: the shared dispatcher is a plain function, and
                // making it async to suit one case would change control flow for every
                // other action in the switch.
                (async () => {
                const ctx = chat_metadata?.deeplore_context || {};
                const rawInstance = ctx.instance;
                const current = String(Array.isArray(rawInstance) ? rawInstance[0] : (rawInstance || '')).trim();
                const character = String(Array.isArray(ctx.character) ? ctx.character[0] : (ctx.character || '')).trim();

                if (!character) {
                    dedupWarning('This chat has no Character set, so a new run has nothing to carry over. Set it in Filters first.', 'newrun_no_char');
                    return;
                }

                // Next letter: highest instance letter already present on THIS character's
                // entries, incremented. Reading the vault rather than assuming the current
                // chat is the latest — an older run reopened would otherwise regress the letter.
                const next = nextInstanceLetter(vaultIndex, character, current);
                if (!next) { dedupError('Ran out of instance letters (z reached).', 'newrun_letters'); return; }

                // Folder filter: keep everything, swapping any folder that looks like the
                // OLD run's instance folder for the equivalent one for the new letter. A
                // folder is only treated as instance-scoped when its leaf actually encodes
                // the current letter — never guessed from the word "instance" alone.
                const { folders: nextFolders, swapped } = swapInstanceFolders(
                    chat_metadata?.deeplore_folder_filter || [], current, next,
                );

                // LOCAL PATCH (Miinthe, 2026-10-02): story trackers start again at step 1 in a new run.
                const oldTrackers = getTrackers();
                const oldBoard = currentBoardName();   // LOCAL PATCH (Miinthe, 2026-10-03): the new run keeps its storyboard
                const trackerResets = describeNewRunReset(oldTrackers);

                const knownFolders = new Set((folderList || []).map(x => (typeof x === 'string' ? x : x?.path)).filter(Boolean));
                const missing = nextFolders.filter(f => !knownFolders.has(f));

                const { callGenericPopup: pop, POPUP_TYPE: PT } = await import('../../../../../popup.js');
                const ok = await pop(
                    `<h3>Start a new run?</h3>
                     <p><b>${escapeHtml(character)}</b></p>
                     <p>Run <b>${escapeHtml((current || '–').toUpperCase())}</b> → <b>${escapeHtml(next.toUpperCase())}</b></p>
                     ${swapped.length ? `<p style="opacity:.8">Folder changes:</p><pre style="white-space:pre-wrap;font-size:.85em;opacity:.8">${escapeHtml(swapped.map(x => `${x.from}  →  ${x.to}`).join('\n'))}</pre>` : '<p style="opacity:.7">No folder in the filter encodes the run letter — folders carry over unchanged.</p>'}
                     ${missing.length ? `<p style="opacity:.8">These don't exist yet and will be created on first write:</p><pre style="white-space:pre-wrap;font-size:.85em;opacity:.8">${escapeHtml(missing.join('\n'))}</pre>` : ''}
                     ${trackerResets.length ? `<p style="opacity:.8">Story trackers start again at step 1:</p><pre style="white-space:pre-wrap;font-size:.85em;opacity:.8">${escapeHtml(trackerResets.join('\n'))}</pre>` : ''}
                     <p style="opacity:.7;font-size:.9em;margin-top:1em">A new SillyTavern chat will be opened and this setup written into it. The current chat is kept.</p>`,
                    PT.CONFIRM, '', { okButton: 'Start run ' + next.toUpperCase(), cancelButton: 'Cancel' },
                );
                if (!ok) return;

                try {
                    const { doNewChat } = await import('../../../../../../script.js');
                    await doNewChat({ deleteCurrentChat: false });
                    // chat_metadata is a live binding — after doNewChat it points at the new chat.
                    const carried = { ...ctx, instance: [next] };
                    chat_metadata.deeplore_context = carried;
                    startTrackersForNewRun(oldTrackers, oldBoard);
                    if (nextFolders.length) chat_metadata.deeplore_folder_filter = nextFolders;
                    saveMetadataDebounced();
                    notifyGatingChanged();
                    toastr.success(`Run ${next.toUpperCase()} open — the setup and folders carried over.`, 'Onyx Quill', { timeOut: 6000 });
                    announceToScreenReader(`New run ${next} started`);
                } catch (err) {
                    console.error('[Onyx Quill] New run failed:', err);
                    notify.error('Could not start the new run: ' + (err?.message || err), { copyable: true });
                }
                })();
                break;
            }
            case 'refresh': {
                if (ds.refreshing) return;
                ds.refreshing = true;
                const $refreshBtn = $(this);
                // Wave I: hide the sync glyph, show a goo-spinner during the refresh.
                $refreshBtn.prop('disabled', true).find('i').hide();
                $refreshBtn.append('<goo-spinner class="dle-btn-goo" size="22" color="currentColor" aria-hidden="true"></goo-spinner>');
                buildIndex().catch(err => {
                    // Manual refresh is user-initiated; surface failure rather than silently letting the status bar stay stale.
                    console.warn('[Onyx Quill] Manual refresh failed:', err?.message);
                    try {
                        toastr.error(
                            trf('dle_toast_refresh_failed', err?.message || 'unknown error'),
                            'Onyx Quill',
                            { timeOut: 10000 },
                        );
                    } catch { /* toastr unavailable */ }
                }).finally(() => {
                    ds.refreshing = false;
                    $refreshBtn.prop('disabled', false).find('.dle-btn-goo').remove();
                    $refreshBtn.find('i').show();
                });
                break;
            }
            case 'scribe': {
                if (generationLock) { toastr.warning(tr('dle_toast_generation_running'), 'Onyx Quill', { timeOut: 2000 }); return; }
                const $scribeBtn = $(this);
                // Wave I carve-out (NOT an oversight): scribe deliberately keeps fa-spin on its OWN
                // feather glyph rather than the hide-icon + goo-spinner pattern the refresh button
                // uses above. /oq-scribe is fire-and-forget (executeCommand swallows the promise and
                // its resolution doesn't map to scribe completion), so the only re-enable signal is the
                // 15s timeout below — converting to a goo would risk an orphaned spinner. See gotcha #87.
                $scribeBtn.prop('disabled', true).find('i').addClass('fa-spin');
                // LOCAL PATCH 2026-08-04 (Miinthe): the upstream watchdog was a blind 15s timer — it
                // warned "Scribe still running or did not return" on EVERY run slower than 15
                // seconds, which is every real run (the scribe's own budget is 60s by default).
                // The note was written; the toast simply wasn't watching anything. Poll the real
                // scribeInProgress flag instead: end silently when the run actually ends, and warn
                // only when the scribe never started. Genuine failures are already reported by
                // runScribe's own toasts, so this must stay quiet on the completion path.
                const _scribeClickedAt = Date.now();
                let _scribeSeenRunning = false;
                const _scribeWatch = setInterval(() => {
                    if (scribeInProgress) { _scribeSeenRunning = true; return; }
                    // /oq-scribe dispatches asynchronously, so the flag is not set the instant the
                    // button is clicked — allow a grace window before calling it a no-show.
                    if (!_scribeSeenRunning && Date.now() - _scribeClickedAt < 10000) return;
                    clearInterval(_scribeWatch);
                    $scribeBtn.prop('disabled', false).find('i').removeClass('fa-spin');
                    if (!_scribeSeenRunning) {
                        toastr.warning(tr('dle_toast_scribe_timeout'), 'Onyx Quill', { timeOut: 4000 });
                        announceToScreenReader('Scribe did not start.');
                    }
                }, 500);
                // Backstop: never leave the poller running if the flag somehow sticks.
                setTimeout(() => {
                    clearInterval(_scribeWatch);
                    $scribeBtn.prop('disabled', false).find('i').removeClass('fa-spin');
                }, 600000);
                executeCommand('/oq-scribe');
                break;
            }
            case 'newlore': executeCommand('/oq-newlore'); break;
            case 'graph': executeCommand('/oq-graph'); break;
            case 'clear-picks': {
                if (generationLock) {
                    toastr.warning(tr('dle_toast_gen_in_progress_picks'), 'Onyx Quill', { timeOut: 2500 });
                    return;
                }
                const settings = getSettings();
                if (settings.debugMode) {
                    const snap = lastGenerationTrackerSnapshot;
                    const log = chat_metadata.deeplore_injection_log;
                    console.debug('[Onyx Quill][DIAG] clear-picks-start', {
                        aiCache: {
                            hashEmpty: !aiSearchCache.hash,
                            manifestHashEmpty: !aiSearchCache.manifestHash,
                            resultCount: aiSearchCache.results?.length ?? 0,
                            resultTitles: aiSearchCache.results?.map(r => r.title) ?? [],
                        },
                        injectionLog: {
                            exists: !!log,
                            length: log?.length ?? 0,
                            entries: log?.map(e => ({ gen: e.gen, titles: e.entries?.map(x => x.title) })) ?? [],
                        },
                        snapshot: snap ? {
                            swipeKey: snap.swipeKey,
                            generationCount: snap.generationCount,
                            cooldownSize: snap.cooldown?.size ?? 0,
                            decaySize: snap.decay?.size ?? 0,
                            consecutiveSize: snap.consecutive?.size ?? 0,
                            historySize: snap.injectionHistory?.size ?? 0,
                        } : null,
                        verdictInjected: _currentVerdictForChat()?.injectedSources?.length ?? 0,
                        generationCount,
                        chatEpoch,
                    });
                }
                resetAiSearchCache();
                // BUG-396: clear injection log too, so strip-dedup doesn't remove entries that were in deleted/regenerated messages.
                if (chat_metadata.deeplore_injection_log) {
                    chat_metadata.deeplore_injection_log = [];
                    saveMetadataDebounced();
                }
                if (settings.debugMode) {
                    console.debug('[Onyx Quill][DIAG] clear-picks-done', {
                        logAfterClear: chat_metadata.deeplore_injection_log,
                        cacheAfterClear: { hashEmpty: !aiSearchCache.hash, resultCount: aiSearchCache.results?.length ?? 0 },
                    });
                }
                announceToScreenReader('Search cache cleared — next generation will re-select lore.');
                toastr.info(tr('dle_toast_cache_cleared'), 'Onyx Quill');
                break;
            }
        }
    });

    $drawer.on('keydown', '.dle-action-btn[data-action]', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    // Top status (dot + pipeline label) → /oq-status. Mirrors footer health icons.
    $drawer.on('click keydown', '.dle-clickable-status', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        if (e.type === 'keydown') e.preventDefault();
        executeCommand('/oq-status');
    });

    // Browse search help icon toggles the syntax popover beside it.
    $drawer.on('click', '.dle-browse-search-help', function (e) {
        e.preventDefault();
        const $popover = $drawer.find('.dle-browse-search-help-popover');
        if (!$popover.length) return;
        const wasOpen = $popover.prop('open');
        $popover.prop('open', !wasOpen);
    });

    $drawer.on('click', '.dle-setup-banner-btn', async () => {
        try {
            const { showSetupWizard, getWizardResumeStep } = await import('../ui/setup-wizard.js');
            // Resume where a "Finish later" skip left off (returns 1 for fresh/completed).
            showSetupWizard(getWizardResumeStep());
        } catch (err) {
            console.error('[Onyx Quill] Setup wizard error:', err);
            toastr.error('Failed to open setup wizard.', 'Onyx Quill');
        }
    });
    $drawer.on('click', '.dle-setup-banner-dismiss', () => {
        $drawer.find('.dle-setup-banner').remove();
        const s = getSettings();
        s._wizardCompleted = true;
        invalidateSettingsCache();
        saveSettingsDebounced();
    });
}

export function wireInjectionTab($drawer) {
    $drawer.on('click', '.dle-why-filter-btn', function () {
        ds.whyTabFilter = $(this).data('filter') || 'both';
        // Flip aria-checked AND the roving tabindex together so the checked radio and the
        // single tab stop never diverge between this click and the deferred render (f104).
        $drawer.find('.dle-why-filter-btn').attr('aria-checked', 'false').attr('tabindex', '-1');
        $(this).attr('aria-checked', 'true').attr('tabindex', '0');
        try { accountStorage.setItem('dle-why-filter', ds.whyTabFilter); } catch { /* noop */ }
        scheduleRender(renderInjectionTab);
    });

    // BUG-AUDIT-C11: roving tabindex for Why? filter radiogroup.
    // Wave G: full ARIA radiogroup keys — Up/Left = prev, Down/Right = next (Enter/Space
    // select natively via the <button>). Enter is also handled explicitly (legacy; idempotent
    // for a radio).
    $drawer.on('keydown', '.dle-why-filter-btn', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $(this).trigger('click'); return; }
        const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (!fwd && !back) return;
        e.preventDefault();
        const $btns = $drawer.find('.dle-why-filter-btn');
        const idx = $btns.index(this);
        const next = fwd ? (idx + 1) % $btns.length : (idx - 1 + $btns.length) % $btns.length;
        $btns.eq(next).trigger('click').focus();
    });

    $drawer.on('click', '.dle-copy-titles-btn', function () {
        const $btn = $(this);
        const sources = _currentVerdictForChat()?.injectedSources ?? null;
        if (!sources || sources.length === 0) {
            toastr.warning(tr('dle_toast_no_entries_copy'), 'Onyx Quill', { timeOut: 2000 });
            return;
        }
        const n = sources.length;
        const titles = sources.map(s => s.title).join('\n');
        navigator.clipboard.writeText(titles).then(
            () => { toastr.success(trPlural('dle_toast_titles_copied', n), 'Onyx Quill', { timeOut: 2000 }); $btn.focus(); },
            () => toastr.warning(tr('dle_toast_clipboard_denied'), 'Onyx Quill', { timeOut: 3000 }),
        );
    });

    // Wave C: stage-aware Fix-It pin on a "Filtered Out" row. Pin-only (no toggle) — its job is to
    // force the entry back in next generation. Mirrors the browse-row pin handler: stores a
    // {title, vaultSource} object (trackerKey-correct), drops any matching block (mutually
    // exclusive), saves + notifies, toasts via the canonical pinned key. The override takes effect
    // on the NEXT generation, so we mark the button active for instant feedback here.
    $drawer.on('click', '.dle-why-fixit', function () {
        const title = $(this).data('title');
        const vaultSource = $(this).data('vault') || null;
        if (!title || !chat_metadata) return;

        if (!chat_metadata.deeplore_pins) chat_metadata.deeplore_pins = [];
        const tl = String(title).toLowerCase();
        const already = chat_metadata.deeplore_pins.some(p => {
            const n = normalizePinBlock(p);
            return n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null);
        });
        if (!already) {
            chat_metadata.deeplore_pins.push({ title, vaultSource });
        }
        // Pin → remove from blocks (mutually exclusive), same as the browse-row pin.
        if (chat_metadata.deeplore_blocks) {
            chat_metadata.deeplore_blocks = chat_metadata.deeplore_blocks.filter(b => {
                const n = normalizePinBlock(b);
                return !(n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null));
            });
        }
        $(this).addClass('dle-why-fixit-active').attr('aria-pressed', 'true');
        announceToScreenReader(`Pinned ${title}`);
        toastr.info(trf('dle_toast_entry_pinned', title), 'Onyx Quill', { timeOut: 2000 });
        saveMetadataDebounced();
        notifyPinBlockChanged();
    });

    $drawer.on('keydown', '.dle-why-fixit', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });
}

/**
 * LOCAL PATCH 2026-08-03 (Miinthe) — moving one entry into another folder: the folder picker, her confirmation, then
 * moveEntryToFolder()'s copy → verify → delete. Shared by Browse's per-entry Move and (overhaul 2a, 2026-10-15) the
 * bar's 📖 → Move an entry….
 */
export async function moveEntryFlow(entry, { entries } = {}) {
    if (generationLock) {
        toastr.warning('A message is generating — wait for it to finish before moving entries.', 'Onyx Quill');
        return;
    }
    // overhaul (2026-10-15, Lore → All entries → Select): several entries go through ONE folder pick, then each is
    // moved with the same copy → verify → delete; the index is rebuilt once at the end.
    const moving = Array.isArray(entries) && entries.length ? entries : [entry];
    entry = moving[0];
    const sameFolder = moving.every(e => (e.folderPath || '') === (entry.folderPath || ''));
    const currentFolder = sameFolder ? (entry.folderPath || '') : '';
    // state.folderList is [{ path, entryCount }], not bare strings — the string form is
    // tolerated too so this doesn't silently produce an empty picker if that ever changes.
    // It is ALSO derived from entry paths, so it cannot see a folder that holds no
    // entries — and an empty folder is very often exactly the destination you want
    // ("00 Inbox/Review" existed and was unreachable). Ask the vault for the real folder
    // tree and union the two: the live listing supplies empty folders, folderList
    // supplies the counts and remains the fallback if the vault can't be reached.
    const counts = new Map(
        (folderList || []).map(f => (typeof f === 'string' ? [f, null] : [f?.path, f?.entryCount ?? null]))
            .filter(([p]) => p),
    );
    const known = new Set(counts.keys());
    try {
        const { listAllFolders } = await import('../vault/obsidian-api.js');
        const { getVaultByName } = await import('../../settings.js');
        const v = getVaultByName(getSettings(), entry.vaultSource);
        const live = await listAllFolders(v.host, v.port, v.apiKey, '', 0, !!v.https);
        for (const f of live) known.add(f);
    } catch (err) {
        console.warn('[Onyx Quill] Could not list vault folders; falling back to indexed folders only:', err);
    }
    const folders = [...known].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const options = folders.filter(f => f !== currentFolder);
    if (options.length === 0) {
        toastr.info('No other folders to move this into.', 'Onyx Quill');
        return;
    }

    const { callGenericPopup, POPUP_TYPE } = await import('../../../../../popup.js');

    // LOCAL PATCH 2026-08-03b (Miinthe): searchable tree picker, replacing a flat <select>.
    // 95 folders in one ungrouped list is a scroll, not a choice — and ~60 of them are
    // Dragon subfolders that are almost never the destination. Same shape as the Patch 5
    // filter picker: search matches the folder's OWN name (so "instance" doesn't drag in
    // every child of a matching parent), children are indented under a dimmed parent path,
    // and the sort is numeric so "10 …" lands after "2 …".
    // The folders this chat is actually filtered to, starred and hoisted to the top —
    // they are overwhelmingly the likely destination, and scrolling past 90 others to
    // reach one you already told DeepLore you care about is silly. Prefix-bounded, the
    // same rule applyFolderFilter uses, so selecting "02 Regency" also stars its
    // base/dark/historical/modern children — those are the folders in play.
    const chatFolders = chat_metadata?.deeplore_folder_filter || [];
    const isChatFolder = (f) => chatFolders.some(sel => f === sel || f.startsWith(sel + '/'));

    // One row = one line, one type size. The earlier version drew a depth indent AND the
    // full parent path AND two font sizes at once, which read as ragged — the same
    // information three ways. Now: the tree indent carries the hierarchy, the leaf name
    // carries the identity, and the count sits right-aligned. The parent path is added
    // ONLY while searching (see onSearch), because a filtered list has no tree left to
    // read the hierarchy from — the same rule Patch 5 settled on for the filter picker.
    const rowHtml = (f, flat, section) => {
        const depth = f.split('/').length - 1;
        const leaf = f.slice(f.lastIndexOf('/') + 1);
        const parent = depth > 0 ? f.slice(0, f.lastIndexOf('/')) : '';
        const n = counts.get(f);
        const countLabel = n == null ? 'empty' : `${n}`;
        // Recent/starred rows are lifted out of the tree, so a depth indent is meaningless
        // there — and they show their parent path always, since they have no tree context.
        // Indent caps at 3 levels. Dragon nests 4 deep, and on a narrow screen an
        // uncapped indent eats the label width and pushes the name off the side.
        const pad = flat ? 10 : 10 + Math.min(depth, 3) * 16;
        const marker = section === 'recent' ? '<i class="fa-solid fa-clock-rotate-left dle-move-marker" aria-hidden="true"></i> '
            : section === 'star' ? '<span class="dle-move-marker" aria-hidden="true">★</span> ' : '';
        // Two controls per row, so they live in a wrapper rather than nesting buttons
        // (nested <button> is invalid HTML and behaves unpredictably). Search toggles the
        // WRAPPER, not the option button.
        // Styling lives in style.css (.dle-move-*), NOT inline. Inline styles cannot answer
        // a media query, and on a phone the fixed paddings plus width:100% without an
        // explicit box-sizing overflowed the popup — which is what made the fields slide
        // around horizontally. Only the depth indent stays inline, because it is data.
        return `<div class="dle-move-row">
                    <button type="button" class="dle-move-opt" data-folder="${escapeHtml(f)}" data-section="${escapeHtml(section)}" data-flat="${flat ? '1' : ''}" data-parent="${escapeHtml(parent)}" role="option" aria-selected="false" style="padding-left:${pad}px">
                        <span class="dle-move-label">${marker}<span class="dle-move-ctx">${flat && parent ? escapeHtml(parent) + '/' : ''}</span>${escapeHtml(leaf)}</span>
                        <span class="dle-move-count">${countLabel}</span>
                    </button>
                    <button type="button" class="dle-move-into" data-folder="${escapeHtml(f)}" title="Put a subfolder of this one in the box" aria-label="Type a subfolder of ${escapeHtml(leaf)}">
                        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                    </button>
                </div>`;
    };
    const headerHtml = (id, text) => `<div class="dle-move-head" data-head="${id}">${escapeHtml(text)}</div>`;

    // Recently-used destinations, newest first. accountStorage syncs across browsers, so a
    // path typed once on the desktop is tappable on the phone afterwards — which is the
    // whole point: an empty folder can never be listed (Obsidian doesn't report it), so
    // without this it would have to be re-typed on every device, every time.
    // Kept even when the folder isn't in the listing: a remembered destination is still a
    // valid one, and writing to it recreates it.
    let recent = [];
    try { recent = JSON.parse(accountStorage.getItem('dle-move-recent') || '[]'); } catch { recent = []; }
    recent = (Array.isArray(recent) ? recent : []).filter(f => typeof f === 'string' && f && f !== currentFolder).slice(0, 6);

    const recentSet = new Set(recent);
    const starred = options.filter(f => isChatFolder(f) && !recentSet.has(f));
    const rest = options.filter(f => !isChatFolder(f) && !recentSet.has(f));
    const listHtml =
        (recent.length ? headerHtml('recent', `Recent (${recent.length})`) + recent.map(f => rowHtml(f, true, 'recent')).join('') : '')
        + (starred.length ? headerHtml('star', `★ This chat's folders (${starred.length})`) + starred.map(f => rowHtml(f, true, 'star')).join('') : '')
        + (rest.length ? headerHtml('all', (recent.length || starred.length) ? 'All folders' : 'Folders') + rest.map(f => rowHtml(f, false, 'all')).join('') : '');

    // Selection is held here, NOT read out of the DOM after the popup resolves — the
    // popup's markup is torn down on close, so reading it afterwards is a race.
    let picked = '';

    const knownSet = new Set(folders);

    // "Into this folder" — drops "<folder>/" into the search box and focuses it, so a
    // subfolder that no listing can show (Obsidian never reports an empty folder) costs
    // one tap plus the leaf name, instead of typing the whole path on a phone keyboard.
    const onInto = (ev) => {
        const btn = ev.target.closest?.('.dle-move-into');
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        const box = document.getElementById('dle-move-search');
        if (!box) return;
        box.value = (btn.dataset.folder || '') + '/';
        box.focus();
        try { box.setSelectionRange(box.value.length, box.value.length); } catch { /* type=search may refuse */ }
        box.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Single place that owns "what is selected" — highlight, aria state and the summary
    // line all move together. Passing null clears the selection entirely.
    const select = (btn) => {
        picked = btn ? (btn.dataset.folder || '') : '';
        document.querySelectorAll('#dle-move-picker .dle-move-opt, #dle-move-create').forEach((b) => {
            const on = !!btn && b === btn;
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.style.background = on ? 'var(--dle-bg-hover, rgba(255,255,255,.12))' : 'none';
        });
        const $c = document.getElementById('dle-move-chosen');
        if ($c) $c.textContent = picked || 'nothing selected';
    };

    const onPick = (ev) => {
        if (ev.target.closest?.('.dle-move-into')) return; // handled by onInto
        const btn = ev.target.closest?.('.dle-move-opt, #dle-move-create');
        if (!btn || !btn.dataset.folder) return;
        ev.preventDefault();
        select(btn);
    };
    const onSearch = (ev) => {
        if (ev.target?.id !== 'dle-move-search') return;
        const q = String(ev.target.value || '').trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('#dle-move-picker .dle-move-opt').forEach((b) => {
            const f = b.dataset.folder || '';
            const leaf = f.slice(f.lastIndexOf('/') + 1).toLowerCase();
            // Match the folder's OWN name only — never the full path. Same rule as the
            // Patch 5 filter picker, and for the same reason: with a full-path fallback,
            // "corvin" returned 73 of 98 folders because every Dragon subfolder sits
            // under "04 Corvin; …". Leaf-only returns the four folders actually named
            // after him, which is what you meant when you typed it.
            const hit = !q || leaf.includes(q);
            // Toggle the row WRAPPER so the chevron hides with its label.
            const row = b.closest('.dle-move-row') || b;
            row.style.display = hit ? 'flex' : 'none';
            if (hit) shown++;
            // While searching the tree is broken up, so a bare leaf name is ambiguous
            // ("base" appears under five different parents). Show the parent path only
            // then, and flatten the indent so rows line up instead of stair-stepping
            // against a hierarchy that is no longer visible.
            const flat = b.dataset.flat === '1';
            const ctx = b.querySelector('.dle-move-ctx');
            // Flat sections (Recent / starred) always carry their parent path — they have
            // no tree around them. Tree rows gain it only while a search is filtering.
            if (ctx) ctx.textContent = (flat || q) && b.dataset.parent ? b.dataset.parent + '/' : '';
            const depth = (b.dataset.folder || '').split('/').length - 1;
            b.style.paddingLeft = (q || flat) ? '10px' : `${10 + Math.min(depth, 3) * 16}px`;
        });
        // Hide a section heading once the search has emptied it — a "★ This chat's
        // folders" label with nothing under it reads as a bug.
        document.querySelectorAll('#dle-move-picker .dle-move-head').forEach((h) => {
            const sec = h.dataset.head;
            // Read the WRAPPER's display — the option button's own display stays 'flex';
            // it is the row that gets hidden.
            const any = [...document.querySelectorAll(`#dle-move-picker .dle-move-opt[data-section="${sec}"]`)]
                .some(b => (b.closest('.dle-move-row') || b).style.display !== 'none');
            h.style.display = any ? 'block' : 'none';
        });
        // Typed-path escape hatch. Obsidian's REST API does not report folders that
        // contain no files at all — "00 Inbox/Review" exists on disk, is returned by
        // nothing, and 404s when asked for directly. No listing can offer it, so the
        // search box doubles as a path field: type the folder and the move writes there,
        // Obsidian creating the folder implicitly. Only offered when the text isn't
        // already a known folder, and labelled as creating one, so it can't happen by
        // accident from a normal search.
        const $mk = document.getElementById('dle-move-create');
        if ($mk) {
            const typed = String(ev.target.value || '').trim().replace(/^\/+|\/+$/g, '');
            const isKnown = knownSet.has(typed);
            const usable = typed && !isKnown && !/[\\:*?"<>|]/.test(typed);
            $mk.style.display = usable ? 'flex' : 'none';
            $mk.dataset.folder = usable ? typed : '';
            const lbl = $mk.querySelector('.dle-move-create-label');
            if (lbl) lbl.textContent = typed;
            // Typing a full PATH is a choice; typing a WORD is a search. Auto-select only
            // when the text contains a separator, so "00 Inbox/Review" selects itself while
            // "retired" stays a plain search — auto-selecting on any non-matching word would
            // silently aim the move at a new top-level folder named after the search term.
            // Without the auto-select the create row could sit visible but UNSELECTED while
            // an earlier tap stayed active, which is how an entry meant for
            // "00 Inbox/Review" landed in "00 Inbox". A bare word still creates a folder if
            // the row is tapped deliberately.
            if (usable && typed.includes('/')) select($mk);
        }
        // A selection must never outlive the row it came from. If the current pick has been
        // filtered out of view, drop it rather than let Move act on something invisible.
        if (picked) {
            const visible = [...document.querySelectorAll('#dle-move-picker .dle-move-opt, #dle-move-create')]
                .some(b => b.dataset.folder === picked && (b.closest('.dle-move-row') || b).style.display !== 'none');
            if (!visible) select(null);
        }
        const $n = document.getElementById('dle-move-count');
        if ($n) $n.textContent = `${shown} folder${shown === 1 ? '' : 's'}`;
    };
    document.addEventListener('click', onInto, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('input', onSearch, true);

    let chosen;
    try {
        chosen = await callGenericPopup(
            `<div class="dle-move-dialog">
             <h3 class="dle-move-title">${moving.length > 1 ? `Move ${moving.length} entries` : 'Move entry'}</h3>
             <p class="dle-move-entry"><b>${moving.length > 1 ? escapeHtml(moving.map(e => e.title).join(', ')) : escapeHtml(entry.title)}</b></p>
             <p class="dle-move-from">${sameFolder ? `Currently in <code>${escapeHtml(currentFolder || '(vault root)')}</code>` : 'Currently in several folders'}</p>
             <input id="dle-move-search" class="text_pole dle-move-search" type="search" placeholder="Search folders, or type a full path…" autocomplete="off" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" />
             <button type="button" id="dle-move-create" role="option" aria-selected="false" data-folder="">
                 <i class="fa-solid fa-folder-plus" aria-hidden="true"></i>
                 <span class="dle-move-create-text">Use path <b class="dle-move-create-label"></b></span>
                 <span class="dle-move-create-hint">creates it</span>
             </button>
             <div id="dle-move-picker" role="listbox" aria-label="Destination folder">${listHtml}</div>
             <p class="dle-move-status"><span id="dle-move-count">${options.length} folders</span> · moving to <b><span id="dle-move-chosen">nothing selected</span></b></p>
             <p class="dle-move-note">The file is copied to the new folder and checked before the old one is removed. If anything looks wrong, nothing is deleted.</p>
         </div>`,
            POPUP_TYPE.CONFIRM, '', { okButton: 'Move', cancelButton: 'Cancel', wide: true },
        );
    } finally {
        document.removeEventListener('click', onInto, true);
        document.removeEventListener('click', onPick, true);
        document.removeEventListener('input', onSearch, true);
    }
    if (!chosen) return;

    const dest = picked;
    if (!dest) {
        toastr.info('No destination folder was selected — nothing moved.', 'Onyx Quill');
        return;
    }
    if (dest === currentFolder) return;

    const { moveEntryToFolder, buildIndex: rebuildIndex } = await import('../vault/vault.js');
    if (moving.length > 1) {
        let ok = 0, orphaned = false;
        for (const e of moving) {
            if ((e.folderPath || '') === dest) continue;
            const r = await moveEntryToFolder(e, dest);
            if (r.ok) ok++;
            else {
                console.error('[Onyx Quill] Move failed:', e.title, r);
                notify.error(`${e.title}: ${r.error || 'Move failed.'}`, { copyable: true, timeOut: r.orphaned ? 0 : 8000 });
                if (r.orphaned) orphaned = true;
            }
        }
        if (ok) {
            toastr.success(`Moved ${ok} of ${moving.length} to ${dest}`, 'Onyx Quill', { timeOut: 4000 });
            try {
                let prev = JSON.parse(accountStorage.getItem('dle-move-recent') || '[]');
                if (!Array.isArray(prev)) prev = [];
                accountStorage.setItem('dle-move-recent', JSON.stringify([dest, ...prev.filter(p => p !== dest)].slice(0, 6)));
            } catch { /* noop */ }
        }
        if (ok || orphaned) { await rebuildIndex(); renderBrowseTab(); }
        return;
    }
    const result = await moveEntryToFolder(entry, dest);

    if (result.ok) {
        toastr.success(`Moved to ${dest}`, 'Onyx Quill', { timeOut: 4000 });
        announceToScreenReader(`Moved ${entry.title} to ${dest}`);
        // Remember it, newest first, capped at 6. accountStorage syncs across browsers, so
        // a destination typed once on the desktop becomes a one-tap option on the phone —
        // which is the only practical way to reach an empty folder from a touch keyboard.
        try {
            let prev = JSON.parse(accountStorage.getItem('dle-move-recent') || '[]');
            if (!Array.isArray(prev)) prev = [];
            accountStorage.setItem('dle-move-recent',
                JSON.stringify([dest, ...prev.filter(p => p !== dest)].slice(0, 6)));
        } catch { /* a lost history entry is not worth failing a completed move over */ }
        // The moved entry's old row is gone; drop any stale expansion before re-render.
        // All FOUR fields, per the BUG-362 convention in drawer.js — leaving
        // browseExpandedExtraHeight set keeps a phantom offset in the virtual scroller's
        // row maths, which is exactly the stale-offset bug that comment is about.
        if (ds.browseExpandedEntry === entry.title) {
            ds.browseExpandedEntry = null;
            ds.browseExpandedVault = null;
            ds.browseExpandedIdx = null;
            ds.browseExpandedExtraHeight = 0;
        }
        await rebuildIndex();
        renderBrowseTab();
    } else {
        console.error('[Onyx Quill] Move failed:', result);
        // `orphaned` = the entry now exists in TWO places. Loud, and the toast must not
        // auto-dismiss, because a duplicate title is a health-check error.
        notify.error(result.error || 'Move failed.', { copyable: true, timeOut: result.orphaned ? 0 : 8000 });
        // Only `orphaned` actually changed the vault — a rolled-back or refused move left
        // it untouched, so rebuilding then would be pure cost. Rebuild here so the
        // duplicate is VISIBLE in Browse and the health check can see it too, rather than
        // hiding until the next refresh.
        if (result.orphaned) {
            await rebuildIndex();
            renderBrowseTab();
        }
    }
}

export function wireBrowseTab($drawer) {
    // Virtual scroll RAF-throttled re-render. Scroll container is .dle-drawer-inner, not the tab panel.
    // Namespace `.dle-browse` so repeated wireBrowseTab calls (drawer rebuild on chat switch / re-init)
    // can off() the prior binding without stacking.
    // LOCAL PATCH 2026-08-02 (Miinthe): scroll events do NOT bubble, so binding to one guessed
    // element misses the wheel entirely when something else is the real scroller. They DO
    // fire during capture, so one capture-phase listener on the drawer root catches scroll
    // from whichever descendant actually moves — outer wrapper or the list itself.
    const drawerEl = $drawer[0];
    if (drawerEl) {
        if (drawerEl._dleBrowseScrollHandler) {
            drawerEl.removeEventListener('scroll', drawerEl._dleBrowseScrollHandler, true);
        }
        const onAnyScroll = () => {
            if (ds.browseScrollRAF) return;
            ds.browseScrollRAF = requestAnimationFrame(() => {
                ds.browseScrollRAF = null;
                renderBrowseWindow();
            });
        };
        drawerEl._dleBrowseScrollHandler = onAnyScroll;
        drawerEl.addEventListener('scroll', onAnyScroll, true);
    }

    $drawer.find('.dle-browse-input').on('input', function () {
        const val = $(this).val();
        clearTimeout(ds.browseSearchTimeout);
        $drawer.find('.dle-browse-refresh-spinner').css('visibility', 'visible');
        ds.browseSearchTimeout = setTimeout(() => {
            $drawer.find('.dle-browse-refresh-spinner').css('visibility', '');
            ds.browseQuery = val;
            scheduleRender(renderBrowseTab);
            requestAnimationFrame(() => {
                const n = ds.browseFilteredEntries?.length ?? 0;
                announceToScreenReader(`${n} result${n !== 1 ? 's' : ''}`);
            });
        }, 250);
    });

    $drawer.find('[data-filter="status"]').on('change', function () {
        ds.browseStatusFilter = $(this).val();
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
    });

    $drawer.find('[data-filter="tag"]').on('change', function () {
        ds.browseTagFilter = $(this).val();
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
    });

    $drawer.find('[data-filter="folder"]').on('change', function () {
        ds.browseFolderFilter = $(this).val();
        // LOCAL PATCH 2026-08-02 (Miinthe): an explicit pick stops Browse re-defaulting to
        // "This chat's folders" on the next render. Clearing filters un-sticks it again.
        ds._browseScopeTouched = true;
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
    });

    // LOCAL PATCH 2026-08-03 (Miinthe): one-tap jump to the inbox, and back. The folder itself
    // is resolved at render time (drawer-render-tabs.js) and parked on the button, so this
    // handler never has to guess what "the inbox" is. Toggling restores whatever scope was
    // showing before, rather than dumping you into "Folder (all)" — pressing a button twice
    // should leave you where you started.
    $drawer.find('.dle-browse-inbox-btn').on('click', function () {
        const folder = $(this).attr('data-inbox-folder') || '';
        if (!folder) return;
        if (ds.browseFolderFilter === folder) {
            ds.browseFolderFilter = ds._preInboxFolderFilter ?? '';
            ds._preInboxFolderFilter = undefined;
        } else {
            ds._preInboxFolderFilter = ds.browseFolderFilter;
            ds.browseFolderFilter = folder;
        }
        ds._browseScopeTouched = true;
        $drawer.find('[data-filter="folder"]').val(ds.browseFolderFilter);
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
    });

    // LOCAL PATCH 2026-08-03 (Miinthe): collapse/expand the filter block (mobile only — CSS
    // hides the toggle elsewhere). State lives on the drawer root so a re-render of the
    // Browse tab cannot silently reopen it.
    $drawer.find('.dle-filters-toggle').on('click', function () {
        // State lives on #deeplore-panel, NOT the drawer root: the root's class is `drawer`
        // (ST's), so a `.dle-drawer` selector would never have matched, and keeping the flag
        // on the same element that carries .dle-mobile makes every rule self-contained.
        const $panel = $drawer.find('#deeplore-panel');
        const open = !$panel.hasClass('dle-filters-open');
        $panel.toggleClass('dle-filters-open', open);
        $(this).attr('aria-expanded', String(open));
        try { accountStorage.setItem('dle-filters-open', open ? '1' : '0'); } catch { /* noop */ }
    });

    $drawer.find('[data-sort]').on('change', function () {
        ds.browseSort = $(this).val();
        try { accountStorage.setItem('dle-browse-sort', ds.browseSort); } catch { /* noop */ }
        toastr.info(trf('dle_toast_sorted_by', $(this).find('option:selected').text()), 'Onyx Quill', { timeOut: 1500 });
        scheduleRender(renderBrowseTab);
    });

    // Delegated — custom field selects are dynamically rendered.
    $drawer.find('.dle-browse-filters').on('change', '.dle-browse-cf-filter', function () {
        const field = $(this).data('cf');
        const val = $(this).val();
        if (val) {
            ds.browseCustomFieldFilters[field] = val;
        } else {
            delete ds.browseCustomFieldFilters[field];
        }
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
    });

    $drawer.on('click', '.dle-qf-pill', function () {
        const qf = $(this).data('qf');
        ds.browseQuickFilter = (ds.browseQuickFilter === qf) ? null : qf;
        scheduleRender(renderBrowseTab);
        const label = $(this).text();
        toastr.info(ds.browseQuickFilter ? `Quick filter: ${label}` : 'Quick filter cleared', 'Onyx Quill', { timeOut: 1500 });
        announceToScreenReader(ds.browseQuickFilter ? `${label} filter on` : 'Quick filter off');
    });
    $drawer.on('keydown', '.dle-qf-pill', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    $drawer.on('click', '.dle-browse-clear-filters', function () {
        ds.browseQuery = '';
        ds.browseStatusFilter = 'all';
        ds.browseTagFilter = '';
        ds.browseFolderFilter = '';
        ds._browseScopeTouched = false;   // LOCAL PATCH (Miinthe): back to chat scope on clear
        ds.browseCustomFieldFilters = {};
        $drawer.find('.dle-browse-input').val('');
        $drawer.find('[data-filter="status"]').val('all');
        $drawer.find('[data-filter="tag"]').val('');
        $drawer.find('[data-filter="folder"]').val('');
        updateFilterActiveIndicators($drawer);
        scheduleRender(renderBrowseTab);
        toastr.info(tr('dle_toast_filters_cleared'), 'Onyx Quill', { timeOut: 2000 });
    });

    // gotcha #83: open obsidian:// links WITHOUT navigating the ST top frame. A plain
    // <a href="obsidian://…"> (no target) unloads the whole SPA → DLE vanishes until
    // reload. Delegated on $drawer so it covers every .dle-obsidian-link (browse
    // preview AND the sources/verdict tab). preventDefault kills the native top-frame
    // nav; openObsidianUri launches via a hidden iframe instead.
    $drawer.on('click', '.dle-obsidian-link', function (e) {
        e.preventDefault();
        openObsidianUri(this.getAttribute('href'));
    });

    // BUG-AUDIT-3: Store {title, vaultSource} objects to match slash-command format.
    // normalizePinBlock() handles both legacy bare strings and structured objects.
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-pin', function () {
        const title = $(this).data('entry');
        const vaultSource = $(this).data('vault') || null;
        if (!title || !chat_metadata) return;

        if (!chat_metadata.deeplore_pins) chat_metadata.deeplore_pins = [];
        const tl = title.toLowerCase();
        const idx = chat_metadata.deeplore_pins.findIndex(p => {
            const n = normalizePinBlock(p);
            return n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null);
        });

        if (idx !== -1) {
            chat_metadata.deeplore_pins.splice(idx, 1);
            announceToScreenReader(`Unpinned ${title}`);
            toastr.info(trf('dle_toast_entry_unpinned', title), 'Onyx Quill', { timeOut: 2000 });
        } else {
            // Pin → also remove from blocks (mutually exclusive).
            chat_metadata.deeplore_pins.push({ title, vaultSource });
            if (chat_metadata.deeplore_blocks) {
                chat_metadata.deeplore_blocks = chat_metadata.deeplore_blocks.filter(b => {
                    const n = normalizePinBlock(b);
                    return !(n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null));
                });
            }
            announceToScreenReader(`Pinned ${title}`);
            toastr.info(trf('dle_toast_entry_pinned', title), 'Onyx Quill', { timeOut: 2000 });
        }
        saveMetadataDebounced();
        notifyPinBlockChanged();
    });

    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-pin', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    // LOCAL PATCH 2026-08-03 (Miinthe): move an entry into another folder from the panel.
    // One entry at a time, on purpose — this is the only action in DeepLore that deletes
    // a lore file, so the first version is the one that is easy to watch. The destination
    // list is the vault's EXISTING folders (state.folderList); no folder is ever created
    // from here. moveEntryToFolder() owns the safety sequence (copy → verify → delete);
    // this handler owns consent — nothing runs until the exact destination is confirmed.
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-move-btn', async function () {
        // Don't move a file out from under a generation that is mid-flight — the pipeline
        // holds entry objects by reference and the index is rebuilt on success.
        if (generationLock) {
            toastr.warning('A message is generating — wait for it to finish before moving entries.', 'Onyx Quill');
            return;
        }
        const title = $(this).data('entry');
        const vaultSource = String($(this).data('vault') || '');
        const filename = String($(this).data('file') || '');
        // Resolve by filename (a path, therefore unique). Title+vault is only a fallback for
        // rows rendered before this patch — duplicate titles in one vault are legal, so a
        // title lookup can resolve to a different entry than the row that was clicked.
        const entry = (filename && vaultIndex.find(e => e.filename === filename))
            || vaultIndex.find(e => e.title === title && (e.vaultSource || '') === vaultSource);
        if (!entry) {
            dedupError('That entry is no longer in the index — refresh and try again.', 'move_entry_missing');
            return;
        }

        await moveEntryFlow(entry);
    });

    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-move-btn', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    $drawer.find('.dle-browse-list').on('click', '.dle-browse-block', function () {
        const title = $(this).data('entry');
        const vaultSource = $(this).data('vault') || null;
        if (!title || !chat_metadata) return;

        if (!chat_metadata.deeplore_blocks) chat_metadata.deeplore_blocks = [];
        const tl = title.toLowerCase();
        const idx = chat_metadata.deeplore_blocks.findIndex(b => {
            const n = normalizePinBlock(b);
            return n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null);
        });

        if (idx !== -1) {
            chat_metadata.deeplore_blocks.splice(idx, 1);
            announceToScreenReader(`Unblocked ${title}`);
            toastr.info(trf('dle_toast_entry_unblocked', title), 'Onyx Quill', { timeOut: 2000 });
        } else {
            // Block → also remove from pins (mutually exclusive).
            chat_metadata.deeplore_blocks.push({ title, vaultSource });
            if (chat_metadata.deeplore_pins) {
                chat_metadata.deeplore_pins = chat_metadata.deeplore_pins.filter(p => {
                    const n = normalizePinBlock(p);
                    return !(n.title.toLowerCase() === tl && (n.vaultSource || null) === (vaultSource || null));
                });
            }
            announceToScreenReader(`Blocked ${title}`);
            toastr.info(trf('dle_toast_entry_blocked', title), 'Onyx Quill', { timeOut: 2000 });
        }
        saveMetadataDebounced();
        notifyPinBlockChanged();
    });

    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-block', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    // f035-kebab: toggle the per-row action cluster open (for touch + keyboard — CSS handles
    // hover-reveal for pointers). Toggles a class on the LIVE row DOM node only, never the
    // virtual-scroll row model (gotcha #13). Closes any other open row's cluster first so only
    // one is open at a time. A pin/block-active row stays open via dle-actions-pinned-open and
    // is unaffected by this toggle.
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-kebab', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const $actions = $(this).closest('.dle-browse-actions');
        const willOpen = !$actions.hasClass('dle-actions-open');
        $drawer.find('.dle-browse-actions.dle-actions-open').removeClass('dle-actions-open')
            .find('.dle-browse-kebab').attr('aria-expanded', 'false');
        if (willOpen) {
            $actions.addClass('dle-actions-open');
            $(this).attr('aria-expanded', 'true');
        }
    });
    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-kebab', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $(this).trigger('click');
        } else if (e.key === 'Escape') {
            const $actions = $(this).closest('.dle-browse-actions');
            if ($actions.hasClass('dle-actions-open')) {
                e.preventDefault();
                $actions.removeClass('dle-actions-open');
                $(this).attr('aria-expanded', 'false').focus();
            }
        }
    });

    $drawer.find('.dle-browse-list').on('click keydown', '.dle-browse-info', function (e) {
        if (e.type === 'keydown' && e.key === 'Escape' && $(this).attr('aria-expanded') === 'true') {
            e.preventDefault();
            $(this).trigger('click');
            return;
        }
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        if (e.type === 'keydown') e.preventDefault();
        const $entry = $(this).closest('.dle-browse-entry');
        const title = $entry.data('title');
        if (!title) return;
        // P3-9 (gotcha #50): the row carries data-vault; resolve by (title, vaultSource)
        // so a cross-vault same-title entry opens the RIGHT vault's content.
        const vault = $entry.data('vault') ?? null;

        const $list = $drawer.find('.dle-browse-list');
        const $existing = $entry.find('.dle-browse-preview');
        if ($existing.length) {
            // Collapse — reset expanded state and force a virtual-scroll re-render to fix row positions.
            $existing.remove();
            $entry.css('height', BROWSE_ROW_HEIGHT + 'px');
            $(this).attr('aria-expanded', 'false');
            ds.browseExpandedEntry = null;
            ds.browseExpandedVault = null;
            ds.browseExpandedIdx = null;
            ds.browseExpandedExtraHeight = 0;
            const totalHeight = (ds.browseRowModel?.length || ds.browseFilteredEntries.length) * BROWSE_ROW_HEIGHT;
            $list.css({ 'min-height': totalHeight + 'px' });
            ds.browseLastRangeStart = -1;
            ds._browseLastScrollTop = undefined;
            renderBrowseWindow();
            return;
        }

        if (ds.browseExpandedEntry) {
            // Scope the collapse-prev selector to the stored vault so a cross-vault
            // same-title row isn't collapsed by mistake (mirrors the renderer at
            // drawer-render-tabs.js). null vault → title-only (back-compat).
            const prevVault = ds.browseExpandedVault;
            const prevTitleSel = `.dle-browse-entry[data-title="${CSS.escape(ds.browseExpandedEntry)}"]`;
            const $prev = prevVault != null
                ? ($list.find(`${prevTitleSel}[data-vault="${CSS.escape(prevVault)}"]`).first().length
                    ? $list.find(`${prevTitleSel}[data-vault="${CSS.escape(prevVault)}"]`).first()
                    : $list.find(prevTitleSel).first())
                : $list.find(prevTitleSel).first();
            if ($prev.length) {
                $prev.find('.dle-browse-preview').remove();
                $prev.css('height', BROWSE_ROW_HEIGHT + 'px');
                $prev.find('.dle-browse-info').attr('aria-expanded', 'false');
            }
        }

        const entry = resolveNavTarget(ds.browseFilteredEntries, title, vault);
        if (!entry) return;

        const entryIdx = parseInt($entry.data('idx'), 10);
        ds.browseExpandedEntry = title;
        ds.browseExpandedVault = vault;
        $(this).attr('aria-expanded', 'true');

        const preview = entry.summary || (entry.content ? entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '') : 'No content');
        const tokens = entry.tokenEstimate ? `${entry.tokenEstimate} tokens` : '';

        const settings = getSettings();
        const srcVault = entry.vaultSource && settings.vaults
            ? settings.vaults.find(v => v.name === entry.vaultSource) : null;
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

        const previewHtml = `<div class="dle-browse-preview"><div class="dle-browse-preview-text">${escapeHtml(preview)}</div>${fieldsHtml}<div class="dle-browse-preview-meta">${escapeHtml(tokens)}${linkHtml}</div></div>`;

        // Append → height:auto → measure (single forced reflow) → batch writes after the read.
        $entry.append(previewHtml);
        $entry.css('height', 'auto');
        const naturalHeight = $entry[0].scrollHeight;
        const extraHeight = Math.max(0, naturalHeight - BROWSE_ROW_HEIGHT);

        ds.browseExpandedIdx = entryIdx;
        ds.browseExpandedExtraHeight = extraHeight;

        const totalHeight = (ds.browseRowModel?.length || ds.browseFilteredEntries.length) * BROWSE_ROW_HEIGHT + extraHeight;
        $list.css({ 'min-height': totalHeight + 'px' });
        ds.browseLastRangeStart = -1;
        ds._browseLastScrollTop = undefined;
        renderBrowseWindow();
    });

    // ─── #13 — folder grouping toggle ───
    $drawer.find('.dle-browse-group-toggle').on('click', function () {
        ds.browseFolderGrouping = !ds.browseFolderGrouping;
        // When turning grouping ON for the first time, expand every top-folder so the
        // user sees their entries — collapsing on demand is opt-in.
        if (ds.browseFolderGrouping) {
            if (!(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
            // Audit M7: on first toggle, browseFilteredEntries may still be []
            // (drawer just opened, no filter pass yet). Fall through to writer-visible
            // entries (excludes lorebook-guide) so the expanded set matches the entries
            // the Browse tab will actually show — empty Set means "all collapsed" in the
            // pure helper. V-M1 (2026-05-22): was `vaultIndex` (raw), which pulled in
            // guide entries and folders the user's filter would have excluded.
            const source = (ds.browseFilteredEntries && ds.browseFilteredEntries.length)
                ? ds.browseFilteredEntries
                : getWriterVisibleEntries();
            const folders = new Set();
            for (const e of source || []) {
                folders.add(e.folderPath ? e.folderPath.split('/')[0] : '(root)');
            }
            ds.browseExpandedFolders = folders;
        }
        // Expansion of a single entry is folder-scoped — collapsing/regrouping invalidates it.
        ds.browseExpandedEntry = null;
        ds.browseExpandedVault = null;
        ds.browseExpandedIdx = null;
        ds.browseExpandedExtraHeight = 0;
        scheduleRender(renderBrowseTab);
        announceToScreenReader(ds.browseFolderGrouping ? 'Grouping by folder' : 'Flat list');
    });

    // ─── expand all / collapse all folders ───
    $drawer.find('.dle-browse-expand-all-toggle').on('click', function () {
        if (!ds.browseFolderGrouping) return;
        const topFolders = listTopFolders(ds.browseFilteredEntries);
        const expandedSet = ds.browseExpandedFolders instanceof Set ? ds.browseExpandedFolders : new Set();
        const allExpanded = topFolders.length > 0 && topFolders.every(f => expandedSet.has(f));
        // If everything is already open, collapse all; otherwise expand all.
        ds.browseExpandedFolders = allExpanded ? new Set() : new Set(topFolders);
        // Single-entry expansion is folder-scoped — bulk collapse/expand invalidates it.
        ds.browseExpandedEntry = null;
        ds.browseExpandedVault = null;
        ds.browseExpandedIdx = null;
        ds.browseExpandedExtraHeight = 0;
        scheduleRender(renderBrowseTab);
        announceToScreenReader(allExpanded ? 'All folders collapsed' : 'All folders expanded');
    });

    // ─── #13 — folder header expand/collapse ───
    // Audit M5: scope delegation to .dle-browse-list so future .dle-browse-folder-header
    // CSS uses elsewhere in the drawer (gating tab, etc.) can't trigger Browse
    // expand/collapse and corrupt browseExpandedFolders.
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-folder-header', function (e) {
        // Don't toggle when the user is interacting with the select-all checkbox.
        if (e.target && (e.target.tagName === 'INPUT' || e.target.closest('.dle-browse-folder-select'))) return;
        const folder = $(this).data('folder');
        if (!folder) return;
        if (!(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
        if (ds.browseExpandedFolders.has(folder)) {
            ds.browseExpandedFolders.delete(folder);
        } else {
            ds.browseExpandedFolders.add(folder);
        }
        // Collapsing a folder that contains the expanded preview invalidates it.
        ds.browseExpandedEntry = null;
        ds.browseExpandedVault = null;
        ds.browseExpandedIdx = null;
        ds.browseExpandedExtraHeight = 0;
        scheduleRender(renderBrowseTab);
    });
    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-folder-header', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    // ─── #26 — select mode toggle ───
    $drawer.find('.dle-browse-select-toggle').on('click', function () {
        ds.browseSelectMode = !ds.browseSelectMode;
        if (!ds.browseSelectMode) {
            // Leaving select mode clears the selection so a stale set can't surprise the user later.
            if (ds.browseSelected instanceof Set) ds.browseSelected.clear();
        }
        scheduleRender(renderBrowseTab);
        announceToScreenReader(ds.browseSelectMode ? 'Select mode on' : 'Select mode off');
    });

    // ─── #26 — row checkbox ───
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-row-select', function (e) {
        // Stop the click from bubbling into the row's expand handler.
        e.stopPropagation();
        const trk = $(this).data('tracker');
        if (!trk) return;
        if (!(ds.browseSelected instanceof Set)) ds.browseSelected = new Set();
        if (this.checked) ds.browseSelected.add(trk);
        else ds.browseSelected.delete(trk);
        // Cheap re-render to update toolbar count + row highlight + folder-header tri-state.
        ds.browseLastRangeStart = -1;
        scheduleRender(renderBrowseTab);
    });
    // Audit M2: Space toggles the checkbox natively AND bubbles to the info-row keydown
    // handler (which treats Space as "expand/collapse preview"). Stop that bubble so the
    // user doesn't get a surprise preview toggle every time they tick a selection.
    $drawer.find('.dle-browse-list').on('keydown', '.dle-browse-row-select', function (e) {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
    });

    // ─── #26 — folder header select-all ───
    $drawer.find('.dle-browse-list').on('click', '.dle-browse-folder-select', function (e) {
        e.stopPropagation();
        const folder = $(this).data('folder');
        if (!folder) return;
        if (!(ds.browseSelected instanceof Set)) ds.browseSelected = new Set();
        // Live computation of which entries live under this folder.
        const inFolder = [];
        for (const ent of ds.browseFilteredEntries || []) {
            const top = ent.folderPath ? ent.folderPath.split('/')[0] : '(root)';
            if (top === folder) {
                const trk = `${ent.vaultSource || ''}:${ent.title}`;
                inFolder.push(trk);
            }
        }
        const allSelected = inFolder.length > 0 && inFolder.every(k => ds.browseSelected.has(k));
        if (allSelected) {
            for (const k of inFolder) ds.browseSelected.delete(k);
        } else {
            for (const k of inFolder) ds.browseSelected.add(k);
        }
        ds.browseLastRangeStart = -1;
        scheduleRender(renderBrowseTab);
    });

    // ─── #26 — clear selection ───
    $drawer.find('.dle-browse-clear-selection').on('click', function () {
        if (ds.browseSelected instanceof Set) ds.browseSelected.clear();
        scheduleRender(renderBrowseTab);
        announceToScreenReader('Selection cleared');
    });

    // ─── #26 — Optimize Selected (handler in popups.js to avoid circular import) ───
    $drawer.find('.dle-browse-optimize-selected').on('click', async function () {
        // Audit M1: prevent double-click from spawning two parallel batch runs.
        if (ds._batchOptimizeInflight) return;
        const trks = ds.browseSelected instanceof Set ? [...ds.browseSelected] : [];
        if (!trks.length) return;
        ds._batchOptimizeInflight = true;
        const $btn = $(this).prop('disabled', true);
        try {
            const mod = await import('../ui/popups.js');
            if (typeof mod.runBatchOptimize !== 'function') {
                toastr.error(tr('dle_toast_batch_optimize_unavailable'), 'Onyx Quill');
                return;
            }
            await mod.runBatchOptimize(trks);
            // Clear selection after the run completes regardless of accept/reject choices —
            // the toolbar should not keep an "Optimize Selected (N)" button after the run is done.
            if (ds.browseSelected instanceof Set) ds.browseSelected.clear();
            scheduleRender(renderBrowseTab);
        } catch (err) {
            console.error('[Onyx Quill] runBatchOptimize failed:', err);
            notify.error(trf('dle_toast_batch_optimize_failed', err?.message || err), { copyable: true });
        } finally {
            ds._batchOptimizeInflight = false;
            $btn.prop('disabled', false);
        }
    });
}

export function wireGatingTab($drawer) {
    // Chip X buttons via event delegation — animate out before removing.
    $drawer.find('#dle-panel-gating').on('click', '.dle-chip-x', function () {
        const field = $(this).data('field');
        const value = $(this).data('value');
        if (!field || !chat_metadata) return;

        if (!chat_metadata.deeplore_context) return;
        const ctx = chat_metadata.deeplore_context;

        const $chip = $(this).closest('.dle-chip');
        $chip.addClass('dle-chip-removing');

        // State update fires on transitionend OR a 200ms safety timeout (whichever first).
        // Don't wait for transitionend exclusively — a concurrent gating render would re-create the chip.
        const applyRemoval = () => {
            const allDefs = fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS;
            const fd = allDefs.find(d => d.name === field);
            if (fd) {
                const ctxKey = fd.contextKey;
                if (fd.multi && Array.isArray(ctx[ctxKey])) {
                    ctx[ctxKey] = ctx[ctxKey].filter(c => c !== value);
                } else {
                    ctx[ctxKey] = null;
                }
            }
            saveMetadataDebounced();
            notifyGatingChanged();
        };

        let fired = false;
        const once = () => { if (!fired) { fired = true; applyRemoval(); } };
        $chip.one('transitionend', once);
        setTimeout(once, 200);
    });

    $drawer.find('#dle-panel-gating').on('keydown', '.dle-chip-x', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    // LOCAL PATCH (Miinthe, 2026-10-03): show/hide the gating fields no entry uses.
    $drawer.find('#dle-panel-gating').on('click', '.dle-gating-unused-toggle', function () {
        ds.gatingShowAll = !ds.gatingShowAll;
        renderGatingTab();
    });

    // LOCAL PATCH (Miinthe, 2026-10-02): Story tab — story trackers.
    // One setup window for new and edit: name, steps (one per line), direction.
    const trackerForm = async (existing) => {
        const { callGenericPopup: pop, POPUP_TYPE: PT } = await import('../../../../../popup.js');
        let values = null;
        const dir = existing?.direction === 'forward' ? 'forward' : 'both';
        const html = `<div style="text-align:left">
            <h3>${existing ? 'Edit tracker' : 'New tracker'}</h3>
            <label style="display:block;margin:.4em 0 .2em">Name — what it follows</label>
            <input type="text" class="text_pole dle-tf-name" placeholder="Relationship" value="${escapeHtml(existing?.name || '')}">
            <label style="display:block;margin:.8em 0 .2em">Steps, one per line, in order</label>
            <textarea class="text_pole dle-tf-steps" rows="7" placeholder="Strangers&#10;Neighbours&#10;Friends">${escapeHtml((existing?.steps || []).join('\n'))}</textarea>
            <label style="display:block;margin:.8em 0 .2em">When it moves by itself</label>
            <select class="text_pole dle-tf-dir">
                <option value="both"${dir === 'both' ? ' selected' : ''}>Both directions — it may also move back when the story plainly says so</option>
                <option value="forward"${dir === 'forward' ? ' selected' : ''}>Forward only — it never moves back by itself (you still can)</option>
            </select>
            <label style="display:flex;align-items:center;gap:8px;margin:.8em 0 .2em;cursor:pointer"><input type="checkbox" class="dle-tf-skip"${existing?.skip === true ? ' checked' : ''} style="flex:none"> May skip steps (e.g. a time jump). Off: it moves one step at a time and tells you when the story jumps ahead.</label>
            <p style="opacity:.7;font-size:.9em;margin-top:.8em">${existing ? 'It stays on its current step if that step is still in the list.' : 'It starts on the first step.'} Name the steps the way your stage entries\' summaries name them — that is how AI search finds the right entry.</p>
        </div>`;
        const ok = await pop(html, PT.CONFIRM, '', {
            okButton: 'Save', cancelButton: 'Cancel', wide: true,
            onClosing: popup => {
                const root = popup?.dlg || document;
                values = {
                    name: String(root.querySelector('.dle-tf-name')?.value || '').trim(),
                    steps: String(root.querySelector('.dle-tf-steps')?.value || ''),
                    direction: root.querySelector('.dle-tf-dir')?.value === 'forward' ? 'forward' : 'both',
                    skip: !!root.querySelector('.dle-tf-skip')?.checked,
                };
                return true;
            },
        });
        if (!ok || !values) return;
        if (!values.name) { dedupWarning('The tracker needs a name.', 'tracker_form'); return; }
        const clash = getTrackers().some(t => t.name.toLowerCase() === values.name.toLowerCase() && t.name !== existing?.name);
        if (clash) { dedupWarning(`There is already a tracker called "${values.name}".`, 'tracker_form'); return; }
        const r = parseStepsText(values.steps);
        if (!r.ok) { dedupWarning(`Tracker not saved: ${r.error}.`, 'tracker_form'); return; }
        setTracker(existing ? existing.name : values.name, r.steps, { direction: values.direction, skip: values.skip, rename: existing ? values.name : null });
    };
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-add', () => trackerForm(null));
    // LOCAL PATCH (Miinthe, 2026-10-05): the storyboard window (stage 2).
    $drawer.find('#dle-panel-story').on('click', '.dle-board-open', async () => (await import('../board-window.js')).openBoardWindow());
    // LOCAL PATCH (Miinthe, 2026-10-04): Re-evaluate + swipe — a WIP button until the DeepLore bar exists
    $drawer.find('#dle-panel-story').on('click', '.dle-reevaluate', async () => (await import('../reevaluate.js')).reEvaluate());
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-edit', function () {
        const t = getTrackers().find(x => x.name === String($(this).data('name') || ''));
        if (t) trackerForm(t);
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-direction', function () {
        const name = String($(this).data('name') || '');
        const list = getTrackers();
        const i = list.findIndex(t => t.name === name);
        if (i === -1) return;
        list[i] = { ...list[i], direction: list[i].direction === 'forward' ? 'both' : 'forward' };
        saveTrackers(list);
    });
    // LOCAL PATCH (Miinthe, 2026-10-05): a collection's name opens the board window at it.
    $drawer.find('#dle-panel-story').on('click', '.dle-col-open', async function () {
        (await import('../board-window.js')).openBoardWindow({ select: String($(this).data('col') || '') || null });
    });
    // LOCAL PATCH (Miinthe, 2026-10-05): undo a collection change (items, money).
    // collections that grow: a waiting find — Keep it / Not worth keeping (board-grow.js)
    $drawer.find('#dle-panel-story').on('click', '.dle-find-keep', async function () {
        $(this).prop('disabled', true).text('Keeping…');
        const { keepFoundWithNotice } = await import('../board-grow.js');
        await keepFoundWithNotice(String($(this).data('col') || ''), String($(this).data('pend') || ''));
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-find-drop', async function () {
        const { refuseFound } = await import('../board-grow.js');
        refuseFound(String($(this).data('col') || ''), String($(this).data('pend') || ''));
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-col-undo', async function () {
        const { undoCollection } = await import('../autotrack.js');
        undoCollection(String($(this).data('log') || ''));
    });
    // LOCAL PATCH (Miinthe, 2026-10-05): take a fork's branch by hand.
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-branch', async function () {
        const { chooseBranch } = await import('../trackers.js');
        const r = chooseBranch(String($(this).data('name')), String($(this).data('branch')));
        if (r.error) toastr.warning(r.error, 'Story tracker'); else toastr.info(r.text, 'Story tracker');
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-undo', function () {
        undoAutoMove(String($(this).data('name') || ''));
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-autotrack-toggle', function () {
        setAutoTrackEnabled(!autoTrackEnabled());
    });
    // LOCAL PATCH (Miinthe, 2026-10-04): pause / continue / abandon / reactivate (abandon asks first), Undo; the board back on
    $drawer.find('#dle-panel-story').on('click', '.dle-run', async function () {
        const name = String($(this).data('name') || ''), act = String($(this).data('act') || '');
        const T = await import('../trackers.js');
        if (act === 'abandon') {
            const { callGenericPopup: pop, POPUP_TYPE: PT } = await import('../../../../../popup.js');
            const ok = await pop(`<h3>Abandon ${escapeHtml(name)}?</h3><p>In this chat only: back to the start and switched off. Reactivate starts it over; Undo restores it.</p>`, PT.CONFIRM, '', { okButton: 'Abandon', cancelButton: 'Cancel' });
            if (!ok) return;
        }
        const r = T.setTrackerRun(name, act);
        try { if (r.error) toastr.warning(escapeHtml(r.error), 'Storyboard'); else toastr.info(`${escapeHtml(r.text)}<br><u>Undo</u>`, 'Storyboard', { escapeHtml: false, timeOut: 10000, onclick: () => T.undoTrackerRun(name) }); } catch { /* noop */ }
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-run-undo', async function () {
        const T = await import('../trackers.js');
        const r = T.undoTrackerRun(String($(this).data('name') || ''));
        try { toastr[r.error ? 'warning' : 'info'](escapeHtml(r.error || r.text), 'Storyboard'); } catch { /* noop */ }
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-board-offbtn', async function () {
        const T = await import('../trackers.js');
        const r = T.switchBoard(true);
        try { toastr[r.error ? 'warning' : 'info'](escapeHtml(r.error || r.text), 'Storyboard'); } catch { /* noop */ }
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-board-on', async function () {
        const T = await import('../trackers.js');
        T.switchBoard(false);
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-remove', async function () {
        const name = String($(this).data('name') || '');
        const { callGenericPopup: pop, POPUP_TYPE: PT } = await import('../../../../../popup.js');
        if (await pop(`<p>Remove the tracker <b>${escapeHtml(name)}</b> from this chat?</p>`, PT.CONFIRM, '', { okButton: 'Remove', cancelButton: 'Keep' })) removeTracker(name);
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-aside', async function () {
        const name = String($(this).data('name') || '');
        const t = getTrackers().find(x => x.name === name);
        if (!t) return;
        const { callGenericPopup: pop, POPUP_TYPE: PT } = await import('../../../../../popup.js');
        const text = await pop(`<h3>Detour — ${escapeHtml(name)}</h3><p>Something happening beside the step, e.g. <b>Nuisance</b>. The step stays at <b>${escapeHtml(t.steps[t.index])}</b>. Leave empty to clear.</p>`, PT.INPUT, t.aside || '', { okButton: 'Save' });
        if (typeof text !== 'string') return;
        const r = setTrackerAside(name, text);
        if (r.error) dedupWarning(r.error, 'tracker_aside');
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-aside-clear', function () {
        const r = setTrackerAside(String($(this).data('name') || ''), '');
        if (r.error) dedupWarning(r.error, 'tracker_aside');
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-move', function () {
        const r = moveTracker(String($(this).data('name') || ''), { delta: Number($(this).data('delta')) || 0 });
        if (r.error) dedupWarning(r.error, 'tracker_move');
    });
    $drawer.find('#dle-panel-story').on('click', '.dle-tracker-step', function () {
        const r = moveTracker(String($(this).data('name') || ''), { toIndex: Number($(this).data('index')) || 0 });
        if (r.error) dedupWarning(r.error, 'tracker_move');
    });

    $drawer.find('#dle-panel-gating').on('click', '.dle-gating-set', async function () {
        const $group = $(this).closest('.dle-gating-group');
        const field = $group.data('field');
        if (!field) return;

        // Built-in fields have dedicated commands; custom fields fall through to generic /oq-set-field.
        const cmdMap = {
            era: '/oq-set-era',
            location: '/oq-set-location',
            scene_type: '/oq-set-scene',
            character_present: '/oq-set-characters',
        };
        const cmd = cmdMap[field] || `/oq-set-field ${field}`;
        executeCommand(cmd);
    });

    $drawer.find('.dle-clear-all-gating-btn').on('click', function () {
        if (!chat_metadata?.deeplore_context) return;
        const ctx = chat_metadata.deeplore_context;
        const allDefs = fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS;
        let cleared = 0;
        for (const fd of allDefs) {
            if (!fd.gating?.enabled) continue;
            const val = ctx[fd.contextKey];
            if (fd.multi ? (Array.isArray(val) && val.length > 0) : !!val) {
                ctx[fd.contextKey] = fd.multi ? [] : null;
                cleared++;
            }
        }
        if (cleared === 0) {
            toastr.info(tr('dle_toast_no_gating_filters'), 'Onyx Quill', { timeOut: 2000 });
            return;
        }
        saveMetadataDebounced();
        notifyGatingChanged();
        toastr.success(trPlural('dle_toast_gating_cleared', cleared), 'Onyx Quill', { timeOut: 2000 });
    });

    $drawer.find('.dle-manage-fields-btn').on('click', () => openRuleBuilder());

    // ── Folder filter ──

    $drawer.find('#dle-panel-gating').on('click', '.dle-folder-chip-x', function () {
        const folder = $(this).data('folder');
        if (!folder || !chat_metadata) return;
        if (!chat_metadata.deeplore_folder_filter) return;

        const $chip = $(this).closest('.dle-chip');
        $chip.addClass('dle-chip-removing');

        let fired = false;
        const apply = () => {
            if (fired) return;
            fired = true;
            chat_metadata.deeplore_folder_filter = chat_metadata.deeplore_folder_filter.filter(f => f !== folder);
            if (chat_metadata.deeplore_folder_filter.length === 0) chat_metadata.deeplore_folder_filter = null;
            saveMetadataDebounced();
            notifyGatingChanged();
        };
        $chip.one('transitionend', apply);
        setTimeout(apply, 200);
    });
    // Audit S6-1: a11y parity with sibling .dle-chip-x — Enter/Space activates the chip-X.
    $drawer.find('#dle-panel-gating').on('keydown', '.dle-folder-chip-x', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    $drawer.find('#dle-panel-gating').on('keydown', '.dle-gating-set', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    $drawer.find('.dle-folder-set-btn').on('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });
    $drawer.find('.dle-folder-set-btn').on('click', async function () {
        const { callGenericPopup, POPUP_TYPE } = await import('../../../../../popup.js');
        const current = chat_metadata?.deeplore_folder_filter || [];
        const currentSet = new Set(current);

        if (folderList.length === 0) {
            await callGenericPopup(
                '<div class="dle-popup"><p>No folders found in the vault. All entries are at the root level.</p></div>',
                POPUP_TYPE.TEXT, '', { wide: false },
            );
            return;
        }

        let html = '<div class="dle-popup"><h4>Select Folders</h4>';
        if (current.length) html += `<p class="dle-mb-2">Active: <strong>${escapeHtml(current.join(', '))}</strong></p>`;
        // LOCAL PATCH 2026-08-02 (Miinthe): search box. The list is one button per folder AND
        // per subfolder, so a vault with a dozen lorebooks scrolls forever. Type to narrow;
        // matching is a plain case-insensitive substring on the full path, so "omega" finds
        // the parent and every layer under it.
        html += '<input type="text" class="text_pole dle-folder-search" placeholder="Type to filter folders…" aria-label="Filter folders" style="margin-bottom:8px;" />';
        html += '<div class="dle-folder-search-empty dle-text-xs" style="display:none;opacity:0.6;padding:4px 2px;">No folder matches that.</div>';
        html += '<div class="dle-flex-col dle-gap-1 dle-folder-list">';
        html += '<button type="button" class="menu_button dle-field-select dle-folder-select dle-flex-between dle-w-full" data-value="">Clear all folders</button>';
        // LOCAL PATCH 2026-08-02 (Miinthe): sort by PATH, not entry count. folderList arrives
        // count-descending, which scatters a parent's children around unrelated top-level
        // folders and makes the indentation read as noise. Numeric collation keeps the
        // user's `02 …` / `03 …` / `10 …` prefixes in human order.
        const sortedFolders = [...folderList].sort((a, b) =>
            a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
        for (const { path, entryCount } of sortedFolders) {
            const isActive = currentSet.has(path);
            const activeClass = isActive ? ' dle-field-select--active' : '';
            // Depth-based indent + a rule down the left so children read as a group.
            const depth = path.split('/').length - 1;
            const style = depth
                ? ` style="padding-left:${6 + depth * 16}px;border-left:2px solid var(--SmartThemeQuoteColor,#888);opacity:0.92;"`
                : ' style="font-weight:600;margin-top:4px;"';
            const leaf = depth ? path.split('/').pop() : path;
            const parent = depth ? path.slice(0, path.lastIndexOf('/')) : '';
            // data-search is the LEAF only, so typing "corvin" matches folders actually
            // named that — not every child of one. data-parent is shown as dim context
            // while searching, since a bare leaf like "Instance A" is ambiguous on its own.
            html += `<button type="button" class="menu_button dle-field-select dle-folder-select dle-flex-between dle-w-full${activeClass}" data-value="${escapeHtml(path)}" data-search="${escapeHtml(leaf.toLowerCase())}" data-parent="${escapeHtml(parent)}"${style} title="${escapeHtml(path)}"><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;">${escapeHtml(leaf)}</span><span class="dle-folder-ctx dle-text-xs" style="display:none;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.45;margin-left:8px;font-weight:400;">in ${escapeHtml(parent)}</span><span class="dle-text-xs" style="flex:0 0 auto;white-space:nowrap;opacity:0.5;margin-left:8px;">${escapeHtml(trPlural('dle_popup_entry_count', entryCount))}</span></button>`;
        }
        html += '</div></div>';

        await callGenericPopup(html, POPUP_TYPE.TEXT, '', {
            wide: false,
            onOpen: () => {
                const buttons = document.querySelectorAll('.dle-folder-select');
                // LOCAL PATCH 2026-08-03 (Miinthe): lock the list's height at open time.
                // The list had no height of its own, so filtering it removed rows and the
                // whole popup collapsed downwards while you were still typing — the OK
                // button moving out from under your finger. Measuring once and pinning
                // the height keeps the popup a fixed size and turns filtering into a
                // scroll inside a stable box. Measured rather than hard-coded so a small
                // vault doesn't get a tall empty panel; capped so a large one doesn't
                // outgrow the screen.
                const list = document.querySelector('.dle-folder-list');
                if (list) {
                    const cap = Math.min(window.innerHeight * 0.55, 420);
                    list.style.height = Math.min(list.scrollHeight, cap) + 'px';
                }

                // LOCAL PATCH 2026-08-02 (Miinthe): wire the search box.
                const search = document.querySelector('.dle-folder-search');
                const emptyMsg = document.querySelector('.dle-folder-search-empty');
                if (search) {
                    const applyFilter = () => {
                        const q = search.value.trim().toLowerCase();
                        let shown = 0;
                        for (const b of buttons) {
                            const hay = b.getAttribute('data-search');
                            // The "Clear all folders" button has no data-search — always keep it.
                            const match = hay === null || !q || hay.includes(q);
                            b.style.display = match ? '' : 'none';
                            if (match && hay !== null) shown++;
                            // While searching, the tree is broken up — so show each result's
                            // parent, and drop the indent that no longer means anything.
                            const ctx = b.querySelector('.dle-folder-ctx');
                            const parent = b.getAttribute('data-parent');
                            if (ctx) ctx.style.display = (q && parent) ? 'inline-block' : 'none';
                            if (parent) b.style.paddingLeft = q ? '10px' : '';
                        }
                        if (emptyMsg) emptyMsg.style.display = (q && shown === 0) ? '' : 'none';
                    };
                    search.addEventListener('input', applyFilter);
                    // Enter toggles the only remaining match — type three letters, hit Enter.
                    search.addEventListener('keydown', (e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const visible = [...buttons].filter(b => b.style.display !== 'none' && b.getAttribute('data-search') !== null);
                        if (visible.length === 1) visible[0].click();
                    });
                    setTimeout(() => search.focus(), 50);
                }
                for (const btn of buttons) {
                    btn.addEventListener('click', () => {
                        const selected = btn.getAttribute('data-value');
                        if (!selected) {
                            chat_metadata.deeplore_folder_filter = null;
                            saveMetadataDebounced();
                            notifyGatingChanged();
                            toastr.success(tr('dle_toast_folder_filter_cleared'), 'Onyx Quill');
                            document.querySelector('.popup-button-ok')?.click();
                            return;
                        }
                        if (!chat_metadata.deeplore_folder_filter) chat_metadata.deeplore_folder_filter = [];
                        const idx = chat_metadata.deeplore_folder_filter.indexOf(selected);
                        if (idx !== -1) {
                            chat_metadata.deeplore_folder_filter.splice(idx, 1);
                            if (chat_metadata.deeplore_folder_filter.length === 0) chat_metadata.deeplore_folder_filter = null;
                            btn.classList.remove('dle-field-select--active');
                        } else {
                            chat_metadata.deeplore_folder_filter.push(selected);
                            btn.classList.add('dle-field-select--active');
                        }
                        const pEl = document.querySelector('.dle-popup p.dle-mb-2');
                        const cf = chat_metadata.deeplore_folder_filter || [];
                        if (pEl) pEl.innerHTML = cf.length ? `Active: <strong>${escapeHtml(cf.join(', '))}</strong>` : '';
                        saveMetadataDebounced();
                        notifyGatingChanged();
                    });
                }
            },
        });
    });

    // BUG-188: keyboard activation on status-zone folder badge + gating value chips.
    $drawer.on('click', '.dle-folder-badge-chip, .dle-gating-value-chip', function () {
        switchTab($drawer, 'gating');
    });
    $drawer.on('keydown', '.dle-folder-badge-chip, .dle-gating-value-chip', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            switchTab($drawer, 'gating');
        }
    });

    // Post-setup-idle Injection empty state links to Browse (f077) — the user is
    // configured, just hasn't triggered a keyword this turn.
    $drawer.on('click', '.dle-empty-browse-link', function (e) {
        e.preventDefault();
        switchTab($drawer, 'browse');
    });

    // f082: button-first CTAs in the pre-setup Injection/Browse empty guides. These live
    // outside #dle-panel-tools, so they need their own dispatch — same TOOL_ACTIONS map +
    // generation/index/master gates as wireToolsTab().
    $drawer.on('click', '.dle-empty-cta-btn[data-empty-action]', function () {
        const action = $(this).data('empty-action');
        const cmd = TOOL_ACTIONS[action];
        if (!cmd) return;
        const settings = getSettings();
        if (!settings.enabled && !SETUP_ACTIONS_WHILE_OFF.has(action)) {
            toastr.warning(tr('dle_toast_disabled'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        if (generationLock) {
            toastr.warning(tr('dle_toast_gen_in_progress'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        if (indexing) {
            toastr.warning(tr('dle_toast_indexing'), 'Onyx Quill', { timeOut: 2500 });
            return;
        }
        executeCommand(cmd);
    });

    // Inline chip clears in the active-filters strip.
    $drawer.on('click keydown', '.dle-active-filters .dle-chip-x', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (!chat_metadata) return;
        const $x = $(this);
        if ($x.hasClass('dle-chip-x-folder')) {
            chat_metadata.deeplore_folder_filter = null;
            saveMetadataDebounced();
            notifyGatingChanged();
            return;
        }
        const $chip = $x.closest('.dle-gating-value-chip');
        const key = $chip.data('ctx-key');
        const val = String($chip.data('ctx-val'));
        const ctx = chat_metadata.deeplore_context;
        if (!key || !ctx || ctx[key] == null) return;
        if (Array.isArray(ctx[key])) {
            ctx[key] = ctx[key].filter(v => String(v) !== val);
            if (ctx[key].length === 0) ctx[key] = [];
        } else {
            ctx[key] = null;
        }
        saveMetadataDebounced();
        notifyGatingChanged();
    });

    // Clear-all chip mirrors the gating-tab "clear all" button.
    $drawer.on('click keydown', '.dle-active-filters .dle-chip-clear-all', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (!chat_metadata) return;
        let cleared = 0;
        if (chat_metadata.deeplore_folder_filter && chat_metadata.deeplore_folder_filter.length > 0) {
            chat_metadata.deeplore_folder_filter = null;
            cleared++;
        }
        const ctx = chat_metadata.deeplore_context;
        if (ctx) {
            const allDefs = fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS;
            for (const fd of allDefs) {
                if (!fd.gating?.enabled) continue;
                const v = ctx[fd.contextKey];
                if (fd.multi ? (Array.isArray(v) && v.length > 0) : !!v) {
                    ctx[fd.contextKey] = fd.multi ? [] : null;
                    cleared++;
                }
            }
        }
        if (cleared === 0) return;
        saveMetadataDebounced();
        notifyGatingChanged();
        toastr.success(`Cleared ${cleared} filter${cleared !== 1 ? 's' : ''}.`, 'Onyx Quill', { timeOut: 1500 });
    });

    $drawer.on('click', '[data-action="goto-ai-connections"]', function (e) {
        e.stopPropagation();
        announceToScreenReader('Open Settings, then Setup, then AI Connections.');
        toastr.info(tr('dle_toast_goto_ai_connections'), 'Onyx Quill', { timeOut: 4000 });
    });
    $drawer.on('keydown', '[data-action="goto-ai-connections"]', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    $drawer.on('click', '.dle-chip-dismiss', function (e) {
        e.stopPropagation();
        ds.reasoningWarningDismissed = true;
        scheduleRender(renderStatusZone);
    });
    $drawer.on('keydown', '.dle-chip-dismiss', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });
}

export function wireHealthIcons($drawer) {
    const $footer = $drawer.find('#dle-drawer-footer');
    if (!$footer.length) return;

    $footer.find('.dle-health-icons').on('click', '[data-health]', function (e) {
        e.preventDefault();
        const area = $(this).data('health');
        switch (area) {
            case 'vault': executeCommand('/oq-health'); break;
            case 'connection': executeCommand('/oq-status'); break;
            case 'pipeline': executeCommand('/oq-inspect'); break;
            case 'cache': {
                const ageMs = indexTimestamp ? Date.now() - indexTimestamp : 0;
                const ageSec = Math.round(ageMs / 1000);
                const msg = indexTimestamp
                    ? `Index: ${vaultIndex.length} entries, ${ageSec}s old${indexEverLoaded ? '' : ' (from IndexedDB cache)'}`
                    : 'No index loaded yet.';
                if (typeof toastr !== 'undefined') toastr.info(msg, 'Cache Status');
                break;
            }
            case 'ai': {
                const totalTok = aiSearchStats.totalInputTokens + aiSearchStats.totalOutputTokens;
                const msg = `Calls: ${aiSearchStats.calls} | Cached: ${aiSearchStats.cachedHits} | Tokens: ${totalTok.toLocaleString()} (${aiSearchStats.totalInputTokens.toLocaleString()} in, ${aiSearchStats.totalOutputTokens.toLocaleString()} out)`;
                if (typeof toastr !== 'undefined') toastr.info(msg, 'AI Search Stats');
                break;
            }
        }
    });

    $footer.find('.dle-health-icons').on('keydown', '[data-health]', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $(this).trigger('click');
        }
    });
}

/** Drawer-wide shortcuts: r=refresh, s=scribe, n=newlore, g=graph, /=focus search. */
export function wireGlobalShortcuts($drawer) {
    $drawer.on('keydown.dle-shortcuts', function (e) {
        if (e.target.matches('input, textarea, [contenteditable]')) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        switch (e.key) {
            case 'r': e.preventDefault(); $drawer.find('.dle-action-btn[data-action="refresh"]').trigger('click'); break;
            case 's': e.preventDefault(); $drawer.find('.dle-action-btn[data-action="scribe"]').trigger('click'); break;
            case 'n': { const $n = $drawer.find('.dle-action-btn[data-action="newlore"]'); if ($n.length) { e.preventDefault(); $n.trigger('click'); } break; }
            case 'g': e.preventDefault(); $drawer.find('.dle-action-btn[data-action="graph"]').trigger('click'); break;
            case '/': {
                const $panel = $drawer.find('#dle-panel-browse');
                if ($panel.hasClass('active')) {
                    e.preventDefault();
                    $drawer.find('.dle-browse-input').trigger('focus');
                }
                break;
            }
        }
    });
}
