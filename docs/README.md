# DLE Code-Level Internals Docs

These docs explain **how the code works** — call graphs, data flows, state mutations, and cross-module contracts. They are for Claude Code sessions, not end users. The wiki covers user-facing docs.

**Always read `gotchas.md` before modifying pipeline, state, or lifecycle code.**

## Routing Table

| Change area | Read first |
|---|---|
| `onGenerate`, interceptor, prompt commit | [generation-pipeline.md](generation-pipeline.md) |
| State variables, `CHAT_CHANGED`, observers | [state-and-lifecycle.md](state-and-lifecycle.md) |
| Obsidian fetch, index build, cache, BM25 | [vault-and-indexing.md](vault-and-indexing.md) |
| AI search, connection routing, circuit breaker | [ai-subsystem.md](ai-subsystem.md) |
| Editable prompts (Prompts tab, override resolver, delete cage) | [editable-prompts.md](editable-prompts.md) |
| Pipeline stages, gating, field definitions | [stages-and-gating.md](stages-and-gating.md) |
| Scribe, Notebook, Graph, Cartographer | [secondary-features.md](secondary-features.md) |
| Pre-change safety check (always) | [gotchas.md](gotchas.md) |
| Storyboard engine, trackers, the board window, the Cast | [storyboard/9 storyboard as built.md](storyboard/9%20storyboard%20as%20built.md) (written from the code; the rest of `storyboard/` is the design record and the roadmap) |

## This fork (dev/board-model)

This fork adds a lot on top of upstream DeepLore 2.6.2. The docs above describe the shared engine; most of them were written before the fork's UI overhaul, so where they name a drawer tab or the old settings popup, read it as the code underneath (those renderers still run, hidden) and check the new UI files below.

| Area | Where |
|---|---|
| Shared UI parts (buttons, rows, folds, menus, windows, icons, theme bridge, old pop-ups in the new look) | `src/kit/` (`kit.js`, `icons.js`, `theme.js`, `legacy-skin.js`) |
| Side panel frame: header, Ready pop-up, tab row, ⋯ menu, lock, left / right | `src/drawer/drawer-frame.js` (the old drawer DOM in `drawer.html` / `src/drawer/` stays in the page, hidden, and still feeds the new views) |
| Side panel tabs Lore · Filters · Story · Cast · Mero, and the Ready view | `src/panel/` (`lore-view.js`, `filters-view.js`, `story-view.js`, `cast-view.js`, `mero-view.js`, `ready-view.js`, each with a `*-pure.js`) |
| The DeepLore bar above the message box | `src/bar/bar.js`, `src/bar/bar-pure.js`; the floating icon drawer on it (other extensions' floating icons in a tab: detection, pointer hand-off): `src/bar/icon-drawer.js`, `src/bar/icon-drawer-pure.js` |
| The DeepLore mark on each message (Why these entries, What this changed, …) | `src/reply-menu.js`; Guided swipe + Compare swipes: `src/guided-swipe.js`, `src/guided-swipe-pure.js` |
| The settings window | `src/settings/` (`settings-pure.js` lists every section and row; `src/ui/settings-ui.js` `openSettingsPopup()` opens it and falls back to the old popup if it fails) |
| The board window | `board/board.html`, opened by `src/board-window.js`; storage `src/board-store.js`, live chat state `src/board-live.js` |
| Trackers and the engine | `src/trackers.js`, `src/trackers-pure.js`, `src/autotrack.js`, `src/storyboard-pure.js`, `src/board-model-pure.js`, plus `collections-pure.js`, `places-pure.js`, `state-pure.js`, `meters-pure.js`, `forks-pure.js`, `conditions-pure.js`, `rolls-pure.js` |
| The Cast (NPCs with their own messages) | `src/cast.js`, `src/cast-pure.js` (incl. ties: `normTie`, the director's `ties`, `castLines`), `src/cast-queue.js`, `src/cast-voice.js`, `src/cast-voice-pure.js`, `src/cast-tab.js`; the side panel's view incl. the Ties fold: `src/panel/cast-view.js` |
| Mero ☆, the co-writer | `mero/mero.html` (her page), `src/mero-window.js` (host bridge), `src/mero.js`, `src/mero-pure.js`, `src/mero-lore.js`, `src/pitches.js`, `src/requests.js`; other parts add lines to her author's-notes block through `addWriterSink` in `mero.js` (the slop guard, a guided swipe); 🎲 games: `src/games/` |
| The slop guard (phrase list, learning by counting, underlines, ✎ Rewrite on a selection) | `src/slop.js`, `src/slop-pure.js` (store `extension_settings.deeplore_slop`) |
| Run cleanup (after a run's last chat is deleted; Settings › Vault) | `src/run-cleanup.js`, `src/run-cleanup-pure.js` |

Tests for these live in `test/` next to the older ones (`npm run test:all`).

After reading a doc, verify your understanding against the actual code — docs may lag behind recent changes.
