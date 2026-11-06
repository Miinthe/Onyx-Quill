/**
 * DeepLore — Session Scribe
 */
import {
    generateQuietPrompt,
    chat,
    chat_metadata,
    name2,
    eventSource,
    event_types,
} from '../../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../../extensions.js';
import { getSettings, resolveConnectionConfig, resolveWriteVault } from '../../settings.js';
import { writeNote } from '../vault/obsidian-api.js';
import { resolveSessionFolder } from './session-folder-pure.js';
import { buildIndex } from '../vault/vault.js';
import { buildAiChatContext } from '../../core/utils.js';
import { callAI, isExcludedFromBreaker } from './ai.js';

// LOCAL PATCH (Miinthe, 2026-07-28): stamp the chat's declared gating context onto entries
// born from play, so play-born lore is world-walled and run-scoped without hand-tagging.
// DeepLore itself writes no context fields. Re-apply after a DeepLore update.
// LOCAL PATCH 2026-08-02 (Miinthe): Session Scribe used to write no `keys:` and no `summary:`,
// so a session note could not be keyword-matched at all and the AI judge fell back to
// reading truncated body text. These three helpers add both at creation time, and file the
// note into the right instance subfolder.

/** Instruction appended to whatever SCRIBE_PROMPT resolves to. Miinthe's stored prompt is never
 *  modified — this is concatenated at call time, and everything degrades to the old
 *  behaviour if the model ignores it. */
const DLE_META_INSTRUCTION = `
---
After the session note, output exactly one metadata block in this format and nothing after it:

<<<DLE-META
KEYS: four to six short, discriminating search terms, comma separated. Use concrete nouns, names and events from THIS session. Never use the character's own name or the world's name — they appear in every scene and would make the entry fire constantly.
SUMMARY: one sentence, under 40 words, saying WHEN this session should be recalled. Write it for a retrieval model, not for a reader. Do not reveal plot twists.
DLE-META>>>`;

/** Pull the metadata block out of the model's reply. Returns { body, keys, summary }; on
 *  anything unexpected, keys/summary come back empty and the note is written as before. */
function dleExtractMeta(raw) {
    const out = { body: raw, keys: [], summary: '' };
    const m = raw.match(/<<<DLE-META([\s\S]*?)DLE-META>>>/);
    if (!m) return out;
    out.body = raw.slice(0, m.index).trim();
    // LOCAL PATCH 2026-08-04 (Miinthe): a small model can emit the metadata block FIRST and the
    // note after it, which left body empty. Only when nothing precedes the block do we fall
    // back to what follows it — the normal "note then block" shape is unaffected.
    if (!out.body) out.body = raw.slice(m.index + m[0].length).trim();
    const block = m[1];
    const km = block.match(/KEYS:\s*(.+)/i);
    if (km) {
        out.keys = km[1].split(',').map(k => k.trim().replace(/^["'\[]+|["'\]]+$/g, ''))
            .filter(k => k && k.length <= 60).slice(0, 8);
    }
    const sm = block.match(/SUMMARY:\s*([\s\S]+?)(?:\n[A-Z]+:|$)/i);
    if (sm) out.summary = sm[1].trim().replace(/\s+/g, ' ').slice(0, 400);
    return out;
}

// LOCAL PATCH 2026-08-09 (Miinthe): session-folder routing moved to session-folder-pure.js so
// it can be unit-tested. It also stopped falling back to "the only folder with this letter",
// which filed a second character's session into the first character's run — see that file.

function dleContextYaml(keys) {
    const ctx = (typeof chat_metadata !== 'undefined' && chat_metadata?.deeplore_context) || {};
    let out = '';
    for (const k of keys) {
        const raw = ctx[k];
        const vals = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).filter(v => v !== '' && v != null);
        if (vals.length === 1) out += `${k}: ${vals[0]}\n`;
        else if (vals.length > 1) out += `${k}:\n` + vals.map(v => `  - ${v}`).join('\n') + '\n';
    }
    return out;
}

import { stripObsidianSyntax } from '../helpers.js';
import {
    scribeInProgress, lastScribeSummary, chatEpoch,
    setScribeInProgress, setLastScribeSummary, setLastScribeChatLength,
    tryAcquireHalfOpenProbe, recordAiSuccess, recordAiFailure, releaseHalfOpenProbe,
    folderList,   // LOCAL PATCH (Miinthe): session folder resolution
} from '../state.js';
import { dedupError, dedupWarning } from '../toast-dedup.js';
import { pushEvent } from '../diagnostics/interceptors.js';
import { resolvePromptOrOverride } from '../prompts/prompt-store.js';
import { trf } from '../i18n/i18n.js';

// Scribe default prompt moved to src/i18n/prompts/en.js as SCRIBE_PROMPT
// and resolved at call time via getPrompt('SCRIBE_PROMPT'). See the
// editable-prompts feature (v2.5) for the new contract.

/**
 * Route a Scribe AI call by configured connection mode.
 * @returns {Promise<string>} Generated summary text.
 */
export async function callScribe(systemPrompt, userMessage, _settings) {
    const resolved = resolveConnectionConfig('scribe');
    const mode = resolved.mode;

    if (mode === 'profile') {
        // v2.5 dead-head: 'proxy' removed from the dispatch whitelist. callAI's
        // proxy branch throws a migration error if a legacy 'proxy' value reaches it.
        // S4-1: mutation gate — tryAcquireHalfOpenProbe, not isAiCircuitOpen
        // (returns false in half-open-no-probe → would leak the probe slot).
        if (!tryAcquireHalfOpenProbe()) throw new Error('AI circuit breaker is open — skipping scribe');
        try {
            const result = await callAI(systemPrompt, userMessage, { ...resolved, caller: 'scribe' });
            recordAiSuccess();
            return result.text || '';
        } catch (err) {
            // BUG-252 + Wave-B contract: shared classifier covers throttled / userAborted /
            // timedOut PLUS HTTP 401/403 (auth) and 429 (rate-limit). Bad API key isn't a
            // service-down signal; without this, the second scribe call after a typo'd key
            // tripped the breaker and locked every AI feature for 30s.
            if (!isExcludedFromBreaker(err)) recordAiFailure(); else releaseHalfOpenProbe(); // #11: free dangling half-open probe
            throw err;
        }
    }

    // v2.5 dead-head: refuse legacy proxy mode explicitly so it doesn't silently
    // fall through to ST's active-connection 'st' path below (which would mask
    // the misconfiguration and use whatever connection ST happens to have).
    if (mode === 'proxy') {
        throw new Error('Custom Proxy mode was removed in v2.5. Pick a Connection Profile in Onyx Quill Settings → Setup → AI Connections.');
    }

    // 'st' mode — ST's active connection via generateQuietPrompt.
    // BUG-116: breaker integration to match profile/proxy. S4-1 mutation gate (above).
    if (!tryAcquireHalfOpenProbe()) throw new Error('AI circuit breaker is open — skipping scribe');
    // generateQuietPrompt can't be aborted — the background gen will complete regardless,
    // but BUG-241 wires GENERATION_STOPPED so our await resolves early and the
    // scribeInProgress lock releases promptly instead of waiting the full timeout.
    const quietPrompt = `${systemPrompt}\n\n${userMessage}`;
    // timeout=0 means "no timeout" — setTimeout(fn, 0) would fire immediately.
    const timeout = resolved.timeout || 60000;
    const quietPromise = generateQuietPrompt({ quietPrompt, skipWIAN: true, responseLength: resolved.maxTokens });
    let scribeTimer;
    let onStop;
    try {
        const result = await Promise.race([
            quietPromise.finally(() => clearTimeout(scribeTimer)),
            new Promise((_, reject) => { scribeTimer = setTimeout(() => {
                console.warn('[Onyx Quill] Scribe quiet prompt timed out — orphaned generation may still complete in background');
                const err = new Error(`Scribe quiet prompt timed out (${Math.round(timeout / 1000)}s)`);
                err.timedOut = true;
                reject(err);
            }, timeout); }),
            new Promise((_, reject) => {
                onStop = () => {
                    const err = new Error('Scribe aborted by user (GENERATION_STOPPED)');
                    err.name = 'AbortError';
                    err.userAborted = true;
                    reject(err);
                };
                // BUG-AUDIT: null onStop on registration failure so finally doesn't
                // remove a listener that was never added.
                try {
                    eventSource.on(event_types.GENERATION_STOPPED, onStop);
                } catch (regErr) {
                    console.warn('[Onyx Quill] Scribe stop-listener registration failed:', regErr?.message);
                    onStop = null;
                }
            }),
        ]);
        // BUG-116: breaker integration to match profile/proxy.
        recordAiSuccess();
        return result;
    } catch (err) {
        // BUG-116/BUG-252 + Wave-B contract: shared classifier — see note above.
        if (!isExcludedFromBreaker(err)) recordAiFailure(); else releaseHalfOpenProbe(); // #11: free dangling half-open probe
        throw err;
    } finally {
        if (onStop) { try { eventSource.removeListener(event_types.GENERATION_STOPPED, onStop); } catch { /* noop */ } }
    }
}

/** Summarize recent chat and write to Obsidian. */
export async function runScribe(customPrompt) {
    if (scribeInProgress) return;
    setScribeInProgress(true);
    pushEvent('scribe', { action: 'start' });

    const epoch = chatEpoch;

    try {
        const settings = getSettings();
        if (!chat || chat.length === 0) {
            dedupWarning('No active chat to summarize.', 'scribe_no_chat');
            return;
        }

        const context = buildAiChatContext(chat, settings.scribeScanDepth);
        if (!context.trim()) {
            dedupWarning('No messages to summarize.', 'scribe_no_messages');
            return;
        }

        const systemPrompt = resolvePromptOrOverride('SCRIBE_PROMPT', settings.scribePrompt);

        const parts = [];
        if (lastScribeSummary) {
            parts.push(`[PREVIOUS SESSION NOTE]\n${lastScribeSummary}`);
        }
        parts.push(`[RECENT CONVERSATION]\n${context}`);
        if (customPrompt) {
            parts.push(`[ADDITIONAL FOCUS]\n${customPrompt}`);
        }
        const userMessage = parts.join('\n\n');

        const summary = await callScribe(systemPrompt + DLE_META_INSTRUCTION, userMessage, settings);

        if (!summary || !summary.trim()) {
            dedupWarning('Session Scribe couldn\'t finish — your chat is unchanged.', 'scribe_empty_summary', { hint: 'Scribe returned empty summary.' });
            return;
        }

        // LOCAL PATCH 2026-08-02 (Miinthe): split the metadata block off before sanitising, so
        // KEYS/SUMMARY never leak into the note body.
        const _meta = dleExtractMeta(summary);
        // Strip Obsidian syntax + neutralize bare YAML delimiters in AI output.
        const sanitizedSummary = stripObsidianSyntax(_meta.body).replace(/^---$/gm, '- - -');

        // LOCAL PATCH 2026-08-04 (Miinthe): the empty-reply guard above tests the RAW reply, which
        // still contains the DLE-META block — so a reply that is metadata and nothing else
        // passes it, and the note was then written with a complete frontmatter and an empty
        // body. Re-check AFTER the split and refuse to write. An empty note in the vault is
        // worse than no note: it looks like a real entry and silently injects nothing.
        if (!sanitizedSummary.trim()) {
            dedupWarning(
                'Session Scribe returned metadata but no session text — nothing was written.',
                'scribe_empty_body',
                { hint: 'Model emitted only the DLE-META block. Raise the scribe token budget, or turn thinking off for its connection profile.' },
            );
            return;
        }

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
        let charName = (name2 || 'Unknown').replace(/[<>:"/\\|?*]/g, '_');
        charName = charName.replace(/^\.+|\.+$/g, '');
        charName = charName.trimEnd();
        // Prefix Windows reserved names to avoid filesystem collisions.
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(charName)) {
            charName = '_' + charName;
        }
        if (!charName) charName = 'Unknown';
        // LOCAL PATCH 2026-08-02 (Miinthe): `character:` is sourced from the chat's gating context
        // when set, falling back to the SillyTavern card name. Gating compares against the
        // context value, so stamping the card name could silently gate a session out of its
        // own character's chats if the two ever diverge.
        const _dleCtx = (typeof chat_metadata !== 'undefined' && chat_metadata?.deeplore_context) || {};
        const _ctxChar = Array.isArray(_dleCtx.character) ? _dleCtx.character[0] : _dleCtx.character;
        const _charField = (_ctxChar && String(_ctxChar).trim()) || charName;
        const _instance = _dleCtx.instance;

        // LOCAL PATCH 2026-08-09 (Miinthe): route on the SAME character value that gets stamped
        // into `character:` below, with the card name only as a secondary candidate. Routing
        // on the card name while stamping the context name let the two halves disagree —
        // the card is "Wren" while the context and the folder both say "Wren; Gallery Light".
        const _targetFolder = resolveSessionFolder(
            settings.scribeFolder, [_charField, charName], _instance, folderList,
        );
        const filename = `${_targetFolder}/${charName} - ${dateStr} ${timeStr}.md`;

        const _yamlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const _keysYaml = _meta.keys.length
            ? `keys:\n${_meta.keys.map(k => `  - ${_yamlStr(k)}`).join('\n')}\n` : '';
        const _summaryYaml = _meta.summary ? `summary: ${_yamlStr(_meta.summary)}\n` : '';

        // LOCAL PATCH 2026-08-04 (Miinthe): DeepLore tagged session notes `lorebook-session` ONLY.
        // parseVaultFile (core/pipeline.js) admits an entry only when its tags contain the
        // CONFIGURED lorebook tag by exact match, so every session note was skipped as
        // SKIP_NO_LOREBOOK_TAG and had to be hand-tagged before DeepLore could see it.
        // `lorebook-session` is written here and read nowhere in the codebase. Emit the
        // configured tag alongside it so play-born notes are indexable at birth.
        const _tagList = [settings.lorebookTag || 'lorebook', 'lorebook-session']
            .filter((t, i, a) => t && a.indexOf(t) === i);
        const _tagsYaml = _tagList.map(t => `  - ${t}`).join('\n');

        const noteContent = `---\ntags:\n${_tagsYaml}\ndate: ${now.toISOString()}\ncharacter: ${_yamlStr(_charField)}\n${_keysYaml}${_summaryYaml}${dleContextYaml(['instance'])}---\n# Session: ${charName} - ${dateStr} ${timeStr}\n\n${sanitizedSummary.trim()}\n`;

        if (epoch !== chatEpoch) {
            if (getSettings().debugMode) console.log('[Onyx Quill] Scribe: chat changed during generation, discarding result');
            return;
        }

        const scribeVault = resolveWriteVault('scribe', settings);
        const data = await writeNote(scribeVault.host, scribeVault.port, scribeVault.apiKey, filename, noteContent, !!scribeVault.https);

        if (data.ok) {
            // Re-check epoch after the async write — would otherwise persist to wrong chat's metadata.
            if (epoch !== chatEpoch) {
                if (getSettings().debugMode) console.log('[Onyx Quill] Scribe: chat changed during note write, skipping metadata update');
                return;
            }
            const finalSummary = sanitizedSummary.trim();
            setLastScribeSummary(finalSummary);
            const chatLenAtWrite = chat?.length || 0;
            setLastScribeChatLength(chatLenAtWrite);
            // BUG-056: write the local computed value, not the live `lastScribeSummary` binding —
            // a future debounced/setter migration would otherwise persist the previous summary.
            chat_metadata.deeplore_lastScribeSummary = finalSummary;
            // BUG-308: persist the "scribed at length N" guard so CHAT_CHANGED / reload can
            // hydrate it. In-memory-only previously let returning to a chat re-trigger
            // scribe immediately on the next render despite no growth.
            chat_metadata.deeplore_lastScribeChatLength = chatLenAtWrite;
            // BUG-AUDIT: flush synchronously. Debounced save reads live chat_metadata at
            // flush time — CHAT_CHANGED in the debounce window would orphan the write to
            // the old object and it would never hit disk.
            try {
                await getContext().saveMetadata();
            } catch (saveErr) {
                console.warn('[Onyx Quill] Scribe: sync saveMetadata failed, falling back to debounced:', saveErr?.message);
                saveMetadataDebounced();
            }
            pushEvent('scribe', { action: 'completed', chatLength: chatLenAtWrite });
            toastr.success(trf('dle_scribe_toast_saved', filename), 'Onyx Quill', { timeOut: 5000 });
            if (epoch !== chatEpoch) {
                if (getSettings().debugMode) console.log('[Onyx Quill] Scribe: chat changed before reindex, skipping buildIndex');
                return;
            }
            try { await buildIndex(); } catch (reidxErr) {
                console.warn('[Onyx Quill] Scribe reindex after write failed:', reidxErr?.message);
                // BUG-AUDIT: without surfacing this, the note is on disk but unretrievable
                // until the next manual refresh.
                try {
                    toastr.warning(
                        trf('dle_scribe_toast_reindex_failed', reidxErr?.message || 'unknown error'),
                        'Onyx Quill',
                        { timeOut: 10000 },
                    );
                } catch { /* toastr unavailable */ }
            }
        } else {
            dedupError('Couldn\'t save the session note to your vault.', 'scribe_write_fail', { hint: data && data.error });
        }
    } catch (err) {
        console.error('[Onyx Quill] Session Scribe error:', err);
        pushEvent('scribe', { action: 'error', error: err?.message });
        dedupError('Session Scribe couldn\'t finish — your chat is unchanged.', 'scribe_runtime_error', { hint: err && err.message });
    } finally {
        // BUG-275: always release. This invocation owns the flag from acquisition to
        // here; CHAT_CHANGED no longer touches it, so an epoch-guarded reset would
        // have leaked it forever on chat switch mid-scribe.
        setScribeInProgress(false);
    }
}
