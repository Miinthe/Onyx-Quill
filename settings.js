import {
    extension_settings,
} from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { validateSettings } from './core/utils.js';
// Re-export pure migration helpers for call-site compatibility (index.js, tests).
// `runMigrations` and `PROXY_DEPRECATION_MODE_KEYS` live in the pure module so
// regression tests can import them without ST globals.
import { runMigrations, PROXY_DEPRECATION_MODE_KEYS } from './src/settings-migrations-pure.js';
export { runMigrations, PROXY_DEPRECATION_MODE_KEYS };

export const MODULE_NAME = 'deeplore_enhanced';

export const PROMPT_TAG = 'deeplore_enhanced';
export const PROMPT_TAG_PREFIX = 'deeplore_';

// AI search system prompt moved to src/i18n/prompts/en.js as
// AI_SEARCH_SYSTEM_PROMPT and resolved at call time via
// getPrompt('AI_SEARCH_SYSTEM_PROMPT'). See src/ai/ai.js and the editable-
// prompts feature (v2.5) for the new contract.

// AI Notepad instruction prompt moved to src/i18n/prompts/en.js as
// AI_NOTEPAD_PROMPT and resolved at call time via getPrompt('AI_NOTEPAD_PROMPT').
// See index.js (notepad extraction) for the new contract.

export const defaultSettings = {
    enabled: false,
    obsidianPort: 27123,
    obsidianApiKey: '',
    lorebookTag: 'lorebook',
    constantTag: 'lorebook-always',
    neverInsertTag: 'lorebook-never',
    seedTag: 'lorebook-seed',
    bootstrapTag: 'lorebook-bootstrap',
    // The writing-guide tag (Settings › Vault › "Writing-guide tag"): entries with it are style guides, never story lore.
    // Saved as `librarianGuideTag` until settings version 7 (2026-11-02), which renames it.
    guideTag: 'lorebook-guide',
    newChatThreshold: 3,
    scanDepth: 4,
    maxEntries: 10,
    unlimitedEntries: false,
    maxTokensBudget: 3072,
    unlimitedBudget: false,
    injectionMode: 'extension', // 'extension' or 'prompt_list' (PM integration)
    injectionPosition: 1,   // extension_prompt_types.IN_CHAT
    injectionDepth: 4,
    injectionRole: 0,        // extension_prompt_roles.SYSTEM
    injectionTemplate: '<{{title}}>\n{{content}}\n</{{title}}>',
    allowWIScan: false,
    recursiveScan: false,
    maxRecursionSteps: 3,
    matchWholeWords: false,
    caseSensitive: false,
    cacheTTL: 300,
    reviewResponseTokens: 0,
    debugMode: false,
    // i18n: AI prompt locale (separate from UI locale). Empty = follow ST UI locale.
    // Values: '' (follow UI), 'en', 'es-es', 'fr-fr', 'de-de', 'ja-jp', 'zh-cn', 'ru-ru'.
    // Affects which translated default prompts the AI features use; user-overridden
    // prompt text (settings.aiSystemPrompt, scribePrompt, etc.) is unaffected.
    aiPromptLocale: '',
    // Editable prompts (v2.5): folder inside Obsidian vault where prompt
    // override .md files live. Default 'DeepLore/prompts/' — sibling to
    // field-definitions.yaml. Sanitized via sanitizePromptsFolderPath() before
    // every I/O call. Empty/null = use the default.
    promptsFolderPath: 'DeepLore/prompts/',
    // Author's Notebook (user-written)
    notebookEnabled: false,
    notebookPosition: 1,
    notebookDepth: 4,
    notebookRole: 0,
    // AI Notepad (AI-written session notes)
    aiNotepadEnabled: false,
    aiNotepadMode: 'tag',    // 'tag' = AI emits <dle-notes>; 'extract' = post-gen API call extracts notes
    aiNotepadPosition: 1,
    aiNotepadDepth: 4,
    aiNotepadRole: 0,
    aiNotepadPrompt: '',      // tag-mode instruction (empty = default)
    aiNotepadExtractPrompt: '', // extract-mode prompt (empty = default)
    aiNotepadConnectionMode: 'inherit', // 'inherit' | 'profile' | 'proxy'
    aiNotepadProfileId: '',
    aiNotepadProxyUrl: 'http://127.0.0.1:42069',
    aiNotepadModel: '',
    aiNotepadMaxTokens: 1024,
    aiNotepadTimeout: 30000,
    // FIFO cap on AI Notepad entries (lines) per chat. New entries bump the oldest
    // non-pinned line when the cap is reached. 0 disables the entry cap (the legacy
    // 64KB char cap still applies as a backstop).
    aiNotepadMaxEntries: 50,
    // Bigram-Dice similarity threshold for the manual "Deduplicate" button in the
    // AI Notepad popup. 0.0 = identical only; 1.0 = exact strings; ~0.85 catches
    // near-duplicates without merging distinct notes that happen to share words.
    aiNotepadFuzzyDedupThreshold: 0.85,
    // AI Search
    aiSearchEnabled: false,
    aiSearchConnectionMode: 'profile',
    aiSearchProfileId: '',
    aiSearchProxyUrl: 'http://127.0.0.1:42069',
    aiSearchModel: '',
    aiSearchMaxTokens: 1024,
    aiSearchTimeout: 20000,
    aiSearchMode: 'two-stage',
    aiSearchScanDepth: 4,
    aiSearchSystemPrompt: '',
    aiSearchManifestSummaryLength: 600,
    aiSearchClaudeCodePrefix: false,
    aiForceUserRole: false, // merge system prompt into user message for providers that lack a system role
    scribeInformedRetrieval: false, // feed Scribe session summary into AI search context
    // Context Cartographer
    showLoreSources: true,
    // Session Scribe
    scribeEnabled: false,
    scribeInterval: 5,
    scribeFolder: 'Sessions',
    scribePrompt: '',
    scribeConnectionMode: 'inherit',
    scribeProfileId: '',
    scribeProxyUrl: 'http://127.0.0.1:42069',
    scribeModel: '',
    scribeMaxTokens: 1024,
    scribeTimeout: 60000,
    scribeScanDepth: 20,
    // Vault name to write Scribe summaries to. '' = use primary (first enabled) vault.
    // The value is a vault.name string (vaults are identified by name, not numeric id).
    scribeWriteVaultId: '',
    // Vault Sync
    syncPollingInterval: 0,
    showSyncToasts: true,
    reinjectionCooldown: 0,
    // Auto Lorebook Creation
    autoSuggestEnabled: false,
    autoSuggestInterval: 10,
    autoSuggestConnectionMode: 'inherit',
    autoSuggestProfileId: '',
    autoSuggestProxyUrl: 'http://127.0.0.1:42069',
    autoSuggestModel: '',
    autoSuggestMaxTokens: 2048,
    autoSuggestTimeout: 30000,
    autoSuggestFolder: '',
    autoSuggestPrompt: '',
    // Vault name to write auto-suggest entries to. '' = use primary vault.
    autoSuggestWriteVaultId: '',
    stripDuplicateInjections: false,       // off since v8 (Miinthe, 2026-11-03): skipping last turn's entries left the writer without them
    stripLookbackDepth: 2,
    // BUG-AUDIT-H20: must match HTML <option value="keyword">, NOT "keyword-only".
    optimizeKeysMode: 'keyword',
    optimizeKeysPrompt: '',
    optimizeKeysConnectionMode: 'inherit',
    optimizeKeysProfileId: '',
    optimizeKeysProxyUrl: 'http://127.0.0.1:42069',
    optimizeKeysModel: '',
    optimizeKeysMaxTokens: 1024,
    optimizeKeysTimeout: 30000,
    // LOCAL PATCH (Miinthe, 2026-10-03): story trackers that follow the story. Its own
    // pinned connection — no 'inherit', so it can never silently follow another tool.
    storyTrackerConnectionMode: 'profile',
    storyTrackerProfileId: '',
    storyTrackerProxyUrl: '',
    storyTrackerModel: '',
    storyTrackerMaxTokens: 400,
    storyTrackerTimeout: 20000,
    // LOCAL PATCH (Miinthe, 2026-10-05): Mero ☆, the co-writer — her own pinned connection (no inherit)
    meroConnectionMode: 'profile',
    meroProfileId: '',
    meroProxyUrl: '',
    meroModel: '',
    meroMaxTokens: 1500,
    meroTimeout: 120000,
    // world layer (Miinthe, 2026-10-19): its own pinned connection; empty = the story helper's (her pick: start on DeepSeek like the helper)
    worldConnectionMode: 'profile',
    worldProfileId: '',
    worldProxyUrl: '',
    worldModel: '',
    worldMaxTokens: 1500,
    worldTimeout: 60000,
    // LOCAL PATCH (Miinthe, 2026-10-13): one summary notice per message ('summary') or one per change ('each') — the rest in the What changed tab
    noticeStyle: 'summary',
    // overhaul step 4 (Miinthe, 2026-10-15): Settings → Interface → "Ask before removing" = every removal asks first.
    // Off: small things go at once with Undo, big ones ask. The board's Edit ▸ Ask before removing is the same switch.
    askBeforeRemoving: false,
    characterContextScan: false,
    // Fuzzy BM25 — TF-IDF supplement to keyword matching.
    fuzzySearchEnabled: false,
    fuzzySearchMinScore: 0.5,
    vaults: [],
    drawerPinned: false,
    drawerSide: 'right',                   // overhaul 2a (Miinthe, 2026-10-15): the side panel on the 'left' or 'right', remembered
    notesEnabled: true,                    // My notes (Miinthe, 2026-10-18): the notes button on the bar; off = no button, the notes stay in their file
    notesSide: 'right',                    // My notes (Miinthe, 2026-10-18): its window on the 'left' or 'right' (PC), remembered
    notesLocked: false,                    // My notes: locked = stays open whatever you do (and after a reload) until the bar button or ✕ closes it
    notesLibOpen: false,                   // My notes: the Everywhere folder open or folded, as she left it (2026-10-19)
    notesLastOpen: '',                     // My notes: the note open when the window closed — reopening comes back to it (2026-10-19)
    notesKeepOpen: false,                  // My notes: was open while locked → opens again after a reload
    kitNoAsk: {},                          // overhaul: the shared parts' "Don't ask me again" answers (per kind of removal)
    dkTheme: 'follow',                     // overhaul: DeepLore's look — 'follow' SillyTavern's theme, or always 'light' / 'dark'
    barShow: true,                         // overhaul: the DeepLore bar above the message box
    barReev: true, barGuide: true, barSpell: true, barSsend: true, barDraftBtn: true,   // the bar's action buttons, each on or off (Miinthe, 2026-11-03)
    spellWords: [],                        // ✓ Fix spelling: her own words — never "fixed", and what a near miss gets fixed to (Miinthe, 2026-11-03)
    barHideStQr: true,                     // overhaul: SillyTavern's own Quick Reply row steps aside while the bar holds starred ones
    iconDrawer: 'off',                     // floating icon drawer (Miinthe, 2026-11-02): 'off' | 'phone' | 'always'
    iconDrawerOff: [],                     // the icons switched off in it (their keys: '#id', '.class' or 't:title')
    barHot: [],                            // overhaul 2a: the bar's starred quick replies, [{ set, label }] (SillyTavern's own Quick Replies)
    barDraft: '',                          // overhaul 2a: the bar's saved reply draft (kept with the account, so it follows her to the phone)
    drawerCompactTabs: false,              // false = icon + text (default), true = icon-only
    // Authoring leniency: parser auto-fixes case-mismatched field names, quoted numbers, and
    // comma-string keys, recording a warning. False = pre-v2 strict mode (silent drops).
    lenientAuthoring: true,
    advancedVisible: {},
    aiConfidenceThreshold: 'low',          // E1: low (all), medium (medium+high), high (high only)
    hierarchicalPreFilter: false,          // E2a: enable hierarchical category pre-filter for large candidate sets
    hierarchicalAggressiveness: 0.8,       // E2: 0.0 (keep all) to 0.8 (aggressive); min retention = 1 - this
    manifestSummaryMode: 'prefer_summary', // E8: prefer_summary, summary_only, content_only
    aiErrorFallback: 'keyword',            // E4: keyword, constants_only, bootstrap_only, none
    aiEmptyFallback: 'constants',          // E4: constants, constants_bootstrap, keyword, none
    contextualGatingTolerance: 'strict',   // E5: strict, moderate, lenient
    multiVaultConflictResolution: 'all',   // E6: all, first, last, merge
    keywordOccurrenceWeighting: false,     // E7
    indexRebuildTrigger: 'ttl',            // E9: ttl, generation, manual
    indexRebuildGenerationInterval: 10,
    autoSuggestSkipReview: false,          // E11
    promptPresets: {},                     // { [toolKey]: { [presetName]: promptText } }
    // overhaul (built 2026-10-17): a character's own lore budget, { [avatar]: { tokens?, entries? } } (0 = no limit;
    // a chat's own is in its chat_metadata.deeplore_budget) — the most specific wins (src/budget-pure.js)
    characterBudgets: {},
    // overhaul (built 2026-10-17): where Auto Lorebook's new entries go — 'about': about the run → the run's folder,
    // otherwise the character's base folder (none: the Target folder) · 'target': always the Target folder (autoSuggestFolder)
    newEntryPlacement: 'about',
    newEntryMark: true,                    // mark them: made_by, from (chat and message), the made-by-mero tag (the date is always stamped)
    // cleaning up a run (Miinthe, 2026-10-27): its files go to the trash folder (never read) or are deleted for good
    runCleanupMode: 'trash',
    runTrashFolder: 'zz Deleted runs',
    ownPrompts: [],                        // her own prompt pieces: [{ id, name, text, position, depth, role }] (src/own-prompts-pure.js)
    // where the story / tracker block goes (was fixed: in the chat, depth 4, as system)
    storyBlockPosition: 1,
    storyBlockDepth: 4,
    storyBlockRole: 0,
    // Graph
    graphRepulsion: 0.3,               // FA2 repulsion coefficient (0.1-5.0)
    graphGravity: 11.0,                // FA2 strong gravity (0.1-20)
    graphDamping: 0.50,                // velocity damping (0.3-0.98)
    graphHoverDimDistance: 3,          // BFS hops kept visible on hover (0-8)
    graphHoverFalloff: 0.55,           // mirrors-and-lasers transmission per hop: E[d] = t^d (0.3-0.85). NOT a linear factor.
    graphHoverAmbient: 0.06,           // ambient floor for off-set elements (0.0-0.2)
    graphNodeSizeMode: 'centrality',   // centrality / priority / uniform
    graphFocusTreeDepth: 2,            // focus-tree N-hop depth (1-15)
    graphDefaultColorMode: 'type',     // type, priority, centrality, frequency
    graphShowLabels: true,
    graphEdgeFilterAlpha: 0.05,        // disparity-filter alpha (0.01-0.5, lower = sparser backbone)
    graphSavedLayout: null,            // { positions: {title: {x,y}}, timestamp }
    fieldDefinitionsPath: 'DeepLore/field-definitions.yaml',
    decayEnabled: false,
    decayBoostThreshold: 5,    // generations without injection before freshness boost
    decayPenaltyThreshold: 2,  // consecutive injections before frequency penalty
    // #16: global priority-order toggle. false = lower priority number wins (Obsidian/WI convention).
    // true = higher wins. Affects pipeline budget allocation, Cartographer display.
    // Browse popup's explicit priority_asc/desc dropdown bypasses this — user-typed sort always wins literal.
    priorityReversed: false,
    // #18: when true, importEntries / upsertConvertedEntry caveman-compress each entry's body
    // before writing to the vault. Per-import option can still override per call. Stored
    // entries are annotated with `compress: caveman` in frontmatter for audit.
    importCompressByDefault: false,
    // Wave 4 (WI parity): how WI import handles Example Messages entries (ST
    // position 5 = before_example_messages, 6 = after_example_messages). DLE
    // has no EM injection slot, so:
    //   'append' (default) — convert to normal entry, prepend "## Example
    //     Dialogue" subheader to the body, map injection position to before/
    //     after based on original ST value. Most natural for character entries
    //     where a flavor quote helps the LLM nail the voice.
    //   'skip' — drop these entries entirely. Most users find a single flavor
    //     line inside the parent character entry is enough; ST's EM slot is
    //     often noise once the model has the character description.
    // Per-import override available via importEntries options.
    wiImportEmHandling: 'append',
    // Custom Fields in AI Manifest: whitelist of custom-field names sent to the AI
    // alongside each candidate entry. Empty array = include ALL custom fields with
    // values (current behavior). Populate to prune the manifest for token control —
    // e.g. ['era', 'faction'] sends only those even if entries have more.
    aiManifestIncludeFields: [],
    // DLE-Side Response Prefill: inject seed text as the last assistant message so
    // the writing AI continues from it instead of starting with "Certainly, here's…".
    // Mode: off (no injection), anthropic-only (only when underlying model is Claude
    // — native prefill behavior), all-providers (applies to every chat-completion
    // source — some accept it as continuation, others may ignore).
    responsePrefillSeed: '',
    responsePrefillMode: 'off',
    // #15: dedicated summary feature — /dle-summarize-range AI prompt + budgets.
    summarySystemPrompt: '',     // empty = use built-in default in summarize.js
    summaryMaxTokens: 400,
    summaryTimeout: 30000,
    analyticsData: {},
    _wizardCompleted: false,
    // Increment to trigger migrations in runMigrations().
    settingsVersion: 8,
};

/** Per-tool settings-key map for resolveConnectionConfig(). */
const TOOL_SETTINGS_KEYS = {
    aiSearch:    { mode: 'aiSearchConnectionMode', profileId: 'aiSearchProfileId', proxyUrl: 'aiSearchProxyUrl', model: 'aiSearchModel', maxTokens: 'aiSearchMaxTokens', timeout: 'aiSearchTimeout' },
    scribe:     { mode: 'scribeConnectionMode', profileId: 'scribeProfileId', proxyUrl: 'scribeProxyUrl', model: 'scribeModel', maxTokens: 'scribeMaxTokens', timeout: 'scribeTimeout' },
    autoSuggest: { mode: 'autoSuggestConnectionMode', profileId: 'autoSuggestProfileId', proxyUrl: 'autoSuggestProxyUrl', model: 'autoSuggestModel', maxTokens: 'autoSuggestMaxTokens', timeout: 'autoSuggestTimeout' },
    aiNotepad:  { mode: 'aiNotepadConnectionMode', profileId: 'aiNotepadProfileId', proxyUrl: 'aiNotepadProxyUrl', model: 'aiNotepadModel', maxTokens: 'aiNotepadMaxTokens', timeout: 'aiNotepadTimeout' },
    optimizeKeys: { mode: 'optimizeKeysConnectionMode', profileId: 'optimizeKeysProfileId', proxyUrl: 'optimizeKeysProxyUrl', model: 'optimizeKeysModel', maxTokens: 'optimizeKeysMaxTokens', timeout: 'optimizeKeysTimeout' },
    storyTracker: { mode: 'storyTrackerConnectionMode', profileId: 'storyTrackerProfileId', proxyUrl: 'storyTrackerProxyUrl', model: 'storyTrackerModel', maxTokens: 'storyTrackerMaxTokens', timeout: 'storyTrackerTimeout' },   // LOCAL PATCH (Miinthe, 2026-10-03)
    mero: { mode: 'meroConnectionMode', profileId: 'meroProfileId', proxyUrl: 'meroProxyUrl', model: 'meroModel', maxTokens: 'meroMaxTokens', timeout: 'meroTimeout' },   // LOCAL PATCH (Miinthe, 2026-10-05)
    world: { mode: 'worldConnectionMode', profileId: 'worldProfileId', proxyUrl: 'worldProxyUrl', model: 'worldModel', maxTokens: 'worldMaxTokens', timeout: 'worldTimeout' },   // world layer (2026-10-19)
};

/**
 * Resolve effective connection config. `inherit` mode pulls mode+profileId from aiSearch and
 * cascades model/proxyUrl (tool's own value wins if set, else aiSearch's). maxTokens/timeout
 * are always the tool's own — those tune the per-feature behavior, not the shared connection.
 *
 * @param {string} toolKey  'aiSearch' | 'scribe' | 'autoSuggest' | 'aiNotepad' | 'optimizeKeys' | 'storyTracker' | 'mero' | 'world'
 * @returns {{ mode: string, profileId: string, proxyUrl: string, model: string, maxTokens: number, timeout: number }}
 */
export function resolveConnectionConfig(toolKey) {
    const s = getSettings();
    const keys = TOOL_SETTINGS_KEYS[toolKey];
    if (!keys) throw new Error(`[DLE] Unknown tool key for connection config: ${toolKey}`);

    const mode = s[keys.mode];
    const toolModel = s[keys.model] || '';
    const toolProxyUrl = s[keys.proxyUrl] || '';
    const maxTokens = s[keys.maxTokens];
    const timeout = s[keys.timeout];

    if (mode === 'inherit' && toolKey !== 'aiSearch') {
        const ai = TOOL_SETTINGS_KEYS.aiSearch;
        return {
            mode: s[ai.mode],
            profileId: s[ai.profileId],
            proxyUrl: toolProxyUrl || s[ai.proxyUrl],
            model: toolModel || s[ai.model],
            maxTokens,
            timeout,
        };
    }

    // the world layer starts on the story helper's connection until a profile of its own is picked (2026-10-19)
    if (toolKey === 'world' && !s[keys.profileId]) {
        const st = TOOL_SETTINGS_KEYS.storyTracker;
        return { mode: 'profile', profileId: s[st.profileId], proxyUrl: s[st.proxyUrl] || '', model: toolModel || s[st.model] || '', maxTokens, timeout };
    }

    return {
        mode,
        profileId: s[keys.profileId],
        proxyUrl: toolProxyUrl || defaultSettings[keys.proxyUrl],
        model: toolModel,
        maxTokens,
        timeout,
    };
}

// runMigrations + PROXY_DEPRECATION_MODE_KEYS now live in
// src/settings-migrations-pure.js so they're importable in test envs without
// pulling in ST globals. Re-exported at the top of this file.

/** Numeric range constraints + enum whitelists for validateSettings(). */
export const settingsConstraints = {
    obsidianPort: { min: 1, max: 65535 },
    scanDepth: { min: 0, max: 100 },
    maxEntries: { min: 1, max: 100 },
    maxTokensBudget: { min: 100, max: 100000 },
    injectionDepth: { min: 0, max: 9999 },
    notebookDepth: { min: 0, max: 9999 },
    aiNotepadDepth: { min: 0, max: 9999 },
    storyBlockDepth: { min: 0, max: 9999 },
    maxRecursionSteps: { min: 1, max: 10 },
    cacheTTL: { min: 0, max: 86400 },
    reviewResponseTokens: { min: 0, max: 100000 },
    aiNotepadMaxTokens: { min: 256, max: 8192 },
    aiNotepadTimeout: { min: 5000, max: 999999 },
    aiNotepadMaxEntries: { min: 0, max: 1000 },
    aiNotepadFuzzyDedupThreshold: { min: 0.1, max: 1 },
    aiSearchMaxTokens: { min: 64, max: 4096 },
    aiSearchTimeout: { min: 1000, max: 999999 },
    aiSearchScanDepth: { min: 1, max: 100 },
    aiSearchManifestSummaryLength: { min: 100, max: 1000 },
    scribeInterval: { min: 1, max: 50 },
    scribeMaxTokens: { min: 256, max: 4096 },
    scribeTimeout: { min: 5000, max: 999999 },
    scribeScanDepth: { min: 5, max: 100 },
    newChatThreshold: { min: 1, max: 20 },
    syncPollingInterval: { min: 0, max: 3600 },
    reinjectionCooldown: { min: 0, max: 50 },
    stripLookbackDepth: { min: 1, max: 10 },
    autoSuggestInterval: { min: 3, max: 50 },
    autoSuggestMaxTokens: { min: 256, max: 4096 },
    autoSuggestTimeout: { min: 5000, max: 999999 },
    optimizeKeysMaxTokens: { min: 256, max: 8192 },
    optimizeKeysTimeout: { min: 5000, max: 999999 },
    storyTrackerMaxTokens: { min: 100, max: 4096 },     // LOCAL PATCH (Miinthe, 2026-10-03)
    storyTrackerTimeout: { min: 3000, max: 120000 },
    meroMaxTokens: { min: 200, max: 8192 },          // LOCAL PATCH (Miinthe, 2026-10-05): Mero
    meroTimeout: { min: 5000, max: 300000 },
    worldMaxTokens: { min: 200, max: 8192 },          // world layer (2026-10-19)
    worldTimeout: { min: 5000, max: 300000 },
    graphRepulsion: { min: 0.1, max: 5.0 },
    graphGravity: { min: 0.1, max: 20 },
    graphDamping: { min: 0.3, max: 0.98 },
    graphHoverDimDistance: { min: 0, max: 15 },
    graphHoverFalloff: { min: 0.3, max: 0.85 },
    graphHoverAmbient: { min: 0.0, max: 0.2 },
    graphFocusTreeDepth: { min: 1, max: 15 },
    graphEdgeFilterAlpha: { min: 0.01, max: 0.5 },
    decayBoostThreshold: { min: 2, max: 20 },
    decayPenaltyThreshold: { min: 2, max: 10 },
    fuzzySearchMinScore: { min: 0.1, max: 2.0 },
    hierarchicalAggressiveness: { min: 0.0, max: 0.8 },
    indexRebuildGenerationInterval: { min: 1, max: 100 },
    // BUG-344: string-enum whitelist — validateSettings resets to defaults on mismatch.
    injectionMode: { enum: ['extension', 'prompt_list'] },
    drawerSide: { enum: ['left', 'right'] },
    notesSide: { enum: ['left', 'right'] },
    dkTheme: { enum: ['follow', 'light', 'dark'] },
    // L-41: aiSearch is the inheritance ROOT — it must never be 'inherit' (a tool
    // resolving 'inherit' cascades to s[aiSearch.mode]; if that were 'inherit' too,
    // callAI receives 'inherit' and throws "unknown connection mode"). The UI only
    // offers profile/proxy for the root (settings-ui.js supportedModes), but without
    // an enum whitelist an import/migration could land 'inherit'/'st'. Reset to the
    // 'profile' default on mismatch.
    aiSearchConnectionMode: { enum: ['profile', 'proxy'] },
    storyTrackerConnectionMode: { enum: ['profile'] },   // LOCAL PATCH (Miinthe, 2026-10-03)
    noticeStyle: { enum: ['summary', 'each'] },   // LOCAL PATCH (Miinthe, 2026-10-13)
    newEntryPlacement: { enum: ['about', 'target'] },   // overhaul (2026-10-17)
    runCleanupMode: { enum: ['trash', 'delete'] },       // run cleanup (2026-10-27)
    iconDrawer: { enum: ['off', 'phone', 'always'] },   // floating icon drawer (2026-11-02)
    meroConnectionMode: { enum: ['profile'] },           // LOCAL PATCH (Miinthe, 2026-10-05): Mero
    worldConnectionMode: { enum: ['profile'] },          // world layer (2026-10-19)
    // BUG-AUDIT (Fix 12): missing whitelist would let invalid imports/migrations land an
    // unrecognized value, which deduplicateMultiVault then silently treated like 'first'
    // (drop duplicates instead of preserving). Safe default 'all' restored on mismatch.
    multiVaultConflictResolution: { enum: ['all', 'first', 'last', 'merge'] },
    responsePrefillMode: { enum: ['off', 'anthropic-only', 'all-providers'] },
};

// BUG-088: settings cache REMOVED. ST's native pattern is direct read of
// `extension_settings[MODULE_NAME]`; a cache flag required every mutator to remember
// invalidateSettingsCache(), which drifted. All getSettings() passes are now idempotent
// — numeric coercion, default-fill (=== undefined gate), validateSettings (clamps in
// place), migrations (self-gated by settingsVersion), vaults SSOT mirror, and the
// vaults[] migration (guarded by _vaultsMigrated) — so running them on every call is
// safe and cheap (~60-key scan). invalidateSettingsCache is kept as a no-op for
// call-site compatibility; removing it would touch every feature.

/** No-op (BUG-088). Retained for call-site compatibility. */
export function invalidateSettingsCache() {
    /* no-op — see BUG-088 comment above */
}

/** @returns {typeof defaultSettings} */
export function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const s = extension_settings[MODULE_NAME];

    // BUG-071: coerce string-typed numbers (e.g. JSON imports) or reset to default if non-numeric.
    // Skip null — used as a sentinel meaning "unset / unlimited" for some keys
    // (a stored null means "unlimited"). Without this skip, Number(null) === 0
    // would silently persist 0, which downstream code may treat as a hard cap.
    for (const key of Object.keys(settingsConstraints)) {
        // Enum keys are validated by validateSettings() below.
        if (Array.isArray(settingsConstraints[key].enum)) continue;
        if (s[key] !== undefined && s[key] !== null && typeof s[key] !== 'number') {
            const num = Number(s[key]);
            if (!Number.isNaN(num)) {
                s[key] = num;
            } else {
                s[key] = defaultSettings[key];
            }
        }
    }

    // Fill missing defaults — idempotent, only touches undefined keys.
    // L-37: ALSO re-fill when the default is an OBJECT/array but the stored value is
    // null. A persisted `null` (corrupt import / manual edit) survived the
    // `=== undefined` gate, and a null `analyticsData` then threw in
    // `Object.hasOwn(null, …)` at commit — surfacing a misleading "Couldn't load
    // your lore" toast even though lore was injected. Numeric/string/boolean
    // null-sentinels are left untouched.
    for (const [key, value] of Object.entries(defaultSettings)) {
        const defaultIsObject = (typeof value === 'object' && value !== null);
        if (s[key] === undefined || (defaultIsObject && s[key] === null)) {
            s[key] = defaultIsObject
                ? JSON.parse(JSON.stringify(value))
                : value;
        }
    }
    validateSettings(s, settingsConstraints, defaultSettings);

    const currentVersion = defaultSettings.settingsVersion;
    const storedVersion = s.settingsVersion || 0;
    if (storedVersion < currentVersion) {
        runMigrations(s, storedVersion, currentVersion);
        s.settingsVersion = currentVersion;
        // Re-validate post-migration — mutated values must be clamped against the current whitelist before first use.
        validateSettings(s, settingsConstraints, defaultSettings);
        try { saveSettingsDebounced(); } catch { /* may not be available pre-init */ }
    }

    // Multi-vault migration: legacy obsidianPort+apiKey → vaults[0]. Requires apiKey to avoid
    // phantom vaults for brand-new users (default port is always set, apiKey signals real config).
    let _migrationDirty = false;
    if (!s._vaultsMigrated && (!Array.isArray(s.vaults) || s.vaults.length === 0) && s.obsidianPort && s.obsidianApiKey) {
        // BUG-339: 27124 is Obsidian Local REST API's HTTPS default; other ports default to HTTP.
        s.vaults = [{
            name: 'Primary',
            host: '127.0.0.1',
            port: s.obsidianPort,
            apiKey: s.obsidianApiKey || '',
            https: s.obsidianPort === 27124,
            enabled: true,
        }];
        s._vaultsMigrated = true;
        _migrationDirty = true;
    }

    // Backfill `host` on legacy vault entries (added when remote Obsidian became supported).
    if (Array.isArray(s.vaults)) {
        for (const v of s.vaults) {
            if (!v.host) { v.host = '127.0.0.1'; _migrationDirty = true; }
        }
    }
    if (_migrationDirty) {
        try { saveSettingsDebounced(); } catch { /* may not be available pre-init */ }
    }

    // BUG-075: vaults[primary] is the SSOT for obsidianPort and obsidianApiKey. Mirror runs every
    // getSettings() call so any code path mutating vaults[0] (or vice versa) can't cause drift.
    // vaults[] wins on conflict.
    if (Array.isArray(s.vaults) && s.vaults.length > 0) {
        const primary = s.vaults.find(v => v.enabled) || s.vaults[0];
        if (primary) {
            if (typeof primary.port === 'number' && s.obsidianPort !== primary.port) {
                s.obsidianPort = primary.port;
            }
            if (typeof primary.apiKey === 'string' && s.obsidianApiKey !== primary.apiKey) {
                s.obsidianApiKey = primary.apiKey;
            }
        }
    }

    return s;
}

/**
 * First enabled vault, or a disabled-default placeholder.
 * @param {typeof defaultSettings} [settings]
 * @returns {{ name: string, port: number, apiKey: string, enabled: boolean }}
 */
export function getPrimaryVault(settings) {
    const s = settings || getSettings();
    return (s.vaults && s.vaults.find(v => v.enabled)) || s.vaults?.[0] || { name: 'Default', host: '127.0.0.1', port: 27123, apiKey: '', https: false, enabled: false };
}

/**
 * Resolve vault by name (entry's vaultSource), falling back to primary if unknown/disabled.
 * @param {typeof defaultSettings} settings
 * @param {string} vaultName
 * @returns {{ name: string, port: number, apiKey: string, enabled: boolean }}
 */
export function getVaultByName(settings, vaultName) {
    if (vaultName && settings.vaults) {
        const match = settings.vaults.find(v => v.name === vaultName && v.enabled);
        if (match) return match;
    }
    return getPrimaryVault(settings);
}

const WRITE_VAULT_KEYS = {
    scribe: 'scribeWriteVaultId',
    autoSuggest: 'autoSuggestWriteVaultId',
};

/**
 * Resolve which vault a write-capable tool should target.
 *
 * Precedence: explicit override (per-write picker) > tool's configured default
 * (settings.{tool}WriteVaultId) > primary enabled vault. Each step falls back
 * to the next on miss/disabled — never throws so writes can't fail because
 * config drifted from the vault list.
 *
 * @param {'scribe'|'autoSuggest'} toolKey
 * @param {typeof defaultSettings} [settings]
 * @param {string} [overrideName]  Per-call override (a per-write picker)
 * @returns {{ name: string, host: string, port: number, apiKey: string, https: boolean, enabled: boolean }}
 */
export function resolveWriteVault(toolKey, settings, overrideName) {
    const s = settings || getSettings();
    if (overrideName) {
        const match = s.vaults?.find(v => v.name === overrideName && v.enabled);
        if (match) return match;
    }
    const key = WRITE_VAULT_KEYS[toolKey];
    const configuredName = key ? s[key] : '';
    if (configuredName) {
        const match = s.vaults?.find(v => v.name === configuredName && v.enabled);
        if (match) return match;
    }
    return getPrimaryVault(s);
}

/**
 * "Ask before removing" (overhaul step 4): on when the setting is on, or when the board's own Edit ▸ Ask before
 * removing was ticked before the setting existed (the board kept it in this browser as sb-ask-remove = 'all').
 * Both places read and write through these two, so they always agree.
 */
export function askBeforeRemoving() {
    if (getSettings().askBeforeRemoving === true) return true;
    try { return localStorage.getItem('sb-ask-remove') === 'all'; } catch { return false; }
}
export function setAskBeforeRemoving(on) {
    getSettings().askBeforeRemoving = !!on;
    try {
        const was = localStorage.getItem('sb-ask-remove');
        if (on) localStorage.setItem('sb-ask-remove', 'all');
        else if (was === 'all') localStorage.setItem('sb-ask-remove', 'big');
    } catch { /* private window */ }
    saveSettingsDebounced();
}
