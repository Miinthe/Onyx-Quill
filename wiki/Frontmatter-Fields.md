The reference for everything you can put in an entry's frontmatter (the YAML block between `---` lines at the top of the note). For ready-made notes see [[Entry Templates]]; for how the gating fields behave see [[Advanced Gating]]. New to writing entries? Start at [[Writing Vault Entries]].

Only `tags` with `lorebook` is required. You will almost always want `keys` too.

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `tags` | list | (required) | Must include `lorebook` (or `lorebook-guide` for a secret for Mero ☆). Can carry the special tags below and any tags of your own. |
| `keys` | list | none | Keywords that pick this entry when they appear in the recent messages. |
| `summary` | text | none | What AI search reads to decide whether to pick the entry. Never sent to the writing AI. Keep it under 600 characters. See [[Writing Vault Entries]]. |
| `priority` | number | `100` | Order when the budget fills up: lower goes first. **Higher priority number wins** in **Settings › Lore selection** turns it around. |
| `constant` | true/false | `false` | `true` is the same as the `lorebook-always` tag: sent with every reply. |
| `enabled` | true/false | `true` | `false` leaves the note out entirely, as if it had no `lorebook` tag. |
| `requires` | list of titles | none | All of these entries must also be picked, or this one stays out. |
| `excludes` | list of titles | none | If any of these entries is picked, this one stays out. |
| `refine_keys` | list | none | A second keyword check after a `keys` match. How it counts is set by `selective_logic`. |
| `selective_logic` | text | `and_any` | `and_any` (one refine key must match too), `and_all` (all must), `not_all` (at least one must be missing), `not_any` (none may match). |
| `cascade_links` | list of titles | none | When this entry is picked, these come along, no keywords needed. |
| `cooldown` | number | none | After being sent, the entry rests for this many replies. |
| `warmup` | number | none | Its keywords must appear at least this many times in the messages read. |
| `probability` | 0 to 1 | none (always) | The chance it goes in when it matches. `0.3` = about one time in three; `0` = never. |
| `scanDepth` | number | the setting | How many recent messages to read for this entry's keywords. `0` = its keywords are not read. |
| `excludeRecursion` | true/false | `false` | `true`: this entry's text is not searched for other entries' keywords (**Entries can call other entries**). |
| `position` | text | the setting | `before` (before the main prompt), `after` (after the main prompt), or `in_chat`. |
| `depth` | number | the setting | How far up in the chat, with `in_chat`. 0 = at the very bottom. |
| `role` | text | the setting | `system`, `user` or `assistant`, with `in_chat`. |
| `outlet` | text | none | Sends the entry to the spot where you put `{{outlet::name}}` instead of the normal place. Doesn't count against the budget. |
| `graph` | true/false | `true` | `false` hides the entry from the relationship graph. Matching is unchanged. |
| `era`, `location`, `scene_type`, `character_present` | text or list | none | The four built-in filter fields. With a value set for the chat, entries with a different value stay out. See [[Custom Fields]]. |
| your own fields | as defined | none | Filter fields you added in the rule builder. See [[Custom Fields]]. |
| `tracker` + `step` | text + text or list | none | The entry is only in play while the story tracker of that name stands at one of these steps. Linking the entry on the board does the same with more choices; see [[Storyboards]]. |

Field names are written exactly as above: lowercase with underscores, except `scanDepth` and `excludeRecursion`. If you write `Keys:` or `Priority:`, Onyx Quill reads it anyway and lists a warning in `/oq-lint`.

Some fields that other tools write (`title`, `type`, `aliases`, `status`) are not read for picking lore. The title always comes from the first `# ` heading, or the file name.

## Special tags

Add these next to `lorebook`:

| Tag | Setting label | What it does |
|---|---|---|
| `lorebook` | **Lore tag** | Marks the note as an entry. |
| `lorebook-always` | **Always-send tag** | Sent with every reply. Same as `constant: true`. |
| `lorebook-never` | **Never-send tag** | Never used; the note is skipped. |
| `lorebook-seed` | **Seed tag** | While the chat is new, the text is given to AI search as background on the setting. |
| `lorebook-bootstrap` | **Starter tag** | Sent with every reply while the chat is new, then an ordinary entry. |
| `lorebook-guide` | **Secrets-for-Mero tag** | A secret for Mero ☆: only she reads it, in her talks and pitches; the writing AI never gets it. It doesn't need `lorebook`. If a note has both, it is a secret for Mero. |

The names can be changed in **Settings › Vault › Tags** (the last four under **More**). **A chat counts as new for** sets how long "new" lasts (3 messages). Seed, starter and secrets for Mero are tags only: there is no `seed:` or `bootstrap:` field.

Secrets for Mero ☆ are for your co-writer (plans, threads to keep in mind), not for writing style; style belongs in your SillyTavern preset. See [[Mero]].

## Priority guide

A rough scale, if you want one:

| Priority | For |
|---|---|
| 10–20 | The core: main characters, world rules |
| 30–40 | Important people and places |
| 50 | Most entries |
| 60–70 | Minor characters, background |
| 80–100 | Trivia, rarely needed |

## Body structure

After the frontmatter, write normal Markdown. A pattern that works well:

```markdown
# Entry Title

One paragraph saying what this is.

<div class="meta-block">
[Role: … | Location: … | Wants: … | Fears: …]
</div>

The rest of the lore, with [[wikilinks]] to related entries.
```

The meta-block is optional: a compact line of facts the writing AI can scan quickly. The `<div>` tags are removed before sending; the line inside stays. Use whatever labels fit the entry.

## Fields from World Info imports

An imported SillyTavern World Info book may carry fields such as `case_sensitive`, `match_whole_words`, `sticky`, `delay`, `group` or `use_probability`. Onyx Quill keeps them in the note but does not act on them, and `/oq-lint` lists them. See [[Coming from DeepLore or World Info]].

## Common mistakes

`/oq-lint` lists every warning and skipped note from the last vault read. `/oq-inspect` shows the full trace of the last reply.

**Quoted numbers.** `priority: "3"` is text, not a number. Onyx Quill converts it and warns; better to write `priority: 3`.

**Keys as one line.** `keys: "Bram, Solvik"` is split at the commas, with a warning. Better:

```yaml
keys:
  - Bram
  - Solvik
```

**No `lorebook` tag.** The note is not an entry. The notice after a vault read counts skipped notes.

**No frontmatter.** A note without the `---` block is skipped.

**Misspelled titles.** `requires`, `excludes` and `cascade_links` name other entries by title (not case sensitive). A misspelled title never matches, so a `requires` with a typo always keeps the entry out. `/oq-health` reports titles that don't exist.

**`depth` or `role` without `in_chat`.** They only apply when the entry (or the setting) puts it in the chat. `/oq-health` warns about it.

---

Next: [[Entry Templates]] · [[Advanced Gating]] · back to [[Writing Vault Entries]]
