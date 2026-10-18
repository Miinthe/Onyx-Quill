/**
 * Overhaul step 4 (2026-10-16) — the settings window, redrawn to the approved mock-up (settings v4): what is in it.
 *
 * Every row reads and writes the SAME saved setting as today's window (extension_settings via settings.js, or Mero's
 * own settings via mero.js). Nothing here changes a stored value by itself: a value changes only when Miinthe changes it.
 * Rows that merge two old controls (e.g. "Session notes every N messages · 0 = off" = scribeEnabled + scribeInterval)
 * have read / write that keep both old keys exactly as the old controls did.
 *
 * A row:
 *   id      unique id (search, "jump to")
 *   label   a few words; hint: a short line under it; tip: the longer explanation (hover)
 *   type    switch · seg · select · num · text · area · btn · custom
 *   key     the setting it stores (or read(s) / write(s, v) for a merged row)
 *   src     'dle' (default: DeepLore's settings) · 'mero' (Mero's settings) · 'own' (the view supplies get / set)
 *   opts    [[value, label], …] for seg / select (optsFrom: a name the view fills in, e.g. the vault list)
 *   min, max, step, unit   for num (min / max default to settings.js settingsConstraints)
 *   scale   num shown divided by this (timeouts: stored in ms, shown in seconds)
 *   more    true: behind the card's "More" (hidden in Simple)
 *   dis(s)  disabled when true (and why: disWhy) · show(s): drawn only when true
 *   fx      what else happens after a change: 'rebuild' (re-read the vault) · 'sync' · 'debug' · 'injmode' · 'reindex'
 *   act     for btn: what the view runs · old: DeepLore's old name for it (search finds it)
 *   keys    the saved settings a merged row stands for (when its read / write don't name them)
 * Pure: no SillyTavern imports (tested in test/settings-view.test.mjs).
 */

export const GROUPS = ['Lore', 'AI', 'Story', 'Look'];

const POS = [[2, 'before the main prompt'], [0, 'after the main prompt'], [1, 'in the chat']];
const ROLE = [[0, 'system'], [1, 'user'], [2, 'assistant']];
const inChat = key => s => Number(s[key]) === 1;
const promptList = s => s.injectionMode === 'prompt_list';
const judgeOff = s => !s.aiSearchEnabled;
const aiOnly = s => !!s.aiSearchEnabled && s.aiSearchMode === 'ai-only';

/** Graph spacing presets (Miinthe, 2026-10-14: "Spacing: tight · normal · loose up front"); normal = the shipped physics. */
export const SPACING = { tight: { graphRepulsion: 0.15, graphGravity: 15 }, normal: { graphRepulsion: 0.3, graphGravity: 11 }, loose: { graphRepulsion: 0.8, graphGravity: 6 } };
export function spacingOf(s) {
    for (const [k, p] of Object.entries(SPACING)) if (Number(s.graphRepulsion) === p.graphRepulsion && Number(s.graphGravity) === p.graphGravity) return k;
    return 'custom';
}

/** "every N · 0 = off" rows that stand for an on/off switch plus a number (both old keys are kept as they were). */
function everyN(onKey, nKey, min, max) {
    return {
        read: s => (s[onKey] ? Number(s[nKey]) : 0),
        write: (s, v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0) { s[onKey] = false; return; }
            s[onKey] = true;
            s[nKey] = Math.max(min, Math.min(max, Math.round(n)));
        },
        min: 0, max, keys: [onKey, nKey],
    };
}

export const SECTIONS = [
    { id: 'vault', name: 'Vault', icon: 'vault', grp: 'Lore', lead: 'Where your lore lives and how DeepLore reaches it.', cards: [
        { t: 'Vaults', custom: 'vaults', rows: [
            { id: 'v-conflict', label: 'When two vaults have the same entry', type: 'select', key: 'multiVaultConflictResolution', opts: [['all', 'keep both'], ['first', 'first vault wins'], ['last', 'last vault wins'], ['merge', 'merge (combine keywords)']], old: 'Multi-vault conflict resolution' },
        ] },
        { t: 'Reading', rows: [
            { id: 'v-sync', label: 'Re-read the vault every', hint: 'seconds · 0 = only by hand', type: 'num', key: 'syncPollingInterval', old: 'Auto-sync interval / polling', fx: 'sync' },
            { id: 'v-toast', label: 'Tell me what changed', tip: 'A notice after a re-read finds changes', type: 'switch', key: 'showSyncToasts', old: 'Show sync change toasts' },
            { id: 'v-now', label: 'Re-read now', type: 'btn', btn: 'Re-read', act: 'reindex', old: 'Refresh index' },
            { id: 'v-rebuild', label: 'Rebuild the index', type: 'seg', key: 'indexRebuildTrigger', opts: [['ttl', 'after a time'], ['generation', 'every N replies'], ['manual', 'only by hand']], more: true, old: 'Index rebuild trigger' },
            { id: 'v-cache', label: 'Keep the index for', hint: 'seconds', tip: 'Used by “after a time”', type: 'num', key: 'cacheTTL', more: true, old: 'Cache duration / cache TTL' },
            { id: 'v-rebuildn', label: 'Every N replies', tip: 'Used by “every N replies”', type: 'num', key: 'indexRebuildGenerationInterval', more: true, old: 'Rebuild every N generations' },
        ] },
        { t: 'Tags', rows: [
            { id: 'v-tag', label: 'Lore tag', tip: 'Notes with this tag are lore', type: 'text', key: 'lorebookTag', fx: 'rebuild', old: 'Lorebook tag' },
            { id: 'v-always', label: 'Always-send tag', tip: 'Sent with every reply', type: 'text', key: 'constantTag', fx: 'rebuild', old: 'Constant tag / constants' },
            { id: 'v-never', label: 'Never-send tag', type: 'text', key: 'neverInsertTag', more: true, fx: 'rebuild', old: 'Never insert tag' },
            { id: 'v-seed', label: 'Seed tag', tip: 'Sent quietly in the background while a chat is new', type: 'text', key: 'seedTag', more: true, fx: 'rebuild', old: 'Seed tag' },
            { id: 'v-boot', label: 'Starter tag', tip: 'Sent openly while a chat is new', type: 'text', key: 'bootstrapTag', more: true, fx: 'rebuild', old: 'Bootstrap tag' },
            { id: 'v-guide', label: 'Writing-guide tag', tip: 'Entries with this tag are writing guides, not lore', type: 'text', key: 'librarianGuideTag', more: true, fx: 'rebuild', old: 'Guide tag' },
            { id: 'v-newchat', label: 'A chat counts as new for', hint: 'messages', type: 'num', key: 'newChatThreshold', more: true, old: 'New chat threshold' },
        ] },
        { t: 'Files', rows: [
            { id: 'v-fields', label: 'Field definitions file', hint: 'in your vault', type: 'text', key: 'fieldDefinitionsPath', old: 'Field definitions path' },
            { id: 'v-prompts', label: 'Prompts folder', hint: 'in your vault', type: 'text', key: 'promptsFolderPath', old: 'Prompts folder path' },
        ] },
    ] },
    { id: 'filters', name: 'Filters', icon: 'filter', grp: 'Lore', custom: 'hub' },
    { id: 'select', name: 'Lore selection', icon: 'lore', grp: 'Lore', lead: 'How DeepLore finds the lore for a reply.', cards: [
        { t: 'Mode', rows: [
            { id: 's-mode', label: 'How lore is picked', type: 'seg', opts: [['keywords-only', 'keywords only'], ['two-stage', 'keywords, then the judge'], ['ai-only', 'the judge only']], old: 'Search mode / AI search enabled',
                read: s => (!s.aiSearchEnabled ? 'keywords-only' : s.aiSearchMode === 'ai-only' ? 'ai-only' : 'two-stage'),
                write: (s, v) => { s.aiSearchEnabled = v !== 'keywords-only'; s.aiSearchMode = v === 'ai-only' ? 'ai-only' : 'two-stage'; } },
        ] },
        { t: 'Keywords', rows: [
            { id: 's-depth', label: 'Messages to read', tip: 'How far back keywords are looked for', type: 'num', key: 'scanDepth', show: s => !aiOnly(s), old: 'Scan depth' },
            { id: 's-char', label: 'Match the active character', type: 'switch', key: 'characterContextScan', old: 'Auto-match active character / character context scan' },
            { id: 's-fuzzy', label: 'Loose matching', tip: 'Also finds entries whose words are close to the chat, not only exact keywords', type: 'switch', key: 'fuzzySearchEnabled', fx: 'reindex', old: 'Fuzzy search / flexible matching' },
            { id: 's-fuzzyn', label: 'How close', hint: 'low = more matches', tip: 'The lowest score that still counts (0.1 – 2). The preview shows sample entries, not your vault.', type: 'num', key: 'fuzzySearchMinScore', step: 0.1, show: s => !!s.fuzzySearchEnabled, preview: 'fuzzy', old: 'Match sensitivity / fuzzy min score' },
            { id: 's-case', label: 'Case sensitive', type: 'switch', key: 'caseSensitive', more: true, dis: aiOnly, disWhy: 'The judge alone picks lore', old: 'Case sensitive' },
            { id: 's-whole', label: 'Whole words only', type: 'switch', key: 'matchWholeWords', more: true, dis: aiOnly, disWhy: 'The judge alone picks lore', old: 'Match whole words' },
            { id: 's-chain', label: 'Entries can call other entries', hint: 'steps · 0 = off', tip: 'An entry’s text can match more entries, up to this many steps', type: 'num', more: true, dis: aiOnly, disWhy: 'The judge alone picks lore', old: 'Recursive scan / chain matching / max recursion steps',
                ...everyN('recursiveScan', 'maxRecursionSteps', 1, 10) },
            { id: 's-weight', label: 'Count how often a keyword appears', tip: 'Can slow down big vaults', type: 'switch', key: 'keywordOccurrenceWeighting', more: true, old: 'Keyword occurrence weighting' },
            { id: 's-reverse', label: 'Higher priority number wins', tip: 'Off: a lower number wins (as in Obsidian and World Info)', type: 'switch', key: 'priorityReversed', more: true, old: 'Reverse priority / priority order' },
            { id: 's-strict', label: 'When a chat has no field value set', type: 'select', key: 'contextualGatingTolerance', opts: [['strict', 'strict: block the entry'], ['moderate', 'moderate: block only a mismatch'], ['lenient', 'lenient: allow it']], more: true, old: 'Filter strictness / contextual gating tolerance' },
        ] },
        { t: 'The judge', rows: [
            { id: 's-conf', label: 'Leave out below', tip: 'How sure the judge must be', type: 'select', key: 'aiConfidenceThreshold', opts: [['low', 'low (keep all)'], ['medium', 'medium'], ['high', 'high']], dis: judgeOff, disWhy: 'The judge is off (Mode: keywords only)', old: 'Confidence threshold' },
            { id: 's-jmsg', label: 'Messages the judge reads', type: 'num', key: 'aiSearchScanDepth', dis: judgeOff, disWhy: 'The judge is off (Mode: keywords only)', old: 'AI scan depth' },
            { id: 's-preview', label: 'Its prompt', tip: 'See exactly what the judge is sent for this chat', type: 'btn', btn: 'Preview', act: 'previewJudge', old: 'Preview AI prompt' },
            { id: 's-err', label: 'If the judge fails', type: 'select', key: 'aiErrorFallback', opts: [['keyword', 'use the keyword picks'], ['constants_only', 'always-send entries only'], ['bootstrap_only', 'starter entries only'], ['none', 'send no lore']], more: true, old: 'AI error fallback' },
            { id: 's-empty', label: 'If the judge picks nothing', type: 'select', key: 'aiEmptyFallback', opts: [['constants', 'always-send entries only'], ['constants_bootstrap', 'always-send + starter entries'], ['keyword', 'use the keyword picks'], ['none', 'send no lore']], more: true, old: 'AI empty result fallback' },
            { id: 's-desc', label: 'The judge reads', type: 'select', key: 'manifestSummaryMode', opts: [['prefer_summary', 'the summary, else the text'], ['summary_only', 'summaries only'], ['content_only', 'the text only']], more: true, old: 'Entry description mode / manifest summary mode' },
            { id: 's-sum', label: 'Longest summary sent', hint: 'characters', type: 'num', key: 'aiSearchManifestSummaryLength', more: true, old: 'Manifest summary length' },
            { id: 's-jnotes', label: 'Give it the session notes', tip: 'Scribe’s latest notes go to the judge too', type: 'switch', key: 'scribeInformedRetrieval', more: true, old: 'Use session notes as AI context / Scribe informed retrieval' },
            { id: 's-jfields', label: 'Your fields it sees', hint: 'comma list · empty = all', type: 'text', more: true, old: 'Custom fields in manifest',
                read: s => (Array.isArray(s.aiManifestIncludeFields) ? s.aiManifestIncludeFields.join(', ') : ''),
                write: (s, v) => { s.aiManifestIncludeFields = String(v || '').split(',').map(x => x.trim()).filter(Boolean); } },
            { id: 's-cat', label: 'Sort by category first', tip: 'An extra AI call that narrows a big list', type: 'switch', key: 'hierarchicalPreFilter', more: true, old: 'Category pre-filter / hierarchical pre-filter' },
            { id: 's-catn', label: 'How much it trims', hint: '0 keep all … 0.8 trim most', type: 'num', key: 'hierarchicalAggressiveness', step: 0.1, more: true, dis: s => !s.hierarchicalPreFilter, disWhy: 'Sort by category first is off', old: 'Category filtering strength / aggressiveness' },
        ] },
        { t: 'Writing helpers', rows: [
            { id: 's-prefill', label: 'Start the writer’s reply for it', tip: 'So it doesn’t open with “Certainly, here’s…”', type: 'select', key: 'responsePrefillMode', opts: [['off', 'off'], ['anthropic-only', 'Claude only'], ['all-providers', 'every provider']], old: 'Response prefill mode' },
            { id: 's-seed', label: 'The opening text', hint: 'empty = none', type: 'text', key: 'responsePrefillSeed', dis: s => s.responsePrefillMode === 'off', disWhy: 'The prefill is off', old: 'Prefill seed' },
            { id: 's-optmode', label: 'Optimize keywords', type: 'seg', key: 'optimizeKeysMode', opts: [['keyword', 'keywords only'], ['two-stage', 'keywords, then AI']], old: 'Optimize keys mode' },
        ] },
    ] },
    { id: 'budget', name: 'Budget & variety', icon: 'budget', grp: 'Lore', lead: 'How much lore, and not the same entries every reply. Set here for Everywhere; a character or a chat can set its own.', cards: [
        { t: 'Budget', custom: 'budgetScopes', rows: [
            { id: 'b-max', label: 'Entries per reply', type: 'num', key: 'maxEntries', dis: s => !!s.unlimitedEntries, disWhy: 'No limit on entries is on', old: 'Max entries' },
            { id: 'b-maxu', label: 'No limit on entries', tip: 'Big vaults may feel slower', type: 'switch', key: 'unlimitedEntries', old: 'Unlimited entries' },
            { id: 'b-tok', label: 'Lore budget', hint: 'tokens per reply', type: 'num', key: 'maxTokensBudget', dis: s => !!s.unlimitedBudget, disWhy: 'No limit on tokens is on', old: 'Token budget' },
            { id: 'b-toku', label: 'No limit on tokens', type: 'switch', key: 'unlimitedBudget', old: 'Unlimited token budget' },
        ] },
        { t: 'Variety', rows: [
            { id: 'b-rep', label: 'Give others a turn', tip: 'An entry sent many times in a row steps back; one skipped a long time gets a boost', type: 'switch', key: 'decayEnabled', old: 'Repetition control / decay' },
            { id: 'b-cool', label: 'Rest after sending', hint: 'replies', tip: 'An entry waits this many replies before it can be sent again', type: 'num', key: 'reinjectionCooldown', old: 'Repeat cooldown / reinjection cooldown' },
            { id: 'b-skip', label: 'Skip what was just sent', hint: 'messages back · 0 = off', tip: 'Leave out entries already sent in this many recent messages', type: 'num', old: 'Skip recently injected / strip duplicate injections / lookback depth',
                read: s => (s.stripDuplicateInjections ? Number(s.stripLookbackDepth) : 0),
                write: (s, v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) { s.stripDuplicateInjections = false; return; } s.stripDuplicateInjections = true; s.stripLookbackDepth = Math.max(1, Math.min(10, Math.round(n))); },
                min: 0, max: 10 },
            { id: 'b-boost', label: 'Bring one back after', hint: 'replies skipped', type: 'num', key: 'decayBoostThreshold', more: true, dis: s => !s.decayEnabled, disWhy: 'Give others a turn is off', old: 'Boost after N skips' },
            { id: 'b-pen', label: 'Hold one back after', hint: 'times in a row', type: 'num', key: 'decayPenaltyThreshold', more: true, dis: s => !s.decayEnabled, disWhy: 'Give others a turn is off', old: 'Penalize after N in a row' },
        ] },
    ] },
    { id: 'inject', name: 'Where it goes', icon: 'ssend', grp: 'Lore', lead: 'Where DeepLore’s parts go in the prompt.', cards: [
        { t: 'How', rows: [
            { id: 'i-mode', label: 'Place DeepLore’s parts', tip: '“In SillyTavern’s prompt list”: drag each part where you want it there; the positions below then step aside', type: 'seg', key: 'injectionMode', opts: [['extension', 'by these settings'], ['prompt_list', 'in the prompt list']], fx: 'injmode', old: 'Injection mode / prompt list / prompt manager' },
            { id: 'i-wi', label: 'Let World Info see DeepLore’s lore', type: 'switch', key: 'allowWIScan', old: 'Allow World Info scan' },
        ] },
        { t: 'Lore entries', rows: [
            { id: 'i-pos', label: 'Position', type: 'select', key: 'injectionPosition', opts: POS, num: true, dis: promptList, disWhy: 'Placed in the prompt list', old: 'Injection position' },
            { id: 'i-depth', label: 'Depth', hint: 'in the chat', type: 'num', key: 'injectionDepth', show: inChat('injectionPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'Injection depth' },
            { id: 'i-role', label: 'As', type: 'select', key: 'injectionRole', opts: ROLE, num: true, show: inChat('injectionPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'Injection role' },
            { id: 'i-format', label: 'How each entry is written', hint: '{{title}} and {{content}}', type: 'area', key: 'injectionTemplate', more: true, old: 'Entry format / injection template' },
        ] },
        { t: 'Story state and notes', rows: [
            { id: 'i-story', label: 'Story trackers block', tip: 'Where the story’s trackers, the board and the Cast are told to the writer', type: 'select', key: 'storyBlockPosition', opts: POS, num: true, dis: promptList, disWhy: 'Placed in the prompt list', old: 'Story tracker position / story block' },
            { id: 'i-stdepth', label: 'Its depth', type: 'num', key: 'storyBlockDepth', show: inChat('storyBlockPosition'), dis: promptList, disWhy: 'Placed in the prompt list' },
            { id: 'i-strole', label: 'As', type: 'select', key: 'storyBlockRole', opts: ROLE, num: true, show: inChat('storyBlockPosition'), dis: promptList, disWhy: 'Placed in the prompt list' },
            { id: 'i-nbpos', label: 'Author’s notebook', type: 'select', key: 'notebookPosition', opts: POS, num: true, dis: promptList, disWhy: 'Placed in the prompt list', old: 'Author Notebook position' },
            { id: 'i-nbdepth', label: 'Its depth', type: 'num', key: 'notebookDepth', show: inChat('notebookPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'Author Notebook depth' },
            { id: 'i-nbrole', label: 'As', type: 'select', key: 'notebookRole', opts: ROLE, num: true, show: inChat('notebookPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'Author Notebook role' },
            { id: 'i-nppos', label: 'AI notepad', type: 'select', key: 'aiNotepadPosition', opts: POS, num: true, more: true, dis: promptList, disWhy: 'Placed in the prompt list', old: 'AI Notepad position' },
            { id: 'i-npdepth', label: 'Its depth', type: 'num', key: 'aiNotepadDepth', more: true, show: inChat('aiNotepadPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'AI Notepad depth' },
            { id: 'i-nprole', label: 'As', type: 'select', key: 'aiNotepadRole', opts: ROLE, num: true, more: true, show: inChat('aiNotepadPosition'), dis: promptList, disWhy: 'Placed in the prompt list', old: 'AI Notepad role' },
        ] },
    ] },
    { id: 'ai', name: 'AI & connections', icon: 'ai', grp: 'AI', custom: 'jobs' },
    { id: 'prompts', name: 'Prompts', icon: 'draft', grp: 'AI', custom: 'prompts' },
    { id: 'mero', name: 'Mero', icon: 'mero', grp: 'AI', lead: 'Your co-writer: who she is and how she helps. Her AI is picked in AI & connections.', cards: [
        { t: 'Who she is', sum: 'who Mero is, in your words', rows: [
            { id: 'm-persona', label: 'In your words', type: 'btn', btn: 'Edit', act: 'meroPersona', old: 'Persona / who Mero is' },
            { id: 'm-reset', label: 'Who she is: first draft', type: 'btn', btn: 'Reset', act: 'meroResetPersona', old: 'Reset who she is' },
        ] },
        { t: 'Her job', rows: [
            { id: 'm-job', label: 'How much she does', tip: 'Her lore upkeep: how often she checks the entries', type: 'seg', src: 'mero', key: 'job', opts: [['off', 'Off duty'], ['freelance', 'Freelancer'], ['part', 'Part-timer'], ['full', 'Full-timer']], old: 'Mero’s job' },
            { id: 'm-sign', label: 'Needs my sign-off', tip: 'On: nothing is written without your yes. Off: she writes changes herself, each with an Undo.', type: 'switch', src: 'mero', key: 'signoff', old: 'Sign-off / approval' },
        ] },
        { t: 'How she talks', rows: [
            { id: 'm-chat', label: 'Chattiness', type: 'seg', src: 'mero', key: 'chatty', opts: [['quiet', 'Quiet'], ['chatty', 'Chatty'], ['very', 'Very chatty'], ['custom', 'Custom']], old: 'Chatty / yapper' },
            { id: 'm-init', label: 'The writer’s initiative', tip: 'From “follow my lead” to “brings events”', type: 'select', src: 'mero', key: 'initiative', num: true, opts: [[0, 'follow my lead'], [1, 'mostly follows'], [2, 'balanced'], [3, 'brings events'], [4, 'takes the wheel']], old: 'Initiative' },
            { id: 'm-reads', label: 'She reads the latest', hint: 'replies', type: 'num', src: 'mero', key: 'replies', min: 2, max: 40, old: 'How many replies Mero reads' },
            { id: 'm-talks', label: 'How much she talks', type: 'seg', src: 'mero', key: 'talk', opts: [['little', 'a little'], ['some', 'some'], ['lots', 'a lot']], more: true, old: 'Custom: talks' },
            { id: 'm-brings', label: 'Brings things up herself', type: 'switch', src: 'mero', key: 'bringUp', more: true, old: 'Custom: brings up' },
            { id: 'm-glow', label: 'The glow', tip: 'A soft light while she has something; costs nothing until you click it', type: 'seg', src: 'mero', key: 'glow', opts: [['off', 'off'], ['big', 'big moments'], ['quiet', '+ quiet threads']], more: true, old: 'Custom: the glow' },
            { id: 'm-resetall', label: 'Her settings', tip: 'Chattiness, initiative, replies, job and sign-off back to how they shipped. Who she is stays.', type: 'btn', btn: 'Reset', act: 'meroResetSettings', more: true, old: 'Reset her settings' },
        ] },
    ] },
    { id: 'story', name: 'Story & memory', icon: 'story', grp: 'Story', lead: 'What DeepLore writes down, and the story tools.', cards: [
        { t: 'Trackers and board', sum: 'they live on the board', rows: [
            { id: 't-chat', label: 'Trackers, board, Cast', tip: 'This chat: its board and DeepLore on or off', type: 'btn', btn: 'This chat…', act: 'scopeChat' },
            { id: 't-board', label: 'The board', type: 'btn', btn: 'Open', act: 'openBoard' },
        ] },
        { t: 'New entries', rows: [
            { id: 'n-on', label: 'Notice lore worth writing', hint: 'every N messages · 0 = off', type: 'num', old: 'Auto Lorebook / auto suggest / new lore', ...everyN('autoSuggestEnabled', 'autoSuggestInterval', 3, 50) },
            { id: 'n-file', label: 'Where they go', tip: 'By what they’re about: about the run → the run’s folder · about the character → the character’s base folder', type: 'select', key: 'newEntryPlacement', opts: [['about', 'by what they’re about'], ['target', 'always the Target folder']] },
            { id: 'n-target', label: 'Target folder', hint: 'when a chat has no folders yet', tip: 'Empty = the top of the vault', type: 'text', key: 'autoSuggestFolder', old: 'Auto Lorebook folder / target folder' },
            { id: 'n-mark', label: 'Mark them', tip: 'made_by, from (chat and message), the made-by-mero tag. The date is always written.', type: 'switch', key: 'newEntryMark' },
            { id: 'n-vault', label: 'Write into the vault', type: 'select', key: 'autoSuggestWriteVaultId', optsFrom: 'vaults', more: true, old: 'Auto Lorebook write to vault' },
            { id: 'n-direct', label: 'Write them straight in', tip: 'Off: you review each one first', type: 'switch', key: 'autoSuggestSkipReview', more: true, old: 'Skip review / write directly' },
        ] },
        { t: 'Scribe', rows: [
            { id: 'sc-on', label: 'Session notes', hint: 'every N messages · 0 = off', type: 'num', old: 'Session Scribe / scribe interval', ...everyN('scribeEnabled', 'scribeInterval', 1, 50) },
            { id: 'sc-folder', label: 'Folder', type: 'text', key: 'scribeFolder', old: 'Scribe folder / session folder' },
            { id: 'sc-reads', label: 'Messages it reads', type: 'num', key: 'scribeScanDepth', more: true, old: 'Scribe messages to include / scan depth' },
            { id: 'sc-vault', label: 'Write into the vault', type: 'select', key: 'scribeWriteVaultId', optsFrom: 'vaults', more: true, old: 'Scribe write to vault' },
        ] },
        { t: 'Notebook and notepad', rows: [
            { id: 'nb-on', label: 'Author’s notebook', type: 'switch', key: 'notebookEnabled', old: 'Author Notebook' },
            { id: 'np-on', label: 'AI notepad', type: 'switch', key: 'aiNotepadEnabled', old: 'AI Notebook / AI Notepad' },
            { id: 'np-mode', label: 'How it gets its notes', tip: 'Tags: the writer adds them, no extra call · Extract: a helper reads each reply', type: 'seg', key: 'aiNotepadMode', opts: [['tag', 'tags'], ['extract', 'extract']], old: 'AI Notepad capture mode' },
            { id: 'np-max', label: 'Notes it keeps', hint: '0 = no limit', tip: 'The oldest drop first', type: 'num', key: 'aiNotepadMaxEntries', more: true, old: 'AI Notepad max entries' },
            { id: 'np-dedup', label: 'Count as the same note from', hint: '0.1 … 1 how alike', type: 'num', key: 'aiNotepadFuzzyDedupThreshold', step: 0.05, more: true, old: 'Fuzzy dedup threshold' },
        ] },
        { t: 'Importing World Info', rows: [
            { id: 'im-shrink', label: 'Shrink imported entries', tip: 'Saves tokens', type: 'switch', key: 'importCompressByDefault', old: 'Caveman mode / compress on import' },
            { id: 'im-ex', label: 'Example messages', tip: 'In a World Info book', type: 'select', key: 'wiImportEmHandling', opts: [['append', 'add them under a subheading'], ['skip', 'skip them']], old: 'WI example messages on import' },
        ] },
    ] },
    { id: 'iface', name: 'Interface', icon: 'iface', grp: 'Look', lead: 'Colors, the bar, notices, removing things, and the graph.', cards: [
        { t: 'Look', rows: [
            { id: 'ui-theme', label: 'Colors', tip: 'Follow SillyTavern’s theme (your own colors too), or keep DeepLore always light or dark', type: 'seg', key: 'dkTheme', opts: [['follow', 'follow SillyTavern'], ['light', 'light'], ['dark', 'dark']] },
        ] },
        { t: 'The bar', rows: [
            { id: 'ui-bar', label: 'Show the DeepLore bar', tip: 'Above the message box', type: 'switch', key: 'barShow' },
            { id: 'ui-barqr', label: 'Hide SillyTavern’s Quick Reply row', tip: 'While you have Quick Replies starred on the bar', type: 'switch', key: 'barHideStQr' },
        ] },
        { t: 'Notices', rows: [
            { id: 'ui-pop', label: 'Pop-ups', type: 'seg', key: 'noticeStyle', opts: [['summary', 'one per message'], ['each', 'every change']], old: 'Notice style' },
            { id: 'ui-ask', label: 'Ask before removing', tip: 'On: everything asks first. Off: small things go at once with Undo; big ones ask.', type: 'switch', src: 'own', key: 'askBeforeRemoving', old: 'Ask before removing (board Edit menu)' },
        ] },
        { t: 'Graph', rows: [
            { id: 'g-space', label: 'Spacing', tip: 'Sets the physics under More for you', type: 'seg', opts: [['tight', 'tight'], ['normal', 'normal'], ['loose', 'loose']], old: 'Graph physics',
                read: s => spacingOf(s), write: (s, v) => { if (SPACING[v]) Object.assign(s, SPACING[v]); } },
            { id: 'g-color', label: 'Color by', type: 'select', key: 'graphDefaultColorMode', opts: [['type', 'type'], ['priority', 'priority'], ['centrality', 'connections'], ['frequency', 'frequency'], ['community', 'community']], old: 'Graph color mode' },
            { id: 'g-labels', label: 'Labels', type: 'switch', key: 'graphShowLabels', old: 'Graph show labels' },
            { id: 'g-rep', label: 'Repulsion', type: 'num', key: 'graphRepulsion', step: 0.05, more: true, old: 'Graph repulsion' },
            { id: 'g-grav', label: 'Gravity', type: 'num', key: 'graphGravity', step: 0.5, more: true, old: 'Graph gravity' },
            { id: 'g-damp', label: 'Damping', type: 'num', key: 'graphDamping', step: 0.01, more: true, old: 'Graph damping' },
            { id: 'g-dim', label: 'Hover dim distance', type: 'num', key: 'graphHoverDimDistance', more: true, old: 'Graph hover dim distance' },
            { id: 'g-depth', label: 'Focus tree depth', type: 'num', key: 'graphFocusTreeDepth', more: true, old: 'Graph focus tree depth' },
            { id: 'g-fall', label: 'Hover falloff', type: 'num', key: 'graphHoverFalloff', step: 0.01, more: true, old: 'Graph hover falloff' },
            { id: 'g-alpha', label: 'Edge filter alpha', type: 'num', key: 'graphEdgeFilterAlpha', step: 0.01, more: true, old: 'Graph edge filter alpha' },
        ] },
    ] },
    { id: 'adv', name: 'Advanced', icon: 'settings', grp: 'Look', lead: 'For troubleshooting.', cards: [
        { t: 'Troubleshooting', rows: [
            { id: 'a-debug', label: 'Debug mode', tip: 'More detail in the browser console', type: 'switch', key: 'debugMode', fx: 'debug', old: 'Debug mode' },
            { id: 'a-diag', label: 'Diagnostics', tip: 'Health, recent activity, session stats', type: 'btn', btn: 'Open', act: 'diagnostics', old: 'Diagnostics / health' },
            { id: 'a-export', label: 'Export diagnostics', tip: 'A file to share, with names removed', type: 'btn', btn: 'Export', act: 'exportDiagnostics', old: 'Export diagnostics' },
            { id: 'a-breaker', label: 'The AI pause', tip: 'After repeated AI errors DeepLore pauses its AI; this clears it', type: 'btn', btn: 'Reset', act: 'resetBreaker', old: 'Reset AI breaker / circuit breaker' },
            { id: 'a-try', label: 'Try matching', tip: 'Replays this chat and shows which entries each message calls up (the side panel’s Try matching)', type: 'btn', btn: 'Open', act: 'tryMatching', old: 'Test Match / Simulate' },
            { id: 'a-review', label: 'Answer length for a vault review', hint: 'tokens · 0 = Mero’s own', type: 'num', key: 'reviewResponseTokens', old: 'Review response tokens' },
        ] },
        { t: 'Reference', sum: 'slash commands · setup wizard · about', rows: [
            { id: 'a-cmds', label: 'Slash commands', type: 'btn', btn: 'Show', act: 'commands', old: 'Reference / commands' },
            { id: 'a-wizard', label: 'Setup wizard', type: 'btn', btn: 'Run', act: 'wizard', old: 'Re-run setup wizard' },
            { id: 'a-about', label: 'About', type: 'btn', btn: 'Show', act: 'about', old: 'About / version' },
        ] },
        { t: 'Start over', sum: 'everything back to the defaults', rows: [
            { id: 'a-resetall', label: 'Reset all settings', tip: 'Every section back to the defaults. Your vaults, AI connections, prompt presets and your own prompts stay. Asks first.', type: 'btn', btn: 'Reset all', act: 'resetAll', old: 'Reset to defaults' },
        ] },
    ] },
];

// ── helpers ────────────────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Every row of a card (the More ones too). */
export const cardRows = card => card.rows || [];
/** Every row in the window, with its section and card. */
export function allRows(sections = SECTIONS) {
    const out = [];
    for (const sec of sections) (sec.cards || []).forEach((card, k) => { for (const row of cardRows(card)) out.push({ sec, card, k, row }); });
    return out;
}
export const findRow = (id, sections = SECTIONS) => allRows(sections).find(x => x.row.id === id) || null;

/** The value a row shows, read from `s` (the right store for its src). */
export function rowValue(row, s) {
    if (!s) return undefined;
    if (row.read) return row.read(s);
    return row.key ? s[row.key] : undefined;
}
/** Write a row's value into `s` (both old keys for a merged row). */
export function writeRow(row, s, v) {
    if (row.write) row.write(s, v);
    else if (row.key) s[row.key] = v;
}
/** Is this row changed from its default? (buttons never are) */
export function isChanged(row, s, d) {
    if (row.type === 'btn' || row.type === 'custom' || !d) return false;
    if (!row.read && !row.key) return false;
    return !same(rowValue(row, s), rowValue(row, d));
}
/** Put a row back to its default. Merged rows put back every key they stand for. */
export function resetRow(row, s, d) {
    if (row.read) writeRow(row, s, rowValue(row, d));
    else if (row.key) s[row.key] = d[row.key] && typeof d[row.key] === 'object' ? JSON.parse(JSON.stringify(d[row.key])) : d[row.key];
}

/** How a value reads in a summary or as "default: …". */
export function showValue(row, v) {
    if (row.type === 'switch') return v ? 'on' : 'off';
    if (row.opts) { const o = row.opts.find(([x]) => String(x) === String(v)); if (o) return o[1]; }
    if (row.scale && Number.isFinite(Number(v))) return String(Number(v) / row.scale);
    if (v === '' || v == null) return 'empty';
    if (Array.isArray(v)) return v.length ? v.join(', ') : 'empty';
    return String(v).replace(/\s+/g, ' ').slice(0, 60);
}

/** A card's one-line summary: its first few rows (not More, not buttons). `pick(row)` gives the store for a row. */
export function cardSummary(card, pick) {
    const rows = cardRows(card).filter(r => !r.more && r.type !== 'btn' && r.type !== 'custom' && (r.key || r.read));
    const parts = [];
    for (const r of rows.slice(0, 3)) {
        const s = pick(r);
        if (r.show && s && !r.show(s)) continue;
        const v = rowValue(r, s);
        if (r.type === 'switch') parts.push(v ? r.label : `${r.label}: off`);
        else if (r.type === 'num' && r.read && Number(v) === 0) parts.push(`${r.label}: off`);
        else parts.push(r.opts ? showValue(r, v) : `${r.label} ${showValue(r, v)}`);
    }
    return parts.join(' · ') || card.sum || '';   // cards of buttons only say what's inside (bug hunt 2026-10-17: an empty line)
}

/** How many rows in a section differ from their defaults. */
export function changedCount(sec, pick, pickDefault) {
    let n = 0;
    for (const card of sec.cards || []) for (const r of cardRows(card)) if (isChanged(r, pick(r), pickDefault(r))) n++;
    return n;
}

/** Search: by label, hint, tip, the old name, or the card / section name. → [{ sec, card, k, row }] */
export function searchRows(q, sections = SECTIONS) {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return [];
    const words = t.split(/\s+/);
    return allRows(sections).filter(({ sec, card, row }) => {
        const hay = [row.label, row.hint, row.tip, row.old, card.t, sec.name, row.btn].filter(Boolean).join(' ').toLowerCase();
        return words.every(w => hay.includes(w));
    });
}

/** Things in the custom sections (vaults, Filters, AI jobs, prompts) that search should find too. */
export const SEARCH_EXTRAS = [
    { id: 'x-vaults', label: 'Vaults: add, edit, test, remove', sec: 'vault', old: 'Obsidian connection / port / API key / HTTPS / multi-vault' },
    { id: 'x-scan', label: 'Scan for vaults', sec: 'vault', old: 'Scan vaults' },
    { id: 'x-hub', label: 'Folders for each character and run', sec: 'filters', old: 'Filters / folder filter / character folders' },
    { id: 'x-fields', label: 'Edit the filter fields', sec: 'filters', old: 'Field editor / rule builder / gating fields' },
    { id: 'x-conn', label: 'Which AI does which job', sec: 'ai', old: 'AI connections / connection profile / inherit / SillyTavern connection' },
    { id: 'x-fine', label: 'Model, answer length, time limit, Test', sec: 'ai', old: 'Model override / max tokens / timeout / test message' },
    { id: 'x-lang', label: 'Prompt language', sec: 'prompts', old: 'AI prompt locale' },
    { id: 'x-presets', label: 'Saved prompt presets', sec: 'prompts', old: 'Presets' },
    { id: 'x-pfiles', label: 'Prompt files: export, reload, reset all', sec: 'prompts', old: 'Export prompts to vault / per prompt export, revert, update' },
    { id: 'x-system', label: 'Each AI job’s prompt', sec: 'prompts', old: 'System prompt / AI search prompt / scribe prompt' },
    { id: 'x-own', label: 'Your own prompts', sec: 'prompts', old: 'Custom prompt / own prompt / extra instructions' },
    { id: 'x-budget', label: 'Budget for one chat or character', sec: 'budget', old: 'Per chat budget / per character budget / token budget' },
];
/** Search rows and the extras. → { rows: [{ sec, card, k, row }], extras: [{ id, label, sec }] } */
export function searchAll(q, sections = SECTIONS) {
    const t = String(q || '').trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    const extras = words.length ? SEARCH_EXTRAS.filter(x => words.every(w => `${x.label} ${x.old}`.toLowerCase().includes(w))) : [];
    return { rows: searchRows(q, sections), extras };
}

/** Clamp a typed number to the row's range (or the settings.js constraint). Empty / not a number → null (keep as is). */
export function clampNumber(row, raw, constraints = {}) {
    if (raw === '' || raw == null) return null;
    let n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (row.scale) n *= row.scale;
    const c = row.key ? constraints[row.key] : null;
    const min = row.min ?? (c && !c.enum ? c.min : undefined);
    const max = row.max ?? (c && !c.enum ? c.max : undefined);
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    if (row.scale) n = Math.round(n);
    return n;
}

/** Map the old window's deep links ({ tab, subtab, toolKey }) onto the new sections. */
const TAB_TO_SECTION = {
    about: 'adv', obsidian: 'vault', connection: 'vault', 'ai-connections': 'ai', search: 'select', matching: 'select', ai: 'select',
    injection: 'inject', prompts: 'prompts', 'author-notebook': 'story', 'ai-notebook': 'story', 'session-scribe': 'story',
    'auto-lorebook': 'story', features: 'story', graph: 'iface', librarian: 'ai', system: 'adv', reference: 'adv', filters: 'filters', mero: 'mero',
};
export function sectionForNav(nav) {
    if (!nav) return null;
    if (nav.section && SECTIONS.some(s => s.id === nav.section)) return nav.section;
    if (nav.toolKey) return 'ai';
    if (nav.subtab === 'ai-connections') return 'ai';
    return TAB_TO_SECTION[nav.subtab] || TAB_TO_SECTION[nav.tab] || null;
}

/** AI & connections: one row per job (the settings keys are settings.js TOOL_SETTINGS_KEYS'). The Librarian is not listed. */
export const JOBS = [
    { tool: 'aiSearch', job: 'Judge', what: 'picks the lore for a reply', modes: ['profile', 'proxy'], root: true },
    { tool: 'storyTracker', job: 'Story helper', what: 'moves trackers; the Cast’s director', modes: ['profile'] },
    { tool: 'mero', job: 'Mero ☆', what: 'talks, pitches, entry ideas', modes: ['profile'] },
    { tool: 'scribe', job: 'Scribe', what: 'session notes', modes: ['inherit', 'st', 'profile', 'proxy'] },
    { tool: 'autoSuggest', job: 'New lore', what: 'notices lore worth writing', modes: ['inherit', 'st', 'profile', 'proxy'] },
    { tool: 'aiNotepad', job: 'AI notepad', what: 'keeps notes from replies (extract)', modes: ['inherit', 'profile', 'proxy'] },
    { tool: 'optimizeKeys', job: 'Optimize keywords', what: 'better keys for an entry', modes: ['inherit', 'profile', 'proxy'] },
];
export const JOB_KEYS = {
    aiSearch: { mode: 'aiSearchConnectionMode', profileId: 'aiSearchProfileId', model: 'aiSearchModel', maxTokens: 'aiSearchMaxTokens', timeout: 'aiSearchTimeout' },
    storyTracker: { mode: 'storyTrackerConnectionMode', profileId: 'storyTrackerProfileId', model: 'storyTrackerModel', maxTokens: 'storyTrackerMaxTokens', timeout: 'storyTrackerTimeout' },
    mero: { mode: 'meroConnectionMode', profileId: 'meroProfileId', model: 'meroModel', maxTokens: 'meroMaxTokens', timeout: 'meroTimeout' },
    scribe: { mode: 'scribeConnectionMode', profileId: 'scribeProfileId', model: 'scribeModel', maxTokens: 'scribeMaxTokens', timeout: 'scribeTimeout' },
    autoSuggest: { mode: 'autoSuggestConnectionMode', profileId: 'autoSuggestProfileId', model: 'autoSuggestModel', maxTokens: 'autoSuggestMaxTokens', timeout: 'autoSuggestTimeout' },
    aiNotepad: { mode: 'aiNotepadConnectionMode', profileId: 'aiNotepadProfileId', model: 'aiNotepadModel', maxTokens: 'aiNotepadMaxTokens', timeout: 'aiNotepadTimeout' },
    optimizeKeys: { mode: 'optimizeKeysConnectionMode', profileId: 'optimizeKeysProfileId', model: 'optimizeKeysModel', maxTokens: 'optimizeKeysMaxTokens', timeout: 'optimizeKeysTimeout' },
};
/** When a job runs, from today's settings (words only — no invented numbers). */
export function jobRuns(tool, s) {
    switch (tool) {
        case 'aiSearch': return s.aiSearchEnabled ? 'every reply' : 'off (keywords only)';
        case 'storyTracker': return 'with the story';
        case 'mero': return 'when you ask';
        case 'scribe': return s.scribeEnabled ? `every ${s.scribeInterval} messages` : 'off';
        case 'autoSuggest': return s.autoSuggestEnabled ? `every ${s.autoSuggestInterval} messages` : 'off';
        case 'aiNotepad': return !s.aiNotepadEnabled ? 'off' : s.aiNotepadMode === 'extract' ? 'every reply' : 'not used (tags)';
        case 'optimizeKeys': return 'when you ask';
        default: return '';
    }
}
/** The connection choice a job shows: 'inherit' · 'st' · 'proxy' · or the profile id. */
export function connChoice(tool, s) {
    const k = JOB_KEYS[tool];
    const mode = s[k.mode];
    if (mode === 'profile') return s[k.profileId] || '';
    return mode;
}
/** Store a connection choice the way the old radio + profile list did. */
export function writeConnChoice(tool, s, v) {
    const k = JOB_KEYS[tool];
    if (v === 'inherit' || v === 'st' || v === 'proxy') { s[k.mode] = v; return; }
    s[k.mode] = 'profile';
    s[k.profileId] = String(v || '');
}
/** Jobs that borrow the judge's connection ("Same as the judge"). */
export const followers = s => JOBS.filter(j => !j.root && s[JOB_KEYS[j.tool].mode] === 'inherit').map(j => j.job);

/** The prompts kept in settings (Prompts section). key = the prompt in src/i18n/prompts (null: no built-in shown). */
export const PROMPTS = [
    { tool: 'aiSearch', name: 'The judge', what: 'picks lore', key: 'aiSearchSystemPrompt', prompt: 'AI_SEARCH_SYSTEM_PROMPT' },
    { tool: 'scribe', name: 'Scribe', what: 'session notes', key: 'scribePrompt', prompt: 'SCRIBE_PROMPT' },
    { tool: 'autoSuggest', name: 'New lore', what: 'entry ideas', key: 'autoSuggestPrompt', prompt: 'AUTO_SUGGEST_PROMPT' },
    { tool: 'optimizeKeys', name: 'Optimize keywords', what: 'better keys', key: 'optimizeKeysPrompt', prompt: 'OPTIMIZE_KEYS_PROMPT' },
    { tool: 'aiNotepad', name: 'AI notepad: tags', what: 'how the writer marks notes', key: 'aiNotepadPrompt', prompt: 'AI_NOTEPAD_PROMPT' },
    { tool: 'aiNotepadExtract', name: 'AI notepad: extract', what: 'the helper that reads each reply', key: 'aiNotepadExtractPrompt', prompt: null },
];
/** Rough token count of a text (4 characters a token — the same rule DeepLore's budgets use). */
export const roughTokens = text => Math.ceil(String(text || '').length / 4);

/**
 * Settings the old window showed that the new one does not draw, and why (the test checks every old control is
 * either drawn or listed here). Their stored values stay exactly as they are.
 */
export const NOT_DRAWN = {
    showLoreSources: 'Why? on / off — let go (Step 4 checklist s-whybtn); Why these entries lives in the reply’s ⋯',
    aiSearchClaudeCodePrefix: 'proxy-only and already hidden in the old window (proxy mode retired in v2.5)',
    aiSearchSystemPrompt: 'edited in Prompts', scribePrompt: 'edited in Prompts', autoSuggestPrompt: 'edited in Prompts',
    optimizeKeysPrompt: 'edited in Prompts', aiNotepadPrompt: 'edited in Prompts', aiNotepadExtractPrompt: 'edited in Prompts',
    aiPromptLocale: 'Prompts › Language', enabled: 'the On switch in the header', vaults: 'Vault › Vaults',
    aiForceUserRole: 'AI & connections › Fine print',
    ownPrompts: 'Prompts › + Your own prompt (its own editor)', characterBudgets: 'a character’s page (Budget rows)',
};
