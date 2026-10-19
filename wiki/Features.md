# Features

DeepLore is feature-dense. This page is a quick catalog with links to the detail pages where each feature is fully explained.

For the core matching pipeline, see [[Pipeline]]. For AI search specifics, see [[AI Search]].

---

## The side panel

DeepLore's side panel shows what DeepLore is doing, live. See [[Drawer|Side Panel]] for full details.

| Part | What it does |
|---------|-------------|
| **Ready** (header) | The status button: what DeepLore is doing now and how many entries your vault has. Click it for this reply's numbers (Lore budget, Entries, Context) and health checks |
| **Header buttons** | Refresh, Scribe, New lore ideas, New run, and the lock that keeps the panel open (PC only) |
| **Lore tab** | Sent · Left out · All entries: what went in with the last reply, what was left out and why, and your whole vault with search, filters, pin, block and Move to folder… |
| **Filters tab** | What this chat is (character, run, its folders), DeepLore on or off in this chat, and field values for this chat |
| **Story tab** | Your trackers with their steps, the board's other trackers, and "What changed" with Undo |
| **Cast tab** | This round's speaking order and the people of your Cast. See [[Cast]] |
| **Mero tab** | Your co-writer. See [[Mero]] |
| **⋯ menu** | Graph, Open the board, Pins and blocks, Try matching, Reroll lore, Review the vault with Mero, Write missing summaries, Optimize keywords, Import World Info, the notebooks, Setup wizard, Diagnostics, move the panel left or right, Settings |

---

## The DeepLore bar

A row of buttons above the message box: the 📖 DeepLore menu, the side-panel button, your starred Quick Replies, and Re-evaluate and swipe, Simple send and Keep as a draft. See [[DeepLore Bar]].

---

## My Notes

Your own notes, never sent to the AI, from a button on the bar. Each shows in this chat, this story (the storyboard), this character, or everywhere (your library of OOC prompts). See [[My Notes]].

## Storyboards

A board window where you lay out the shape of a story: step trackers (a relationship, a plot), collections (clues, suspects, inventory, flags), counters and meters, places, state and dates, and a Cast. A helper AI follows the story and moves them, and the writer is told where things stand. See [[Storyboards]].

---

## The Cast

NPCs set up on the board, each with their own character card. They come and go, have wants and plans, and can speak in their own messages. See [[Cast]].

---

## Mero ☆

Your co-writer, in the side panel's Mero tab. Talk with her about the story, ask for pitches and plans, and answer her requests (including lore gaps found while replies were written). See [[Mero]].

---

## Inspection and diagnostics

Tools for understanding what DLE is doing and why. See [[Inspection and Diagnostics]] for full details.

![Entry relationship graph with 209 nodes and 418 edges in a force-directed layout, showing link types and node coloring by entry type](images/dle-graph.png)

![Activation simulation timeline showing which entries activate and deactivate across 9 chat messages, with blue-highlighted entry names at each step](images/dle-simulate.png)

| Feature | What it does |
|---------|-------------|
| **Context Cartographer** | Each message's DeepLore ⋯ button → **Why these entries** shows which entries were sent and why |
| **Pipeline Inspector** | Detailed trace of the last generation (`/dle-inspect`) |
| **Entry Browser** | Searchable popup of all indexed entries (`/dle-browse`) |
| **Relationship graph** | Interactive force-directed graph of entry connections (`/dle-graph`) |
| **Activation Simulation** | Replay chat history showing entry activation timeline (`/dle-simulate`) |
| **"Why Not?" diagnostics** | In the Lore tab's **Left out** list, tap an entry to see why it was not sent |
| **Entry analytics** | Track match and injection counts per entry (`/dle-analytics`) |
| **Health check** | 30+ automated checks for common entry issues (`/dle-health`) |
| **Diagnostics export** | Pseudonymized bundle for bug reports (`/dle-diagnostics`); IPs, hostnames, API keys, profile names, vault names, and character names masked |

---

## AI tools

Features that use AI to help you build and maintain your vault. See [[AI-Powered Tools]] for full details.

![Session Scribe note in Obsidian showing a timestamped session summary with Key Events, Plot Developments, and Character Dynamics sections](images/dle-scribe-entry.png)

| Feature | What it does |
|---------|-------------|
| **Session Scribe** | Auto-summarize sessions and write notes back to your vault |
| **Auto Lorebook** | AI suggests new entries based on chat content (`/dle-newlore`) |
| **Optimize Keys** | AI analyzes an entry and suggests better keywords (`/dle-optimize-keys`) |
| **Auto-Summary** | Generate AI summaries for entries missing a `summary` field (`/dle-summarize`) |
| **Scribe-informed retrieval** | Feed Scribe summaries into AI search for broader story awareness |

---

## Lore tools during replies (search and flag)

While a reply is written, the writing AI can get two optional tools: `search` (look up entries DeepLore missed) and `flag` (note a gap in your lore). They are off by default; the Setup wizard's **Mero ☆** page has the switch **Let Mero look up lore during replies**. Flagged gaps land in [[Mero]]'s **Requests**, under **📚 Lore gaps**. Tool-calling provider required (Claude, Gemini, OpenAI-compatible, Cohere).

| Feature | What it does |
|---------|-------------|
| **Generation tools** | Writing AI calls `search` and `flag` mid-generation to look up vault entries and flag gaps |
| **Emma's toolset** | `search_vault`, `get_entry`, `get_full_content`, `find_similar`, `list_flags`, `get_links`, `get_backlinks`, `list_entries`, `get_recent_chat`, `flag_entry_update`, `compare_entry_to_chat`, and `get_writing_guide` |
| **Session continuity** | Emma's session (messages, draft state, work queue) persists in `chat_metadata` across reloads and chat switches |
| **Lore gap detection** | Writing AI flags missing or stale lore mid-generation; gaps land in Mero › Requests › 📚 Lore gaps. **Write it** opens Write a new entry… with the gap filled in (Mero can draft it there); **Open it** opens an entry that needs an update in Obsidian |
| **Done, Hide, No** | **Done** marks a gap as taken care of. **Hide** hides it until it is flagged again. **No** removes it for good, even if it is flagged again |
| **Vault audits** | `/dle-librarian audit` walks the entire vault and flags gaps, inconsistencies, and entries that need updates |
| **Writing guides** | Tag a vault entry with `lorebook-guide` to make it a Librarian-only style reference. Emma fetches these via `get_writing_guide`. They never reach the writing AI through any path |
| **Customizable persona** | Tweak Emma's personality and focus through an editable prompt |

> [!IMPORTANT]
> Turning on these lore tools auto-enables function calling on the active connection profile. If you disable function calling elsewhere, tool invocations break.

---

## AI Notepad

Per-chat AI-extracted session notes injected into context. The AI maintains running notes about important story details (decisions, relationship changes, revealed secrets) using `<dle-notes>` tags. Notes are stripped from visible chat, accumulated per-chat in `chat_metadata.deeplore_ai_notepad`, and reinjected into future messages as context.

| Feature | What it does |
|---------|-------------|
| **Tag extraction** | AI wraps notes in `<dle-notes>` tags; DLE extracts and stores them, then strips them from the visible message |
| **Per-chat storage** | Notes stored on `chat_metadata.deeplore_ai_notepad`; accumulate as the chat grows |
| **Configurable injection** | Position, depth, and role controls; same pattern as Author's Notebook |
| **Independent connection** | Separate connection channel for the extraction call |
| **`/dle-ai-notepad`** | View, edit, or clear accumulated notes |

---

## Entry matching and behavior

Per-entry frontmatter fields and global settings that control when entries trigger. See [[Entry Matching and Behavior]] for full details.

| Feature | What it does |
|---------|-------------|
| **Cooldown** | Skip an entry for N generations after it triggers |
| **Warmup** | Require N keyword occurrences before first trigger |
| **Re-injection cooldown** | Global setting to skip re-injecting recent entries |
| **Injection dedup** | Strip entries already injected in recent generations |
| **Entry decay and freshness** | Boost stale entries, penalize over-injected ones |
| **Conditional gating** | `requires` and `excludes` dependency rules |
| **Refine keys** | Secondary AND_ANY filter on top of primary keywords |
| **Cascade links** | Unconditionally pull in related entries when one matches |
| **Active character boost** | Auto-match the active character's entry |
| **Fuzzy search (BM25)** | TF-IDF scored fuzzy matching alongside exact keywords; inverted-index posting list |
| **Bootstrap and seed entries** | `lorebook-bootstrap` for chat-start force-injection; `lorebook-seed` for new-chat story context |
| **Probability** | 0.0-1.0 trigger chance for matched entries |

---

## Injection and context control

How and where entries are injected, plus per-chat overrides. See [[Injection and Context Control]] for full details.

| Feature | What it does |
|---------|-------------|
| **Per-entry injection position** | Override position, depth, and role per entry |
| **Prompt Manager integration** | Register DLE injections as draggable Prompt Manager entries (`injectionMode: prompt_list`) |
| **Author's Notebook** | Persistent per-chat user scratchpad injected every generation (`/dle-notebook`) |
| **Per-chat pin and block** | Pin entries to always inject or block them, per chat |
| **Contextual gating** | Filter entries by era, location, scene type, characters present, and user-defined custom fields (configurable via the rule builder) |
| **Confidence-gated budget** | AI over-requests, then prioritizes high-confidence picks |
| **Folder filter** | Per-chat folder restriction; only entries in allowed folders are considered |

---

## Infrastructure

Under-the-hood systems that make DLE fast and reliable. See [[Infrastructure]] for full details.

| Feature | What it does |
|---------|-------------|
| **Multi-vault support** | Connect multiple Obsidian vaults simultaneously; entries deduped by content hash across vaults |
| **IndexedDB persistent cache** | Instant startup from browser-side cache |
| **Reuse sync** | Skip re-parsing unchanged entries on refresh |
| **Circuit breaker** | Exponential backoff on Obsidian connection failures; AI search circuit trips after 2 consecutive failures (30s cooldown) |
| **Sliding window AI cache** | Reuse AI search results when recent chat changes don't mention any vault entity, so identical lookups skip the provider call entirely |
| **Hierarchical manifest clustering** | Two-call AI approach for vaults with 40+ entries |
| **HTTPS support** | Obsidian connections support HTTPS for remote or secured setups, with auto-diagnosis of cert/auth/unreachable failure modes |
| **Flight recorder** | Ring buffer captures recent extension activity (pipeline runs, tool calls, errors) for export |

---

## Setup and import

Getting started and migrating from other lorebook systems. See [[Setup and Import]] for full details.

| Feature | What it does |
|---------|-------------|
| **Setup wizard** | Guided first-time setup (`/dle-setup`) |
| **Header and ⋯ menu** | One-click actions in the side panel's header and its ⋯ menu |
| **ST lorebook import** | Convert SillyTavern World Info JSON into Obsidian vault notes (`/dle-import`); offers AI summary generation for imported entries |
