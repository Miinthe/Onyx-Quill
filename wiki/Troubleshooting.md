Fixes for the problems people run into most, from connecting Obsidian to Mero's lookups. Two tools find most problems for you: the side panel's **Diagnostics** view (⋯ › **Diagnostics**, or the **Ready** button at the top of the panel) and `/oq-health`. Both are explained on [[Diagnostics]].

## Connecting Obsidian

Onyx Quill reads your lore from Obsidian through the **Local REST API** community plugin. The browser you use for SillyTavern talks to Obsidian directly, so Obsidian must be open and reachable from that browser. Set the connection in **Settings › Vault** (or with the [[Setup Wizard]]) and press **Test**.

**Test** answers with one of these:

| It says | What to do |
| --- | --- |
| connected | All good. |
| can't reach Obsidian | Obsidian isn't open, the Local REST API plugin isn't installed or switched on (Obsidian › Settings › Community plugins), or the port is wrong. |
| the API key was refused, or "failed: Authentication failed …" | Copy the key again from Obsidian › Settings › Local REST API, with no spaces around it. |
| certificate not trusted | You are on HTTPS. Switch to HTTP (below). |

**HTTP or HTTPS.** Use HTTP. The plugin's HTTP port is `27123`; its HTTPS port is `27124`. In Obsidian › Settings › Local REST API, switch on **Enable Non-Encrypted (HTTP) Server**; in Onyx Quill, switch **HTTPS** off (the port changes to 27123 by itself). HTTPS works only after you install the plugin's certificate in your operating system's trust store; accepting the browser's warning once is not enough. With HTTPS on, the vault's **Trust its certificate** link opens the address, and the guidance window after a failed test walks you through the steps for Windows, macOS, Linux and Firefox.

**CORS.** You don't need to change anything: the Local REST API plugin allows the browser to call it. Onyx Quill does not use SillyTavern's CORS proxy, so `enableCorsProxy` in SillyTavern's `config.yaml` doesn't matter for it.

**Addresses Onyx Quill accepts.** To keep your API key at home, it only connects to addresses on your computer or your own network: `127.0.0.1`, `localhost`, LAN addresses (`192.168.…`, `10.…`, `172.16–31.…`), private IPv6 addresses, and Tailscale names ending in `.ts.net`. A public address is refused with a message saying so.

**"Obsidian connection paused after N failures — retrying in N s."** After three failed calls Onyx Quill waits a few seconds before asking that vault again, so a closed Obsidian doesn't slow every reply. Open Obsidian and press **Test**; that ends the wait at once.

**"0 entries" although the connection works.** Only notes with the lore tag are lore. Check that your notes have `lorebook` in their frontmatter `tags:` (or whatever **Settings › Vault › Tags › Lore tag** says). `/oq-lint` lists notes that were skipped because their frontmatter couldn't be read. See [[Writing Vault Entries]].

**"Open in Obsidian" links don't work.** The vault's **Name** in **Settings › Vault** must match the vault's name in Obsidian exactly.

## "The original DeepLore is switched on too"

Onyx Quill is built on DeepLore by pixelnull, and the two can't run at the same time: both would hook into every reply and share the chats' data. When the original DeepLore is switched on, Onyx Quill stays off and shows this notice until you close it. Turn one of them off in **Extensions › Manage extensions**, then reload the page. Moving over from DeepLore: [[Coming from DeepLore or World Info]].

## Nothing gets sent to the writer

Open 📖 on the reply › **Why these entries**. "no lore used" means nothing went out. Then check, in this order:

1. **Is Onyx Quill on in this chat?** The side panel's **Filters** tab shows **on** or **off** for this chat, with the reason. In a one-on-one chat, a character with no folders anywhere counts as off ("… has no folders yet"): give the character folders, or the chat its own (**Filters** › **Change folders and fields…** › the character's base folders, the run's folders, or **This chat's own folders…**), or set **Onyx Quill in this chat** to **always on**. A chat or character can also be switched off there.
2. **Are there entries?** `/oq-status` shows how many entries the vault has. If it is 0, see "0 entries" above.
3. **Are the entries in this chat's folders?** The **Filters** tab says how many entries are left out by the folders.
4. **Do the keywords appear?** With **keywords only** (the default), an entry goes out only when one of its `keys` appears in the last **Messages to read** (4 by default; **Settings › Lore selection › Keywords**). **Whole words only** and **Case sensitive** (behind More) make matching stricter. Keywords in the text don't count; they belong in `keys:`.
5. **Did AI search pick nothing?** With AI search on, **If AI search picks nothing** decides what goes out, and its default is the always-send entries only. `/oq-inspect` shows what AI search was given and what it picked.
6. **Did a filter take it out?** Field values (era, location, run …), pins and blocks, `requires` / `excludes`, cooldowns. **Why these entries** lists these under **Not Injected** with a **Why?** button for each entry, and `/oq-context-state` shows this chat's field values.

## Too much or too little lore

**Too little:**

- Raise **Entries per reply** (10 by default) or the **Lore budget** (3,072 tokens by default) in **Settings › Budget & variety**. A character or a chat can have its own budget there; the most specific one wins, so check it isn't set lower for this chat.
- **Over budget** in **Why these entries** means entries were cut for space. Give the important ones a better priority (a lower number wins, unless **Higher priority number wins** is on).
- Raise **Messages to read** so keywords further back count.
- With AI search: lower **Leave out below**, raise **Messages AI search reads**, and write `summary` fields that say *when* to pick the entry. **Write missing summaries** (side panel ⋯ › Tools) writes them for entries that have none.
- **Rest after sending** above 0 keeps entries out for that many replies after they went out.

**Too much:**

- Make keywords more specific; very short keywords (two letters or fewer) match too often. `/oq-health` lists them, and `/oq-simulate` (**Try matching**) shows which keywords fire early or flicker.
- Lower **Entries per reply**, the **Lore budget** or **Messages to read**.
- Switch on AI search (**How lore is picked › keywords, then AI search**): it drops matches that don't matter right now.
- **Give others a turn** (**Settings › Budget & variety › Variety**) lets entries that went out many times in a row step back.
- Folders and field filters keep a chat to its own part of the vault; see [[Advanced Gating]] and [[Custom Fields]].

If the lore takes more than 20% of the model's context, a notice warns you.

## AI search is failing

When AI search (the AI that picks lore) fails, the reply still goes out, with what **If AI search fails** says (by default the keyword picks). The notice tells you what happened:

| Notice | What to do |
| --- | --- |
| A time-out | Raise the **Time limit** for **AI search** in **Settings › AI & connections › Fine print** (20 seconds by default). Local models often need 60 to 120 seconds on long chats. |
| "AI search authentication failed …" | The API key in AI search's connection profile is wrong or expired. Test the profile in SillyTavern. |
| "AI search rate-limited by provider …" | The provider wants you to slow down. Wait, or use another model. |
| "AI search couldn't read the model's reply …" / "… unexpected reply format …" / "… found no usable entries …" | The model didn't answer in the expected form. A more capable model usually fixes it; also try **Prompt Post-Processing** set to Strict in the connection profile. |
| "AI search couldn't talk to your provider …" | Set **Prompt Post-Processing** to Semi or Strict in the connection profile, or switch on **Put the system prompt into the user message** (**Fine print**) for providers without a system role. |
| "AI search is resting after errors — using keywords for now." | The AI pause: two service errors in a row. It tries again after 30 seconds. To end it now: **Reset the AI pause** in the Diagnostics view. |

Also check:

- The **AI search** row in **Settings › AI & connections** has a profile picked. If it says "No connection profiles yet", make one in SillyTavern's API Connections (the plug icon) › Connection Profile. **Test** in **Fine print** sends a one-line message through it.
- **Its prompt › Preview** (**Settings › Lore selection › AI search**) shows exactly what AI search is sent for this chat.
- The jobs set to **Same as AI search** (Scribe, New lore, AI notepad, Optimize keywords) fail the same way when AI search's connection does.

## Story trackers don't move by themselves

Trackers follow the story only when the **Story helper** has a connection. Pick a profile for **Story helper** in **Settings › AI & connections**. Without one, you can still move trackers by hand on the board. See [[Storyboards]].

## Mero ☆

**"Mero has no connection yet …"** Pick a profile for **Mero ☆** in **Settings › AI & connections**.

**"🔎 lookups off" above her answer.** Mero looks things up (lore, the board, the chat, the Cast, the web) through tool calls, and her connection can't do them. She still answers, from the board, the latest replies and the entries that were sent. Lookups need all of these:

- Mero's connection profile is a **Chat Completion** profile.
- **Put the system prompt into the user message** (**Settings › AI & connections › Fine print**) is off.
- The model, and with local models its chat template, accepts tools. Some local models or templates refuse them (for example with some models in LM Studio).

After a failed try that isn't a passing hiccup, lookups stay off for that profile until you reload the page. Switch to a model that does tool calls, then reload. A vault review (**Review the vault with Mero**) never uses lookups.

**"🔎 no lookups this time".** The AI service was busy or timed out. She tries again with the next answer.

**She doesn't know an entry.** Mero reads only what this story reads: the chat's folders, the board first. An entry outside the chat's folders is invisible to her too. Secrets for Mero ☆ (the `lorebook-guide` tag) also count only inside the chat's folders. See [[Mero]].

**Web search doesn't happen.** Mero searches the web only when all of these are true: **Settings › Mero › Her job › Searches the web** is on, her lookups work (above), and SillyTavern can search: the **Web Search** extension is installed (whatever search service you pick there is used), or a Tavily key is saved in SillyTavern.

## Pictures for 📷 photos

Real pictures for 📷 photos in [[World]] messages are drawn by SillyTavern's own **Image Generation** extension, with the image source, model and style words you set up there. If you see "SillyTavern's Image Generation isn't switched on (Extensions › Image Generation)", switch it on and choose an image source; test it with `/imagine` in the chat. "No picture came back …" means Image Generation answered with nothing: check its settings, then tap 🎨 on the photo to try again. After a failure, pictures stop being drawn by themselves until one drawn by hand works. The switches are in the board's World tab › **Pictures**. Each picture is one image call.

## Edits in Obsidian don't show up

Onyx Quill keeps a copy of your vault and reads it again after **Keep the index for** (300 seconds by default; **Settings › Vault › Reading**, behind More). For a re-read right away, press **Re-read now** there, or run `/oq-refresh`. **Re-read the vault every** N seconds checks in the background. See [[Under the Hood]].

## "Lore from the last message is taking longer than expected"

A lore selection held on for more than 30 seconds, usually a slow AI call, and the next reply took over. Check the **Time limit** of AI search and the Story helper in **Settings › AI & connections › Fine print**. If the chat seems stuck, reload the page.

## Using Onyx Quill on a phone or tablet

Onyx Quill works in a phone's browser; the bar and the side panel have a phone layout. The one thing to know: **the phone's browser talks to Obsidian itself.** In **Settings › Vault**, an address like `127.0.0.1` means the phone, not your computer. On a phone you need:

- Obsidian open on the computer, with the Local REST API plugin running.
- The vault's **Address** set to an address the phone can reach: the computer's address on your home network (like `192.168.1.20`), or its Tailscale name (`….ts.net`) when you're away from home.
- The plugin reachable at that address from other devices, not only from the computer itself (see the plugin's own documentation).
- If you open SillyTavern itself over `https://`, your browser may refuse plain `http://` calls from that page. Then Obsidian needs to be reached over HTTPS too.

Vault settings are shared by every device that uses the same SillyTavern account, so an address that works on the phone must also work on the computer (a LAN address usually does both).

## Still stuck?

1. Run `/oq-health` and fix the errors it lists.
2. Look at `/oq-logs`, or the browser console (F12) filtered for `[Onyx Quill`. Switch on **Debug mode** (**Settings › Advanced**) for more detail, and off again afterwards.
3. Export diagnostics: **Settings › Advanced › Export diagnostics**, or `/oq-diagnostics`. Read the privacy notes on [[Diagnostics]] before you share the report.
4. [Open an issue](https://github.com/Miinthe/Onyx-Quill/issues) with your Onyx Quill version (**Settings › Advanced › Reference › About**), what you did, what you expected, what happened, and the anonymized report (not the connections reference file).
