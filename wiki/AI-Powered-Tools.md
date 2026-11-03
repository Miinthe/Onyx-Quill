# AI-Powered Tools

Features that use AI to help you build, maintain, and grow your vault. These run alongside [[AI Search]] (which selects entries during generation); the tools on this page actively create or improve vault content.

Your co-writer [[Mero]] ☆ has her own page. She also took over what the removed Librarian left behind: saved lore gaps show up as her requests, and she suggests entry ideas. This page covers the other AI helpers.

> [!NOTE]
> Each tool below has its own independent connection channel, set in **Settings › AI & connections** (one row per job: Judge, Story helper, Mero ☆, Scribe, New lore, AI notepad, Optimize keywords). You can route the Scribe to one model and AI Search to another. Most default to inheriting from AI Search. Each channel is a SillyTavern **Connection Profile** (or "Inherit"); the legacy Custom Proxy mode was removed in v2.5 — see [[AI Search#connection]] for the migration note.

---

## Session Scribe

Auto-summarizes your roleplay into timestamped markdown notes written back to your Obsidian vault. The next summary feeds the prior summary back as context, so notes build on each other instead of repeating.

**Flow:**

1. After every N new messages (default 5), Scribe fires from the `CHARACTER_MESSAGE_RENDERED` handler
2. It summarizes the recent message window using the configured prompt
3. The summary is written as a markdown file with frontmatter (`tags: lorebook-session`, `date`, `character`) to the configured Session Folder (default `Sessions`)
4. The vault re-indexes so the new note is searchable

**On-demand:** `/oq-scribe` writes a summary immediately. Optional focus topic: `/oq-scribe What happened during the trial?`

**Browse past summaries:** `/oq-scribe-history` opens a popup of the current chat's notes.

**Connection options:**
- **Inherit** (default): resolves to AI Search settings
- **SillyTavern Connection**: reuse your main chat's active connection
- **Connection Profile**: any saved Connection Manager profile. Use this to route summaries through a different (often cheaper) model.

**Setup:**
1. In **Settings › Story & memory › Scribe**, set **Session notes** to every N messages (0 = off)
2. Set the **Folder**
4. Pick a connection mode
5. Optionally customize the summary prompt and message window depth (`scribeScanDepth`, default 20)

**Defaults to know:** message window 20 messages, response token limit 1024, timeout 60s.

![Session Scribe output in Obsidian showing the vault folder structure on the left and a timestamped session note with Properties metadata, Key Events and Plot Developments bullet points, and a Character Dynamics section](images/dle-scribe-entry.png)

---

## Auto Lorebook

Scans recent chat for characters, places, items, and concepts that lack a vault entry, then proposes new entries you can review and accept.

**Flow:**

1. Every N messages (default 10), or on-demand via `/oq-newlore`, the AI scans recent chat
2. It compares against existing entries and identifies gaps (case-insensitive title match)
3. Suggestions appear in a popup with title, type, keywords, summary, and content
4. Accept to write the entry to Obsidian, or reject to skip

**Connection options:** Inherit (default), SillyTavern Connection, or Connection Profile.

**Setup:**
1. In **Settings › Story & memory › New entries**, set **Notice lore worth writing** to every N messages (0 = off)
2. Choose **Where they go**: by what they're about (the run's folder or the character's base folder), or always the **Target folder**
3. Pick a connection for the **New lore** job in Settings › AI & connections

`/oq-newlore` triggers on-demand without enabling automatic suggestions. Accepted entries are written with proper frontmatter (type, priority, tags, keys, summary).

---

## Optimize Keys

`/oq-optimize-keys <entry name>` asks an AI to analyze an entry and suggest better keywords. The AI considers the entry's content, summary, and current keys to recommend additions and refinements: synonyms, related terms, trigger phrases.

**When to use:** an entry isn't triggering as expected, or you want a second opinion on key choices after writing the entry.

**Modes** (`optimizeKeysMode`):
- `keyword`: pure keyword optimization without AI
- `two-stage`: AI analyzes content and suggests keys

**Connection:** independent (Inherit / Connection Profile). Defaults to Inherit (resolves to AI Search settings).

Suggestions appear in a popup for review. Apply changes in Obsidian, then run `/oq-refresh` to pick them up.

---

## Auto-Summary Generation

`/oq-summarize` scans every indexed entry, finds those without a `summary` frontmatter field, and generates summaries one at a time. Each suggestion is shown in a review popup where you can edit, approve, or skip before it is written to the entry's frontmatter in Obsidian.

**When to use:** after importing entries from World Info, or when you have a backlog of entries without summaries. The `summary` field is what AI Search reads to decide whether an entry is relevant, so filling missing summaries directly improves selection quality.

---

## Scribe-Informed Retrieval

When enabled, the Session Scribe's latest summary is fed into the AI Search context as additional story background. This widens what AI Search "knows" about the ongoing narrative beyond the scan-depth window, so it can pick entries relevant to long-running plot arcs.

**Setup:** turn on **Give it the session notes** in **Settings › Lore selection › The judge** (behind More).

**Requires:**
- Session Scribe enabled
- At least one summary written for the current chat

Most useful for long conversations where important plot points have scrolled past the AI Scan Depth window.

---

## Related pages

- [[AI Search]]: the second-stage AI selection during generation
- [[AI Notepad]]: AI-managed session notes (separate from Auto Lorebook and from Scribe)
- [[Pipeline]]: where each AI tool fits into the generation flow
- [[Settings Reference]]: every setting documented
- [[Slash Commands]]: every `/oq-*` command
