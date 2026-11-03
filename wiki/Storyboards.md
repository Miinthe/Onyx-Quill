# Storyboards

A storyboard is a plan for your story that DeepLore follows while you play. It holds **trackers**: where a relationship or plot stands, what has been found, where the scene is, what day it is, how much someone trusts you, and who your NPCs are. While you chat, a helper AI moves the trackers when the story says so, and the writer is told where things stand. Entries you link to a step or a place go in only when the story is there.

One board can be used by many chats. Each chat keeps its own place on it.

---

## Opening the board

- The bar's 📖 menu → **Open the board**.
- The side panel's ⋯ → **Open the board**.
- **Story** tab → **Timeline** (opens the board on its Timeline).
- The slash command `/oq-board`.

The board opens as a big window over SillyTavern. **Close** (top right) takes you back to the chat. It works on a phone too.

---

## The board window

**The menu bar** at the top:

- The board's name and three views: **Board** (the tiles), **Outline** (the same as a list) and **Timeline** (this chat's real history: moves, starts, places, items, days, with "Go to message").
- **File**: New…, Open…, Save, Save as…, Save as and apply to…, Save as template, Apply to…, Delete board….

**Starting a new board:** **File › New…** offers an empty board or one of four starter templates, each a small working example of what a board can do: **Slow-burn romance** (relationship steps with a fork at the confession, Trust and Attraction meters, one-way flags like First kiss), **Mystery** (an investigation, clues and suspects with states, places), **Fantasy quest** (a quest with a fork at the trial, a pack with gold that grows, a map, day · time · weather, a health meter) and **Slice of life** (dated events on a calendar, becoming family, a mood meter, places around town, shared memories that grow). Everything in them can be renamed, changed or removed. Your own templates from **Save as template** are listed under them.
- **Edit**: Undo, Redo, Rename board…, Duplicate, Move row up / down, Ask before removing, Delete…, Folders this board reads…, Suggest a setup from the folders…, Board settings…, Smart arrange.
- **View**: the three views and the window's color themes. **Appearance**: Everywhere… or This board….
- **Help**: Keyboard shortcuts, Show tips in the panels, Getting started, Tips, Keyboard & mouse, Slash commands, What's what.
- **Used in N** shows which chats and characters use this board.

**Draft, Save, Discard:** your edits are a draft until you press **Save**. Chats keep using the saved board until then.

**The tools row:** **Select**, **Add ▸**, **Remove**, **View ▸**, **Check ▸** (problems on the board, with a count), **Play ▸**, **Mero**, Undo / Redo, and the tile size (**Full**, **Compact**, **Mini**). There is a search box too (press `/`).

- **Add ▸** opens a second row: **+ Tracker…**, **+ Step**, **+ Entry**, **+ Connection**, **+ Fork**, **+ Detour**, **+ Note**.
- **Play ▸** → **Walk the board in story order**: a play-through in a sandbox. Your chats are untouched.
- **Mero** opens [[Mero]] on the board, to help you set it up. When she needs to know something (which tracker, how it should end) she asks with question cards: pick an answer or write your own, add details under **Anything to add?**, then **Send answers**.

Click a tile to see and edit it in the side area of the window.

---

## Adding a tracker

**+ Tracker…** opens **Add to the board**. First pick what to add, then fill in its details (name, icon, color, steps…).

| Group | Kinds |
|---|---|
| Story lines | **Tracker** (a line of steps: a relationship, a plot, an arc) · **Fork** (an interlude or an ending after a step) |
| Things you collect | **Clues** · **Suspects** · **Inventory** (items with amounts) · **Flags** (yes / no facts) · **Collection** (with your own states) |
| Numbers | **Counter** (a number: money, days) · **Meter** (trust, tension, told as a named band) |
| The world | **Places** (where the scene is) · **State** (time of day, days, weather, due dates) · **Cast** (NPCs with their own cards) |

A few notes on each:

- **Steps** move forward as the story goes, for example Strangers → Friends → Sweethearts. A step can have forks (decided by the story or by a 🎲 roll) and detours.
- **Collections** keep things with states (a clue goes from hidden to uncovered). An item can be made "there to be found" only in some places or moments.
- **Meters** shift a little at a time. You name bands (like "Trusting"), and the writer is told the band.
- **Places** follow where the scene is, and can pin the place's entry while you are there.
- **State** keeps time, weather and a calendar of dates.
- **Cast** holds your NPCs. See [[Cast]].

## Connections

Connections tie things together, for example "starts when Kettle is in the scene", "needs the key", or "the pantry makes the glue findable". You add them with **+ Connection** or from a tile's side area.

## Entries on the board

Link vault entries to a step, an item, a band or a place with **+ Entry**. Each link has a kind:

- 📄 **context**: facts for the writer.
- 🧭 **guidance**: how the character acts there.
- ⚖️ **judge**: only for the helper, to know what counts as reaching it.

---

## In the chat

- The side panel's **Story** tab shows your trackers and lets you move them by hand. See [[Drawer|Side Panel]].
- **Pause board** (Story tab) stops the whole board for this chat until you resume it.
- Each reply's 📖 → **What this changed** shows what the board changed, with Undo.
- **Re-evaluate and swipe** (on the bar or the newest reply) undoes the newest reply's board changes and asks again.

Slash commands for boards and trackers (`/oq-board`, `/oq-board-off`, `/oq-tracker`, `/oq-tracker-go` and more) are in [[Slash Commands]].
