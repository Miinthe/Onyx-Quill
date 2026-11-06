Filter fields let an entry say *where it belongs*: an era, a place, a kind of scene, who must be present, or anything your story needs (a faction, the time of day, a danger level). You set a value for the chat, and entries whose value doesn't fit stay out. Four fields come built in; you can change them and add your own.

## How it works

1. **Define the fields** in the rule builder (or the field definitions file in your vault).
2. **Give entries values** in their frontmatter, for example `location: Bayside Shushail`.
3. **Set the chat's value**: side panel **Filters** tab › **Fields**, or a slash command. Values are kept per chat.
4. Entries whose values don't fit are left out when lore is picked. **Why these entries** lists them under "Filtered by context".

## The four built-in fields

| Field | In frontmatter | Set it with | Example values |
|---|---|---|---|
| Era | `era` | `/oq-set-era` | `medieval`, `renaissance` |
| Location | `location` | `/oq-set-location` | `Bayside Shushail`, `Bellsummit` |
| Scene Type | `scene_type` | `/oq-set-scene` | `social`, `combat` |
| Characters Present | `character_present` | `/oq-set-characters` | `Gorduin Wynlar` |

All four hold one or more text values, use **Match Any** and **Moderate**: an entry goes in when one of its values matches one of the chat's values, and while the chat has no value for the field, nobody is held back. An entry without the field is never filtered by it.

The board can set **Location** from where the scene is, and the Cast can fill in **Characters Present**. See [[Storyboards]] and [[Cast]].

## Adding and changing fields

Open the rule builder from the side panel's **Filters** tab › **Change folders and fields…** › **Edit the filter fields…**, or from **Settings › Filters**. For each field you set:

- **Name**: the frontmatter key. Lowercase letters, numbers and underscores, starting with a letter.
- **Label**: the name shown in the side panel and on AI search's cards.
- **Type**: Text, Number or Boolean (true/false), and **Multi-value** for a list.
- **Gating**: **Enabled**, the operator and the tolerance (below).
- **Context Key**: where the chat's value is kept; linked to the name unless you unlink it.
- **Allowed Values**: an optional fixed list. A one-value field with a list gets a dropdown in the Filters tab.

You can also delete, duplicate and reorder fields, or reset to the four built-ins (your own fields are then lost). Saving writes the file to your vault and re-reads the vault.

These names are taken and can't be used: `keys`, `priority`, `tags`, `requires`, `excludes`, `position`, `depth`, `role`, `scandepth`, `excluderecursion`, `refine_keys`, `selective_logic`, `cascade_links`, `cooldown`, `warmup`, `probability`, `summary`, `graph`, `enabled`, `constant`, `seed`, `bootstrap`, `type`, `fileclass`, `status`, `aliases`.

## Operators

How the entry's value is compared with the chat's value:

| Operator | The entry passes when… |
|---|---|
| **Match Any** (`match_any`) | one of its values is among the chat's values. |
| **Match All** (`match_all`) | every one of its values is among the chat's values. |
| **Not Any** (`not_any`) | none of its values is among the chat's values. |
| **Equals** (`eq`) | its value equals the chat's value. |
| **Greater Than** (`gt`) | its number is bigger than the chat's number. |
| **Less Than** (`lt`) | its number is smaller than the chat's number. |
| **Exists** (`exists`) | it has a value for this field at all. |
| **Not Exists** (`not_exists`) | it has no value for this field. |

Text is compared without regard to case. **Exists** and **Not Exists** look only at the entry, never at the chat, and they work even when no value is set anywhere: a field with **Exists** keeps out *every* entry that lacks it. **Not Exists** is handy for a `draft` field: give unfinished entries `draft: true`, and they stay out until you remove it.

## Tolerance

What happens when an entry has a value for the field:

| Tolerance | Chat has no value for the field | Chat has a value, the check fails |
|---|---|---|
| **Strict** | left out | left out |
| **Moderate** | goes in | left out |
| **Lenient** ("keep even on a mismatch") | goes in | left out only for **Not Any**, **Equals**, **Greater Than**, **Less Than**; goes in for **Match Any** and **Match All** |

**Moderate** suits most fields. **Strict** is for entries that must only ever appear in their context, but note that a field only filters once the chat has a value for *some* field. **Lenient** with Match Any or Match All never leaves anything out, so it is only useful with the other operators. One exception to the whole table: an entry with the **Not Exists** check on a field is left out whenever the entry has that field, under every tolerance and whatever the chat says.

## Values in entries

```yaml
---
tags:
  - lorebook
keys:
  - Highwallow Night Clinic
location: Highwallow
danger: 3
---
```

A multi-value field takes one value or a list:

```yaml
era: renaissance
era:
  - medieval
  - renaissance
```

## Setting the chat's values

In the side panel's **Filters** tab, the **Fields** fold shows each field with its value and how many entries it leaves out; **＋** or ✎ sets a value, the ✕ on a value removes it. **Show** lists the fields no entry uses yet. Values set here are for this chat only.

Or with commands:

```
/oq-set-field danger 5
/oq-set-location Highwallow
/oq-set-characters Gorduin Wynlar, Ayre Waesphyra
/oq-clear-field danger
/oq-clear-all-context
/oq-context-state
```

`/oq-set-field` with only a field name (and `/oq-set-era`, `/oq-set-location`, `/oq-set-scene`, `/oq-set-characters` without a value) opens a list of the values found in your vault. Short forms: `/oq-era`, `/oq-loc`, `/oq-ctx` (for `/oq-context-state`), `/oq-reset-context` (for `/oq-clear-all-context`).

## Who is not filtered

Always-send entries, seed entries, pinned entries, and starter entries while the chat is new go in whatever the fields say.

## Where fields show up

- AI search sees each entry's field values on its card. **Settings › Lore selection › Your fields it sees** (under **More**) limits which ones (empty = all).
- **Lore › All entries** in the side panel has a filter chip for each field.
- The relationship graph can color entries by a field.
- **Why these entries** shows an entry's field values when you open it.

## The field definitions file

The rule builder saves to `Onyx Quill/field-definitions.yaml` in your vault (settings that came over from DeepLore keep `DeepLore/field-definitions.yaml`; change the path in **Settings › Vault › Files › Field definitions file**). You can also edit it in Obsidian in normal YAML: the usual indents, lists and comments all work. A line Onyx Quill can't place is skipped with a warning, instead of the whole file being ignored.

```yaml
fields:
  - name: era
    label: Era
    type: string
    multi: true
    gating:
      enabled: true
      operator: match_any
      tolerance: moderate
    values: []
    contextKey: era
  - name: danger
    label: Danger
    type: number
    multi: false
    gating:
      enabled: true
      operator: lt
      tolerance: moderate
    values: []
    contextKey: danger
```

With this `danger` field, `/oq-set-field danger 5` lets in entries with a danger below 5 and keeps out the rest; entries without `danger` are not affected.

## Folders

Folders are the other filter: each chat reads only its character's, its run's and its own folders. See [[How Lore Gets Picked]].

## See also

- [[Advanced Gating]]: the other rules for when an entry goes in
- [[Frontmatter Fields]]: every field
- [[Slash Commands]]: all commands
