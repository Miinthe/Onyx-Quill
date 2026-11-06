Complete notes you can copy into your vault and change. The examples use **Duskfrost**, the made-up harbor city of the demo vault that ships with Onyx Quill (`test-vault/`); their text is written for this page. What each field means is in [[Frontmatter Fields]]; how the gating fields behave is in [[Advanced Gating]]. New to writing entries? Start at [[Writing Vault Entries]].

In every note: the title is the first `# ` heading, the `summary` is for AI search, and the text is for the writing AI. Write each paragraph as one line; Obsidian wraps it for you.

## 1. Smallest entry

```markdown
---
tags:
  - lorebook
keys:
  - Drowned Anchor
---

# The Drowned Anchor

A sailors' tavern on the Bayside Shushail waterfront, known for cheap drinks and cheaper gossip.
```

## 2. Character

```markdown
---
tags:
  - lorebook
keys:
  - Bram Solvik
  - Dockmaster Solvik
  - Bram
  - the dockmaster
priority: 40
summary: "Human dockmaster of Bayside Shushail's main cargo pier; decides which ships berth and what the manifests say. Select when port operations, cargo inspection, smuggling at the docks, or the balance between the Solarguard and the Bonehands on the waterfront come up."
---

# Dockmaster Bram Solvik

Dockmaster of [[Bayside Shushail]]'s main cargo pier. Methodical, gruff and hard to rattle, he keeps both the [[Solarguard]] customs office and the [[Bonehands]] dock crew just satisfied enough that neither starts a war on his pier.

<div class="meta-block">
[Species: Human | Age: 51 | Role: Dockmaster | Build: Barrel-chested, sea-weathered | Speech: Gruff, few words, dockside dialect | Wants: Trade that keeps moving | Fears: A dockside war | Secret: A locked log of every hold heavier than its manifest]
</div>

## Background

Twenty years a merchant sailor before he took the post, Bram still thinks in tides and cargo weights rather than politics.

## Relationships

- **[[Solarguard]]**: gets enough honest manifests to meet its inspection quotas.
- **[[Bonehands]]**: gets enough scheduling slack to move what it needs to move.
```

## 3. Place

```markdown
---
tags:
  - lorebook
keys:
  - Drowned Anchor
  - harbor tavern
priority: 60
location: Bayside Shushail
scene_type: social
summary: "Sailors' tavern in Bayside Shushail. Select for harbor social scenes, sailors and dockworkers, dice games, or picking up waterfront rumors."
---

# The Drowned Anchor

A low, smoky tavern built half into the old sea wall of [[Bayside Shushail]]. The floor slopes toward the water and the tables are bolted down.

<div class="meta-block">
[Category: Tavern | District: Bayside Shushail | Atmosphere: Loud, damp, friendly to anyone who pays | Regulars: Sailors, dockworkers, Bonehands runners | Rules: No blades drawn indoors]
</div>

## Notable features

- **The back booth**, where deals are made and nobody sits by accident.
- **The tide bell** over the bar, rung when the harbor patrol is seen on the quay.
```

The `location` and `scene_type` values let a chat's filters keep this entry out of scenes elsewhere. See [[Custom Fields]].

## 4. Lore or a world rule

```markdown
---
tags:
  - lorebook
keys:
  - blood binding
  - blood contract
priority: 45
summary: "How contracts are enforced with blood-binding in Duskfrost. Select when contracts, oaths, debts, legal agreements or binding magic come up."
---

# Blood Binding Contracts

A contract sealed with a drop of each party's blood binds them by sigil. Breaking it doesn't kill, but the breaker's own sigil-work fails until the debt is settled.

<div class="meta-block">
[Category: Law, magic | Who knows: Everyone, roughly | Consequences: Sigils fail for the breaker | Misconceptions: Many believe a broken contract is fatal]
</div>
```

## 5. Faction

```markdown
---
tags:
  - lorebook
keys:
  - Bonehands
  - the Hands
priority: 35
summary: "Duskfrost's dominant criminal organization, running the harbor and the marsh. Select when crime, smuggling, protection money, Bayside Shushail or Highwallow come up."
---

# Bonehands

The guild that really runs the waterfront of [[Bayside Shushail]] and the marsh streets of [[Highwallow]]. Smuggling, protection and quiet loans; open violence is bad for business.

<div class="meta-block">
[Category: Criminal guild | Public face: A dockworkers' mutual society | True purpose: Smuggling and protection | Rivals: Solarguard | Vulnerabilities: Needs the harbor open]
</div>
```

## 6. Event or story thread

```markdown
---
tags:
  - lorebook
keys:
  - Velkhast succession
  - succession crisis
priority: 30
era: renaissance
summary: "The ongoing fight over who heads House Velkhast. Select when Velkhast house politics, the claimants, the stalled harbor trade or the Triumvirate's balance come up."
---

# Velkhast Succession Crisis

The head of House Velkhast died without naming an heir, and two claimants now pull the house apart. Harbor trade, which the house controls, has nearly stopped.

## Where it stands

Neither claimant can win the house council outright. The other two Triumvirate houses wait to see who is worth backing.

## Open threads

- Who forged the late head's last letter?
- What the Bonehands are paid to keep the harbor quiet.
```

## 7. Always sent

For the few facts every reply needs. Keep it short: it uses budget every time.

```markdown
---
tags:
  - lorebook
  - lorebook-always
keys:
  - Duskfrost
priority: 5
---

# Duskfrost World Rules

Duskfrost is a coastal city of about 80,000, built on the ruins of a civilization destroyed in the Calamity some 355 years ago. Three noble houses, the Triumvirate, share power. Magic is worked through sigils and always costs the caster something.
```

`constant: true` in the frontmatter does the same as the `lorebook-always` tag.

## 8. Seed (background for AI search in new chats)

```markdown
---
tags:
  - lorebook
  - lorebook-seed
keys:
  - Duskfrost eras
priority: 15
---

# Duskfrost Era Guide

The named eras of Duskfrost: the Antecedent Culture before the Calamity; the Reconstruction after it; the medieval era of the first Triumvirate compact; and the renaissance of today, year 355 after the Calamity.
```

While a chat is new, AI search gets this text as background on the setting. It only matters when AI search is on.

## 9. Starter (sent while the chat is new)

```markdown
---
tags:
  - lorebook
  - lorebook-bootstrap
keys:
  - arriving in Duskfrost
priority: 10
---

# Arriving in Duskfrost

Newcomers land at the cargo piers of Bayside Shushail and climb the Cliff Stairs toward the richer districts. The Solarguard checks papers at the top; nobody checks anything at the bottom.
```

Sent with every reply for the first messages of a chat (**A chat counts as new for**, 3 by default), then it is an ordinary entry.

## 10. Secret for Mero ☆

Only Mero reads these, in her talks and pitches; the writing AI never gets them. Use them for what your co-writer should know about your plans, not for writing style (that belongs in your SillyTavern preset).

```markdown
---
tags:
  - lorebook-guide
---

# Plans for the Velkhast thread

I want the succession to stay unresolved until the harbor nearly riots. The forged letter should surface through the Bonehands, not the Solarguard. Remind me if the second claimant hasn't appeared for a while.
```

The note doesn't need the `lorebook` tag. Mero reads the notes in the chat's folders. See [[Mero]].

## 11. Only together with another entry (requires / excludes)

```markdown
---
tags:
  - lorebook
keys:
  - Archive Master Key
  - master key
requires:
  - Gorduin Wynlar
excludes:
  - Archive Disappearance
summary: "The master key to the Archive's restricted collection. Only relevant when Gorduin Wynlar is part of the scene."
---

# Archive Master Key

A heavy iron key that opens every door of the Archive's restricted collection. Gorduin Wynlar wears it on a chain and has never let it out of his sight.
```

The key goes in only when the entry **Gorduin Wynlar** is picked for the same reply, and never once **Archive Disappearance** is.

## 12. Its own place in the prompt

```markdown
---
tags:
  - lorebook
keys:
  - tide bell
position: in_chat
depth: 1
role: system
---

# The Tide Bell

When the tide bell rings in a waterfront tavern, everyone with something to hide stops talking and finds the back door.
```

`position` is `before`, `after` or `in_chat`; `depth` and `role` only matter with `in_chat`.

## 13. Not every time (cooldown, warmup, probability)

```markdown
---
tags:
  - lorebook
keys:
  - fog
  - harbor fog
cooldown: 5
warmup: 2
probability: 0.5
---

# Harbor Fog

Duskfrost fog rolls in off the water thick enough to hide the next lamp post. Sound carries strangely in it; footsteps seem to come from every side.
```

It needs its keys twice in the messages read (all keys counted together, so one "harbor fog" already counts twice), then goes in about half the time, then rests for 5 replies.

## 14. A common word as a key (refine keys)

```markdown
---
tags:
  - lorebook
keys:
  - the Crown
  - Angel Crown
refine_keys:
  - artifact
  - relic
  - pre-Calamity
selective_logic: and_any
---

# Angel Crown

A pre-Calamity crown kept in the Oracles of Might's vault. Scholars argue whether it amplifies sigil-work or simply remembers it.
```

"the Crown" alone is not enough; one of the refine keys must appear too. Other `selective_logic` values: `and_all`, `not_all`, `not_any`.

## 15. Entries that come along (cascade links)

```markdown
---
tags:
  - lorebook
keys:
  - Oracles of Might
  - the Oracles
cascade_links:
  - Bellsummit
  - Duskfrost Academy
---

# Oracles of Might

Duskfrost's foremost arcane research guild, headquartered in [[Bellsummit]] and bound by old agreements to the [[Duskfrost Academy]].
```

When this entry matches, **Bellsummit** and **Duskfrost Academy** come along without needing their own keywords.

## 16. Only in the right scene (field filters)

```markdown
---
tags:
  - lorebook
keys:
  - Corwin Velkhast
  - Corwin
era: renaissance
scene_type: social
character_present:
  - Corwin Velkhast
---

# Corwin Velkhast

The younger claimant to House Velkhast: polished, patient, and backed by the Solarguard. In company he never raises his voice; he lets others do it for him.
```

Once the chat has values for these fields (side panel **Filters** tab, or `/oq-set-era`, `/oq-set-scene`, `/oq-set-characters`), the entry goes in only when they match. See [[Custom Fields]].

## 17. An exact spot (outlet)

```markdown
---
tags:
  - lorebook
  - lorebook-always
keys:
  - harbor rules
outlet: harbor_rules
---

# Harbor Rules

On the piers, cargo belongs to whoever holds the manifest. Arguments are settled by the dockmaster, never by blades.
```

Put `{{outlet::harbor_rules}}` in your system prompt or character card. Always-send makes sure it is there every reply; without the tag it appears only when the entry is picked.
