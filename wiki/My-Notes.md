# My Notes

My notes is a place for your own notes: OOC prompts, plot notes, names you made up, anything you want at hand. **They are never sent to the AI.** Open it with the **My notes** button on the [[DeepLore Bar]] (press it again to close).

On a PC it is one of DeepLore's panels: it fills the side of the chat like the side panel, and when it shares a side with the side panel or World they become tabs at the bottom (see [[Drawer|Side Panel]] › Panel tabs). Pick the side with ⋯ → **Move to the left** / **Move to the right**, by right-clicking its lock, or by dragging its tab (remembered). On a phone it covers the screen.

**The lock** (🔒 in the header, yellow when locked): unlocked, a click into the chat closes it (a click in the other DeepLore panels doesn't). Locked, it stays open whatever you do (other chats, a reload) until you close it with the notes button or ✕. The notes button on the bar opens it unlocked; right-click the button while it is open to lock or unlock it. Closing it clears the lock. SillyTavern's own panels (AI response configuration, characters …) open over the notes.

Don't want it? **Settings › Interface › The bar › My notes** switches the button off. Your notes stay saved and come back when you switch it on again.

---

## Where a note shows

Every note shows in one place:

| Shows in | Where you see it |
|---|---|
| **This chat** | only in this chat |
| **This story** | every chat on the same [[Storyboards|storyboard]], so all its runs share it (a renamed board keeps its notes) |
| **This character** | every chat with that character |
| **Everywhere** | every chat: your library, e.g. OOC prompts |

The window lists the notes for where you are first: this chat, this story, this character. Your library (**Everywhere**) is folded underneath; tap its count to open it. Pinned notes (★) show even while it is folded. Notes from other chats, stories and characters stay out of sight.

## Working with a note

- **+** makes a new note (it starts in **This chat**). A note left completely empty is not kept.
- Tap a card to open it. At the bottom, **Shows in** moves it to another place in one tap.
- The note shows formatted while you write. **B**, **I**, **H** and **•** make text bold, italic, a heading or a list. Behind the scenes it is kept with SillyTavern's own marks (`**bold**`, `*italic*`, `### heading`, `- list`), so a note put in your reply comes out formatted in the chat. Pasted text comes in plain. **★** pins it to the top.
- **Put in reply box** (the arrow on a card, or the button in the note) drops the note into the message box. If you already typed something, it goes at the end on its own line. On a phone the window closes so you see the box.
- **Copy** copies the text.
- **Delete** asks for a second tap; the notice that follows has **Undo**.
- **Search** looks through all your notes, also the hidden ones, and says where each one lives.

## ⋯ More

- **Bring over Notebook notes**: lists the pages of SillyTavern's Notebook extension. Tick the ones to copy and pick where each shows (Everywhere is preset); "This chat / story / character" means the chat open now, so for plot pages open a chat of that story first. The Notebook keeps its own copy. Bold, italic, headings and lists come along; colors and fonts do not.
- **Move to the left / right** (PC).
- **Sort**: newest first, or A to Z.

## Where they are kept

In one small file on the SillyTavern server, `deeplore-my-notes.json` in your user files (not in the settings), so they follow you to other devices. It is read fresh each time the window opens. If it cannot be read, the window says so and changes nothing.
