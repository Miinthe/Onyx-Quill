/** DeepLore — Slash Commands: AI Features */
import {
    chat,
    eventSource,
    event_types,
} from '../../../../../../script.js';
import { escapeHtml } from '../../../../../utils.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';
import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from '../../../../../slash-commands/SlashCommandEnumValue.js';
import { classifyError, NO_ENTRIES_MSG, yamlEscape } from '../../core/utils.js';
import { getSettings, getPrimaryVault, resolveConnectionConfig } from '../../settings.js';
import { vaultIndex, scribeInProgress, setIndexTimestamp, tryAcquireHalfOpenProbe, recordAiSuccess, recordAiFailure, releaseHalfOpenProbe } from '../state.js';
import { buildIndex, ensureIndexFresh } from '../vault/vault.js';
import { runScribe } from '../ai/scribe.js';
import { runAutoSuggest, showSuggestionPopup } from '../ai/auto-suggest.js';
import { optimizeEntryKeys, showOptimizePopup } from './popups.js';
import { parseRange, summarizeRange, rollbackSummary, listSummaries } from '../ai/summarize.js';
import { ensureFreshOrToast, resolveEntryByName } from './commands-shared.js';
import { tr, trf } from '../i18n/i18n.js';
import { notify } from '../toast-dedup.js';
import { abortWith } from '../diagnostics/interceptors.js';

export function registerAiCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-optimize-keys',
        callback: async (_args, entryName) => {
            if (!await ensureFreshOrToast('/oq-optimize-keys')) return '';
            if (vaultIndex.length === 0) {
                toastr.info(NO_ENTRIES_MSG, 'Onyx Quill');
                return '';
            }
            const name = (entryName || '').trim();
            if (!name) {
                toastr.info(tr('dle_cmd_optimizekeys_usage_toast'), 'Onyx Quill');
                return '';
            }
            // Shared fuzzy resolver so a typo / partial name doesn't drop on the floor.
            const entry = await resolveEntryByName(name, vaultIndex, { commandLabel: 'Optimize keys' });
            if (!entry) return '';
            const loadingToast = toastr.info(trf('dle_cmd_optimizekeys_loading_toast', entry.title), 'Onyx Quill', { timeOut: 0, extendedTimeOut: 0 });
            try {
                const result = await optimizeEntryKeys(entry);
                toastr.clear(loadingToast);
                await showOptimizePopup(entry, result);
            } catch (err) {
                toastr.clear(loadingToast);
                console.error('[DLE] Optimize keys error:', err);
                notify.error(classifyError(err), { copyable: true });
            }
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'vault entry title',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: true,
            enumProvider: () => vaultIndex.map(e => new SlashCommandEnumValue(e.title)),
        })],
        helpString: 'Suggest better keywords for an entry using AI. Usage: /oq-optimize-keys <entry name>.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    const newloreCallback = async () => {
        if (!chat || chat.length === 0) {
            toastr.info(tr('dle_cmd_newlore_nochat_toast'), 'Onyx Quill');
            return '';
        }
        const loadingToast = toastr.info(tr('dle_cmd_newlore_analyzing_toast'), 'Onyx Quill', { timeOut: 0, extendedTimeOut: 0 });
        try {
            const suggestions = await runAutoSuggest();
            toastr.clear(loadingToast);
            await showSuggestionPopup(suggestions);
        } catch (err) {
            toastr.clear(loadingToast);
            console.error('[DLE] Auto-suggest error:', err);
            notify.error(classifyError(err), { copyable: true });
        }
        return '';
    };
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-newlore',
        callback: newloreCallback,
        helpString: 'Analyze the chat for characters, locations, and concepts not in your lorebook, and suggest new entries to create.',
        returns: ARGUMENT_TYPE.STRING,
    }));
    // Backwards-compatible alias.
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-suggest',
        callback: newloreCallback,
        helpString: 'Analyze the chat and suggest new lorebook entries. Alias for /oq-newlore.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-scribe',
        callback: async (_args, userPrompt) => {
            if (scribeInProgress) {
                toastr.warning(tr('dle_cmd_scribe_inprogress_toast'), 'Onyx Quill');
                return '';
            }
            // BUG-AUDIT-H23: missing scribeFolder would write to "undefined/".
            const settings = getSettings();
            if (!settings.scribeFolder) {
                toastr.warning(tr('dle_cmd_scribe_nofolder_toast'), 'Onyx Quill');
                return '';
            }
            toastr.info(tr('dle_cmd_scribe_writing_toast'), 'Onyx Quill');
            await runScribe(userPrompt?.trim() || '');
            return 'Session note written.';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'optional focus topic for the scribe',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
        })],
        helpString: 'Write a session summary note to Obsidian. Usage: /oq-scribe <focus topic>. Example: /oq-scribe What happened with the sword?',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-review',
        callback: async (_args, userPrompt) => {
            try {
            await ensureIndexFresh();

            // BUG-AUDIT Fix 21: lorebook-guide entries are writing guides and must
            // never reach the writing AI. /oq-review previously dumped raw vaultIndex,
            // leaking guide content as a persistent user message. Mirrors writer-visible
            // contract from getWriterVisibleEntries() / matchTextForExternal.
            const reviewEntries = vaultIndex.filter(e => !e.guide);

            if (reviewEntries.length === 0) {
                toastr.info(NO_ENTRIES_MSG, 'Onyx Quill');
                return '';
            }

            const totalTokens = reviewEntries.reduce((sum, e) => sum + e.tokenEstimate, 0);

            // Miinthe 2026-10-18: the review used to go into the story chat as her message and stay there (sent with every
            // later reply). It is a talk with Mero now — the story chat stays as it was.
            const confirmed = await callGenericPopup(
                `<p>Mero reads all <b>${reviewEntries.length}</b> entries (~${totalTokens} tokens) in a new talk, on her own connection. Your story chat stays as it is.</p>
                <p class="dle-text-xs dle-muted">The whole vault goes along with every answer in that talk, so each one may take a while.</p>
                <p>Start the review?</p>`,
                POPUP_TYPE.CONFIRM, '', {},
            );
            if (!confirmed) return '';

            const { startVaultReview } = await import('../mero.js');
            const { openMeroTalk } = await import('../mero-window.js');
            const r = startVaultReview(userPrompt);
            if (r.error) { toastr.warning(r.error, 'Onyx Quill'); return ''; }
            openMeroTalk(r.talk.id);
            r.done.then(res => { if (!res?.ok) toastr.warning(`Mero could not answer: ${res?.error || 'no answer'}`, 'Onyx Quill'); });

            return '';
            } catch (err) {
                console.warn('[DLE] /oq-review failed:', err);
                toastr.error(tr('dle_cmd_review_error_msg'), 'Onyx Quill');
                return '';
            }
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'optional question to ask about the vault',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
        })],
        helpString: 'Have Mero review your entire vault in a new talk (nothing goes into the story chat). Usage: /oq-review <question>. Example: /oq-review What inconsistencies do you see?',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-summarize',
        callback: async () => {
            if (!await ensureFreshOrToast('/oq-summarize')) return '';
            if (vaultIndex.length === 0) {
                toastr.info(NO_ENTRIES_MSG, 'Onyx Quill');
                return '';
            }

            const missingSummary = vaultIndex.filter(e => !e.summary || !e.summary.trim());
            if (missingSummary.length === 0) {
                toastr.success(tr('dle_cmd_summarize_allhave_toast'), 'Onyx Quill');
                return '';
            }

            const confirmed = await callGenericPopup(
                `<p>Found <b>${missingSummary.length}</b> entries without AI search summaries.</p>
                <p>This will generate summaries using your AI search connection and present each for review before writing to Obsidian.</p>
                <p>Continue?</p>`,
                POPUP_TYPE.CONFIRM, '', {},
            );
            if (!confirmed) return '';

            const result = await summarizeEntries(missingSummary);
            let msg = `Done: ${result.generated} written, ${result.skipped} skipped, ${result.failed} failed`;
            if (result.aborted > 0) msg += `, ${result.aborted} aborted`;
            msg += '.';
            toastr.success(msg, 'Onyx Quill');

            if (result.generated > 0) {
                setIndexTimestamp(0);
                await buildIndex();
            }
            return '';
        },
        helpString: 'Generate AI search summaries for entries that are missing them. Each summary is presented for review before writing.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    // #15 — Dedicated summary feature: AI-summarize a chat range, hide originals, prepend summary.
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-summarize-range',
        callback: async (_args, rangeArg) => {
            if (!chat || chat.length === 0) {
                toastr.info(tr('dle_cmd_summarizerange_nochat_toast'), 'Onyx Quill');
                return '';
            }
            const range = parseRange(rangeArg || '', chat.length);
            if (!range) {
                toastr.warning(tr('dle_cmd_summarizerange_usage_toast'), 'Onyx Quill');
                return '';
            }
            const loading = toastr.info(`Summarizing messages ${range.start}–${range.end}...`, 'Onyx Quill', { timeOut: 0, extendedTimeOut: 0 });
            // L-16: summarizeRange accepts a signal but nothing ever passed one, so a
            // slow summary couldn't be cancelled and would mutate the chat even after
            // the user switched away. Abort on CHAT_CHANGED so it bails before the
            // hide+prepend (summarizeRange re-checks signal.aborted around the AI call).
            const summarizeAbort = new AbortController();
            // Gotcha #38: route through abortWith so signal.reason carries attribution
            // (a bare .abort() loses the post-mortem reason the diagnostics depend on).
            const onChatChange = () => abortWith(summarizeAbort, 'summarize:chat_changed');
            try { eventSource.on(event_types.CHAT_CHANGED, onChatChange); } catch { /* noop */ }
            try {
                const result = await summarizeRange(range, summarizeAbort.signal);
                toastr.clear(loading);
                if (!result.ok) {
                    notify.error(result.error, { copyable: true });
                    return '';
                }
                toastr.success(`Summarized ${result.hiddenCount} messages. ID: ${result.summaryId} (use /oq-summarize-rollback ${result.summaryId} to undo).`, 'Onyx Quill', { timeOut: 8000 });
                return result.summaryId;
            } catch (err) {
                toastr.clear(loading);
                notify.error(trf('dle_cmd_summarizerange_error_msg', err.message), { copyable: true });
                return '';
            } finally {
                try { eventSource.removeListener(event_types.CHAT_CHANGED, onChatChange); } catch { /* noop */ }
            }
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'range: start-end, N- (from N), -N (last N), or single N',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: true,
        })],
        helpString: 'AI-summarize a chat range, hide originals, prepend the summary. Usage: /oq-summarize-range <range>. Examples: 5-15 (range), 10- (from 10 to end), -8 (last 8 messages), 7 (single message).',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-summarize-rollback',
        callback: async (_args, idArg) => {
            const id = (idArg || '').trim();
            const result = await rollbackSummary(id || 'all');
            if (!result.ok) {
                toastr.warning(result.error || 'Rollback failed', 'Onyx Quill');
                return '';
            }
            toastr.success(`Restored ${result.restored} messages, removed ${result.removed} summary message${result.removed === 1 ? '' : 's'}.`, 'Onyx Quill');
            return '';
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'summary id to roll back (omit or "all" = roll back every summary in this chat)',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
            enumProvider: () => {
                const list = listSummaries();
                return [
                    new SlashCommandEnumValue('all', 'roll back every summary'),
                    ...list.map(s => new SlashCommandEnumValue(s.id, `#${s.summaryIndex} · ${s.hiddenCount} hidden · ${new Date(s.createdAt).toLocaleTimeString()}`)),
                ];
            },
        })],
        helpString: 'Roll back a /oq-summarize-range operation. Usage: /oq-summarize-rollback [id|all].',
        returns: ARGUMENT_TYPE.STRING,
    }));
}

/**
 * Each summary is presented for review before writing. Aborted via button in review popup.
 * @returns {{ generated: number, skipped: number, failed: number, aborted: number }}
 */
export async function summarizeEntries(entries) {
    const { callAI, isExcludedFromBreaker } = await import('../ai/ai.js');
    const { writeNote, obsidianFetch, encodeVaultPath } = await import('../vault/obsidian-api.js');
    const settings = getSettings();
    const vault = getPrimaryVault(settings);
    // Wave-B contract: the batch summary path was bypassing BOTH resolveConnectionConfig
    // AND the breaker. Without breaker integration a bad API key here used to bake every
    // per-entry call without ever shedding load; without resolveConnectionConfig the loop
    // ignored settings.optimizeKeys / inheritance and reached straight into aiSearch.* .
    // Mirror callScribe / callAutoSuggest: resolve a tool config, gate every call with
    // tryAcquireHalfOpenProbe, route the trip decision through isExcludedFromBreaker.
    const resolved = resolveConnectionConfig('optimizeKeys');

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    let aborted = false;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        toastr.info(`Generating summary ${i + 1}/${entries.length}: "${entry.title}"...`, 'Onyx Quill', { timeOut: 0, extendedTimeOut: 0 });

        try {
            // LOCAL PATCH 2026-08-03 (Miinthe): rewritten. The old prompt said "max 600 chars"
            // (read as a target — real summaries came out at a median of 562) and asked it to
            // answer "What is this?" first, which is exactly what produced the useless
            // preamble every summary opened with: "This is a session summary documenting…".
            // It also never forbade spoilers, so retrieval lines were giving away the twists
            // the entries exist to guard — against the vault's own rule 13.
            const systemPrompt = 'You are a retrieval librarian. Write ONE sentence, under 40 words, telling an AI WHEN to select this lorebook entry.\n\nRules:\n- Start with the trigger, not with what the entry is. Never begin with "This entry", "This is", "A session log", "This details" or anything similar.\n- Name concrete things that would actually appear in a scene: people, places, objects, events, topics of conversation.\n- Do NOT reveal twists, secrets, or outcomes the entry exists to guard. Name the subject, never the answer.\n- No physical description, no atmosphere, no plot recap.\n\nOutput the sentence only.';
            const userMsg = `Entry: ${entry.title}\n\nContent:\n${entry.content.substring(0, 3000)}`;

            // Breaker probe per call. If open (or probe taken), skip this entry but keep
            // looping — `failed++` (not aborted), so the toast at the end still reports
            // a useful count.
            if (!tryAcquireHalfOpenProbe()) {
                console.warn('[DLE] summarizeEntries: circuit breaker open — skipping entry', entry.title);
                failed++;
                continue;
            }
            let result;
            try {
                result = await callAI(systemPrompt, userMsg, {
                    ...resolved,
                    caller: 'summaryGen',
                    maxTokens: 300,
                });
                recordAiSuccess();
            } catch (callErr) {
                if (!isExcludedFromBreaker(callErr)) recordAiFailure(); else releaseHalfOpenProbe();
                throw callErr;
            }
            // Audit DIAG-09: result.text may be undefined when the AI call fails or returns
            // an unexpected shape. Bare .trim() would throw and crash the per-entry loop.
            const responseText = (result && typeof result.text === 'string') ? result.text : '';

            // LOCAL PATCH 2026-08-03 (Miinthe): 600 -> 400. A safety net, not a target; the
            // prompt above asks for well under this.
            const summary = responseText.trim().substring(0, 400);
            if (!summary) {
                failed++;
                continue;
            }

            const remaining = entries.length - i - 1;
            const reviewHtml = `
                <div class="dle-popup">
                    <h4>${escapeHtml(entry.title)}</h4>
                    <p class="dle-text-xs dle-muted dle-mb-2">Progress: ${i + 1} of ${entries.length} | ${generated} written, ${skipped} skipped, ${failed} failed${remaining > 0 ? ` | ${remaining} remaining` : ''}</p>
                    <p class="dle-text-sm dle-muted">Entry content preview: ${escapeHtml(entry.content.substring(0, 200))}...</p>
                    <hr>
                    <p><b>Generated Summary:</b></p>
                    <textarea id="dle-summary-edit" class="text_pole dle-summary-textarea">${escapeHtml(summary)}</textarea>
                    <p class="dle-text-xs dle-faint">OK = write to Obsidian, Cancel = skip this entry.</p>
                    ${remaining > 0 ? '<button type="button" id="dle-summary-abort" class="menu_button" style="margin-top:8px;"><i class="fa-solid fa-stop"></i> Abort remaining</button>' : ''}
                </div>`;

            let capturedTextarea = null;
            let userAborted = false;
            const approved = await callGenericPopup(reviewHtml, POPUP_TYPE.CONFIRM, '', {
                wide: true,
                onOpen: () => {
                    capturedTextarea = document.getElementById('dle-summary-edit');
                    const abortBtn = document.getElementById('dle-summary-abort');
                    if (abortBtn) {
                        abortBtn.addEventListener('click', () => {
                            userAborted = true;
                            document.querySelector('.popup-button-cancel')?.click();
                        });
                    }
                },
            });

            if (userAborted) {
                aborted = true;
                break;
            }

            if (!approved) {
                skipped++;
                continue;
            }

            const finalSummary = capturedTextarea?.value?.trim() || summary;

            const fileResult = await obsidianFetch({
                host: vault.host,
                port: vault.port,
                apiKey: vault.apiKey,
                https: !!vault.https,
                path: `/vault/${encodeVaultPath(entry.filename)}`,
                accept: 'text/markdown',
            });

            if (fileResult.status !== 200) {
                failed++;
                console.warn(`[DLE] Failed to read ${entry.filename}: HTTP ${fileResult.status}`);
                continue;
            }

            let fileContent = fileResult.data;
            if (fileContent.startsWith('---')) {
                const endIdx = fileContent.indexOf('---', 3);
                if (endIdx > 0) {
                    const fmSection = fileContent.substring(0, endIdx);
                    const rest = fileContent.substring(endIdx);
                    // LOCAL PATCH 2026-08-02 (Miinthe): `/^summary:.*$/m` removed only the FIRST
                    // LINE of the old summary. When that summary was a multi-line YAML block
                    // (`summary: |` followed by indented prose) the header vanished and the
                    // indented text stayed behind, orphaned inside the frontmatter with no key
                    // holding it. A new `summary:` was then appended after the wreckage.
                    // Result: junk absorbed into whatever key preceded it — one session note
                    // silently gained five sentence-long "keys" — and the file stopped parsing
                    // under strict YAML. It happened three times to the same entry (2026-07-27
                    // twice, found again 2026-08-02). This consumes the whole block: the
                    // `summary:` line plus every following indented or blank line, stopping at
                    // the next real key at column 0.
                    const cleaned = fmSection
                        .replace(/^summary:.*(?:\n(?:[ \t]+.*|[ \t]*))*$/m, '')
                        .replace(/\n{3,}/g, '\n\n');
                    fileContent = cleaned + `summary: ${yamlEscape(finalSummary)}\n` + rest;
                }
            }

            const writeResult = await writeNote(vault.host, vault.port, vault.apiKey, entry.filename, fileContent, !!vault.https);
            if (writeResult.ok) {
                generated++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`[DLE] Summary generation error for "${entry.title}":`, err);
            failed++;
        }
    }

    const abortedCount = aborted ? entries.length - generated - skipped - failed : 0;
    return { generated, skipped, failed, aborted: abortedCount };
}
