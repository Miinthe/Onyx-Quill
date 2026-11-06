Your lore lives as ordinary Markdown notes in your Obsidian vault. A note becomes an entry when it carries the `lorebook` tag; its keywords and summary decide when it is picked, and its text is what the writing AI reads. This page is the starting point for writing entries. The reference pages are linked at the end.

## The smallest entry

```markdown
---
tags:
  - lorebook
keys:
  - Drowned Anchor
  - harbor tavern
---

# The Drowned Anchor

A sailors' tavern on the Bayside Shushail waterfront. Cheap drinks, loud dice games, and more harbor gossip per square foot than anywhere else in Duskfrost.
```

The part between the two `---` lines is the frontmatter. When "Drowned Anchor" or "harbor tavern" comes up in the chat, this text goes to the writing AI. Everything else is optional.

## The title

An entry's title is its first `# ` heading. Without one, the file name is used. A `title:` line in the frontmatter is not read. Titles matter: `requires`, `excludes`, `cascade_links`, pins and AI search all name entries by title, and the title becomes the wrapper around the text in the prompt.

## What the two AIs see

Your entry is read by two different AIs, and they see different things.

**AI search** (when it is on, see [[How Lore Gets Picked]]) never sees the full text. It gets a short card:

```xml
<entry name="Dockmaster Bram Solvik">
Dockmaster Bram Solvik (412tok) → Bayside Shushail, Solarguard, Bonehands
[Location: Bayside Shushail]
Human dockmaster of the main cargo pier. Select when port operations, cargo inspection, smuggling at the docks, or Bayside Shushail trade come up.
</entry>
```

That is the title, the entry's size in tokens, the entries it links to with `[[wikilinks]]`, your field values, and the `summary`. Without a summary, AI search gets the start of the text instead (up to 600 characters).

**The writing AI** gets the cleaned text, wrapped in the entry format (by default `<Title>` … `</Title>`). Before it is sent:

- the frontmatter is removed (keys, summary, priority and so on never reach it),
- the first `# ` heading is removed (the title is already the wrapper),
- `[[Link]]` becomes `Link`, and `[[Link|shown text]]` becomes `shown text`,
- `<div>` tags are removed (the text inside stays),
- images (`![[picture.png]]`, `![alt](url)`) are removed,
- Obsidian comments and hidden blocks are removed (below).

So: the **summary** is for AI search, the **text** is for the writer. Write each for its reader.

## Hiding text from the AIs

Anything between `%%` markers is an Obsidian comment: hidden in Obsidian's reading view, and never sent. A comment over several lines is only left out when each `%%` starts its own line, as below.

```markdown
Bram keeps a locked log of every hold heavier than its manifest.

%%
Plot note: the log is what the Solarguard captain wants in chapter four.
%%
```

For bigger blocks, wrap them in `%%oq-exclude%%` … `%%/oq-exclude%%`. Both kinds are also left out of AI search's card.

## Good keywords

- Use the names people actually say: full name, short name, title, nickname (`Bram Solvik`, `Bram`, `Dockmaster Solvik`, `the dockmaster`).
- Keywords are not case sensitive and match inside longer words by default: `Bram` also matches "Brambles". Very short keys (two letters) match almost everything. **Whole words only** in **Settings › Lore selection** stops that.
- Don't use a name that is in every message as a key, like the name of the character you are talking to: the speaker's name is read too, so the entry would go in with every reply. Pin it, or use **Match the active character**, or field filters instead.
- Write keys as a list, one per line with `- `. A comma line like `keys: "a, b"` is split for you, with a warning in `/oq-lint`.

## Good summaries

The summary is AI search's only view of your entry. A good one says:

1. **What it is**, in one sentence.
2. **When to pick it**: the situations, topics and people that make it relevant.
3. **Important ties**, briefly.

Weak (describes, but gives no reason to pick it):

> Bram is barrel-chested and sea-weathered, with tar under his nails and a sailor's roll.

Strong:

> Human dockmaster of Bayside Shushail's main cargo pier; decides which ships berth and what the manifests say. Select when port operations, cargo inspection, smuggling at the docks, or the Solarguard–Bonehands balance on the waterfront come up.

Keep summaries under 600 characters; a summary is sent whole, however long (**Entry text it reads, at most** only caps the text used when there is no summary). Leave out looks and atmosphere; that belongs in the text. The side panel's **Lore** tab has **Write summaries**: select entries without one and the AI drafts them, and you check each before it is saved.

## Special kinds of entries

Add one of these tags next to `lorebook`:

| Tag | What it does |
|---|---|
| `lorebook-always` | Sent with every reply. Keep these few and short. |
| `lorebook-bootstrap` | Sent with every reply while the chat is new (3 messages), then an ordinary entry. |
| `lorebook-seed` | While the chat is new, given to AI search as background on the setting. |
| `lorebook-never` | Never used. The note is skipped. |
| `lorebook-guide` | A **secret for Mero ☆**: only Mero reads it, never the writing AI. It doesn't need the `lorebook` tag. |

Secrets for Mero ☆ are for things your co-writer should know (where you want the story to go, threads to keep in mind, what you like her to bring up), not for writing style; style belongs in your SillyTavern preset. Mero reads the notes in the chat's folders. See [[Mero]].

The tag names can be changed in **Settings › Vault › Tags**. More in [[Frontmatter Fields]].

## Tips

- **Start simple.** A tag, a few keys and good text is enough. Add fields when an entry fires too often, too rarely, or in the wrong scene.
- **Link related entries** with `[[wikilinks]]`. AI search sees the links, and with AI search on, linked entries become candidates too.
- **Use folders.** Each chat reads only its folders, so one folder per story or setting keeps stories apart. See [[How Lore Gets Picked]].
- **Check what was sent.** The 📖 button on a reply › **Why these entries** shows what went in and what nearly did.
- **Run `/oq-lint`** after editing frontmatter, and `/oq-health` now and then. See [[Diagnostics]].
- **Let Onyx Quill help.** **Optimize keywords** in the Lore tab suggests better keys; new entries can be suggested from the chat. See [[Scribe and AI Helpers]].

## Where to go next

- [[Entry Templates]]: complete, copy-ready notes for characters, places, lore, factions, events and the special kinds.
- [[Frontmatter Fields]]: every field and tag, with defaults.
- [[Advanced Gating]]: control when an entry fires (`requires`, `excludes`, `cooldown`, `refine_keys`, `cascade_links`, `outlet` and more).
- [[Custom Fields]]: your own filter fields, like `faction` or `time_of_day`.
- [[Coming from DeepLore or World Info]]: what an imported World Info book looks like in the vault.
