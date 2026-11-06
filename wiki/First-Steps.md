You have Onyx Quill connected and one entry going out ([[Quick Start]]). This page takes you from there to a small, useful vault: a few good entries, AI search and Mero ☆ connected, the right amount of lore per reply, and ways to check what was sent.

## Write a handful of entries

Start with three to five entries for the things your story leans on most: the main characters, the places scenes happen in, and one or two ideas the world runs on. A good entry has:

- the tag `lorebook`,
- **keys**: the names and words that call it up (a person's full name, first name, title; a place's name and what people call it),
- a **summary**: one or two sentences on what the entry is and *when it matters*. AI search reads the summaries, not the full text, to decide what fits.
- and the text itself, below the frontmatter. Keep it focused: the writer gets all of it each time the entry goes out.

Here is the top of a character entry from the Duskfrost demo vault, shortened:

```markdown
---
tags:
  - lorebook
keys:
  - Barlyn Greymantle
  - Barlyn
  - Greymantle
  - the mason
priority: 48
summary: "Cirilae master mason and district council representative for the Marblesmiths guild. Select when Cirilae community, construction, the Marblesmiths, or Amberburgh district politics come up."
---

# Barlyn Greymantle

Barlyn Greymantle has been laying stone in Duskfrost for sixty-three years...
```

**Priority** decides who wins when there is more lore than room: a lower number wins. Entries without one count as `100`. Use small numbers for the few entries that must not be dropped.

More examples are in [[Entry Templates]]; every field is in [[Frontmatter Fields]]; tips for writing them well are in [[Writing Vault Entries]].

## Tags that change when an entry is sent

Besides `lorebook`, a few tags change how an entry behaves. You can rename them all in **Settings › Vault › Tags**.

| Tag | What it does |
|---|---|
| `lorebook-always` (**Always-send tag**) | Sent with every reply. Keep these few: they use up the budget every time. |
| `lorebook-bootstrap` (**Starter tag**) | Sent while a chat is new (for its first 3 messages unless you change **A chat counts as new for**), then picked like any other entry. Good for the setup of a story. |
| `lorebook-never` (**Never-send tag**) | Onyx Quill skips the note entirely. It stays in your vault. |
| `lorebook-guide` (**Secrets-for-Mero tag**) | Secrets for Mero ☆ only: she reads them in her talks and pitches, the writing model never gets them. When the chat has folders, only notes in them (or at the top of the vault) count. See [[Mero]]. |

## Choose how lore is picked

**Settings › Lore selection › Mode › How lore is picked** has three choices:

| Choice | What happens | AI calls for picking lore |
|---|---|---|
| **keywords only** | Entries whose keywords show up in the latest messages are sent. | none |
| **keywords, then AI search** | Keywords find the candidates; AI search reads their summaries and picks what fits the scene. | one per reply |
| **AI search only** | AI search reads the summaries of the whole vault and picks. | one per reply, with a much longer prompt on a big vault |

Keywords only is a fine start while your vault is small. Once you have more entries and notice the right one staying out because nobody said its name, switch to **keywords, then AI search**. AI search is why summaries matter.

## Connect the AI helpers

Each AI job in Onyx Quill uses a SillyTavern **Connection Profile**. If you have none yet, make one in SillyTavern's **API Connections** (the plug icon) › **Connection Profile**.

Then open **Settings › AI & connections**. It has one row per job: **AI search**, **Story helper** (moves the board's trackers and directs the Cast), **Mero ☆**, **World**, **Scribe**, **New lore**, **AI notepad** and **Optimize keywords**. Pick a profile for each job you want to use. Some jobs can use **Same as AI search**. Under **Fine print** you can set a different model for a job, how long its answer may be, a time limit, and **Test** the connection.

A small, fast model is usually enough for AI search. Mero ☆ and the story helper do more thinking and benefit from a stronger one.

## How much lore goes out

Two places decide the amount:

- **Settings › Lore selection › Keywords › Messages to read**: how many recent messages are searched for keywords (default 4). More finds more, and also more that doesn't fit.
- **Settings › Budget & variety › Budget**: **Entries per reply** (default 10) and **Lore budget** in tokens per reply (default 3072), each with a "no limit" switch.

The budget can be set for everywhere, for one character, or for one chat: use the **Everywhere · character · This chat** choice at the top of the settings window.

**Settings › Budget & variety › Variety** keeps the same entries from going out every time: **Give others a turn** steps back an entry that was sent many times in a row, and **Rest after sending** makes an entry wait a few replies before it can go again.

## Check what was sent

- **📖 › Why these entries** on any reply: the entries that went with it, and why each one went in.
- The side panel's **Lore** tab: **Sent** (the last reply), **Left out** (considered but not sent, grouped by reason) and **All entries** (your whole vault, with search, pin and block).
- **Try matching** in the side panel's **⋯** menu (or `/oq-simulate`): replays the chat and shows which entries each message calls up.
- `/oq-health`: checks your vault and settings for problems, such as entries without keywords, entries that require a missing entry, oversized entries, and (with AI search on) entries without a summary.

See [[Diagnostics]] for the rest.

## Common early mistakes

| Mistake | What to do |
|---|---|
| Too many always-send entries | Keep them few. Give the rest keywords. |
| Keywords that are too common ("the", "door", "said") | Use names and specific words. |
| Only the full name as a key | Add what people actually say: first name, nickname, title. |
| No summaries | AI search can't pick well without them. Write one for every entry, or use **⋯ › Write missing summaries**. |
| Very long entries | Split them into smaller ones, so each goes out only when it is needed. |
| `probability: 50` | Probability is written as a fraction: `0.5` means half the time. A number above 1 counts as always. |

## Next

- [[Storyboards]] and [[Cast]]: plan the story and give NPCs their own voice.
- [[Mero]]: talk the story over with your co-writer.
- [[How Lore Gets Picked]]: the full picture of how entries are chosen.
- [[Troubleshooting]] if something doesn't behave.
