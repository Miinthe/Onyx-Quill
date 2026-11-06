Onyx Quill helps you play long stories with an AI without the story losing its shape. You lay out the story on a **storyboard**, and Onyx Quill follows it while you play: it notices when the story moves on, tells the writing model where things stand, and brings in the lore that belongs to that point. Around the board it adds a Cast of NPCs, a living world around `{{user}}`, and Mero ☆, a co-writer. Your lore lives as notes in an Obsidian vault. This page explains the idea and how the parts fit together.

## The problem it solves

The writing model only sees what is in the prompt: the character card, the system prompt and the latest messages. It does not know where your story is going, what has already happened, or how your world works. In a long story that shows: it rushes past the slow parts, forgets a promise made fifty messages ago, lets a relationship jump three steps at once, or invents facts about your world.

Onyx Quill gives the model what it is missing, at the right moment: where the story stands on your plan, what matters right now, and the parts of your world the scene needs.

## The storyboard at the center

A storyboard is the plan of your story. It holds **trackers**, each following one thread:

- **Steps**: a relationship or a plot moving from one stage to the next, with forks (the story can go one way or another) and detours (a side path that comes back).
- **Collections and flags**: clues found, items owned, secrets known.
- **Places**: where the scene is.
- **State and dates**: the time of day, the day, the weather, or any list of values you make, plus a calendar of dates (a festival in two days).
- **Meters**: how much someone trusts, fears or likes `{{user}}`, in bands you name.
- **Cast**: the people of the story (see [[Cast]]).

Each step, place or item can have notes from your vault linked to it: 📄 **context** (facts that are in play while the story is there; 📌 pinned ones always go in), 🧭 **guidance** (how the characters act at that point, sent to the writer as instructions) and ⚖️ **judge** (the rule the story helper uses to decide that the story really got there; it never reaches the writer).

You can start a board from a template (slow-burn romance, mystery, fantasy quest, slice of life) or build your own. One board can serve many chats, and each chat keeps its own place on it. See [[Storyboards]].

## What happens on each reply

1. **You send a message.**
2. **The story helper reads it.** A helper AI looks at the newest messages and reports what changed on the board: a step reached, a clue found, a day passing. Every change must quote the chat word for word and follow the board's rules, and each one shows a notice with **Undo**. Without a connection for the helper, trackers move only when you move them.
3. **The lore is picked.** The board decides what is in play: entries linked to a step only while the story is there, 📌 pinned ones always, the entry of the place the scene is at, and 🧭 guidance as instructions. From there, entries come in by their **keywords**, and if you switch it on, **AI search** (an AI that reads short summaries of your entries) also picks the ones that fit the scene even when nobody named them.
4. **The writing model gets the picture.** One short block on where the story stands, the lore for this moment, and the notes you or Mero ☆ keep for the writer. Then it writes the reply.

You can always see what happened: each message's 📖 menu has **Why these entries**, the side panel's **Lore** tab lists what was **Sent** and what was **Left out**, and the board's **Timeline** shows every move with its message. See [[How Lore Gets Picked]].

## What else is in it

**For the story**

- [[Cast]]: NPCs with their own character cards who speak in their own messages inside a one-on-one chat, in a round order, with ties between people. A director keeps their plans and what they know up to date.
- [[World]]: set up per board. People text `{{user}}` and each other, post and gossip in a feed, rumors spread, the local news reports what happened, and people send photos: described in words, or drawn by your image generator if you have one. What happens there flows back into the story.
- [[Mero]]: Mero ☆, a co-writer in the side panel. She knows your board and your lore, talks with you out of character, writes notes for the writer and keeps your entries up to date (she asks first unless you tell her otherwise). **💡 Pitches** are ideas for what could happen next, one twist or a 🪜 plan of several beats, from her or written by you. **Requests** collect everything waiting for your answer: the board's helper asking about a move, a stalled plan, Mero's lore ideas. **🎲 Games** (Wordle, Four in a Row) are there for a break.
- **New runs and branches**: start a story over as a new run in one step (the next letter, the run's folders swapped, the trackers back at the start, the old chat kept), or branch from any message into a new run that takes the old run's notes and lore up to that point, as copies. See [[Storyboards]].
- [[My Notes]]: your own notes, never sent to the AI.

**Around the chat**

- [[The Bar]]: buttons above the message box for the board and the panels, your quick replies (all in one row, favorites starred on the bar), a drawer for other extensions' floating icons, **✓ Fix spelling**, **🧭 Guided swipe** and **Re-evaluate**.
- [[Side Panel]]: the Lore, Filters, Story, Cast and Mero tabs.
- [[AI Notepad]] and [[Scribe and AI Helpers]]: notes the AI keeps, session notes written back to your vault, new-entry ideas, summaries and better keywords.

**Made to fit how you play**

- What you don't use stays out of your way: the World has no button, panel or AI calls until you switch it on, each action button on the bar can be switched off, and the floating icon drawer only appears if you want it.
- Make it yours: Onyx Quill's own accent color, panels on the side you like (as tabs when they share a side), locks to keep them open, and **Keep as a draft** on the bar for a message you want to finish later.
- On a phone, the bar keeps the essentials and folds the rest into **⋯ More**, panels slide over the chat, the World tab has a phone layout, and the board window works on a phone too. Setting up a board is easier on a PC; playing works well on both.

**For your lore**

- Your lore is a folder of Markdown notes in your Obsidian vault, read through Obsidian's **Local REST API** plugin. You write and organize them in Obsidian, with links, folders and search.
- Lore grows as you play. The **Session Scribe** (kept from DeepLore, with new filing) writes notes of what happened into your vault, every few messages or when you press it. Each note now gets keywords and a one-line summary so it can be found again, carries the chat's character and run (one play-through, marked by a letter), and goes into that run's folder. New entry ideas from the chat are filed the same way: the run's folder or the character's own folder, by what they are about. See [[Scribe and AI Helpers]].
- **Move an entry…** on the bar's 📖 menu moves a note to another folder without risk: copied, checked, then removed from its old place.
- Fine control per entry: priority, cooldowns, entries that need or exclude others, links that pull related entries in, and filters by era, location, scene, who is present, or your own fields. See [[Frontmatter Fields]], [[Advanced Gating]] and [[Custom Fields]].
- Checks and tools: a health check of the vault, a relationship graph, **Try matching** (replays the chat and shows which entries each message calls up), and a World Info importer.

## AI calls and cost

Every AI job has its own row in **Settings › AI & connections**: AI search, the story helper, Mero ☆, World, Scribe, New lore, AI notepad and Optimize keywords. Each one uses a SillyTavern **Connection Profile**, so you can run a cheap or local model for one job and a stronger one for another. The **Runs** column there tells you when each job runs.

- The **story helper** is one call per reply while a chat has a board.
- **AI search** is off at first (lore comes in by keywords and the board, which costs nothing). Switched on, it is one call per reply.
- **Mero ☆** answers when you talk to her or press one of her buttons; at her default job she also checks your lore by herself every few replies (see [[Mero]]).
- **World** runs only on boards where you switched it on, as often as its settings say (see [[World]]).

## Who it is for

Onyx Quill fits writers who play long stories and want them to keep their shape: a slow burn that really takes its time, a mystery whose clues stay consistent, a world with more than a handful of people and places. It works best if you like planning a little ahead and keeping your lore in Obsidian.

## Next

- [[Installation]] and [[Quick Start]] to get it running.
- [[Storyboards]] to start your first board.
- [[First Steps]] to build a small vault and tune it.
- [[Coming from DeepLore or World Info]] if you are moving over.

Onyx Quill is built on [DeepLore](https://github.com/pixelnull/sillytavern-DeepLore) by pixelnull.
