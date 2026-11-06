These frontmatter fields control *when* an entry goes in, beyond its keywords. All of them are optional: reach for one when an entry fires too often, too rarely, or in the wrong scene. Copy-ready notes for each are in [[Entry Templates]]; the full field list is in [[Frontmatter Fields]]. For the order in which all of this happens, see [[How Lore Gets Picked]].

## Which rules apply when

- **Keyword rules** (`refine_keys`, `warmup`, `probability`, `cooldown`, `cascade_links`, `scanDepth`) work in **keywords only** and **keywords, then AI search**. In **AI search only** no keywords are read, so they do nothing there.
- **`requires` / `excludes`**, field filters and the folder filter apply in every mode.
- Always-send entries, seed entries, pinned entries, and starter entries while the chat is new **skip** `requires` / `excludes`, field filters, rests and the folder filter. Only the budget and a block can keep them out.

## requires and excludes: entries that depend on each other

```yaml
requires:
  - Gorduin Wynlar
excludes:
  - Solarguard
```

- `requires`: **every** listed entry must also be picked for this reply, or this one stays out.
- `excludes`: if **any** listed entry is picked, this one stays out.

Titles are matched without regard to case, but must otherwise be exact. A misspelled title never counts as picked, so a `requires` with a typo always keeps the entry out; `/oq-health` reports titles that don't exist.

"Picked" means picked for this reply, after AI search and the filters. Always-send and pinned entries always count as picked, so `excludes` naming an always-send entry keeps your entry out for good.

The check repeats until nothing changes: if A requires B and B is dropped by its own rules, A goes too. When two entries exclude each other, the one with the better priority stays.

Good for: a secret that only makes sense next to its setup, two states of the world that can't both be true, a detail entry that needs its main entry.

## cooldown, warmup, probability: how often

```yaml
cooldown: 5       # after being sent, rest for 5 replies
warmup: 2         # its keywords must appear at least twice
probability: 0.4  # about two times in five when it matches
```

- **`cooldown`**: after the entry is sent, it rests for that many replies. For flavor that shouldn't repeat every turn. The side panel's **Lore** tab shows resting entries in the **Timers** fold.
- **`warmup`**: the entry's keywords must appear at least that many times in the messages read (all keys counted together). Keeps one passing mention from pulling it in.
- **`probability`**: a chance between 0 and 1 each time it matches. No `probability`, or `1`, means always; `0` means never.

For one rest that applies to every entry, use **Rest after sending** in **Settings › Budget & variety**. Rests start over when you switch chats or reload the page.

## refine_keys and selective_logic: a second keyword check

For an entry whose key is a common word ("the Guild", "the Crown") and fires too often.

```yaml
keys:
  - Ayre
  - the Translator
refine_keys:
  - ancient
  - pre-Calamity
selective_logic: and_any
```

A `keys` match is always needed first. Then the refine keys are checked:

| `selective_logic` | The entry goes in when… |
|---|---|
| `and_any` (default) | at least one refine key also appears. |
| `and_all` | every refine key also appears. |
| `not_all` | at least one refine key is missing. |
| `not_any` | no refine key appears. |

An unknown value counts as `and_any`, and `/oq-lint` warns. Refine keys are not checked for entries found by **Loose matching** or pulled in by `cascade_links`. **Why these entries** lists entries a refine check kept out.

## cascade_links: entries that travel together

```yaml
cascade_links:
  - Bellsummit
  - Duskfrost Academy
```

When this entry matches (by keywords, or because it is always sent), the listed entries come along, no keywords needed. Their own `cooldown` and `probability` still apply (`warmup` and `refine_keys` don't), and their own `cascade_links` are followed too. With **keywords only** they go in; with **keywords, then AI search** they join the candidates, and AI search still decides.

The difference to `[[wikilinks]]`: a link only offers the other entry to AI search (or to **Entries can call other entries**, through its keywords); a cascade link pulls it in without keywords.

Good for: a place and the faction headquartered there, an artifact and the war it caused, a character and their ability entry.

## scanDepth and excludeRecursion

- **`scanDepth`**: how many recent messages to read for this entry's keywords, instead of **Messages to read**. A big number for something mentioned once long ago that should stay; `0` means its keywords are not read at all.
- **`excludeRecursion: true`**: when **Entries can call other entries** is on, this entry's text is not searched for other entries' keywords. Useful for long entries that name half the vault.

## Field filters: era, location, scene, who is present

```yaml
location: Bayside Shushail
scene_type: social
character_present:
  - Gorduin Wynlar
```

These compare the entry with values you set for the chat (side panel **Filters** tab › **Fields**, or `/oq-set-location`, `/oq-set-scene`, `/oq-set-characters`, `/oq-set-era`, `/oq-set-field`). With the built-in settings:

- An entry without the field is never filtered by it.
- An entry with the field goes in only when one of its values matches the chat's value.
- While the chat has no value for that field, the entry is not held back.

The board can set the location from where the scene is, and the Cast can set who is present. You can add your own fields and change how each one compares. See [[Custom Fields]].

## outlet: put an entry in an exact spot

```yaml
outlet: harbor_rules
```

Put `{{outlet::harbor_rules}}` in your system prompt, character card, or a prompt in SillyTavern's prompt list, and the entry's text appears there, whenever the entry is picked. Outlet entries don't use the normal position and don't count against the budget. Several entries with the same outlet name are placed there together.

## position, depth, role: a different place in the prompt

```yaml
position: in_chat
depth: 1
role: system
```

The entry ignores **Settings › Where it goes** for itself. `position` is `before` (before the main prompt), `after` (after the main prompt) or `in_chat`; `depth` and `role` only matter with `in_chat`. In **in the prompt list** mode, an entry with its own position keeps it.

## Only at one step of the story

```yaml
tracker: Velkhast Succession
step:
  - The Claim
  - The Vote
```

The entry is only in play while the story tracker named `Velkhast Succession` stands at one of these steps (pinned entries stay). Linking an entry to a step on the board does the same, with more choices (📄 context, 🧭 guidance, ⚖️ judge); see [[Storyboards]].

---

Next: [[Frontmatter Fields]] · [[Entry Templates]] · [[Custom Fields]] · back to [[Writing Vault Entries]]
