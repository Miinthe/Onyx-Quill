# Setup wizard

The setup wizard walks you through configuring DeepLore for the first time. Eight pages: Welcome, vault connection, tags and search mode, matching, AI search, vault structure, lorebook import, and Done. It takes you from install to working lore injection without leaving the popup.

If you pick **keywords-only** on the tags-and-search-mode page, the AI search page is skipped, so you'll see seven pages instead of eight.

## When it runs

- **Automatically** on first load when the extension has never been configured
- **Manually** any time with `/oq-setup`

You can re-run the wizard whenever you want to reconfigure. It prefills with your current settings.

## Pages

### 1. Welcome

Introduction to what the wizard configures. No settings on this page.

### 2. Obsidian connection

Connect to your Obsidian vault's Local REST API plugin.

| Field | Default | Description |
|-------|---------|-------------|
| Vault Name | `Primary` | Display name for this vault |
| Host | `127.0.0.1` | IP or hostname where Obsidian is running |
| Port | `27123` | REST API port (set in the Local REST API plugin settings) |
| Use HTTPS | Off | Switch to HTTPS (default port 27124). HTTP is recommended |
| API Key | empty | Bearer token from the Local REST API plugin settings |

Click **Test Connection** to verify. The test must pass before you continue.

> [!NOTE]
> HTTP is recommended. HTTPS requires installing the plugin's self-signed certificate to your OS trust store, and DLE does not bundle a setup walkthrough for that. If you need HTTPS, see the [Local REST API author's guide on trusting the certificate](https://github.com/coddingtonbear/obsidian-web/wiki/How-do-I-get-my-browser-trust-my-Obsidian-Local-REST-API-certificate%3F).

**Demo vault:** A collapsible callout at the bottom introduces the bundled Duskfrost demo vault (257 pre-built entries). Click "Show me how" for instructions on opening the bundled `test-vault` folder as an Obsidian vault, then "Auto-fill connection for demo vault" to populate the connection fields.

> If the test fails, check that Obsidian is open and the Local REST API plugin is enabled. See [[Troubleshooting#Connection Issues]].

### 3. Tags and search mode

Configure which Obsidian tags identify lorebook entries, and pick your search strategy.

**Tags:**

| Tag | Default | Purpose |
|-----|---------|---------|
| Lorebook tag | `lorebook` | Entries with this tag are indexed |
| Constant tag | `lorebook-always` | Always injected regardless of matching |
| Seed tag | `lorebook-seed` | Sent to AI search as story context on new chats |
| Bootstrap tag | `lorebook-bootstrap` | Force-injected when chat is short |

**Search mode** (radio buttons):

| Mode | Description |
|------|-------------|
| Keywords only | Match entries by keyword triggers only. No AI calls |
| Two-stage | Keywords pre-filter, then AI search ranks the candidates. Recommended |
| AI only | Send the entire vault manifest to AI search. More thorough, more expensive |

If you select keywords-only, the AI search page is skipped.

### 4. Matching configuration

Configure how deep the keyword scanner looks and how many entries can inject.

**Vault size presets:**

| Preset | Scan Depth | Max Entries | Token Budget |
|--------|-----------|-------------|--------------|
| Small | 4 | 10 | 2,048 |
| Medium | 6 | 15 | 3,072 |
| Large | 8 | 20 | 4,096 |

Click a preset to fill the values, or set them manually:

| Field | Description |
|-------|-------------|
| Scan Depth | Recent messages to scan for keywords (0 to 100) |
| Max Entries | Maximum entries to inject per generation |
| Token Budget | Maximum total tokens for injected lore |
| Unlimited Entries | Ignore the max entries cap |
| Unlimited Budget | Ignore the token budget cap |
| Fuzzy Search | Add BM25 ranked-relevance scoring alongside keyword matching |

### 5. AI search setup

*Skipped if you chose keywords-only on page 3.*

DLE connects to an AI for entry selection through a saved **SillyTavern Connection Manager profile**. Pick your profile from the dropdown, then click **Test AI Connection** to verify the selected connection works.

> [!NOTE]
> As of v2.5 the wizard offers only Connection Profile mode — the old Custom Proxy option was removed. No `config.yaml` changes are needed. If you upgraded from an older DeepLore that used a proxy, that setting is migrated to a profile automatically and a one-time notice asks you to choose one.

### 6. Vault structure

Optional. Creates starter files in your Obsidian vault.

| Item | Path | Purpose |
|------|------|---------|
| Field definitions | `DeepLore/field-definitions.yaml` | Custom gating field schema. See [[Custom Fields]] |
| Sessions folder | `Sessions/` | Where Session Scribe writes notes |

Both are checkboxes. Status indicators show success or error for each.

### 7. Import

Optional. Import an existing SillyTavern lorebook into your Obsidian vault. You can also import later with `/oq-import`.

Import methods:

- **Skip import** (default): set up entries in Obsidian manually or import later
- **From SillyTavern lorebook:** select an existing ST World Info book from a dropdown
- **From JSON file:** upload a World Info export JSON or V2 character card
- **From paste:** paste raw JSON text directly

Set a target folder for imported entries. Results show counts of imported, failed, and renamed entries.

### 8. Done

Review what got configured:

- Vault connection details
- Search mode
- Matching settings (entries, budget)
- Files created

Action buttons let you immediately:

- **Run Health Check:** audit your entries for issues
- **Open Graph:** open the relationship graph
- **Browse Entries:** open the entry browser
- **Open Settings:** fine-tune advanced settings
- **Meet Mero:** meet Mero ☆, your co-writer, in the side panel

## What happens on finish

When you click **Finish**:

1. All settings are saved
2. The extension is enabled
3. A full vault index build is triggered
4. The wizard completion flag is set so the wizard does not auto-launch again

You're ready. Send a message and open the side panel's **Lore** tab (its **Sent** list) to see the lore that was picked.

## See also

- [[Installation]]: prerequisites and install steps
- [[Quick Start]]: getting started after setup
- [[Settings Reference]]: every setting explained
