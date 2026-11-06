The bar is the row of buttons just above SillyTavern's message box. It holds Onyx Quill's menu, the buttons that open its panels, your Quick Replies, and a few helpers for your own messages: Re-evaluate, Guided swipe, Fix spelling, Simple send and Keep as a draft. Each message in the chat also gets an Onyx Quill button (📖) with its own small menu; it is described at the end of this page.

To hide the whole bar, switch off **Settings › Interface › The bar › Show the Onyx Quill bar**.

<!-- screenshot: the bar on a PC, with two starred Quick Replies and the action buttons after the divider -->

## The buttons (PC)

From left to right: first the buttons that open something, always in this order, then a divider and the action buttons.

- **📖 Onyx Quill menu**: **Open** (or **Close**) **the side panel**, **Lock the side panel open** (or **Unlock**), **Open the board**, **Write a new entry…**, **Move an entry…**, and **Setup and settings**.
- **Side-panel button**: opens the [[Side Panel]]; press it again to close it. It also carries Mero's signal (see below).
- **My notes**: your own notes, never sent to the AI. See [[My Notes]]. You can remove this button with **Settings › Interface › The bar › My notes**.
- **🌐 World**: only in chats where the board's world layer is on. Small dots show something new in the world. See [[World]].
- **⚡ All quick replies**: opens every Quick Reply of the sets SillyTavern has switched on here (global ones, this chat's and this character's) as an extra row on top of the bar. Tap one to run it. **📌** at the end of the row turns it into the chooser: which ones sit on the bar (☆ / ★) and in what order (‹ ›); **Done** goes back. If no set is switched on here, the row says so.
- **Your starred Quick Replies**: right after ⚡, one button each. A star belongs to its set, so it only shows in chats where that set is on. While you have starred ones, SillyTavern's own Quick Reply row steps aside (switch **Hide SillyTavern's Quick Reply row** off in **Settings › Interface › The bar** to keep both).

The side-panel, My notes and World buttons open Onyx Quill's panels. **Right-click** one while its panel is open to lock or unlock it (a closed panel ignores the right-click). If the panel is open but waiting behind another tab, a click brings it to the front. See [[Side Panel]] › Panel tabs.

After the divider, the action buttons:

- **Re-evaluate and swipe**: a new swipe with a fresh look at the newest turn: the board's changes are worked out again and AI search asks again (see below).
- **🧭 Guided swipe**: swipe the newest reply with a direction (see below).
- **✓ Fix spelling**: correct the typos in what you typed (see below).
- **Simple send**: post what you typed as your message, without asking for a reply.
- **Keep as a draft**: put what you typed aside. Press it again to put it back. A small dot on the button shows a draft is waiting. The draft follows you to other devices. If the box already holds other text, Onyx Quill asks before it swaps the two, so nothing you typed is lost.

While Onyx Quill is choosing lore for a reply, its working line shows in the bar too.

## On a phone

The bar has fewer buttons: 📖, the side-panel button, **Quick replies**, **My notes**, **🌐 World** (where it is on) and **⋯ More** (the action buttons). Quick replies and More take over the bar's row when you tap them; **‹** goes back. Pull the handle on top of that row up for more room. In the Quick Reply row, 📌 opens a window to choose which ones sit on the bar on a PC. While a swipe direction is set, More shows a dot.

## Switching buttons off

**Settings › Interface › The bar** has a switch for each action button: **Button: Re-evaluate and swipe**, **Button: Guided swipe**, **Button: Fix spelling**, **Button: Simple send** and **Button: Keep as a draft**. All are on at first. A button switched off is gone from the bar; on a phone, ⋯ goes away when all of them are off.

## Mero's signal

The side-panel button tells you when Mero ☆ has something for you:

- **Panel not locked:** a small orange dot appears on the button while Mero has requests, and the button wiggles now and then while a reply waits for your answer. Pressing the button then opens straight to her requests. A dot in the accent color (Mero pink, unless you picked another in **Settings › Interface › Look**) means Mero wants to talk about a big moment.
- **Panel locked open (PC):** the button becomes an envelope. It takes you to Mero's requests and, pressed again, back to where the panel was.

When a reply is waiting for you, a small banner above the bar says **⏸ Waiting for your answer**; tap it to open the requests. When Mero wants to talk, the banner says **☆ Mero wants to talk**; tap it to open her talks. See [[Mero]].

## Re-evaluate and swipe

A normal swipe keeps everything the board did for the reply. **Re-evaluate and swipe** is the other kind: a new swipe with a fresh look at the newest turn. It undoes what that turn changed on the board (tracker moves, branches, rolls, items, places, the clock), asks the story helper and AI search again as if your message had just been sent, then writes the new swipe. It runs at once, without asking first. Nothing is lost: in a chat with a board, each swipe keeps its own board, so flipping back to the earlier swipe brings its board back. It costs two AI calls (the helper and AI search) plus the new reply, and works on the newest reply only. The same is in the 📖 menu of the newest reply, and as `/oq-reevaluate`.

## 🧭 Guided swipe

Swipe the newest reply with a direction, like "less flowery" or "he's colder here". Press **🧭**, type what should change, and press **Swipe**. The direction goes to the writing model with the new swipe, for this reply only. It costs no extra AI call.

The button holds the direction: while one is in force, it is lit with a dot and its tooltip shows the direction. Press it again for:

- **Swipe again with it**
- **Change the direction…**
- **Keep it as a 🧭 note**: it becomes one of Mero's notes and stays until you switch it off. See [[Mero]].
- **Drop it**: new swipes are written as usual.

The direction stays for every swipe of that reply, and clears itself when you send your next message. Each swipe remembers the direction it was written with, which **Compare swipes** shows (see the 📖 menu below).

## ✓ Fix spelling

Corrects typos, capitals, punctuation and small grammar slips in what you typed, without changing your words, your style or the meaning. *Actions*, "speech", line breaks, `{{macros}}` and `[OOC: …]` stay exactly as they were. Nothing is sent: you still press Send.

- A notice above the message box lists what changed ("beleive → believe"), with **Undo**. Undo works while the message box still holds the corrected text.
- If the correction would change too much, or lose any of the parts above, your text stays as it was and the notice says why.
- It makes one small call with Mero's AI. If no AI is picked for Mero yet, it tells you to pick one in **Settings › AI & connections**.

**Your words:** right-click ✓ (on a phone, press and hold it) for your list of words that are never "fixed": made-up names, places, spells. A word typed a little wrong is fixed to your spelling (Ashvalle → Ashvale). The names and keywords of your lore entries, character names and your persona's name count too, without adding them. After a fix, **Keep mine…** in the notice puts your spelling back for a word and adds it to the list.

## Moving and writing entries

From the 📖 menu on the bar:

- **Write a new entry…** opens the board's entries window on its own. The new entry is filed where **Settings › Story & memory › New entries** says, and Mero can draft it.
- **Move an entry…**: pick the entry (newest first, or search), then its new folder. The entry is copied, checked, and only then removed from its old place.

## Floating icon drawer

Other extensions' floating icons (round buttons that hover over your chat) can wait in a small, low tab on top of the bar, at its left end. Tap the tab and they open as an extra row on top of the bar, the size of the bar's own buttons (hover for the name); **▼** at the end of the row closes it. Tap an icon to use it as usual; hold it (or right-click on a PC) for that extension's own options. A number on an icon shows on the tab too.

It is off at first. Turn it on in **Settings › Interface › The bar › Floating icon drawer** (**off**, **phone only**, **always**). **Icons in the drawer › Choose…** has a switch for each icon; switched off, an icon floats where it was before. If the bar is hidden, the icons stay where they are.

## The 📖 button on each message

Every message gets one Onyx Quill button (📖) next to SillyTavern's own message buttons. It opens a small menu:

- **Pitch from here**: ask [[Mero]] for story ideas starting at this message.
- **Ask Mero about this**: opens her with this message attached.
- **Why these entries**: which lore went out with this reply, and why. Grayed out when no lore was used. If the [[AI Notepad]] took notes from this reply, they show here too.
- **What this changed**: the board changes this reply made (opens **Story › What changed** in the side panel).
- **Branch here as a new run**: SillyTavern's own branch; the new chat then offers to become a new run.
- **Start a rumor from this…**: only where the board's world layer is on. See [[World]].
- **Guided swipe…**: only on the newest reply. The same as the bar's 🧭.
- **Compare swipes**: when a message has more than one swipe. They show side by side, each marked with the direction it was written with; **Use this one** picks it.
- **Re-evaluate and swipe**: only on the newest reply; a fresh look, as a new swipe.

<!-- screenshot: the 📖 menu open on the newest reply -->

See also: [[Side Panel]], [[Storyboards]], [[Mero]], [[Scribe and AI Helpers]].
