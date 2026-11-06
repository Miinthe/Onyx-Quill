This page is for two groups: people who used **DeepLore**, the extension Onyx Quill is built on, and people who keep their lore in SillyTavern's built-in **World Info**. DeepLore users mostly keep what they had; World Info users get a map of the concepts and an importer that turns a World Info book into vault notes.

## Coming from DeepLore

Onyx Quill started as a fork of [DeepLore by pixelnull](https://github.com/pixelnull/sillytavern-DeepLore) and keeps its core: lore in an Obsidian vault, keywords plus AI search, and the same entry format. Here is what changes when you switch.

### What carries over

- **Your settings, once.** At its first start, Onyx Quill copies DeepLore's settings (vaults, connections, tags, budgets, and the rest) to its own. It copies only what it doesn't have yet, so this happens once. DeepLore's own settings stay untouched, and from then on the two are separate: a change in one doesn't reach the other. Because your vault is already set up, the setup wizard doesn't open.
- **Your chats.** Data stored inside chats (pins and blocks, the chat's folders and field values, the notebook, the AI notepad, trackers) keeps working as it was.
- **Your vault.** Notes, frontmatter fields and tags work as before: `lorebook`, `lorebook-always`, `lorebook-seed`, `lorebook-bootstrap`, `lorebook-never`, `lorebook-guide`, and the field definitions file.

### What got better

- **The Session Scribe files its notes properly.** In DeepLore a session note had no keywords and no summary, and it was tagged only `lorebook-session`, so it wasn't even read as lore until you tagged it by hand. In Onyx Quill every note is written with your lore tag, keywords and a one-line summary, carries the chat's character and run letter, and goes into that run's folder. A later reply finds the session when the story comes back to it, and notes from one play-through don't mix with another's. See [[Scribe and AI Helpers]].
- **New entries land in the right folder.** Entry ideas from the chat and entries written on the board are filed by what they are about: into the run's folder, or into the character's own folder.
- **Starting over and branching are one step each.** **New run** starts the story fresh with the next run letter, the run's folders swapped and the old chat kept; **Branch here as a new run** turns a branch into its own run, with that run's notes and lore up to the branch copied over. In DeepLore that meant setting the instance letter, re-picking folders and starting a chat by hand. See [[Storyboards]].
- **Moving entries is safe.** **Move an entry…** in the bar's 📖 menu copies a note to its new folder, checks it, and only then removes the old one.
- **Your lore follows the story.** On a [[storyboard|Storyboards]], entries linked to a step are only in play while the story is there, so lore about later events stays out until the story gets there.

### What is different

- **Commands start with `/oq-`.** Every `/dle-…` command is now `/oq-…` (for example `/oq-refresh`, `/oq-health`, `/oq-import`), and the command palette is `/oq`. The old `/dle-` names no longer work, so update any Quick Replies or scripts that use them. See [[Slash Commands]].
- **Only one of the two at a time.** Onyx Quill and the original DeepLore both hook into every reply and share the data in your chats, so they can't run together. If DeepLore is switched on, Onyx Quill stays off and says so. Switch one of them off in **Extensions › Manage extensions**, then reload the page. DeepLore can stay installed while it is off.
- **No Librarian.** DeepLore's Librarian helper is gone. [[Mero]] ☆, the co-writer in the side panel, took over its work: she suggests new entries and changes to existing ones. The Librarian's old lore gaps are not shown any more.
- **Secrets for Mero ☆.** Notes tagged `lorebook-guide` are now **Secrets for Mero ☆**: only Mero reads them, in her talks and pitches, and when the chat has folders only those in them (or at the top of the vault). The writing model never gets them.
- **New names in files.** Hidden blocks are `%%oq-exclude%%` … `%%/oq-exclude%%` now (`%%deeplore-exclude%%` still works), new installs keep their files in an `Onyx Quill/` folder (yours stay where they are), and diagnostics files start with `onyx-quill-`. Your settings, notes, reply draft and saved AI search verdicts come over by themselves.
- **A new settings window.** Settings are grouped differently and many have new, plainer names. The search box at the top finds the old names too, and shows what a setting used to be called.
- **English only.** DeepLore's translations are not included.
- **Much more around the lore**: [[Storyboards]], the [[Cast]], [[World]], [[Mero]], [[My Notes]], [[The Bar]] and a new [[Side Panel]].

## Coming from World Info

World Info keeps a lorebook as a JSON file you edit inside SillyTavern. Onyx Quill keeps it as a folder of Markdown notes in an Obsidian vault, read through the Local REST API plugin ([[Installation]]). Each note is one entry: the settings go in the frontmatter at the top, the text below it.

### The same ideas, different names

| World Info | Onyx Quill | Notes |
|---|---|---|
| Entry | A note tagged `lorebook` | One note per entry. |
| Title / memo | The note's title | |
| Content | The note's text, below the frontmatter | Plain Markdown. |
| Primary keywords | `keys:` | A list, one keyword per line. |
| Secondary keywords and their logic | `refine_keys:` and `selective_logic:` | `selective_logic` takes `and_any` (the default), `and_all`, `not_any` or `not_all`. |
| Constant | the `lorebook-always` tag | Sent with every reply. |
| Order | `priority:` | **Reversed:** see below. |
| Position | `position:` (`before`, `after` or `in_chat`) | World Info's seven positions become three. |
| Depth | `depth:` | Used with `position: in_chat`. |
| Role | `role:` (`system`, `user` or `assistant`) | |
| Probability | `probability:` | **A fraction:** see below. |
| Scan depth | `scanDepth:` | Per entry. |
| Disabled | `enabled: false` | |
| Non-recursable | `excludeRecursion: true` | |
| Cooldown | `cooldown:` | |

Onyx Quill also has things World Info doesn't: a **summary** that tells AI search when an entry matters, AI search that can pick an entry even when its keyword wasn't typed, entries that need or exclude other entries, links that pull related entries in, and filters by era, location, scene type, who is present, or your own fields. See [[Frontmatter Fields]], [[Advanced Gating]] and [[Custom Fields]].

### Two things that work the other way round

**Priority is reversed.** In World Info, a higher Order number wins. In Onyx Quill, a **lower** `priority` wins. The importer keeps your numbers as they are, so after an import the order is upside down until you fix it, or switch on **Higher priority number wins** (**Settings › Lore selection › Keywords**, under the rarely used settings).

**Probability is a fraction.** World Info writes 50 for half the time; Onyx Quill writes `0.5`. The importer converts it for you. When you write it by hand, remember that a number above 1 counts as always.

### Importing a World Info book

Run `/oq-import`, or use the side panel's **⋯ › Import World Info**. (The [[Setup Wizard]] has a shorter version on its Import page.)

1. Choose where the entries come from: one of your SillyTavern lorebooks from the list, a JSON file (a World Info export or a character card with an embedded book), or JSON pasted into the box.
2. Confirm. The notes are written into your vault: at the top, or in a folder if you give one, as in `/oq-import Imported`.
3. A report shows what came over: the fields Onyx Quill uses, the fields it only keeps, and any entries that failed (with a way to try those again).
4. If AI search is on, Onyx Quill offers to write real summaries for the new entries (they arrive with the placeholder "Imported from SillyTavern World Info"). You review each summary before it is written.

Good to know:

- **Nothing is overwritten.** If a note of that name exists, the new one gets `_imported` (then `_imported_2`, and so on) added to its name.
- **Fields Onyx Quill doesn't use are kept** in the frontmatter, so you can see what the entry had, and `/oq-lint` lists them. Among them: sticky, delay and inclusion groups, per-entry case-sensitivity and whole-word settings, and the extra scan sources (persona, character description and so on). Remove those lines if you don't need them.
- **Regex keys** (`/pattern/`) are not supported. They come over as plain text.
- **Example-message entries** (World Info's positions before and after the example messages) have no place of their own in Onyx Quill. By default they become normal entries with an "Example Dialogue" heading; **Settings › Story & memory › Importing World Info › Example messages** can skip them instead, and the report has a button that does the same.
- **Shrink imported entries** in the same place shortens the text of imported entries to save tokens.

### Running both

Onyx Quill does not switch World Info off. If you keep your World Info books active, their entries are sent too, next to Onyx Quill's. Once your lore is imported, switch the old books off so nothing goes out twice.
