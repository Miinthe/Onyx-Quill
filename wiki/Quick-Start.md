The shortest way from a fresh install to a reply that used your lore. You connect a vault with the setup wizard, write (or borrow) one entry, send a message, look at what went out, and then start your first storyboard. It takes a few minutes. You need Obsidian with the Local REST API plugin and Onyx Quill installed (see [[Installation]]).

## 1. Open the setup wizard

The wizard opens by itself the first time Onyx Quill loads. If it doesn't, type `/oq-setup` in the chat box.

<!-- screenshot: the wizard's Welcome page with its three choice cards -->

The Welcome page offers three ways to start:

- **Try the demo vault**: explore Onyx Quill with the made-up city of Duskfrost, no vault of your own needed. Easiest.
- **Connect my Obsidian**: use your own vault.
- **Import a lorebook**: bring a SillyTavern World Info book into a vault.

Pick one of the first two below. (Importing is covered in [[Coming from DeepLore or World Info]].)

## 2a. With the demo vault

Onyx Quill ships with a demo vault: the fantasy city of **Duskfrost**, about 250 notes of characters, places, factions, species and history. It lives in a folder named `test-vault` inside the Onyx Quill extension folder.

1. Press **Try the demo vault**. The wizard opens the Connection page, shows the steps, and fills in the connection for you (name "Duskfrost Demo", port `27123`, HTTP).
2. In Obsidian, use **Open folder as vault** (from the vault switcher at the bottom left) and choose the `test-vault` folder. The wizard shows its path and has a copy button. Where it is on disk depends on how you installed Onyx Quill: `public/scripts/extensions/third-party/Onyx-Quill/test-vault` for all users, or `data/<user>/extensions/Onyx-Quill/test-vault` for one user, inside your SillyTavern folder.
3. In the demo vault, install and switch on the **Local REST API** plugin, switch on its HTTP server, and copy its API key.
4. Back in the wizard, paste the key into **API Key** and press **Test Connection**.

Two open vaults can't both use port `27123`. If your own vault runs the plugin too, close it while you try the demo, or give one of them another port.

## 2b. With your own vault

1. Press **Connect my Obsidian**.
2. Leave **Host** at `127.0.0.1` and **Port** at `27123` (unless you changed them in the plugin), paste the **API Key** from the plugin's settings, and press **Test Connection**. Not sure of the port? **Scan for vaults** looks for it.

**Next** unlocks once the test passes.

## 3. Go through the rest of the wizard

For a first run, the defaults are fine:

- **Tags**: keep `lorebook` as the lore tag. For how lore is picked, start with **Keywords only**. It needs no AI, and you can switch to **Keywords, then AI search** later.
- **Matching**: pick the preset that matches your vault's size (the demo vault is **Large**).
- **Vault** and **Import**: both optional. Press **Skip this step** and **Next**.
- **Done**: press **Finish**. Onyx Quill switches on and reads your vault.

The [[Setup Wizard]] page explains every field.

## 4. Write a first entry (own vault only)

The demo vault already has hundreds of entries; skip this step if you use it. In your own vault, make a new note in Obsidian and paste this:

```markdown
---
tags:
  - lorebook
keys:
  - Lantern Market
  - night market
summary: "A night market under the old bridge where smugglers sell charms. Select when shopping, smuggling, charms or the bridge district come up."
---

# Lantern Market

The Lantern Market opens at dusk under the old bridge and closes before the first bell. Stalls hang paper lanterns in colors that tell buyers what is sold there: green for herbs, red for charms, and no lantern at all for things nobody should ask about.
```

- `tags: lorebook` makes the note an entry.
- `keys` are the words that call it up when they appear in the chat.
- `summary` tells AI search when the entry matters. Keywords-only mode doesn't need it, but write one anyway: you will want it when you turn AI search on.

By default, Onyx Quill reads the vault again before a reply once its copy is five minutes old. To pick up the new note right away, press **Refresh** at the top of the side panel, or run `/oq-refresh`.

## 5. See it work

1. Open a chat and send a message that uses a keyword: "Lantern Market" for your new entry, or "Bellsummit" or "Duskfrost" with the demo vault.
2. When the reply arrives, open the 📖 menu on it (the book button next to the message's edit button) and choose **Why these entries**. Your entry is listed with the reason it went in.
3. Open the side panel (the side-panel button on the bar above the message box, or Onyx Quill's book icon in SillyTavern's top bar). The **Lore** tab's **Sent** list shows what went out with the last reply; **Left out** shows what was considered and why it didn't go.

<!-- screenshot: the 📖 menu's "Why these entries" window listing one entry -->

Nothing listed? See [[Troubleshooting]], or run `/oq-health` for a check of your vault and connection.

## 6. Start a storyboard

The storyboard is where Onyx Quill really starts to help: it follows your story's plan while you play.

1. Open the board: the bar's 📖 menu › **Open the board**. In a chat without a board it opens on a new, empty one.
2. **File › New…** and pick a starter template, for example **Slow-burn romance** or **Mystery**. Each is a small working board you can rename and change.
3. **File › Save**, then **File › Apply to…** and pick this chat.
4. Give the story helper a connection: **Settings › AI & connections › Story helper** (a saved SillyTavern Connection Profile). Without one, the trackers only move when you move them.
5. Play on. When the story reaches the next step, a notice shows the move with the quote it is based on and **Undo**, and the writing model is told where things stand.

<!-- screenshot: a notice "Relationship: Strangers → Acquaintances" with its quote and Undo -->

## Next

- [[Storyboards]]: everything the board can do, from forks and meters to linking your lore to a step.
- [[First Steps]]: a starter vault, connecting AI search and Mero ☆, and tuning how much lore goes out.
- [[Writing Vault Entries]]: how to write good entries.
- [[Cast]], [[World]] and [[Mero]]: the other story tools.
