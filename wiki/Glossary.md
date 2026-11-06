The words Onyx Quill uses, in plain terms, grouped by where you meet them. Labels in **bold** are what the screen says. For every setting see [[Settings Reference]]; for every command see [[Slash Commands]].

## Your lore

**Vault**: a folder of notes in Obsidian. Onyx Quill reads it through Obsidian's Local REST API plugin. You can connect more than one vault. Use a vault for your story, not your private notes: what Onyx Quill sends goes to your AI provider. See [[Installation]].

**Entry**: a vault note that carries the lore tag (`lorebook` by default). Notes without it are ignored. An entry has frontmatter at the top (keywords, priority, summary and so on) and its text below. See [[Writing Vault Entries]] and [[Frontmatter Fields]].

**Keywords** (`keys`): words that make an entry come up when the chat mentions them.

**Summary**: a short description of an entry for AI search. AI search reads summaries to decide what fits. `/oq-summarize` writes missing ones.

**Priority**: a number on an entry. When the budget is tight, a lower number wins (unless **Higher priority number wins** is on).

**Always-send entry**: an entry with the `lorebook-always` tag. It goes with every reply. It costs budget every time, so use it sparingly.

**Never-send entry**: an entry with the `lorebook-never` tag. It is never sent.

**Starter entry**: an entry with the `lorebook-bootstrap` tag. It is sent while a chat is new (the first 3 messages by default), then picked like any other entry.

**Seed entry**: an entry with the `lorebook-seed` tag. While a chat is new, AI search reads it as background to the story when it picks lore. It only matters with AI search on.

**Secrets for Mero ☆**: vault notes with the `lorebook-guide` tag. They are not lore: only Mero ☆ reads them, in her talks and pitches, and only those in the chat's folders. The writing AI never gets them. Not to be confused with the board's 🧭 guidance, which does go to the writer. See [[Mero]].

**Folders**: which parts of the vault a chat reads. A character has **base folders**; each run can add its own; a chat can add more (**This chat adds**). A chat reads all of these together. A character chat with no folders anywhere reads nothing, so Onyx Quill stays off there. Set them in **Settings › Filters**, the side panel's Filters tab, or with `/oq-char-folders` and `/oq-set-folder`.

**Filter fields**: values a chat can have, such as era, location, scene type and who is present, plus fields of your own. An entry that names a value for a field only goes to chats that match. See [[Advanced Gating]] and [[Custom Fields]].

**Pin** / **Block**: per-chat choices for one entry. A pinned entry is always sent in this chat; a blocked one never is. Side panel ⋯ → **Pins and blocks**, or `/oq-pin` and `/oq-block`.

**Index**: Onyx Quill's saved copy of your vault, so it doesn't read Obsidian on every reply. **Re-read** (or `/oq-refresh`) reads the vault again.

**New lore**: the helper that notices people, places and things the chat mentions but your vault has no entry for, and suggests entries (**Notice lore worth writing**, or `/oq-newlore`).

## How lore gets picked

**AI search**: the AI that picks which entries fit the reply. It is optional. See [[How Lore Gets Picked]].

**Keywords only**: no AI search. Entries come up by their keywords (and filters, pins and budget). Free.

**Two-stage** (**keywords, then AI search**): keywords make a short list, then AI search picks from it.

**AI search only**: AI search reads every entry's summary each time. Costs the most tokens.

**Budget**: how much lore goes with one reply: a number of tokens (**Lore budget**) and of entries (**Entries per reply**). A character or a chat can have its own budget; the most specific wins (this chat, then its character, then Everywhere).

**Give others a turn**: an entry sent many times in a row steps back, one skipped a long time gets a boost. **Rest after sending** makes an entry wait some replies before it can come again.

**Why these entries**: in the 📖 menu on each reply. It shows which entries went with that reply and why. An entry sent again shows as "Same as last turn".

**Try matching**: replays the chat and shows which entries each message calls up (side panel ⋯, or `/oq-simulate`).

**Prompt list**: a way of placing Onyx Quill's parts: instead of Onyx Quill's own position settings, you drag each part into place in SillyTavern's prompt list (**Settings › Where it goes**).

**Story block**: what the writer is told about the board, the trackers and the Cast, as one part of the prompt (**Story trackers block**).

## Storyboards

See [[Storyboards]].

**Board** (storyboard): where your story's structure lives: trackers, linked entries, the Cast and the World. A board is shared by the chats that use it; each chat has its own place on it. A character can have a default board for new chats.

**Tracker**: one thing on the board that follows the story. The story helper moves it when the chat plainly shows a change, with a word-for-word quote, and each change comes with an Undo. The kinds are steps, meters, collections (with inventory and flags), places, state and counters.

**Step**: one point on a **Steps** tracker, such as "Strangers → Friends → Partners". A steps tracker stands on one step at a time.

**Fork**: a choice after a step: the story can go one of several ways (branches). In the middle of a tracker it is an interlude, after the last step an ending. The story decides, or a roll does. A tracker waits at a fork until a branch is taken (`/oq-tracker-branch` takes one by hand).

**Detour**: a side state beside a step, outside the line of steps: the tracker stays on its step while the detour lasts. The story helper starts and ends it, or you set it by hand (`/oq-tracker-aside`).

**Line**: a rule between parts of the board: needs, starts, blocks, only one, triggers. Some lines can have odds (🎲).

**Collection**: a set of things with states, such as clues (hidden → uncovered → lost) or suspects. **Inventory** is a collection with amounts, and it can have a purse (money). Things still in their first state are not part of the story yet, so the writer doesn't hear of them.

**Flags**: a collection of yes / no facts.

**Place**: a **Places** tracker knows the story's places (some inside others, some nearby) and where the scene is now. The writer is told where the scene is and which known places are not here, so it doesn't invent surroundings.

**State**: a tracker for time and conditions: a cycle (time of day, weekdays, seasons), the day number, choices (weather, mood) and a calendar of due dates the writer is told not to skip past.

**Meter**: a value that shifts a little at a time (trust, tension). The story helper reports a slight, clear or big change; the board turns that into points. The writer is told the band ("Trusting, rising"), never the number.

**Counter**: a plain number, such as money or days.

**Board entries**: entries linked to a step, a detour, a branch, a meter band, an item, a place or a person. Each link has a kind:

- 📄 **context**: facts for the writer. Ordinary lore, there while the story is at that point; pinned ones are always sent there.
- 🧭 **guidance**: behavior for the writer ("they are married now: act like it"), sent as guidance in the story block while the story is there.
- ⚖️ **judge**: only the story helper reads it, as the rule for what counts as reaching that point. It never reaches the writer.

**Swipe boards**: each swipe of the newest reply keeps its own board. Flipping back to a swipe brings back its board and its changes.

## Cast

See [[Cast]].

**Cast**: the people (NPCs) of your story, on the board. Each has their own character card and entries, and speaks in their own messages inside a one-on-one chat. Only people in the scene are updated and told to the writer, so a big Cast costs no more than a small one.

**In the scene**: whether a Cast person is here now. The story helper reports someone coming or leaving, with a quote; you can set it by hand.

**Knows**: what a Cast person has learned, and how. Knowledge is earned: only someone in the scene learns something, and only with a quote.

**Wants** and **plans**: a person's long goal, and up to three intentions the director keeps up to date. The writer gets the plans of people in the scene, never their wants or private thoughts.

**Director**: the part of the story helper that, before each reply, updates the inner life of the Cast people in the scene: their thoughts, plans and what they know.

**Ties**: how a Cast person feels about someone (another Cast person, the main character or `{{user}}`), in a few words, with a trend (warming, cooling). The director suggests them for you to ✓ or ✕, or writes them, or leaves them; a tie you set yourself stays.

**Round**: one turn of the conversation with the Cast. **▶ Go** plays one round: `{{user}}`'s half first (your message and the NPC lines you write, in your order), then the AI's half (the NPCs the AI writes and the main character, in their order).

## World

See [[World]].

**World**: the world layer around your story, set up on the board's World tab. It runs on the **World** connection.

**Messages**: text messages between `{{user}}`, the main character and the Cast, outside the main chat. Group chats are possible. Pictures (📷 photos) use SillyTavern's Image Generation extension.

**Feed**: the world's posts. **Chatter** is people posting and commenting; **News** is articles from the story's news account.

**Voices** and **regulars**: who else posts besides the Cast. A voice is an account of the story (a newspaper, a shop); a regular is a recurring commenter with a personality.

**Rumor**: a post in Chatter from the story's rumor account, so nobody's name is on it. A rumor can be true, twisted or made up. It spreads by word of mouth and can change as it is retold.

**Planned messages**: messages the board holds ready, sent once when their condition is met (a story day, a step, a place, someone in the scene).

## Mero ☆

See [[Mero]].

**Mero ☆**: your co-writer in the side panel's Mero tab. She talks with you out of character about the story, pitches ideas, keeps notes for the writer, looks after your lore, can look things up and search the web, and plays games with you. She reads only what this story reads. She is not the writer of the story replies.

**Talk**: a conversation with Mero. Talks belong to the character, so every chat and run of that character sees them. What is said in a talk stays there; only notes you keep reach the story.

**Pitch** (💡): a story idea from Mero, made when you ask, always from your story. You can send it with the next reply, keep it, have Mero draft your next line from it, give it to a Cast person as a plan, or hide it until its moment comes.

**Plan** (🪜): a pitch in several steps (beats) toward a goal. The writer works toward the current beat gently, over several replies; the story helper ticks a beat off only with a quote, and never before its "not before N replies" floor.

**Beat**: one step of a plan.

**Notes for the writer**: notes you keep from a talk that go to the writer: 🚫 don't, 🧭 steer, 📄 fact, 💡 idea. Each lasts ⚡ for the next reply only, 📌 for N replies, or 📍 until you remove it, and applies to this chat, this run, the character or the board.

**Requests**: questions waiting for your answer in Mero's tab, grouped by who asks: 🤖 the story helper (a move it isn't sure about, an item it found), 🪜 a plan, ☆ Mero (for example an entry change she suggests). Answered ones stay listed.

**Her job**: Mero's lore upkeep: how often she checks your entries against the story (Off duty, Freelancer, Part-timer, Full-timer). With **Needs my sign-off** on, nothing is written without your yes.

**The glow**: Mero's 💬 lights up after a big moment on the board, an invitation to talk about it. It costs nothing until you click it.

## Around the chat

**The bar**: Onyx Quill's row above the message box: the 📖 menu, the side panel button, starred Quick Replies and buttons such as **Re-evaluate and swipe**, **Guided swipe**, **Fix spelling**, **Simple send** and **Keep as a draft**. See [[The Bar]].

**Side panel**: Onyx Quill's panel beside the chat, with the tabs **Lore**, **Filters**, **Story**, **Cast** and **Mero**, and a ⋯ menu with tools. It can sit left or right, and be locked open on a computer. See [[Side Panel]].

**📖 menu on a reply**: Onyx Quill's menu on each reply: **Why these entries**, **What this changed**, **Pitch from here**, **Ask Mero about this**, **Branch here as a new run**, **Guided swipe…**, **Re-evaluate and swipe** and more.

**Re-evaluate and swipe**: a new swipe of the newest reply with a fresh look at that turn: the story helper and AI search are asked again.

**Guided swipe**: a new swipe of the newest reply with a direction you give.

**My notes**: your own notes, behind a button on the bar. They are never sent to the AI. See [[My Notes]].

**Author's notebook**: your own notes for one chat that are sent to the writer with every reply.

**AI notepad**: the writer's own notes. It writes them in a hidden `<oq-notes>` block (or a helper pulls them out of each reply), and they go back to it with later replies. See [[AI Notepad]].

**Scribe**: the helper that writes session notes, summaries of the chat, into your vault (the `Sessions` folder by default). See [[Scribe and AI Helpers]].

## AI jobs and runs

**Job**: one AI task, each with its own connection in **Settings › AI & connections**: AI search, the story helper, Mero ☆, the World, Scribe, New lore, the AI notepad and Optimize keywords.

**Story helper**: the AI job that moves the trackers and acts as the Cast's director.

**Connection profile**: a saved SillyTavern connection (provider, model, key) that a job uses. Some jobs can use **Same as AI search** or SillyTavern's own connection instead.

**The AI pause**: after repeated AI errors, Onyx Quill pauses its AI calls for a short while. **Settings › Advanced › The AI pause** clears it.

**Run**: one play-through with a character, marked by a letter (run A, run B…). A new chat gets the character's next free letter. A run can add its own folders, and Mero's notes can apply to one run. **Branch here as a new run** (or `/oq-branch-run`) starts the next run from a point in the chat. The letter is kept in the chat's `instance` field, so older notes may say "instance" for a run.

**Cleaning up a run**: when you delete a run's last chat, Onyx Quill offers to move that run's files in your vault to a trash folder (or delete them). It always asks first.

## Coming from DeepLore

Onyx Quill is built on DeepLore by pixelnull. Some things have new names:

- DeepLore's commands `/dle-…` are `/oq-…`, and the palette is `/oq`.
- Auto Lorebook is **New lore**; Session Scribe is **Scribe**; the Context Cartographer is **Why these entries**; the drawer is the **side panel**.
- `%%deeplore-exclude%%` is `%%oq-exclude%%`, and the writer's notes tag `<dle-notes>` is `<oq-notes>`; the old ones still work.
- Constants are **always-send** entries; bootstrap entries are **starter** entries; guide entries are **Secrets for Mero ☆**.

See [[Coming from DeepLore or World Info]].
