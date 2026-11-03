# Side Panel

The side panel is DeepLore's home in SillyTavern. It shows what lore went out with the last reply, what this chat reads, where your story stands, your Cast, and Mero ☆, your co-writer.

**Where to find it:** press the side-panel button on the [[DeepLore Bar]] (above the message box), or open SillyTavern's DeepLore drawer icon. Press the same bar button again to close it. The bar's 📖 menu also has **Open the side panel**.

---

## The header

Along the top of the panel:

- **Ready** (with a colored dot and your entry count): tap it for this reply's numbers and health. The dot is green when all is well, amber or red when a health check found something, and it shows "busy" while DeepLore works.
- **Refresh**: read your vault again.
- **Scribe**: write session notes now.
- **New lore**: the AI suggests entries from the chat.
- **New run**: a fresh chat as the next run, with the same folders.
- **Lock** (PC only): keeps the panel open, even under SillyTavern's own panels, until you unlock it. A locked panel comes back open after a reload. Yellow when locked. **Right-click** it to move the panel to the other side. Phones have no lock.
- **✕**: closes the panel (a locked one unlocks as it closes).

The header and the tab row run across the whole width of the panel. The tab row stays under the header while a tab scrolls, and the scroll bar sits on the panel's outer edge (left on the left, right on the right).

### Ready: numbers and health

Tapping **Ready** opens a small window with two parts:

- **This reply**: Lore budget, Entries and Context as small meters, the mode, and any active filters.
- **Health**: Vault, Connection, Lore selection, Cache and AI service, each with a dot. Click a row to run its check. **Reset the AI pause** shows only while the AI is paused. **Recent activity** folds open, and the session numbers sit at the bottom.

---

## The tabs

The tabs are **Lore · Filters · Story · Cast · Mero**, then **⋯**.

### Lore

Three lists, switched at the top: **Sent**, **Left out** and **All entries**.

- **Sent**: the entries that went out with the last reply. A line at the top counts them (matched, picked, sent), with a button to copy the titles. Each row shows a small "how sure" mark; tap a row to see why it went in, and get **Pin**, **Block**, **Move to folder…** and **Open in Obsidian**. **Timers** folds open at the bottom (cooldowns and other waiting entries).
- **Left out**: entries that did not go in, grouped by reason (for example "Blocked by you", "Not this chat's folders", "Over budget", "Resting", "Needs another entry"). Tap one for **Let it in next time** or **Find in All entries**.
- **All entries**: search your whole vault. Press **?** for search tricks like `tag:`, `folder:`, `key:`, `summary:` and `field:`. Filter chips narrow the list (this chat's folders or any folder, status, tags, your own fields, sort, since last reply). **Group by folder** shows folders, and **Select** lets you pick several entries for one action: **Pin**, **Block**, **Move to folder…**, **Optimize keywords** or **Write summaries**.
- **New**: shows when your vault has an inbox folder. It lists the new entries waiting there, each with a **Move…** button. Press it again to go back.
- **⧉** pops the current list out into a big window.

### Filters

A card for what this chat is: the character (and run), the folders it reads, how many entries sit outside them, and **DeepLore in this chat** (on, off, or follow the character). Below it, the **Fields** fold lets you set a field (like era or location) for this chat only. **Show** lists the unused fields too.

**Change folders and fields…** holds the rest: **Filters in settings…**, **Run folders…**, **This chat's own folders…**, **Edit the filter fields…**, **Clear all field values** and **All field values in a window**.

### Story

Your story trackers for this chat, from the [[Storyboards|storyboard]].

- The top line has **Pause board** (nothing of the board runs in this chat until you **Resume board**) and **Timeline** (opens the board on its Timeline). Its **⋯** chooses how trackers move: **By themselves when the story says so** or **Only by hand**, and has **Open the board**.
- Each step tracker is a card with ◀ ▶ to move it a step, and a note line (for example a quote from the reply that moved it, with **Undo**). Tap a card for its steps (tap a step to jump there) and **Pause**, **Edit steps**, **Abandon** and more.
- **On the board** folds open to show time, places and collections, including new finds the story wants to keep (**Keep it** / **Not worth keeping**).
- **What changed** folds open to list what the helper, the director and the board changed, newest first, each with Undo. **Clear list** empties it.

### Cast

Your NPCs, when the board has a 🎭 Cast. See [[Cast]].

### Mero

Mero ☆, your co-writer, lives here. A dot on the tab means she has something for you (amber while a reply waits for your answer). See [[Mero]].

### ⋯ (more)

The last tab button holds the tools:

- **See**: Graph, Open the board, Pins and blocks.
- **Tools**: Try matching, Reroll lore (on the next reply), Review the vault with Mero, Write missing summaries, Optimize keywords, Import World Info.
- **Notebooks**: Author's notebook, AI notepad, Scribe history.
- **DeepLore**: Setup wizard, Diagnostics (opens Ready), Move the side panel to the left / right (remembered), and **Settings**.

---

## Panel tabs (PC)

The side panel, [[My Notes]] and World (where the board's world layer is on) are DeepLore's three panels. Each one sits on the left or the right of the chat, and you choose which (remembered per panel). They share one look: the same width as the side panel, the same header across the top.

- **Panels on the same side become tabs** in a row at the bottom of that side. One shows; the others wait behind it. Click a tab to show it, **✕** on a tab to close that panel. A small yellow lock on a tab shows which ones are locked.
- **A panel alone on its side** has no tab row.
- **Move a panel to the other side:** drag its tab across (the other side lights up), right-click its tab → **Move to the left / right**, or right-click the lock in its header (the way for a panel that's alone).
- **Right-click a tab** for **Lock open / Unlock**, **Move**, **Close**, and for the whole row **Lock all**, **Unlock all** and **Close all**.
- **Locks:** a locked panel stays open. An unlocked one closes when you click into the chat — but not when you click in one of the other DeepLore panels. Left-click a panel's button on the [[DeepLore Bar]] to open it (unlocked); right-click the button of an open panel to lock or unlock it. Closing a panel clears its lock.
- **A panel waiting behind another tab:** its bar button brings it to the front instead of closing it.

Phones keep one panel at a time over the chat, without tabs.

---

## Good to know

- **Left or right:** right-click the header's lock, or ⋯ → **Move the side panel to the left** (or right). It is remembered, and Mero's rail follows to the outer edge.
- **Keyboard** (when the panel has focus and you are not typing): `r` refresh, `s` scribe, `n` new lore, `g` graph.
- **Every reply** has a DeepLore button (📖) next to SillyTavern's own message buttons, with **Why these entries**, **What this changed** and more. See [[DeepLore Bar]].
