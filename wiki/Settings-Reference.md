# Settings reference

Every setting in DeepLore's settings window, with its default and what it does. The `code names` at the end of each row are the saved setting, for anyone reading the code.

## Opening the settings

- The [[DeepLore Bar]]'s 📖 menu → **Setup and settings**.
- The [[Drawer|side panel]]'s ⋯ → **Settings**.
- SillyTavern's Extensions panel → DeepLore → **Open DeepLore Settings**. The **Enable DeepLore** checkbox there is the same on/off switch as in the window.

## The window

- **On / Off everywhere** (top left): DeepLore's master switch (`enabled`).
- **Search settings…**: finds a setting by its name, its explanation, or its old name from earlier versions.
- **Everywhere · a character ▾ · This chat**: whose settings you are changing. A character or a chat can have its own budget and folders; the most specific wins.
- **Simple · Sandbox**: Simple hides the rarely used settings (the ones marked **(More)** below). Sandbox shows everything.
- **Only what I changed (N)**: lists only the settings you changed from their defaults. Each changed setting can be put back with **Reset**.
- The sections are grouped as **Lore** (Vault, Filters, Lore selection, Budget & variety, Where it goes), **AI** (AI & connections, Prompts, Mero), **Story** (Story & memory) and **Look** (Interface, Advanced). On a phone, tap a section to open it and **← All settings** to go back.

Board, tracker and Cast settings are not here: they live on the board ([[Storyboards]]).

## Vault

Where your lore lives and how DeepLore reaches it.

### Vaults

Each vault is a card with its **Name** (must match your Obsidian vault's name exactly), **Address**, **Port**, **HTTPS** (with **Trust its certificate**), **API key** (from Obsidian's Local REST API plugin), and **Test** / **Remove** buttons. Below the list: **Add a vault**, **Scan for vaults** (looks for Obsidian vaults on this computer) and **Test all**.

| Setting | Default | What it does |
|---|---|---|
| **When two vaults have the same entry** | keep both | Choices: keep both · first vault wins · last vault wins · merge (combine keywords). `multiVaultConflictResolution` |

### Reading

| Setting | Default | What it does |
|---|---|---|
| **Re-read the vault every** | 0 | Seconds · 0 = only by hand. `syncPollingInterval` |
| **Tell me what changed** | on | A notice after a re-read finds changes. `showSyncToasts` |
| **Re-read now** | — | Button: **Re-read**. |
| **Rebuild the index** (More) | after a time | Choices: after a time · every N replies · only by hand. `indexRebuildTrigger` |
| **Keep the index for** (More) | 300 | Seconds. Used by “after a time”. `cacheTTL` |
| **Every N replies** (More) | 10 | Used by “every N replies”. `indexRebuildGenerationInterval` |

### Tags

| Setting | Default | What it does |
|---|---|---|
| **Lore tag** | lorebook | Notes with this tag are lore. `lorebookTag` |
| **Always-send tag** | lorebook-always | Sent with every reply. `constantTag` |
| **Never-send tag** (More) | lorebook-never | `neverInsertTag` |
| **Seed tag** (More) | lorebook-seed | Sent quietly in the background while a chat is new. `seedTag` |
| **Starter tag** (More) | lorebook-bootstrap | Sent openly while a chat is new. `bootstrapTag` |
| **Writing-guide tag** (More) | lorebook-guide | Entries with this tag are writing guides, not lore. `librarianGuideTag` |
| **A chat counts as new for** (More) | 3 | Messages. `newChatThreshold` |

### Files

| Setting | Default | What it does |
|---|---|---|
| **Field definitions file** | DeepLore/field-definitions.yaml | In your vault. `fieldDefinitionsPath` |
| **Prompts folder** | DeepLore/prompts/ | In your vault. `promptsFolderPath` |

## Filters

Folders for each character and run. **Open now** shows the chat that is open: its character and run, the folders it reads, whether DeepLore is on, and the board it uses, with **Edit <character>** and **This chat only…**. Below it, **Find a character…** and **Rescan cards** list every character; each has **Base folders** and, per run, **Run X adds**, each with **Edit**. **More** holds **Edit the filter fields…** (add, rename or remove fields; saved in the field definitions file). For one chat's own folders and field values, see the side panel's **Filters** tab ([[Drawer|Side Panel]]).

## Lore selection

How DeepLore finds the lore for a reply.

### Mode

| Setting | Default | What it does |
|---|---|---|
| **How lore is picked** | keywords only | Choices: keywords only · keywords, then the judge · the judge only. |

### Keywords

| Setting | Default | What it does |
|---|---|---|
| **Messages to read** | 4 | How far back keywords are looked for. `scanDepth` |
| **Match the active character** | off | `characterContextScan` |
| **Loose matching** | off | Also finds entries whose words are close to the chat, not only exact keywords. `fuzzySearchEnabled` |
| **How close** | 0.5 | Low = more matches. The lowest score that still counts (0.1 – 2). The preview shows sample entries, not your vault. `fuzzySearchMinScore` |
| **Case sensitive** (More) | off | `caseSensitive` |
| **Whole words only** (More) | off | `matchWholeWords` |
| **Entries can call other entries** (More) | 0 | Steps · 0 = off. An entry’s text can match more entries, up to this many steps. `recursiveScan` + `maxRecursionSteps` |
| **Count how often a keyword appears** (More) | off | Can slow down big vaults. `keywordOccurrenceWeighting` |
| **Higher priority number wins** (More) | off | Off: a lower number wins (as in Obsidian and World Info). `priorityReversed` |
| **When a chat has no field value set** (More) | strict: block the entry | Choices: strict: block the entry · moderate: block only a mismatch · lenient: allow it. `contextualGatingTolerance` |

### The judge

| Setting | Default | What it does |
|---|---|---|
| **Leave out below** | low (keep all) | How sure the judge must be. Choices: low (keep all) · medium · high. `aiConfidenceThreshold` |
| **Messages the judge reads** | 4 | `aiSearchScanDepth` |
| **Its prompt** | — | See exactly what the judge is sent for this chat. Button: **Preview**. |
| **If the judge fails** (More) | use the keyword picks | Choices: use the keyword picks · always-send entries only · starter entries only · send no lore. `aiErrorFallback` |
| **If the judge picks nothing** (More) | always-send entries only | Choices: always-send entries only · always-send + starter entries · use the keyword picks · send no lore. `aiEmptyFallback` |
| **The judge reads** (More) | the summary, else the text | Choices: the summary, else the text · summaries only · the text only. `manifestSummaryMode` |
| **Longest summary sent** (More) | 600 | Characters. `aiSearchManifestSummaryLength` |
| **Give it the session notes** (More) | off | Scribe’s latest notes go to the judge too. `scribeInformedRetrieval` |
| **Your fields it sees** (More) | (empty) | Comma list · empty = all. |
| **Sort by category first** (More) | off | An extra AI call that narrows a big list. `hierarchicalPreFilter` |
| **How much it trims** (More) | 0.8 | 0 keep all … 0.8 trim most. `hierarchicalAggressiveness` |

### Writing helpers

| Setting | Default | What it does |
|---|---|---|
| **Start the writer’s reply for it** | off | So it doesn’t open with “Certainly, here’s…”. Choices: off · Claude only · every provider. `responsePrefillMode` |
| **The opening text** | (empty) | Empty = none. `responsePrefillSeed` |
| **Optimize keywords** | keywords only | Choices: keywords only · keywords, then AI. `optimizeKeysMode` |

## Budget & variety

How much lore, and not the same entries every reply. Set here for Everywhere; a character or a chat can set its own.

### Budget

Set for **Everywhere** here; a character or a chat can set its own budget (the most specific wins: this chat → its character → Everywhere). **Follow Everywhere again** drops a character's or chat's own numbers.

| Setting | Default | What it does |
|---|---|---|
| **Entries per reply** | 10 | `maxEntries` |
| **No limit on entries** | off | Big vaults may feel slower. `unlimitedEntries` |
| **Lore budget** | 3072 | Tokens per reply. `maxTokensBudget` |
| **No limit on tokens** | off | `unlimitedBudget` |

### Variety

| Setting | Default | What it does |
|---|---|---|
| **Give others a turn** | off | An entry sent many times in a row steps back; one skipped a long time gets a boost. `decayEnabled` |
| **Rest after sending** | 0 | Replies. An entry waits this many replies before it can be sent again. `reinjectionCooldown` |
| **Skip what was just sent** | 2 | Messages back · 0 = off. Leave out entries already sent in this many recent messages. |
| **Bring one back after** (More) | 5 | Replies skipped. `decayBoostThreshold` |
| **Hold one back after** (More) | 2 | Times in a row. `decayPenaltyThreshold` |

## Where it goes

Where DeepLore’s parts go in the prompt.

### How

| Setting | Default | What it does |
|---|---|---|
| **Place DeepLore’s parts** | by these settings | “In SillyTavern’s prompt list”: drag each part where you want it there; the positions below then step aside. Choices: by these settings · in the prompt list. `injectionMode` |
| **Let World Info see DeepLore’s lore** | off | `allowWIScan` |

### Lore entries

| Setting | Default | What it does |
|---|---|---|
| **Position** | in the chat | Choices: before the main prompt · after the main prompt · in the chat. `injectionPosition` |
| **Depth** | 4 | In the chat. `injectionDepth` |
| **As** | system | Choices: system · user · assistant. `injectionRole` |
| **How each entry is written** (More) | <{{title}}>
{{content}}
</{{title}}> | {{title}} and {{content}}. `injectionTemplate` |

### Story state and notes

| Setting | Default | What it does |
|---|---|---|
| **Story trackers block** | in the chat | Where the story’s trackers, the board and the Cast are told to the writer. Choices: before the main prompt · after the main prompt · in the chat. `storyBlockPosition` |
| **Its depth** | 4 | `storyBlockDepth` |
| **As** | system | Choices: system · user · assistant. `storyBlockRole` |
| **Author’s notebook** | in the chat | Choices: before the main prompt · after the main prompt · in the chat. `notebookPosition` |
| **Its depth** | 4 | `notebookDepth` |
| **As** | system | Choices: system · user · assistant. `notebookRole` |
| **AI notepad** (More) | in the chat | Choices: before the main prompt · after the main prompt · in the chat. `aiNotepadPosition` |
| **Its depth** (More) | 4 | `aiNotepadDepth` |
| **As** (More) | system | Choices: system · user · assistant. `aiNotepadRole` |

## AI & connections

Which AI does which job. One row per job, with its **Connection**, when it **Runs**, and **Answer up to** (the most the AI may answer):

| Job | What it does | Connection choices |
|---|---|---|
| **Judge** | picks the lore for a reply | a connection profile |
| **Story helper** | moves trackers; the Cast's director | a connection profile |
| **Mero ☆** | talks, pitches, entry ideas | a connection profile |
| **Scribe** | session notes | Same as the judge · SillyTavern's own connection · a profile |
| **New lore** | notices lore worth writing | Same as the judge · SillyTavern's own connection · a profile |
| **AI notepad** | keeps notes from replies (extract) | Same as the judge · a profile |
| **Optimize keywords** | better keys for an entry | Same as the judge · a profile |

Connection profiles are made in SillyTavern's API Connections (the plug icon) → Connection Profile. **Fine print** holds, per job, **Model** (a different model on the same connection), **Answer up to**, **Time limit** and **Test** (a one-line test message), plus **Put the system prompt into the user message** (for providers that have no system role). A job saved in the old custom proxy mode shows **Custom proxy (old)**; pick a profile instead.

## Prompts

The prompt each AI job uses: **The judge**, **Scribe**, **New lore**, **Optimize keywords**, **AI notepad: tags** and **AI notepad: extract**. **Edit** opens a prompt (empty = the built-in one; **Back to the built-in**, **Save as preset…**, **Saved presets…**), and **Revert** goes back to the built-in. **+ Your own prompt** adds a piece of your own that goes into every prompt, where you say. Also here: **Language** (the prompt language) and the prompt files in your vault: **Export to vault**, **Reload** and **Reset all** (asks first).

## Mero

Your co-writer: who she is and how she helps. Her AI is picked in AI & connections. See [[Mero]].

### Who she is

| Setting | Default | What it does |
|---|---|---|
| **In your words** | — | Button: **Edit**. |
| **Who she is: first draft** | — | Button: **Reset**. |

### Her job

| Setting | Default | What it does |
|---|---|---|
| **How much she does** | Part-timer | Her lore upkeep: how often she checks the entries. Choices: Off duty · Freelancer · Part-timer · Full-timer. `job` |
| **Needs my sign-off** | on | On: nothing is written without your yes. Off: she writes changes herself, each with an Undo. `signoff` |

### How she talks

| Setting | Default | What it does |
|---|---|---|
| **Chattiness** | Chatty | Choices: Quiet · Chatty · Very chatty · Custom. `chatty` |
| **The writer’s initiative** | balanced | From “follow my lead” to “brings events”. Choices: follow my lead · mostly follows · balanced · brings events · takes the wheel. `initiative` |
| **She reads the latest** | 12 | Replies. `replies` |
| **How much she talks** (More) | some | Choices: a little · some · a lot. `talk` |
| **Brings things up herself** (More) | off | `bringUp` |
| **The glow** (More) | big moments | A soft light while she has something; costs nothing until you click it. Choices: off · big moments · + quiet threads. `glow` |
| **Her settings** (More) | — | Chattiness, initiative, replies, job and sign-off back to how they shipped. Who she is stays. Button: **Reset**. |

## Story & memory

What DeepLore writes down, and the story tools. Trackers, boards and the Cast are set up on the board itself (see [[Storyboards]] and [[Cast]]); this section only points there.

### Trackers and board

| Setting | Default | What it does |
|---|---|---|
| **Trackers, board, Cast** | — | This chat: its board and DeepLore on or off. Button: **This chat…**. |
| **The board** | — | Button: **Open**. |

### New entries

| Setting | Default | What it does |
|---|---|---|
| **Notice lore worth writing** | 0 | Every N messages · 0 = off. `autoSuggestEnabled` + `autoSuggestInterval` |
| **Where they go** | by what they’re about | By what they’re about: about the run → the run’s folder · about the character → the character’s base folder. Choices: by what they’re about · always the Target folder. `newEntryPlacement` |
| **Target folder** | (empty) | When a chat has no folders yet. Empty = the top of the vault. `autoSuggestFolder` |
| **Mark them** | on | Made_by, from (chat and message), the made-by-mero tag. The date is always written. `newEntryMark` |
| **Write into the vault** (More) | (empty) | `autoSuggestWriteVaultId` |
| **Write them straight in** (More) | off | Off: you review each one first. `autoSuggestSkipReview` |

### Scribe

| Setting | Default | What it does |
|---|---|---|
| **Session notes** | 0 | Every N messages · 0 = off. `scribeEnabled` + `scribeInterval` |
| **Folder** | Sessions | `scribeFolder` |
| **Messages it reads** (More) | 20 | `scribeScanDepth` |
| **Write into the vault** (More) | (empty) | `scribeWriteVaultId` |

### Notebook and notepad

| Setting | Default | What it does |
|---|---|---|
| **Author’s notebook** | off | `notebookEnabled` |
| **AI notepad** | off | `aiNotepadEnabled` |
| **How it gets its notes** | tags | Tags: the writer adds them, no extra call · Extract: a helper reads each reply. Choices: tags · extract. `aiNotepadMode` |
| **Notes it keeps** (More) | 50 | 0 = no limit. The oldest drop first. `aiNotepadMaxEntries` |
| **Count as the same note from** (More) | 0.85 | 0.1 … 1 how alike. `aiNotepadFuzzyDedupThreshold` |

### Importing World Info

| Setting | Default | What it does |
|---|---|---|
| **Shrink imported entries** | off | Saves tokens. `importCompressByDefault` |
| **Example messages** | add them under a subheading | In a World Info book. Choices: add them under a subheading · skip them. `wiImportEmHandling` |

## Interface

Colors, the bar, notices, removing things, and the graph. About the bar: [[DeepLore Bar]].

### Look

| Setting | Default | What it does |
|---|---|---|
| **Colors** | follow SillyTavern | Follow SillyTavern’s theme (your own colors too), or keep DeepLore always light or dark. Choices: follow SillyTavern · light · dark. `dkTheme` |

### The bar

| Setting | Default | What it does |
|---|---|---|
| **Show the DeepLore bar** | on | Above the message box. `barShow` |
| **Hide SillyTavern’s Quick Reply row** | on | While you have Quick Replies starred on the bar. `barHideStQr` |

### Notices

| Setting | Default | What it does |
|---|---|---|
| **Pop-ups** | one per message | Choices: one per message · every change. `noticeStyle` |
| **Ask before removing** | off | On: everything asks first. Off: small things go at once with Undo; big ones ask. `askBeforeRemoving` |

### Graph

| Setting | Default | What it does |
|---|---|---|
| **Spacing** | normal | Sets the physics under More for you. Choices: tight · normal · loose. |
| **Color by** | type | Choices: type · priority · connections · frequency · community. `graphDefaultColorMode` |
| **Labels** | on | `graphShowLabels` |
| **Repulsion** (More) | 0.3 | `graphRepulsion` |
| **Gravity** (More) | 11 | `graphGravity` |
| **Damping** (More) | 0.5 | `graphDamping` |
| **Hover dim distance** (More) | 3 | `graphHoverDimDistance` |
| **Focus tree depth** (More) | 2 | `graphFocusTreeDepth` |
| **Hover falloff** (More) | 0.55 | `graphHoverFalloff` |
| **Edge filter alpha** (More) | 0.05 | `graphEdgeFilterAlpha` |

## Advanced

For troubleshooting.

### Troubleshooting

| Setting | Default | What it does |
|---|---|---|
| **Debug mode** | off | More detail in the browser console. `debugMode` |
| **Diagnostics** | — | Health, recent activity, session stats. Button: **Open**. |
| **Export diagnostics** | — | A file to share, with names removed. Button: **Export**. |
| **The AI pause** | — | After repeated AI errors DeepLore pauses its AI; this clears it. Button: **Reset**. |
| **Try matching** | — | Replays this chat and shows which entries each message calls up (the side panel’s Try matching). Button: **Open**. |
| **Answer length for a vault review** | 0 | Tokens · 0 = Mero’s own. `reviewResponseTokens` |

### Reference

| Setting | Default | What it does |
|---|---|---|
| **Slash commands** | — | Button: **Show**. |
| **Setup wizard** | — | Button: **Run**. |
| **About** | — | Button: **Show**. |

### Start over

| Setting | Default | What it does |
|---|---|---|
| **Reset all settings** | — | Every section back to the defaults. Your vaults, AI connections, prompt presets and your own prompts stay. Asks first. Button: **Reset all**. |
