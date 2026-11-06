The side panel is Onyx Quill's home next to the chat. It shows which lore went out with the last reply, which folders and fields this chat reads, where your story trackers stand, your Cast, and Mero ☆, your co-writer. Open it with the side-panel button on [[The Bar]], or with the open-book icon in SillyTavern's top bar. Press the same bar button again to close it.

<!-- screenshot: the side panel open on the right, header with Ready, the five tabs, the Lore tab on Sent -->

## The header

Along the top of the panel:

- **Ready** (with a colored dot and your entry count): tap it for this reply's numbers and health (see below). The dot is green when all is well, amber or red when a health check found something, and it shows when Onyx Quill is busy. While it works, "Ready" changes to what it is doing.
- **Refresh**: read your vault again.
- **Scribe**: write session notes now (see [[Scribe and AI Helpers]]).
- **New lore**: the AI suggests new entries from the chat (see [[Scribe and AI Helpers]]).
- **New run**: start a fresh chat as the next run of this story, with the same folders.
- **Lock** (PC only): keeps the panel open until you unlock it, even while SillyTavern's own panels open over it. A locked panel comes back open after a page reload. It is lit while locked. **Right-click** it for **Lock open / Unlock** and **Move to the left / right**. Phones have no lock.
- **✕**: closes the panel. A locked panel unlocks as it closes.

The header and the tab row stay at the top while a tab scrolls.

### Ready: numbers and health

Tapping **Ready** opens a small window with two parts:

- **This reply**: **Lore budget**, **Entries** and **Context** as small meters, the mode, and any active filters.
- **Health**: **Vault**, **Connection**, **Lore selection**, **Cache** and **AI service**, each with a dot. Click a row to run its check. **Reset the AI pause** shows only while the AI is paused after repeated errors. **Recent activity** folds open, and this session's numbers sit at the bottom.

See [[Diagnostics]] for what each check means.

<!-- screenshot: the Ready pop-up with the three meters and the five health rows -->

## The tabs

The tabs are **Lore · Filters · Story · Cast · Mero**, then **⋯** for the tools.

### Lore

Three lists, switched at the top: **Sent**, **Left out** and **All entries**.

- **Sent**: the entries that went out with the last reply. A line at the top counts them (matched, picked, sent), with a button to copy the titles. Each row shows a small "how sure" mark and its token cost. Tap a row to see why it went in, with **Pin**, **Block**, **Move to folder…** and **Open in Obsidian**. **Timers** folds open at the bottom: entries resting on a cooldown, and entries that have not gone in for a while.
- **Left out**: entries that did not go in, grouped by reason, for example "Blocked by you", "Not this chat's folders", "The AI passed", "Resting", "Needs another entry" or "Over budget". Tap one to see why, with **Let it in next time** (pins it for this chat) and **Find in All entries**.
- **All entries**: search your whole vault. Press **?** for search tricks like `tag:`, `folder:`, `key:`, `summary:` and `field:`, mixed with plain words. Filter chips narrow the list: this chat's folders or any folder, your own fields, status, tags, sort and **Since last reply**. On a phone the chips fold behind **Filters**. **Group by folder** shows the list under its folders, and **Select** lets you pick several entries for one action: **Pin**, **Block**, **Move to folder…**, **Optimize keywords** or **Write summaries**.
- **New**: shows when your vault has an inbox folder. It lists the new entries waiting there, each with a **Move…** button. Press **New** again to go back.
- **⧉** pops the current list out into a big window.

**Pin** and **Block** work for this chat only: a pinned entry goes in with every reply, a blocked one never does. Both show a notice with **Undo**. Press `/` while the panel has focus to jump to the search.

### Filters

A card for what this chat is: the character (and run letter), the folders it reads, how many entries sit outside them, and **Onyx Quill in this chat** (follow the character, always on, or off). Below it, the **Fields** fold lets you set a field (like era or location) for this chat only. **Show** lists the unused fields too.

**Change folders and fields…** holds the rest: **Filters in settings…** (every character and run), the character's base folders, the run's folders, **This chat's own folders…**, the on/off switch for the character, **Clear all field values**, **Edit the filter fields…** and **All field values in a window**. See [[Advanced Gating]] and [[Custom Fields]].

### Story

Your story trackers for this chat, from the [[board|Storyboards]].

- The top line has **Pause board** (nothing of the board runs in this chat until you **Resume board**) and **Timeline** (opens the board on its Timeline). Its **⋯** chooses how trackers move, **By themselves when the story says so** or **Only by hand**, and has **Open the board**.
- Each step tracker is a card with ◀ ▶ to move it a step, and a note line (for example a quote from the reply that moved it, with **Undo**). Tap a card for its steps (tap a step to jump there) and **Pause**, **Edit steps**, **Abandon** and **⋯** for the rest (detours, how it moves by itself, open it on the board, remove it).
- **On the board** folds open to show time, places and collections, including new finds the story wants to keep (**Keep it** / **Not worth keeping**).
- **What changed** folds open to list what the helper, the director and the board changed, newest first, each with **Undo**. **Clear list** empties the list (the changes themselves stay).

### Cast

Your NPCs, when the board has a 🎭 Cast: the speaking order for the next round (drag to reorder, **Go**, **Stop after this one**, **Reset**), then who is here and who is away. Tap a person for their details. See [[Cast]].

### Mero

Mero ☆, your co-writer, lives here. A dot on the tab means she has something for you; it turns amber while a reply waits for your answer. See [[Mero]].

### ⋯ (more)

The last button in the tab row holds the tools:

- **See**: **Graph**, **Open the board**, **Pins and blocks**.
- **Tools**: **Try matching**, **Reroll lore** (on the next reply), **Review the vault with Mero**, **Write missing summaries**, **Optimize keywords**, **Import World Info**.
- **Notebooks**: **Author's notebook**, **AI notepad** (see [[AI Notepad]]), **Scribe history**.
- **Onyx Quill**: **Setup wizard**, **Diagnostics** (opens Ready), **Move the side panel to the left / right** (remembered), and **Settings**.

## Panel tabs (PC)

The side panel, [[My Notes]] and [[World]] (where the board's world layer is on) are Onyx Quill's three panels. Each one sits on the left or the right of the chat, and you choose which; each remembers its own side. They share one look: the same width as the side panel, the same kind of header.

- **Panels on the same side become tabs** in a row at the bottom of that side. One shows; the others wait behind it. Click a tab to show it, **✕** on a tab to close that panel. A small lock on a tab shows which ones are locked.
- **A panel alone on its side** has no tab row.
- **Move a panel to the other side:** drag its tab across (the other side lights up), right-click its tab and choose **Move to the left / right**, or right-click the lock in its header (the way for a panel that is alone on its side).
- **Right-click a tab** for **Lock open / Unlock**, **Move to the left / right** and **Close**, and for the whole row **Lock all**, **Unlock all** and **Close all**.
- **Locks:** a locked panel stays open. An unlocked one closes when you click into the chat, but not when you click in another Onyx Quill panel, the bar, or one of its menus. Left-click a panel's button on [[The Bar]] to open it (unlocked); right-click the button of an open panel to lock or unlock it. Closing a panel clears its lock.
- **A panel waiting behind another tab:** its bar button brings it to the front instead of closing it.

On a phone, and in a very narrow window, there are no panel tabs: one panel at a time slides over the chat.

<!-- screenshot: the right side with the side panel and My notes as two tabs at the bottom, one locked -->

## Good to know

- **Left or right:** right-click the header's lock, or **⋯ › Move the side panel to the left** (or right). It is remembered, and Mero's rail follows to the outer edge.
- **Keyboard** (when the panel has focus and you are not typing): `r` refresh, `s` scribe, `n` new lore, `g` graph, `/` search all entries.
- **Every message** has an Onyx Quill button (📖) next to SillyTavern's own message buttons, with **Why these entries**, **What this changed** and more. See [[The Bar]].
