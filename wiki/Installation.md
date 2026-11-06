How to install Onyx Quill and connect it to Obsidian. You need SillyTavern, the Obsidian app with its **Local REST API** plugin, and a vault (your own, or the Duskfrost demo vault that comes with Onyx Quill). The setup wizard does most of the connecting for you; this page covers what comes before it and how to do it by hand.

## What you need

- **SillyTavern 1.12.14 or newer.** Older versions refuse to load the extension.
- **Obsidian** (the desktop app), with the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin installed and switched on. Obsidian has to be open while you write: Onyx Quill reads your vault through this plugin.
- **A vault.** Your own Obsidian vault works as it is: only notes with the lore tag (`lorebook`) become entries. To try things first, use the demo vault (see [[Quick Start]]). Coming from World Info? The importer turns a World Info book into notes (see [[Coming from DeepLore or World Info]]).
- **For the AI parts (optional at first):** a saved SillyTavern **Connection Profile**. AI search, the story helper, Mero ☆ and the other helpers each use one. Picking lore by keywords alone needs no AI at all.

> [!IMPORTANT]
> If you have the original DeepLore installed, switch it off first. The two can't run at the same time: when both are on, Onyx Quill stays off and tells you so. See [[Coming from DeepLore or World Info]].

## Step 1: set up the Local REST API plugin in Obsidian

1. In Obsidian, open **Settings › Community plugins**, browse for **Local REST API**, install it and switch it on.
2. Open the plugin's settings. Switch on **Enable Non-Encrypted (HTTP) Server**. Its port is `27123`.
3. Copy the **API key** shown there. You will paste it into Onyx Quill.

Plugins in Obsidian belong to one vault. If you use more than one vault (for example your own and the demo vault), each needs the plugin and has its own API key.

> [!NOTE]
> HTTP is the easy way. The plugin's HTTPS server (port `27124`) uses a self-signed certificate, and your browser only accepts it after you install that certificate into your operating system's trust store. Onyx Quill does not walk you through that; if you need HTTPS, see the [Local REST API author's guide](https://github.com/coddingtonbear/obsidian-web/wiki/How-do-I-get-my-browser-trust-my-Obsidian-Local-REST-API-certificate%3F).

## Step 2: install Onyx Quill

1. In SillyTavern, open the **Extensions** panel.
2. Press **Install extension**.
3. Paste this address:
   ```
   https://github.com/Miinthe/Onyx-Quill
   ```
4. Install it (just for you, or for all users, if SillyTavern asks).
5. Reload the page if SillyTavern doesn't do it for you.

Onyx Quill now has its own entry in the Extensions panel, with **Enable Onyx Quill** and **Open Onyx Quill Settings**.

**By hand, with git:** clone the same address into SillyTavern's extensions folder and restart SillyTavern. For all users that is `public/scripts/extensions/third-party/`; for one user it is `data/<user>/extensions/`.

```bash
git clone https://github.com/Miinthe/Onyx-Quill
```

## Step 3: run the setup wizard

The first time Onyx Quill loads with no vault set up, the [[Setup Wizard]] opens on its own (after SillyTavern's own welcome, if that shows). It connects your vault, sets the tags, picks how lore is picked, and can import a World Info book. If you closed it, run `/oq-setup`, or use the side panel's **⋯ › Setup wizard**; it picks up where you left off.

Then follow [[Quick Start]] to see your first entry go out.

## Connecting by hand

You can skip the wizard and set things up in the settings window instead. Open it from the Extensions panel (**Open Onyx Quill Settings**), from the bar's 📖 menu (**Setup and settings**), or from the side panel's **⋯ › Settings**.

1. Go to **Settings › Vault › Vaults**. Press **Add a vault** (or **Edit** on the one that is there).
2. Fill in **Address** (`127.0.0.1` when Obsidian runs on the same computer), **Port** (`27123`) and **API key**. Leave **HTTPS** off.
3. Press **Test**. The vault's line should say "connected".
4. Switch Onyx Quill on: the **On / Off everywhere** switch at the top of the settings window, or **Enable Onyx Quill** in the Extensions panel.
5. Press **Re-read now** under **Settings › Vault › Reading** (or run `/oq-refresh`).

**Scan for vaults** looks for a running Local REST API on this computer if you are not sure of the port.

### Using SillyTavern from another device

Onyx Quill talks to Obsidian from your browser. `127.0.0.1` only works when the browser runs on the same computer as Obsidian. If you open SillyTavern on a phone or another computer, use the address of the computer that runs Obsidian, make sure the Local REST API plugin accepts connections from the network (see its settings), and let the port through that computer's firewall.

## Updating

When a new version is out, SillyTavern offers the update under **Extensions › Manage extensions**. If you installed with git, run `git pull` in the Onyx Quill folder and reload.

## If something doesn't work

- **Can't reach Obsidian:** is Obsidian open, with the Local REST API plugin switched on in this vault? Does the port match the plugin's settings? Is the HTTP server switched on?
- **"Authentication failed" or "the API key was refused":** copy the key again from the plugin's settings. It changes when the plugin is reinstalled.
- **Connected, but no entries:** notes need the lore tag (`lorebook` unless you changed it) in their `tags`. See [[Writing Vault Entries]].
- **Onyx Quill doesn't show up:** check your SillyTavern version (1.12.14 or newer), then reload the page without the cache (`Ctrl+Shift+R`).
- **"The original DeepLore is switched on too":** switch one of them off in **Extensions › Manage extensions**, then reload.

More in [[Troubleshooting]].
