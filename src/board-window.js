/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — the storyboard window inside SillyTavern (stage 2).
 *
 * The window is the frozen mock-up (`board/board.html`), opened full-screen in an iframe
 * over SillyTavern so its styles can't clash with ST's. On opening it asks this file for
 * the real data (window.__dleBoardHost.load) instead of its toy example; Save calls back.
 *
 * STORAGE (engine on v2, step 5 — one board store):
 *   extension_settings.onyxquill_storyboards.boards[name] = { board: v2 }   — every board (board-store.js); the old
 *   extension_settings.deeplore_storyboards is no longer written (kept as a backup)
 *   chat_metadata.deeplore_board_state                       = v2 chat state        — collections, places, forks…
 *   chat_metadata.deeplore_trackers                          = v1 list              — the engine's older list (since
 *                                                                                      step 7 the v2 state is the truth)
 * Shapes and conversions: board-window-pure.js.
 */
import { setupPrompt, parseSetup, SETUP_SCHEMA } from './world/setup-pure.js';   // the world layer's ☆ Set up with Mero (stage 6)
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, saveMetadataDebounced, extension_settings } from '../../../../extensions.js';
import { vaultIndex, setIndexTimestamp } from './state.js';
import { askBeforeRemoving, setAskBeforeRemoving, getSettings, resolveConnectionConfig } from '../settings.js';   // overhaul step 4: one "Ask before removing" switch
import { buildIndex } from './vault/vault.js';   // the re-read after a save (what /oq-refresh does)
import { escapeHtml } from '../../../../utils.js';
import { BOARD_KEY, noteRename } from './storyboard-pure.js';
import { boardStore, getBoard, putBoard } from './board-store.js';   // engine on v2, step 5: one board store
import { TRACKERS_KEY, asList } from './trackers-pure.js';
import { saveTrackers, currentBoardName, setCharacterBoard, characterBoardName, detachBoard, notifyTrackersView, getTrackers, deleteBoard } from './trackers.js';
import { normalizeState, freshState, fromEngineList, toEngineList } from './board-model-pure.js';
import { syncLiveLocation, worldChatPaused, setWorldPaused } from './board-live.js';   // places: here → DeepLore's location filter; the world's pause in this chat
import { toWindowBoard, fromWindowBoard, toWindowChat, fromWindowChat, withVaultLinks, journalWindowMoves, timelineEvents } from './board-window-pure.js';
// LOCAL PATCH (Miinthe, 2026-10-04): creating an entry right from the board
import { runStampYaml } from './ai/run-stamp-pure.js';
import { writeEntry } from './board-grow.js';
// overhaul (2026-10-17): "Write a new entry…" from the bar opens this window straight into its entries window, filed by
// the new-entry rules (Settings › Story & memory › New entries); ☆ Mero on the board (one AI call per button press)
import { chatStatus } from './characters.js';
import { foldersByType, entryMarks } from './new-entry-pure.js';
import { ENTRY_TYPES } from './board-entry-pure.js';
import { callAI } from './ai/ai.js';
import { meroSettings, meroWhere, meroConnectionName, boardMeroAnswer, meroLore } from './mero.js';
import { BOARD_MERO_TASKS, buildBoardMeroPrompt, parseBoardMero, meroBoardBlock, boardHandover } from './board-mero-pure.js';
import { STARTER_TEMPLATES } from './board-templates-pure.js';
import { meroNames } from './mero-names-pure.js';

export { V2_KEY } from './board-store.js';
export const STATE_KEY = 'deeplore_board_state';
export const PREFS_KEY = 'onyxquill_board_prefs';       // the window's own settings (theme), same on every device

function prefs() {
    const p = extension_settings[PREFS_KEY];
    extension_settings[PREFS_KEY] = p && typeof p === 'object' ? p : {};
    return extension_settings[PREFS_KEY];
}
function setPref(key, value) { prefs()[key] = value; saveSettingsDebounced(); }
/**
 * Is SillyTavern's own theme dark? Read from its text colour (light text = dark theme) —
 * what Miinthe sees, unlike the device setting, which can say "light" under a dark ST theme.
 */
export function stIsDark() {
    try {
        const css = getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyColor').trim() || getComputedStyle(document.body).color;
        const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (!m) return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        const [r, g, b] = m.slice(1, 4).map(Number);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
    } catch { return false; }
}
/** The window's background while it loads, so a dark board doesn't flash white. */
function frameBackground() {
    const t = prefs().theme;
    const dark = t === 'dark' || (t !== 'light' && stIsDark());
    return dark ? '#1b1f29' : '#f4f5f8';
}

/** Every board (engine on v2, step 5: one store — board-store.js; edits from the Story tab are already in it). */
function allBoards() {
    const out = {};
    for (const name of Object.keys(boardStore().boards)) { const b = getBoard(name); if (b) out[name] = withVaultLinks(b, vaultIndex); }
    return { boards: out, changed: [] };
}

const first = v => (Array.isArray(v) ? v[0] : v) || '';
function lastMessageIndex() { const c = getContext()?.chat; return Array.isArray(c) && c.length ? c.length - 1 : 0; }
function chatLabel() { return getContext()?.getCurrentChatId?.() || 'This chat'; }
function charLabel() {
    const ctx = getContext();
    if (ctx?.groupId) return null;
    const name = ctx?.characters?.[ctx?.characterId]?.name;
    return name ? `${name} (character)` : null;
}

/** This chat's v2 state for `board`: the stored one, with the engine's latest positions read in. */
function chatState(board) {
    const stored = chat_metadata?.[STATE_KEY];
    const base = stored && currentBoardName() === board.name ? normalizeState(stored, board) : freshState(board);
    if (stored?.stepsRebuilt) return base;   // engine on v2, step 7: the v2 state is the truth (the stored list is old)
    return currentBoardName() === board.name ? fromEngineList(board, base, asList(chat_metadata?.[TRACKERS_KEY])) : base;
}

function vaultList() {
    return (vaultIndex || []).map(e => ({ title: e.title, folder: e.folderPath ? `${e.folderPath}/` : '', summary: e.summary || '' }));
}
function linkMap() {
    const out = {};
    for (const e of vaultIndex || []) if (Array.isArray(e.links) && e.links.length) out[e.title] = [...new Set(e.links)];
    return out;
}
/** The vault's folders as the window's tree: { name, kids, value }. */
function folderTree() {
    const root = { name: 'Vault', kids: [] };
    for (const e of vaultIndex || []) {
        if (!e.folderPath) continue;
        let node = root, path = '';
        for (const part of e.folderPath.split('/').filter(Boolean)) {
            path += part + '/';
            let k = node.kids.find(x => x.name === part);
            if (!k) { k = { name: part, kids: [], value: path }; node.kids.push(k); }
            node = k;
        }
    }
    const sort = n => { n.kids.sort((a, b) => a.name.localeCompare(b.name)); n.kids.forEach(sort); if (!n.kids.length) delete n.kids; };
    sort(root);
    return root;
}

let frame = null;
let pendingSelect = null;   // a row to open the window at (Story tab → a collection)
let pendingAdd = false;   // open straight into the Add window (Story tab → New tracker, overhaul 2026-10-16)
let pendingEntry = null;   // "Write a new entry…" (bar 📖): { title?, ask? } — the window opens on it alone
let pendingView = null;   // open on a view: 'time' (Story → Timeline, Miinthe 2026-10-16)

/** What the window asks for when it opens. */
function load() {
    const { boards, changed } = allBoards();
    const chat = chatLabel(), ch = charLabel();
    let current = currentBoardName(), unsaved = false;
    if (!current || !boards[current]) {
        unsaved = true;
        // no board here yet: a new, empty one named after the chat (saved only when Miinthe saves)
        current = ch ? ch.replace(/ \(character\)$/, '') : chat;
        while (boards[current]) current += ' (new)';
        boards[current] = fromWindowBoard({ name: current, trackers: [], folders: [] }, current);
    }
    for (const [name, b] of Object.entries(boards)) {
        const applied = new Set(b.applied || []);
        if (name === currentBoardName()) applied.add(chat); else applied.delete(chat);
        if (ch) { if (characterBoardName() === name) applied.add(ch); else applied.delete(ch); }
        b.applied = [...applied];
    }
    const board = boards[current];
    const out = {
        boards: Object.fromEntries(Object.entries(boards).map(([n, b]) => [n, toWindowBoard(b)])),
        current, chat, unsaved,   // the window marks a made-up board "not saved yet" (Open…, Delete board…)
        bag: toWindowChat(board, chatState(board)),
        // this chat's real history for the Timeline (round "timeline + lanes", 2026-10-04)
        timeline: currentBoardName() === current ? timelineEvents(board, getTrackers(), chatState(board)) : [],
        targets: [...(ch ? [ch] : []), chat],
        run: first(chat_metadata?.deeplore_context?.instance).toUpperCase() || 'A',
        // what a new entry is stamped with (the run stamp — Auto Lorebook does the same)
        stamp: runStampYaml(chat_metadata?.deeplore_context, ['character', 'instance']).replace(/^date: .*\n?/m, ''),
        vault: vaultList(), links: linkMap(), tree: folderTree(),
        changed,
        select: pendingSelect,
        add: pendingAdd,
        view: pendingView,
        entry: pendingEntry,
        newEntry: newEntryRules(chat),
        mero: meroStatus(),
        // the character cards an NPC can be (the Cast, 2026-10-13): name + avatar file, as SillyTavern lists them
        cards: (getContext()?.characters || []).map(c => ({ name: c.name, avatar: c.avatar })).filter(c => c.avatar),
        mainName: getContext()?.groupId ? '' : (getContext()?.name2 || ''),
        userName: getContext()?.name1 || '',   // the persona's name where the board shows {{user}} (Miinthe: never a bare macro)
        mainCard: getContext()?.groupId ? '' : (getContext()?.characters?.[getContext()?.characterId]?.avatar || ''),   // the World tab's pictures   // the world layer's "who can write first" (2026-10-19)
        // planned messages already sent (or a chance missed) in this chat — the World tab shows each plan's status
        // the World tab's overview of this chat (Miinthe, 2026-10-19: "the main space is like strangely empty")
        worldSummary: (() => {
            const recs = Array.isArray(chat_metadata?.deeplore_world?.records) ? chat_metadata.deeplore_world.records : [];
            const posts = recs.filter(r => r?.kind === 'post'), msgs = recs.filter(r => r?.kind === 'msg'), by = {};
            for (const r of [...posts, ...msgs]) { const k = r.by || r.from; if (k && k !== 'user') by[k] = (by[k] || 0) + 1; }
            return {
                stories: recs.filter(r => r?.kind === 'wstory').map(s => ({ title: s.title, at: Number(s.at) || 0, n: (s.phases || []).length, next: (s.phases || [])[Number(s.at) || 0] || '' })),
                posts: posts.length, msgs: msgs.length, unread: msgs.filter(m => m.to === 'user' && !m.read).length,
                // posts AND messages, newest first, up to 15 — the card shows 3 and folds out the rest (Miinthe, 2026-11-04: "should show more than just 3 messages, maybe make it expandable")
                recent: recs.filter(r => r?.kind === 'post' || r?.kind === 'msg').slice(-15).reverse().map(r => r.kind === 'msg'
                    ? { kind: 'msg', by: r.from, to: r.to, you: r.to === 'user', unread: r.to === 'user' && !r.read, text: String(r.text || '').slice(0, 140) }
                    : { kind: 'post', by: r.by, text: (r.title ? r.title + ': ' : '') + String(r.text || '').slice(0, 140) }),
                counts: by,   // posts + messages per person — the activity bar on each person (World tab v2, 2026-11-04)
                busiest: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4),
                // stage 5: the rumors going around and who heard them (the poster behind the account stays hidden)
                rumors: posts.filter(p => p.rumor && typeof p.rumor === 'object').slice(-4).reverse().map(p => ({ kind: ({ true: 'True', twisted: 'Twisted', madeup: 'Made up', planned: 'Planned' })[p.rumor.kind] || 'Rumor', text: String(p.text || '').slice(0, 120), heard: Array.isArray(p.rumor.heard) ? p.rumor.heard.slice(0, 8) : [] })),
            };
        })(),
        worldPaused: worldChatPaused(),   // this chat's own world pause (undefined: never set here — the board's old flag counts)
        worldFired: Object.fromEntries((chat_metadata?.deeplore_world?.records || []).filter(r => r?.kind === 'fired' && r.plan).map(r => [r.plan, { i: r.i, hit: r.hit !== false }])),
        prefs: { ...prefs() },
        templates: STARTER_TEMPLATES,   // the built-in starter templates of New board (board-templates-pure.js, 2026-11-02)
        askBeforeRemoving: askBeforeRemoving(),   // overhaul step 4: Edit ▸ Ask before removing = the setting in Settings → Interface
        stDark: stIsDark(),
    };
    return JSON.parse(JSON.stringify(out));
}

/** Where a new entry is filed here (by its kind) and its marks — the rules in Settings › Story & memory › New entries. */
function newEntryRules(chat) {
    const s = getSettings();
    let base = [], run = [];
    try { const cs = chatStatus(); base = cs.setup?.folders || []; run = cs.run ? cs.setup?.runs?.[cs.run]?.folders || [] : []; } catch { /* no character */ }
    return {
        byType: foldersByType({ mode: s.newEntryPlacement, target: s.autoSuggestFolder, base, run }, ENTRY_TYPES),
        mark: s.newEntryMark !== false,
        from: entryMarks({ chat, message: Math.max(0, (getContext()?.chat || []).length - 1) }).from || '',
    };
}

/** ☆ Mero on the board: may she help now (her job, her connection), and on which AI. */
function meroStatus() {
    const st = meroSettings();
    let connected = false;
    try { connected = !!resolveConnectionConfig('mero').profileId; } catch { /* no connection */ }
    return { job: st.job, signoff: st.signoff !== false, connection: meroConnectionName(), block: meroBoardBlock({ job: st.job, connected }) };
}

let meroAsking = false;
/**
 * One question to Mero from the board (board-mero-pure.js has the jobs). One AI call, on her own connection; the answer
 * goes back to the window only — nothing is written. Returns { ok, … } or { ok: false, error }.
 */
async function meroAsk(task, input) {
    if (!BOARD_MERO_TASKS.includes(task)) return { ok: false, error: 'unknown job' };
    const status = meroStatus();
    if (status.block) return { ok: false, error: status.block };
    if (meroAsking) return { ok: false, error: 'Mero is still answering the last one' };
    const inp = JSON.parse(JSON.stringify(input ?? {}));
    if (task === 'draft') {   // the linked entries' own words, so her draft fits them
        inp.entries = (Array.isArray(inp.linked) ? inp.linked : []).slice(0, 4).map(t => (vaultIndex || []).find(e => e.title === t)).filter(Boolean).map(e => ({ title: e.title, text: e.content || e.summary || '' }));
    }
    const st = meroSettings();
    const me = { persona: st.persona, character: meroWhere().character, names: meroNames(st) };
    meroAsking = true;
    try {
        // her talk on the board looks things up like her talks do (Miinthe, 2026-11-04) — the lookups show above her answer
        if (task === 'talk') {
            // what she is pointed at comes along up front, no AI call (only entries this story may read)
            const lore = meroLore(), mine = new Map(); for (const e of lore.entries) if (!mine.has(e.title)) mine.set(e.title, e);
            const quickKey = typeof inp.quick === 'string' ? inp.quick : null;
            // for Find gaps: this story's entries no tile links — the board's folders first (no AI call)
            let unlinked = [];
            if (quickKey === 'gaps') {
                const linked = new Set((inp.brief?.trackers || []).flatMap(t => [...(t.steps || []), ...(t.tiles || [])].flatMap(s => s.entries || [])));
                const dirs = (inp.brief?.folders || []).map(f => String(f).replace(/\/+$/, '')).filter(Boolean);
                const inBoard = e => dirs.some(d => e.folderPath === d || String(e.folderPath || '').startsWith(d + '/'));
                const loose = [...mine.values()].filter(e => !linked.has(e.title) && !e.constant);
                unlinked = dirs.length ? loose.filter(inBoard) : loose;
            }
            const h = boardHandover(inp.brief, inp.message || '', quickKey, t => mine.get(t) || null, 9000, unlinked);
            const a = await boardMeroAnswer(lookups => buildBoardMeroPrompt(task, { ...inp, lookups, handover: h.text }, me));
            const out = parseBoardMero(task, a.text, { ...inp, known: [...mine.keys()] });   // a link names an entry that exists
            const handed = [...(h.n ? [{ label: `📖 Handed to her: ${h.n} entr${h.n > 1 ? 'ies' : 'y'}${h.full ? '' : ' (their summaries)'}` }] : []), ...(h.loose ? [{ label: `📖 Handed to her: ${h.loose} entr${h.loose > 1 ? 'ies' : 'y'} no tile links yet` }] : [])];
            const steps = [...handed, ...a.steps];
            return out.ok && steps.length ? { ...out, steps } : out;
        }
        const { system, user } = buildBoardMeroPrompt(task, inp, me);
        const r = await callAI(system, user, { ...resolveConnectionConfig('mero'), caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
        return parseBoardMero(task, r?.text ?? '', inp);
    } catch (err) {
        console.warn('[Onyx Quill] Mero on the board could not answer:', err?.message || err);
        return { ok: false, error: `Mero could not answer: ${err?.message || err}` };
    } finally { meroAsking = false; }
}

let worldSettingUp = false;
/**
 * ☆ Set up with Mero (world layer stage 6, Miinthe 2026-10-18: "describe it to Mero; she suggests voices and style; Miinthe approves"):
 * one call on Mero's own connection, in her voice. Returns her proposal for the window to tick through — nothing is written.
 */
async function worldSetup(input) {
    const status = meroStatus();
    if (status.block) return { ok: false, error: status.block };
    if (worldSettingUp) return { ok: false, error: 'Mero is still thinking about the last one.' };
    const ctx = getContext(), chars = ctx?.characters || [];
    const about = card => { const ch = card ? chars.find(c => c.avatar === card) : null; return ch ? [ch.description || ch.data?.description, ch.personality || ch.data?.personality].filter(Boolean).join('\n') : ''; };
    const main = !ctx?.groupId && ctx?.characters?.[ctx?.characterId] ? ctx.characters[ctx.characterId] : null;
    const people = [...(main ? [{ key: 'main', name: main.name, about: about(main.avatar) }] : []), ...(input?.cast || []).map(c => ({ key: c.key, name: c.name, about: about(c.card) }))];
    const { system, user } = setupPrompt({ persona: meroSettings().persona, user: ctx?.name1 || 'User', storyName: input?.storyName || 'the story', about: input?.about || '', setting: input?.setting || '', people, existing: input?.existing || [], look: input?.look || 'phone' });
    worldSettingUp = true;
    try {
        const conn = resolveConnectionConfig('mero');
        const r = await callAI(system, user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 2500), caller: 'mero', skipThrottle: true, jsonSchema: SETUP_SCHEMA, disableThinkingOnClaude: true });
        const s = parseSetup(r?.text, people);
        return s ? { ok: true, ...s, names: Object.fromEntries(people.map(p => [p.key, p.name])) } : { ok: false, error: 'Mero\'s answer came back unreadable. Try again.' };
    } catch (err) { return { ok: false, error: `Mero couldn't answer: ${err?.message || err}` }; }
    finally { worldSettingUp = false; }
}

/**
 * "Write a new entry…" — Create in the window: one new file, written now (Miinthe pressed Create), never over an existing
 * one.
 */
async function createEntry(form) {
    const r = await writeEntry(form, { reindex: true });
    if (r.ok) { try { toastr.success(`“${escapeHtml(form.title)}” is in your vault: ${escapeHtml(r.filename)}${form.madeBy ? ' (marked as Mero’s draft)' : ''}.`, 'New entry', { escapeHtml: false }); } catch { /* noop */ } }
    return JSON.parse(JSON.stringify(r));
}

/** Save board `name` from the window; `bag` is the window's place for this chat (or null). */
function save(name, doc, bag) {
    const board = fromWindowBoard(doc, name);
    board.name = name;
    putBoard(name, board);
    const usesIt = currentBoardName() === name || board.applied.includes(chatLabel());
    if (usesIt && bag) {
        // a chat moving onto this board from another: its stored engine list is the old board's (or from before the chat
        // was converted), and the v2 log would be rebuilt from it — positions from that list came back (hunt 2, 2026-11-03)
        const was = currentBoardName();
        if (was !== name) chat_metadata[TRACKERS_KEY] = toEngineList(board, freshState(board), []);
        chat_metadata[BOARD_KEY] = name;
        // the chat's stored state only if it was this board's (read before the name above was set, it always looked so:
        // another board's log, rolls and positions came along — hunt 2, 2026-11-03)
        const old = chat_metadata?.[STATE_KEY] && was === name ? chat_metadata[STATE_KEY] : null;
        const st = fromWindowChat(board, bag, old);
        // engine on v2: the step trackers' new places reach the v2 state through the list (saveTrackers), so a move made
        // here is logged like a move by hand and a delete rolls it back; everything else the window sets is stored now
        chat_metadata[STATE_KEY] = old && st.v2steps ? { ...st, trackers: normalizeState(old, board).trackers } : st;
        // the engine's list: positions from the window, journal and memory kept; a move made in the window is journalled
        // (from the list as the engine reads it — with its starting point, else the first move had none to go back to)
        const prevList = getTrackers();
        saveTrackers(journalWindowMoves(toEngineList(board, st, prevList), prevList, lastMessageIndex()));
        try { syncLiveLocation(); } catch { /* no place tracker */ }
        saveMetadataDebounced();
    }
    applyTargets(name, board.applied);
    notifyTrackersView();
    refreshVault();
    return { ok: true };
}

/** Use / stop using `name` for this chat and the character, as picked in "Apply to…". */
function applyTargets(name, picked) {
    const chat = chatLabel(), ch = charLabel();
    if (!boardStore().boards[name]) return;               // not saved yet: applied on save
    if (picked.includes(chat) && currentBoardName() !== name) {
        const board = getBoard(name) || fromWindowBoard({ trackers: [] }, name);
        chat_metadata[BOARD_KEY] = name;
        chat_metadata[STATE_KEY] = freshState(board);
        // a fresh list too, as New Run does: the stored one is the old board's (or from before the chat was converted),
        // and the v2 log is rebuilt from it — its positions came back on the newly applied board (hunt 2, 2026-11-03)
        chat_metadata[TRACKERS_KEY] = toEngineList(board, chat_metadata[STATE_KEY], []);
        saveMetadataDebounced();
    } else if (!picked.includes(chat) && currentBoardName() === name) detachBoard();
    if (ch) {
        if (picked.includes(ch)) setCharacterBoard(name);
        else if (characterBoardName() === name) setCharacterBoard(null);
    }
    // one board per chat / character: taken off the board it used before, so that one's "Used in" no longer lists it
    // (Miinthe 2026-10-18: her test chat stayed listed on "Toaster" after "Toaster & Kettle" was applied to it)
    let moved = false;
    for (const [n, rec] of Object.entries(boardStore().boards)) {
        if (n === name || !Array.isArray(rec?.board?.applied)) continue;
        const keep = rec.board.applied.filter(x => !(x === chat && picked.includes(chat)) && !(ch && x === ch && picked.includes(ch)));
        if (keep.length !== rec.board.applied.length) { rec.board.applied = keep; moved = true; }
    }
    if (moved) saveSettingsDebounced();
}

/** Delete board `name` (the window's Board ▸ Delete board…; it asked first). */
function remove(name) {
    const r = deleteBoard(name);
    if (r.ok) refreshVault();
    return r;
}

function rename(from, to) {
    const s = boardStore();
    if (s.boards[from]) { s.boards[to] = { ...s.boards[from], board: { ...s.boards[from].board, name: to } }; delete s.boards[from]; }   // Mero's summary moves along
    noteRename(s, from, to);   // other chats using it follow on opening (trackers.js syncBoardOnOpen)
    for (const [k, v] of Object.entries(s.characters)) if (v === from) s.characters[k] = to;
    saveSettingsDebounced();
    if (currentBoardName() === from) { chat_metadata[BOARD_KEY] = to; saveMetadataDebounced(); }
    notifyTrackersView();
}

function close() {
    frame?.remove();
    frame = null;
    document.body.classList.remove('dle-board-open');
    holdPage(false);
}

// A scrollIntoView inside the window also scrolls SillyTavern's own page (the window is fixed to that page), which slid the
// whole board off the left of the screen until a reload (bug hunt 2026-10-17). While the window is open, the page stays put.
let held = null;
function holdPage(on) {
    const pe = document.scrollingElement || document.documentElement;
    if (held) { window.removeEventListener('scroll', held, true); held = null; }
    if (!on) return;
    const x = pe.scrollLeft, y = pe.scrollTop;
    held = () => { if (pe.scrollLeft !== x || pe.scrollTop !== y) { pe.scrollLeft = x; pe.scrollTop = y; } };
    window.addEventListener('scroll', held, true);
}

/** An error inside the window: a notice in SillyTavern and a line in the browser console. */
function report(msg) {
    console.error('[Onyx Quill] board window:', msg);
    try { toastr.error(String(msg).split('\n')[0], 'Storyboard window', { timeOut: 0, extendedTimeOut: 0, closeButton: true }); } catch { /* noop */ }
}

/**
 * The board's new entries, written when Miinthe saves the board (Miinthe, 2026-10-05: nothing touches the vault before
 * Save). Each a new file, never over an existing one (board-grow.js writeEntry); the vault is re-read once, after
 * the board is saved. Returns [{ title, ok, filename?, error? }].
 */
async function writeEntries(list) {
    const out = [];
    for (const form of Array.isArray(list) ? list : []) {
        const r = await writeEntry(form, { reindex: false });
        out.push({ title: form.title, ok: !!r.ok, ...(r.ok ? { filename: r.filename } : { error: r.error || 'not written' }) });
    }
    return out;
}

/** After every board save: re-read the vault, as /oq-refresh does (Miinthe, 2026-10-05), in the background. */
function refreshVault() {
    try { setIndexTimestamp(0); } catch { /* noop */ }
    buildIndex().then(() => notifyTrackersView()).catch(err => console.warn('[Onyx Quill] re-reading the vault after a board save failed:', err?.message || err));
}

/** The Timeline's "Go to message #": close the window and scroll the chat there. */
function goto(m) {
    close();
    const el = document.querySelector(`#chat .mes[mesid="${Number(m)}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else try { toastr.info(`Message #${Number(m)} isn't loaded in the chat — scroll up or load more messages.`, 'Storyboard'); } catch { /* noop */ }
}

/** The board's "Open in the Cast tab" (2026-10-13): close the window, open DeepLore's Cast tab (at that person). */
function openCast(personKey) {
    close();
    try { window.__dleOpenCast?.(personKey || null); } catch { /* noop */ }
}

/** The World tab's pause switch: this chat only, at once (Miinthe, 2026-11-05). The World panel and the bar follow. */
function worldPause(on) {
    const ok = setWorldPaused(on);
    if (ok) notifyTrackersView();
    if (ok && !on) import('./world/world.js').then(m => m.wakeWorld()).catch(err => console.warn('[Onyx Quill] world: wake', err));   // answer what waited
    return ok;
}

window.__dleBoardHost = { load, save, rename, remove, apply: (name, picked) => { applyTargets(name, picked); notifyTrackersView(); }, close, report, setPref, writeEntries, goto, openCast, setAskBeforeRemoving, meroAsk, meroStatus, createEntry, worldSetup, worldPause };

/**
 * Open the board window over SillyTavern; `select` opens it at that row (a tracker or collection id), `add` straight
 * into its Add window, `entry` (true or { title, ask }) on its entries window alone: "Write a new entry…".
 */
export async function openBoardWindow({ select = null, add = false, view = null, entry = null } = {}) {
    if (frame) return;
    pendingSelect = select;
    pendingAdd = !!add;
    pendingView = view;
    pendingEntry = entry ? { ...(typeof entry === 'object' ? entry : {}) } : null;
    if (!getContext()?.getCurrentChatId?.()) { try { toastr.info(entry ? 'Open a chat first — a new entry is stamped with its chat and run.' : 'Open a chat first — the board shows where that chat stands.', entry ? 'New entry' : 'Storyboard'); } catch { /* noop */ } return; }
    // The window shows the vault's entries and folders: make sure DeepLore has read the vault.
    if (!(vaultIndex || []).length) {
        try { toastr.info('Reading the vault first…', 'Storyboard', { timeOut: 2500 }); } catch { /* noop */ }
        try { await (await import('./vault/vault.js')).ensureIndexFresh(); } catch { /* open with what there is */ }
        if (frame) return;
    }
    frame = document.createElement('div');
    frame.id = 'dle-board-window';
    // Size and layer set right here as well as in style.css: a browser still holding an older
    // style.css would otherwise drop the window as a small blank box at the bottom of the page.
    frame.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:40000;margin:0;padding:0;background:${frameBackground()}`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'border:0;width:100%;height:100%;display:block';
    iframe.title = entry ? 'New entry' : 'Storyboard';
    iframe.src = `${new URL('../board/board.html', import.meta.url).href}?v=${Date.now()}`;   // never an old cached copy
    frame.appendChild(iframe);
    document.body.appendChild(frame);
    document.body.classList.add('dle-board-open');
    holdPage(true);
    iframe.addEventListener('load', () => { try { iframe.contentWindow.focus(); } catch { /* noop */ } });
}

/** For tests: the pieces without the window. */
export const _host = { load, save, rename, allBoards };
