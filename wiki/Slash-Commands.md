Onyx Quill adds 65 slash commands to SillyTavern, all starting with `/oq`. Type them in the message box like any SillyTavern command. Most of what they do also has a button somewhere (the side panel, the bar's 📖 menu, the board), so you rarely need them. SillyTavern's own `/help slash` lists them too, with the short help each one carries.

How to read this page: `<something>` is an argument you must give, `[something]` is one you may leave out. Aliases (shorter names for the same command) are shown next to the name.

## The palette

| Command | What it does |
|---|---|
| `/oq` | Opens the command palette: a searchable list of commands. Type to filter, use the arrow keys and Enter, or click one to run it. |

The palette lists every command except `/oq-engine-check` (a developer check). **Settings › Advanced › Slash commands** shows the same list; click one there to copy it.

## Your vault

| Command | What it does |
|---|---|
| `/oq-refresh` (alias `/oq-r`) | Reads every entry from Obsidian again. Use it after editing entries, instead of waiting for the next re-read. |
| `/oq-clear` | Empties the saved copy of your vault and stops, without reading it again. Run `/oq-refresh` afterwards. |
| `/oq-cache-info` | Shows the saved copy of your vault: size, age, entry count, and a button to clear it. |
| `/oq-browse` (alias `/oq-b`) | Opens the entry browser: every entry, with search and filters. |
| `/oq-graph` (alias `/oq-g`) | Shows your entries and the links between them as a graph you can drag and zoom. |
| `/oq-import [folder]` | Imports a SillyTavern World Info book into your vault. Pick a book, a JSON file, or paste JSON. Without a folder the entries go to the top of the vault; example: `/oq-import Imported`. |
| `/oq-lint` (alias `/oq-l`) | Shows the warnings and skipped notes from the last vault read. Use it when a notice mentions warnings or skips. |
| `/oq-health` (alias `/oq-h`) | Checks your entries and settings for problems: duplicates, broken links between entries, conflicting rules, budget warnings and more. |
| `/oq-status` | Shows the connection, entry counts and AI search's numbers for this session. |

## Why these entries

| Command | What it does |
|---|---|
| `/oq-why` (alias `/oq-context`) | Shows which entries would go with the next reply, and why, without writing one. With AI search on it makes a real AI call, so it asks first. |
| `/oq-inspect` (alias `/oq-i`) | Shows what happened on the last reply: which entries matched, why, and what AI search picked. The 📖 menu on a reply → **Why these entries** shows the same for any reply. |
| `/oq-simulate` | Replays the chat message by message and shows which entries come and go at each one (the side panel's **Try matching**). |
| `/oq-analytics` | Shows how often each entry was matched and sent. |

## Pins and blocks (this chat)

| Command | What it does |
|---|---|
| `/oq-pin <entry>` | Always sends this entry in this chat. |
| `/oq-unpin <entry>` | Removes the pin. |
| `/oq-block <entry>` | Never sends this entry in this chat, even if it matches. |
| `/oq-unblock <entry>` | Removes the block. |
| `/oq-pins` | Shows every pin and block in this chat. |

## Folders and filters

Which lore a chat reads. See [[Settings Reference]] (Filters, Per character, This chat) for the same in the settings window.

| Command | What it does |
|---|---|
| `/oq-char-folders [run]` | Picks the base folders of this chat's character. With `run`: the folders this chat's run adds. |
| `/oq-char <on\|off>` | Onyx Quill for this chat's character: off, or on (follows its folders; no folders means off). |
| `/oq-chat <on\|off\|follow>` | Onyx Quill for this chat only: on, off, or follow (like its character). |
| `/oq-char-status` | Says what this chat reads and whether Onyx Quill is on. |
| `/oq-set-folder [folders]` (alias `/oq-folder`) | Sets the folders this chat adds. Separate folders with spaces; put a path with spaces in quotes. Without folders it opens a picker. |
| `/oq-clear-folder` | Removes this chat's own folders. |
| `/oq-set-era [value]` (alias `/oq-era`) | Sets this chat's era. Without a value it shows the values your entries use. |
| `/oq-set-location [value]` (alias `/oq-loc`) | Sets this chat's location. Without a value it shows the choices. |
| `/oq-set-scene [value]` | Sets this chat's scene type. Without a value it shows the choices. |
| `/oq-set-characters [names]` | Sets who is present, as a comma list. Without names it shows the choices to switch on and off. |
| `/oq-set-field <field> [value]` | Sets any filter field, including your own. With only the field name it shows its values. |
| `/oq-clear-field <field>` | Clears one filter field. |
| `/oq-clear-all-context` (alias `/oq-reset-context`) | Clears all filter fields at once (era, location, scene, characters and your own). |
| `/oq-context-state` (alias `/oq-ctx`) | Shows this chat's value for every filter field. |

See [[Advanced Gating]] and [[Custom Fields]] for what the fields do.

## Board and trackers

These work on the open chat. The board window does all of this with buttons (see [[Storyboards]]). In examples, a tracker name like `Relationship` stands for one of yours.

| Command | What it does |
|---|---|
| `/oq-board [name]` | Without a name: opens the board window. With a name: uses that board in this chat. |
| `/oq-board-saveas [name]` | Saves this chat's trackers as a new board and uses it here (without a name it is called "Storyboard"). The old board stays as it was. |
| `/oq-board-character <name\|off>` | Sets the board new chats with this character start with. `off` clears it. |
| `/oq-board-detach` | Stops using the board in this chat. The chat keeps its own copy of the trackers. |
| `/oq-board-off [chat\|character\|on]` | Switches the board off for this chat (the default) or for its character: nothing of the board runs there. `on` switches it back on. |
| `/oq-tracker [Name = Step 1, Step 2, …]` | Makes or changes a step tracker, e.g. `/oq-tracker Relationship = Strangers, Neighbors, Friends`. Without anything after it, lists this chat's trackers. |
| `/oq-tracker-next [tracker]` | Moves a tracker one step on. The name can be left out when the chat has one tracker. |
| `/oq-tracker-back [tracker]` | Moves a tracker one step back. |
| `/oq-tracker-go <Name = Step>` | Jumps a tracker to a step, e.g. `/oq-tracker-go Relationship = Friends`. |
| `/oq-tracker-aside <Name = detour>` | Sets a detour beside the tracker's step, e.g. `/oq-tracker-aside Relationship = Rivals`. Nothing after `=` clears it. |
| `/oq-tracker-branch <Name = branch>` | Takes a fork's branch by hand. The tracker must be waiting at that fork. |
| `/oq-tracker-run <Name> <action>` | In this chat only: `pause` (keeps its step; not watched, not told to the writer, its lore hidden) · `continue` · `abandon` (back to the start, switched off) · `reactivate` (on again from the start) · `undo`. |
| `/oq-tracker-remove <tracker>` | Removes a tracker from this chat. |
| `/oq-tracker-rewind [message]` | Puts every tracker back to where it was at a message number. Without a number: the end of the chat. |
| `/oq-engine-check` | A developer check: compares two internal copies of the trackers' state and says whether they agree. You don't need it for writing. |

## Runs and swipes

| Command | What it does |
|---|---|
| `/oq-branch-run` | Starts this chat as the next run, copying the run's session notes and lore up to this point. The 📖 menu on a reply → **Branch here as a new run** does the same from any message. |
| `/oq-reevaluate` | Re-evaluate and swipe: writes a new swipe of the newest reply with a fresh look at that turn; the story helper and AI search are asked again. Each swipe keeps its own board, so flipping back to an earlier swipe brings its board back. |

## AI helpers

These use the connections set in **Settings › AI & connections**. See [[Scribe and AI Helpers]].

| Command | What it does |
|---|---|
| `/oq-newlore` | Reads the chat for people, places and ideas your vault has no entry for, and suggests new entries. |
| `/oq-suggest` | The same as `/oq-newlore`. |
| `/oq-optimize-keys <entry>` | Suggests better keywords for an entry. |
| `/oq-summarize` | Writes summaries (what AI search reads) for entries that have none. Asks first, and shows each summary for review before it is written. |
| `/oq-review [question]` | Mero ☆ reviews the entries this story reads (its folders and filter fields) in a new talk (nothing goes into the story chat). Example: `/oq-review What doesn't fit together?` |
| `/oq-scribe [focus]` | Writes a session summary note to Obsidian now. Example: `/oq-scribe What happened with the sword?` |
| `/oq-scribe-history` | Shows the session notes in the Scribe folder. |
| `/oq-summarize-range <range>` | Summarizes part of the chat with AI, hides those messages and puts the summary in front of them. Ranges: `5-15`, `10-` (from 10 to the end), `-8` (the last 8 messages), `7` (one message). |
| `/oq-summarize-rollback [id\|all]` | Undoes a `/oq-summarize-range`. Without an id, or with `all`, undoes every one in this chat. |

## Notebooks

| Command | What it does |
|---|---|
| `/oq-notebook` | Opens the Author's notebook for this chat. |
| `/oq-ai-notepad [clear]` | Shows the AI notepad for this chat. With `clear`: empties it. See [[AI Notepad]]. |

## Setup and troubleshooting

| Command | What it does |
|---|---|
| `/oq-setup` | Opens the setup wizard (see [[Setup Wizard]]). |
| `/oq-diagnostics` (alias `/oq-diag`) | Exports a diagnostics report (a Markdown file with names removed) to share when asking for help. The same as **Settings › Advanced › Export diagnostics**. |
| `/oq-debug [on\|off]` | Switches debug mode: more detail in the browser console. Without `on` or `off` it flips it. |
| `/oq-logs [count]` | Shows Onyx Quill's recent console messages (1–500, default 50). |

See [[Diagnostics]] and [[Troubleshooting]].

## Coming from DeepLore

DeepLore's commands started with `/dle-`, and its palette was `/dle`. In Onyx Quill they start with `/oq-`, and the palette is `/oq`. A few were renamed along the way; the tables above are today's names.
