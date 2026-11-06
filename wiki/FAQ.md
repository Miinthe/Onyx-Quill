Short answers to the questions people ask most. For step-by-step fixes, see [[Troubleshooting]].

## General

### What is Onyx Quill?

A SillyTavern extension that keeps your lore in an Obsidian vault and sends the right entries with each reply, plus storyboards, a Cast of NPCs, a world layer and Mero ☆, a co-writer. It is built on DeepLore by pixelnull. The full picture: [[What is Onyx Quill]].

### Is it free?

Yes. Onyx Quill is free and open source under the MIT license. What can cost money are the AI calls some features make: they go through your own SillyTavern connections, so you pay whatever your provider charges, or nothing with a local model. Picking lore by keywords alone makes no AI calls at all.

### Can I use it without Obsidian?

No. Onyx Quill reads its lore from an Obsidian vault through Obsidian's **Local REST API** community plugin, and it needs one vault connected. Obsidian must be open while you play, on a computer your SillyTavern browser can reach. Setup: [[Installation]].

### What needs an AI and what doesn't?

Without any AI (no extra calls):

- Picking lore by keywords (**Settings › Lore selection › Mode › keywords only**, the default), with pins, blocks, folders, field filters, budgets and cooldowns.
- The board itself: trackers you move by hand, the board's own triggers and odds, links between entries and steps.
- 📖 **Why these entries**, [[My Notes]], the side panel's views, Browse, the graph, the health check and the other [[Diagnostics]].
- The slop guard's count of phrases the writer keeps reusing.

With an AI, each from its own row in **Settings › AI & connections**:

- **AI search**: picks the lore for each reply, when the mode includes AI search.
- **Story helper**: moves trackers by itself as the story goes; also the Cast's director.
- **Mero ☆**: talks, pitches, entry ideas, ✓ Fix spelling and ✎ Rewrite when you ask; her lore upkeep as often as **Settings › Mero › Her job › How much she does** says (**Off duty** stops it).
- **World**: chatter, news, messages and rumors in stories with the world layer on.
- **Scribe**: session notes every N messages, and **Write missing summaries**.
- **New lore**: notices lore worth writing, every N messages.
- **AI notepad**: notes from each reply, in extract mode.
- **Optimize keywords**: better keys for an entry, when you ask.

Each of these is off or idle until you give it a connection or switch it on. The **Runs** column in **Settings › AI & connections** says when each one runs with your settings. Cast members' own messages are written by SillyTavern's normal connection, like any reply; pictures for 📷 photos use SillyTavern's Image Generation.

### Which AI providers work?

Any provider you can save as a SillyTavern **Connection Profile** (API Connections, the plug icon › Connection Profile): cloud APIs and local backends alike. Each job picks its own profile, and **Fine print** lets you pick a different model on the same profile. Mero's lookups need a Chat Completion profile whose model can do tool calls; see [[Troubleshooting]].

### Which model should AI search use?

A fast, inexpensive one is usually enough. AI search doesn't write story text: it reads short descriptions of the candidate entries and the recent chat, and answers with a list. Give local models a longer **Time limit** (**Settings › AI & connections › Fine print**).

### Can I use it on a phone?

Yes, in the phone's browser; the bar and the side panel have a phone layout. Because the phone's browser talks to Obsidian itself, the vault's address must be one the phone can reach (your computer's home-network address, or a Tailscale `….ts.net` name), not `127.0.0.1`. Details: [[Troubleshooting]], "Using Onyx Quill on a phone or tablet".

### I used DeepLore before. What now?

Onyx Quill copies your DeepLore settings over on its first start and keeps your chats' data as it is. You can't run both at the same time: switch the original DeepLore off in **Extensions › Manage extensions**. Everything about moving over: [[Coming from DeepLore or World Info]].

### Can I keep using SillyTavern's World Info too?

You can, but both send lore into the same prompt, so you pay twice in tokens and may get the same facts twice. `/oq-import` turns World Info into vault notes; see [[Coming from DeepLore or World Info]].

## Writing entries

### How does a note become a lore entry?

Give it the lore tag (default `lorebook`) and some keywords in its frontmatter:

```yaml
---
tags:
  - lorebook
keys:
  - Gorduin
  - Gorduin Wynlar
  - Head Archivist
summary: "Select when the Oracles of Might's archive or its Head Archivist comes up."
---
```

The guide: [[Writing Vault Entries]]. Every field: [[Frontmatter Fields]].

### Always-send, seed and starter entries: what's the difference?

- **Always-send** (`lorebook-always`): goes out with every reply, whatever the chat says. For a few rules the story can never forget.
- **Seed** (`lorebook-seed`): sent quietly in the background while a chat is new.
- **Starter** (`lorebook-bootstrap`): sent openly while a chat is new, then behaves like a normal entry with keywords.

A chat counts as new for its first 3 messages (**Settings › Vault › Tags › A chat counts as new for**, behind More). The tag names can be changed in the same place.

### What are secrets for Mero ☆?

Notes tagged `lorebook-guide` are for [[Mero]] only: she reads them in her talks and pitches, and the writing model never gets them. Only notes inside the chat's folders count. They are not the same as the board's 🧭 guidance, which does go to the writer.

### Do I need summaries?

Only if AI search picks your lore. The `summary` field tells AI search *when* to pick an entry; it is not sent to the writer. With keywords only, summaries aren't used. **Write missing summaries** (side panel ⋯ › Tools) writes them for entries that have none.

### Can I organize entries in folders?

Yes, any way you like. Folders also decide what a chat reads: each character, run and chat can have its own folders, set in the side panel's **Filters** tab. A one-on-one chat whose character has no folders anywhere has Onyx Quill off. See [[Advanced Gating]].

## Checking what happened

### How do I see what was sent with a reply?

- 📖 on the message › **Why these entries**: what went out, why, and what didn't make it.
- The side panel's **Lore › Sent**: the entries sent with the last reply.
- `/oq-inspect`: every step of the last lore selection.

More on [[Diagnostics]].

### My entries aren't being sent. Where do I start?

Open 📖 › **Why these entries** on the reply, then run `/oq-health`. The most common causes: Onyx Quill is off in this chat (no folders yet), the note lacks the lore tag, the keywords aren't in the last messages it reads, or the budget is full. [[Troubleshooting]] goes through them in order.
