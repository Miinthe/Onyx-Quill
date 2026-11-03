# Librarian (removed)

The Librarian (Emma) was removed from this fork on 2026-10-27 (shipped live, tag `live-2026-10-27`). Its code (`src/librarian/`), the reply takeover and agentic loop, the `search_lore` / `flag_lore` tools, Emma's session and review pop-up, the Librarian tab and its action-row buttons, the in-message tool dropdown, `/oq-librarian`, its settings tab, setup-wizard page 6 (the wizard has 8 pages now) and its prompts are all gone.

What it used that survived moved to the co-writer Mero ☆ (side panel → Mero tab):

- **Lore gaps** moved unchanged to `src/lore-gaps.js`. Mero shows them as her requests (`src/mero-window.js`), and the board's "Write a new entry…" marks one written (`src/board-window.js`). Nothing flags new gaps anymore (only the reply takeover did that); the ones already saved in a chat stay.
- **Entry ideas** come from Mero.
- Settings version 6 quietly drops every `librarian*` key except the writing-guide tag; version 7 (2026-11-02) renames that one to `guideTag`.

For Mero, see `docs/storyboard/10 co-writer design.md`.

This file stays so old links don't break.
