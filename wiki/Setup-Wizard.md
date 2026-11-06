The setup wizard takes you from a fresh install to a working connection in one window. It has eight pages: **Welcome**, **Connection**, **Tags**, **Matching**, **AI**, **Vault**, **Import** and **Done**. Your settings are saved when you press **Finish** on the last page. A few things take effect earlier: the two folder paths on the Vault page, and whatever **Create Helpers** or **Import** writes into your vault.

## Opening it

- It opens **by itself** the first time Onyx Quill loads with no vault set up (after SillyTavern's own welcome, if that shows).
- Run `/oq-setup`, or use the side panel's **⋯ › Setup wizard**. Both pick up on the page where you left off.
- **Settings › Advanced › Reference › Setup wizard › Run** starts it from the first page.
- While there are no entries yet, the side panel's **Lore** tab shows a **Setup wizard** button (and **Import World Info**).

When you run it again later, it fills in your current settings, so going through it again changes only what you change.

**Finish later** (at the bottom of every page) closes the wizard without saving and remembers the page you were on. It then won't open by itself again; reopen it with `/oq-setup`. Closing the window any other way works the same.

<!-- screenshot: the wizard with its row of eight steps -->

## 1. Welcome

What Onyx Quill does, in short, and three ways to start:

- **Try the demo vault** (easiest start): jumps to the Connection page with the demo vault's steps open and its connection filled in.
- **Connect my Obsidian**: jumps to the Connection page for your own vault.
- **Import a lorebook**: jumps to the Import page with **From SillyTavern Lorebook** chosen.

Or press **Next** to go through every page.

## 2. Connection

Connects to Obsidian through the Local REST API plugin (see [[Installation]] for setting up the plugin).

| Field | Default | What it is |
|---|---|---|
| **Vault Name** | `Primary` | A name for this vault in Onyx Quill. |
| **Host** | `127.0.0.1` | Where Obsidian runs. `127.0.0.1` is this computer. |
| **Port** | `27123` | The plugin's port. |
| **API Key** | empty | The key from the plugin's settings. |
| **Use HTTPS** | off | Switches to the plugin's HTTPS server (port `27124`). HTTP is recommended: HTTPS only works after you install the plugin's certificate in your operating system. |

Press **Test Connection**. **Next** stays locked until the test passes ("Test connection to continue"). If the test fails, a line under the buttons says what went wrong (for example that the API key was refused), and when Obsidian can't be reached or the HTTPS certificate isn't trusted, a help window explains what to check.

**Scan for vaults** looks for a running Local REST API on the host and fills in what it finds. You still press **Test Connection** afterwards.

**New to Onyx Quill? Try the demo vault.** This box at the bottom explains the Duskfrost demo vault. **Show me how** lists the steps and shows the path of the `test-vault` folder with a copy button; **Auto-fill connection for demo vault** fills in the fields, so you only paste the demo vault's API key and test. The steps are in [[Quick Start]].

The path the wizard shows starts with `public/scripts/extensions/third-party/`. That is where the folder is when Onyx Quill was installed for all users. Installed for one user, it is in `data/<user>/extensions/Onyx-Quill/test-vault` instead.

## 3. Tags

Which notes become entries, and how they are picked.

| Tag | Default | What it does |
|---|---|---|
| **Lorebook Tag** | `lorebook` | Notes with this tag become entries. |
| **Always-send tag** | `lorebook-always` | Entries sent with every reply. |
| **Seed Tag** | `lorebook-seed` | Sent quietly in the background while a chat is new. |
| **Starter tag** | `lorebook-bootstrap` | Sent while a chat is new (its first few messages). |

The settings window calls these the **Lore tag**, **Always-send tag**, **Seed tag** and **Starter tag** (**Settings › Vault › Tags**).

**Search Mode:**

| Choice | What it does |
|---|---|
| **Keywords only** | Entries are picked by their keywords. No AI calls. The wizard's default. |
| **Keywords, then AI search** (recommended) | Keywords find candidates, then AI search (an AI) picks the ones that fit. |
| **AI search only** | AI search reads the summaries of the whole vault. More expensive, no keywords needed. |

With **Keywords only**, the wizard skips the AI page. In the settings window the same choice is **Settings › Lore selection › Mode › How lore is picked** (**keywords only** · **keywords, then AI search** · **AI search only**).

## 4. Matching

How far back to look and how much lore to send. Pick a preset for your vault's size, or set the numbers yourself.

| Preset | For | Scan Depth | Max Entries | Token Budget |
|---|---|---|---|---|
| **Small** | under 50 entries | 4 | 10 | 2048 |
| **Medium** | 50 to 200 entries | 6 | 15 | 3072 |
| **Large** | over 200 entries | 8 | 20 | 4096 |

- **Scan Depth**: how many recent chat messages are searched for keywords.
- **Max Entries**: the most entries sent with one reply. **Unlimited** removes the cap.
- **Token Budget**: the most tokens of lore per reply. **Unlimited** removes the cap.
- **Enable fuzzy search**: also finds entries whose words are close to the chat, not only exact keywords.

A preset turns both **Unlimited** boxes off. In the settings window these are **Messages to read** and **Loose matching** (**Settings › Lore selection › Keywords**), and **Entries per reply** and **Lore budget** (**Settings › Budget & variety**).

## 5. AI

Only shown for **Keywords, then AI search** and **AI search only**. AI search uses a SillyTavern **Connection Profile**: choose one from **Connection Profile**. If the list is empty, make a profile in SillyTavern's **API Connections** (the plug icon) › **Connection Profile**, then open this page again.

**Check profile** checks that the profile you picked exists ("Profile found"). Nothing is sent to test it, so a wrong key or address shows up with the first reply; use **Test** in **Settings › AI & connections › Fine print** for a real test.

This page sets AI search only. Mero ☆, the story helper and the other helpers get their profiles in **Settings › AI & connections** (see [[First Steps]]).

## 6. Vault

Optional helper files. Onyx Quill finds entries by tag, not by folder, so you don't have to point it at anything here. This page needs a tested connection; without one it shows **Connection Not Verified** and a **Back to Connection** button.

- **Field definitions** (checked): creates `Onyx Quill/field-definitions.yaml`, the file for filter fields like era, location, scene type and characters present. **Show template** shows what goes in it. See [[Custom Fields]].
- **Optional: Session Scribe folder**: creates the `Sessions` folder that Scribe writes its session notes into. See [[Scribe and AI Helpers]].

You can change both paths. Press **Create Helpers** to create the checked items (a line under each says Created or Failed), or **Skip this step**.

## 7. Import

Optional. Brings a SillyTavern World Info book into your vault as notes. You can always do this later with `/oq-import`.

- **Skip Import** (the default).
- **From SillyTavern Lorebook**: choose one of your World Info books.
- **From JSON File**: a World Info export or a character card with an embedded book.
- **Paste JSON**: paste World Info JSON.

**Target Folder** (optional) is where the notes go; empty means the top of the vault. Press **Import Entries**. A line shows how many were imported, renamed (when a file of that name already existed) or failed.

The import writes into your vault, so it needs the connection from page 2. If you jumped here from **Import a lorebook** on the Welcome page, click **Connection** in the step row first and test it.

`/oq-import` does more after an import than the wizard does: a full report of which fields came over, a reminder about priority order, and, with AI search on, an offer to write real summaries. See [[Coming from DeepLore or World Info]].

## 8. Done

A summary: the vault and its address, the search mode, the matching numbers (and which preset they match), and what was created or imported. With the demo vault, it suggests mentioning "Duskfrost" or "Bellsummit" in a chat, and running `/oq-health` and `/oq-graph`.

The buttons are shortcuts: **Run Health Check**, **Open Graph**, **Browse Entries**, **Open Settings** and **Meet Mero** (opens Mero ☆ in the side panel). Each one first saves the setup, the same as **Finish**, and then opens.

**Finish** saves everything, switches Onyx Quill on and reads your vault. If the connection was never tested, it asks first (**Finish anyway** or **Go back**). Once finished, the wizard won't open by itself again.

Then send a message and open the side panel's **Lore** tab to see what was sent. Next: [[First Steps]].

## See also

- [[Installation]]: what to set up before the wizard.
- [[Quick Start]]: the shortest path through it.
- [[Settings Reference]]: every setting the wizard touches, and more.
