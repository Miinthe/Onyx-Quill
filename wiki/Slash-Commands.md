# Slash Commands

DeepLore registers more than 40 slash commands in SillyTavern. Type them in the chat input, or open the `/dle` palette and search.

> [!NOTE]
> ST's built-in `/help slash` auto-discovers DLE commands from the `helpString` each one registers, so the in-app help stays current with the code. A couple of commands (`/oq-summarize-range`, `/oq-summarize-rollback`) are registered but intentionally left off the `/dle` palette to keep it focused — they still work and show up in `/help slash`.

## Command palette

### `/dle`
Open the command palette: a searchable popup of every DLE command. Type to filter, click to run.

---

## Vault management

### `/oq-refresh` (alias: `/oq-r`)
Rebuild the vault index from Obsidian. Clears the cache timestamp and re-fetches every entry.

**When to use:** after editing entries in Obsidian, instead of waiting for the cache TTL or auto-sync to pick the change up.

---

### `/oq-browse` (alias: `/oq-b`)
Open the entry browser: a searchable, filterable popup of every indexed entry.

**When to use:** quick review without switching to Obsidian. Browse titles, keywords, priorities, and token sizes.

---

### `/oq-import [folder]`
Import a SillyTavern World Info JSON into the vault. The popup accepts three input methods: pick an existing ST lorebook from a dropdown, browse to a local `.json` file, or paste JSON directly. Pass a folder name to drop the entries into a vault subfolder, e.g. `/oq-import Imported`.

**Notes:**
- Validates JSON before import. Files over 10 MB prompt for confirmation.
- Warns if any entries have neither content nor keys.
- Optionally generates AI summaries for the imported entries (requires AI search to be configured).
- Surfaces a one-shot warning that ST's "Order" semantics flip in DLE: lower priority means higher precedence.

---

### `/oq-graph` (alias: `/oq-g`)
Visualize entry relationships as an interactive force-directed graph. Nodes are entries, edges are wikilinks, requires/excludes, and cascade links. Drag, zoom, pan.

**When to use:** explore the relationship structure. Identify clusters, orphans, dependency chains.

---

### `/oq-cache-info`
Show vault cache status: cached entry count, cache age, browser storage usage (IndexedDB), index load time. Includes a button to clear the cache.

---

### `/oq-clear`
Clear the vault cache AND the live index without re-fetching (wipe and stop). Run `/oq-refresh` to index again from Obsidian.

### `/oq-status`
Show connection info, entry counts, AI search stats, and cache status in a popup.

**Includes:**
- Enabled vaults with port numbers
- Lorebook tag, always-send tag, never-insert tag, seed tag, bootstrap tag
- Indexed entry counts (total, constants, seeds, bootstrap, guides, estimated tokens)
- Token budget and max-entry caps
- Recursive scan settings
- Cache age and TTL
- AI search state and session call/cache/token totals
- Custom field definitions
- Active folder filter (if any)
- Auto-sync interval

---

## Pipeline inspection

### `/oq-why` (alias: `/oq-context`)
Run the pipeline against the current chat without generating a message, then show what would inject right now.

**Notes:**
- If AI search is on, this makes a real API call and uses tokens. A confirmation dialog appears first.
- Runs full keyword matching, AI search, gating, contextual gating, and cooldowns.
- Results render in the Context Cartographer popup.

---

### `/oq-inspect` (alias: `/oq-i`)
Show a detailed trace of the last generation pipeline.

**Includes:**
- Pipeline mode (two-stage, ai-only, keywords-only)
- Per-stage timing breakdown
- Keyword matches with the specific keyword that fired
- AI selections with confidence and reason
- BM25 fuzzy search stats
- Contextual gating removals with per-field mismatch detail
- Cooldown removals, warmup failures, refine-key blocks
- Strip-dedup removals (already in recent context; only if the old skip setting was switched back on by hand)
- Probability skips with the rolled value
- Budget/max cuts
- Folder filter info

**When to use:** debug why an entry was or was not injected in the last generation.

---

### `/oq-simulate`
Replay the current chat history step by step, showing which entries activate and deactivate at each message.

**Notes:**
- Uses keyword matching only (no AI search, no probability/warmup/cooldown) for a deterministic view.
- Per-entry scan-depth overrides are respected.
- Most useful after a conversation has some length.

---

### `/oq-analytics`
Show entry usage analytics. Table sorted by injection count: entry name, match count, injection count, last-used timestamp. Includes a Never Injected section for dead-entry detection.

---

### `/oq-health` (alias: `/oq-h`)
Run 30+ health checks on vault entries and settings. Results group by category in a popup, with errors expanded by default.

**Categories:**
- Multi-vault config and API key validation
- Settings (scan depth, AI mode, leftover Custom Proxy mode from before v2.5, budget, cache TTL, index staleness)
- Entry config (duplicate titles, empty keys, empty content, orphaned references, oversized entries, missing summaries)
- Gating (circular requires, unresolved wikilinks, conflicting overrides)
- AI search (entries without summaries)
- Keywords (short keywords, duplicates across entries)
- Size (constants exceeding budget, oversized seeds)
- Injection (depth/role overrides without `in_chat`)
- Entry behavior (cooldown on constants, warmup unlikely to trigger, bootstrap with no keys, probability zero)

**When to use:** after adding or modifying entries, or when injection behavior surprises you. See [[Features#Entry Health Check]].

---

### `/oq-lint` (alias: `/oq-l`)
Show parser warnings and skipped entries from the last vault index build. Use this when the index build toast mentions warnings or skips.

---

### `/oq-diagnostics` (alias: `/oq-diag`)
Export an anonymized diagnostic report (`.md`) plus a private connections-reference file. The report packages settings, recent pipeline traces from the flight recorder, console/network/error ring buffers, and AI call history. Sensitive values are redacted with stable per-export pseudonyms. See [[Inspection and Diagnostics#Diagnostics export]] for what is in and out.

**When to use:** filing a bug report or asking for help. Open the file and verify the privacy section before sharing.

---

### `/oq-debug [on|off]`
Toggle debug logging. With no argument, flips the current setting. Debug mode echoes interceptor output to a `[DLE-DBG]` console group and enables prompt-replay capture in the AI prompt buffer.

---

### `/oq-logs [count]`
Show the most recent DLE console log entries (default 50, max 500). Drains the console ring buffer and filters for `[DLE]` lines. Includes a copy-to-clipboard button.

---

## AI features

### `/oq-newlore` (alias: `/oq-suggest`)
Analyze the current chat for characters, locations, items, concepts, or events that lack a vault entry, then suggest new entries.

**Output:** popup with each suggestion (title, type, keywords, summary, content preview). Accept writes the entry to Obsidian with proper frontmatter. Reject dismisses it.

**Notes:**
- Works on demand; Auto Lorebook does not need to be enabled.
- Filters out titles that already exist (case-insensitive).
- Uses the Auto Lorebook connection settings.

---

### `/oq-optimize-keys <entry name>`
AI suggests better keywords for the named entry, considering content, summary, and current keys. Suggestions appear in a popup; you apply them in Obsidian.

**Example:** `/oq-optimize-keys Valen Ashwick`

Uses the AI search connection.

---

### `/oq-summarize`
Generate AI search summaries for entries that lack one. Each summary is presented in a review popup before writing back to Obsidian frontmatter. A button on the review popup aborts the remaining queue.

---

### `/oq-summarize-range <range>`
AI-summarize a range of chat messages, hide the originals, and prepend the summary in their place. Returns a summary ID you can use to undo.

**Range syntax:**
- `5-15` summarize messages 5 through 15
- `10-` from message 10 to the end
- `-8` the last 8 messages
- `7` just message 7

The success toast includes the summary ID and the rollback command to undo it. Uses the Optimize Keys connection settings and the dedicated summary prompt/budgets (System tab is not where these live — see the `summarySystemPrompt`/`summaryMaxTokens`/`summaryTimeout` keys).

---

### `/oq-summarize-rollback [id|all]`
Undo a `/oq-summarize-range` operation: restore the hidden messages and remove the summary message.

**Usage:**
- `/oq-summarize-rollback <id>` roll back one summary (the ID from the summarize toast)
- `/oq-summarize-rollback` or `/oq-summarize-rollback all` roll back every summary in this chat

The argument autocompletes with the summaries present in the current chat.

---

### `/oq-review [question]`
Send the entire vault to the AI for review. Posts the vault as a visible user message and triggers a normal generation.

**Usage:**
- `/oq-review` general review
- `/oq-review What inconsistencies do you see?` ask a specific question

**Notes:**
- The review message stays in chat history. Delete it or start a new chat afterward if you do not want it influencing later turns.
- Response token limit comes from the "Review Response Tokens" setting (0 = auto).
- Confirms before sending and shows entry count plus estimated tokens.

---

### `/oq-scribe [focus]`
Write a session summary note to the configured Session Scribe folder.

**Usage:**
- `/oq-scribe` summarize the full session
- `/oq-scribe What happened with the sword?` summarize with a focus topic

**Notes:**
- Works on demand. Session Scribe does not need to be enabled in settings.
- Auto-scribe also runs every N messages when enabled (tracks chat position).
- Writes a timestamped markdown note via the Scribe connection.

---

### `/oq-scribe-history`
Browse all session notes from the configured scribe folder. Notes sort newest first, with character name and timestamp. Click a note to expand the full body.

Requires a configured scribe folder. Fetches notes from Obsidian's REST API.

---

## Author tools

### `/oq-notebook`
Open the Author's Notebook editor for the current chat. Content is injected as a system message every generation when Author's Notebook is enabled. See [[Features#Author's Notebook]].

---

### `/oq-ai-notepad [clear]`
View or clear the AI Notepad for the current chat.

**Usage:**
- `/oq-ai-notepad` open the popup with all accumulated AI notes
- `/oq-ai-notepad clear` clear all AI notes for this chat

**How it works:** when AI Notepad is enabled, the writing AI is instructed to append session notes inside `<dle-notes></dle-notes>` tags. DLE strips the tags from the visible chat, stores the notes per-chat, and reinjects them into later messages so the AI keeps continuity.

Per-message AI notes also surface in the Context Cartographer popup.

---

## Per-chat overrides

### `/oq-pin <entry name>`
Pin an entry so it always injects in the current chat, regardless of keywords or AI selection. Stored in `chat_metadata.deeplore_pins`. Pinning an entry that is currently blocked moves it from the block list to the pin list.

---

### `/oq-unpin <entry name>`
Remove a pin from the current chat.

---

### `/oq-block <entry name>`
Block an entry from injecting in the current chat. Stored in `chat_metadata.deeplore_blocks`. Blocking an entry that is currently pinned moves it from the pin list to the block list.

---

### `/oq-unblock <entry name>`
Remove a block from the current chat.

---

### `/oq-pins`
Show all pinned and blocked entries for the current chat. See [[Features#Per-Chat Pin/Block]].

---

## Contextual gating

### `/oq-set-field <field_name> [value]`
Set a custom gating field value. Works with built-in fields (`era`, `location`, `scene_type`, `character_present`) and any user-defined field from `field-definitions.yaml`.

**Usage:**
- `/oq-set-field weather stormy` set directly
- `/oq-set-field weather` open a browse-and-select popup of values found in the vault

For multi fields, comma-separated values are accepted: `/oq-set-field character_present Eris, Valen`.

---

### `/oq-clear-field <field_name>`
Clear a custom gating field, removing it from the active context (e.g. `/oq-clear-field weather`).

---

### `/oq-set-era [era]` (alias: `/oq-era`)
Set the active era for contextual gating (e.g. `/oq-set-era pre-war`). With no argument, opens a browse-and-select popup showing every era value in the vault with entry counts.

If the value matches no entries, the popup lists available eras.

---

### `/oq-set-location [location]` (alias: `/oq-loc`)
Set the active location for contextual gating (e.g. `/oq-set-location The Docks`). With no argument, opens a browse-and-select popup with entry counts.

---

### `/oq-set-scene [scene type]`
Set the active scene type for contextual gating (e.g. `/oq-set-scene combat`). With no argument, opens a browse-and-select popup with entry counts.

---

### `/oq-set-characters <names>`
Set present characters for contextual gating (comma-separated, e.g. `/oq-set-characters Valen, Sera`). With no argument, opens a multi-select popup; toggle characters and the change applies when you close the popup.

---

### `/oq-context-state` (alias: `/oq-ctx`)
Show the current contextual gating state for every defined field (built-in and custom).

---

### `/oq-clear-all-context` (alias: `/oq-reset-context`)
Clear every active gating field at once: era, location, scene type, characters, and all custom fields.

**When to use:** quick reset between scenes or arcs, instead of clearing each field one by one.

---

### `/oq-set-folder [path...]` (alias: `/oq-folder`)
Filter entries by Obsidian folder path. Only entries in the selected folders are eligible for injection.

**Usage:**
- `/oq-set-folder Characters/NPCs` set one folder
- `/oq-set-folder "World Lore" Characters` multiple folders, quote paths with spaces
- `/oq-set-folder` open a selection popup with checkbox toggles per folder

Validates folder paths against the indexed list and warns about unknown ones.

---

### `/oq-clear-folder`
Clear the folder filter, allowing entries from every folder again.

---

## Storyboards and trackers

See [[Storyboards]] for what these are.

### `/oq-board [board name]`
Open the storyboard window, or apply a board to this chat: `/oq-board Toaster & Kettle`.

### `/oq-board-saveas`
Save this chat's trackers as a new storyboard and use it here. The old one stays as it was.

### `/oq-board-character [board name | off]`
Default storyboard for new chats with this character: `/oq-board-character Toaster & Kettle` (`off` clears it).

### `/oq-board-detach`
Stop using the storyboard in this chat (it keeps its own copy of the trackers).

### `/oq-board-off [chat | character | on]`
Switch this chat's board off for this chat (default) or for its character. Nothing of the board runs there. `on` switches it back on.

### `/oq-tracker [name = steps]`
Make or edit a story tracker: `/oq-tracker Relationship = Strangers, Neighbours, Friends`. With no argument, it lists this chat's trackers.

### `/oq-tracker-next [tracker]` and `/oq-tracker-back [tracker]`
Move a story tracker one step on, or one step back. The name is optional when there is only one tracker.

### `/oq-tracker-go <tracker = step>`
Jump a story tracker to a step: `/oq-tracker-go Relationship = Friends`.

### `/oq-tracker-aside <tracker = detour>`
Set a detour beside a tracker's step, e.g. `/oq-tracker-aside Relationship = Nuisance`. Nothing after the `=` clears it.

### `/oq-tracker-branch <tracker = branch>`
Take a fork's branch by hand, e.g. `/oq-tracker-branch Relationship = Confesses`. The tracker must be waiting at that fork.

### `/oq-tracker-run <tracker> <pause | continue | abandon | reactivate | undo>`
In this chat only. **pause** keeps its step (not watched, not told, its lore hidden) · **continue** · **abandon** (back to the start, switched off) · **reactivate** (on again from the start) · **undo**.

### `/oq-tracker-remove <tracker>`
Remove a story tracker from this chat.

### `/oq-tracker-rewind [message number]`
Put every story tracker back to where it was at a message (default: the end of the chat).

### `/oq-reevaluate`
Re-evaluate and swipe: undo what the newest turn changed on the board, ask the helper and the judge again, then write a new swipe. The same as **Re-evaluate and swipe** on the [[DeepLore Bar]].

### `/oq-engine-check`
A developer check: compares the step trackers in the engine's list with the board's chat state. They should always agree.

## Characters, chats and runs

### `/oq-char-folders [run]`
Pick the folders this chat's character reads (base). With `run`: the folders this run adds.

### `/oq-char <on | off>`
DeepLore for this chat's character: off, or on (follows its folders; no folders means off).

### `/oq-chat <on | off | follow>`
DeepLore for this chat only: on, off, or follow (like its character).

### `/oq-char-status`
What this chat reads and whether DeepLore is on.

### `/oq-branch-run`
Start this chat as the next run, copying the run's session notes and lore up to this point. (Each reply's 📖 → **Branch here as a new run** does this from a message.)

## Setup

### `/oq-setup`
Run the guided setup wizard: connect the Obsidian vault, configure the lorebook tag, pick a search mode, and so on. AI search connections are configured separately in the settings panel (Connection → AI Connections; pick a Connection Profile). See [[Installation]].

---

## Quick reference

| Command | Description |
|---------|-------------|
| `/dle` | Command palette |
| `/oq-refresh` (`/oq-r`) | Rebuild vault index |
| `/oq-status` | Connection and index status |
| `/oq-why` (`/oq-context`) | Preview what would inject now |
| `/oq-inspect` (`/oq-i`) | Show last pipeline trace |
| `/oq-simulate` | Replay chat showing entry activation |
| `/oq-browse` (`/oq-b`) | Browse all indexed entries |
| `/oq-import [folder]` | Import ST World Info JSON |
| `/oq-graph` (`/oq-g`) | Visualize entry relationships |
| `/oq-analytics` | Entry usage statistics |
| `/oq-health` (`/oq-h`) | Run 30+ vault health checks |
| `/oq-lint` (`/oq-l`) | Parser warnings from last index build |
| `/oq-diagnostics` (`/oq-diag`) | Export diagnostic report |
| `/oq-debug [on\|off]` | Toggle debug logging |
| `/oq-logs [count]` | Recent DLE console entries |
| `/oq-cache-info` | Vault cache status and storage |
| `/oq-notebook` | Open Author's Notebook editor |
| `/oq-ai-notepad [clear]` | View or clear AI Notepad |
| `/oq-newlore` (`/oq-suggest`) | AI suggests new entries |
| `/oq-optimize-keys <name>` | AI suggests better keywords |
| `/oq-summarize` | Generate missing summaries |
| `/oq-summarize-range <range>` | AI-summarize a chat range, hide originals |
| `/oq-summarize-rollback [id\|all]` | Undo a summarize-range operation |
| `/oq-review [question]` | Send vault to AI for review |
| `/oq-scribe [focus]` | Write session note to Obsidian |
| `/oq-scribe-history` | Browse session notes |
| `/oq-pin <name>` | Pin entry for this chat |
| `/oq-unpin <name>` | Remove a pin |
| `/oq-block <name>` | Block entry for this chat |
| `/oq-unblock <name>` | Remove a block |
| `/oq-pins` | List pins and blocks |
| `/oq-set-field <name> [value]` | Set any gating field |
| `/oq-clear-field <name>` | Clear a gating field |
| `/oq-set-era [era]` (`/oq-era`) | Set active era |
| `/oq-set-location [location]` (`/oq-loc`) | Set active location |
| `/oq-set-scene [scene type]` | Set active scene type |
| `/oq-set-characters <names>` | Set present characters |
| `/oq-context-state` (`/oq-ctx`) | Show all gating fields |
| `/oq-clear-all-context` (`/oq-reset-context`) | Clear all gating filters |
| `/oq-set-folder [path...]` (`/oq-folder`) | Filter by Obsidian folder |
| `/oq-clear-folder` | Clear folder filter |
| `/oq-setup` | Run setup wizard |
| `/oq-clear` | Wipe the cache and index without re-fetching |
| `/oq-board [name]` | Open the board, or apply one to this chat |
| `/oq-board-saveas` | Save this chat's trackers as a new board |
| `/oq-board-character [name\|off]` | Default board for this character |
| `/oq-board-detach` | Stop using the board in this chat |
| `/oq-board-off [chat\|character\|on]` | Switch the board off or on |
| `/oq-tracker [name = steps]` | Make, edit or list trackers |
| `/oq-tracker-next` / `/oq-tracker-back` | Move a tracker a step |
| `/oq-tracker-go <tracker = step>` | Jump a tracker to a step |
| `/oq-tracker-aside <tracker = detour>` | Set or clear a detour |
| `/oq-tracker-branch <tracker = branch>` | Take a fork's branch |
| `/oq-tracker-run <tracker> <action>` | Pause, continue, abandon, reactivate, undo |
| `/oq-tracker-remove <tracker>` | Remove a tracker from this chat |
| `/oq-tracker-rewind [message]` | Put trackers back to a message |
| `/oq-reevaluate` | Re-evaluate and swipe |
| `/oq-char-folders [run]` | Pick the character's (or run's) folders |
| `/oq-char <on\|off>` | DeepLore for this character |
| `/oq-chat <on\|off\|follow>` | DeepLore for this chat |
| `/oq-char-status` | What this chat reads |
| `/oq-branch-run` | Start this chat as the next run |
