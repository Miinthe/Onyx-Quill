/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆, the co-writer: SillyTavern glue.
 * Rules: mero-pure.js (tested). Design: `10 co-writer design.md`. The tab itself is mero/mero.html (the approved
 * mock-up v13, in host mode), mounted by mero-window.js.
 *
 * Storage:
 *   extension_settings.onyxquill_mero = { chars: { [avatar]: { talks } }, notes: { char, run, board }, settings }
 *   chat_metadata.deeplore_mero_notes = [notes for this chat]
 * Mero's AI connection is the pinned "Mero" profile in DeepLore's AI connections (no inherit).
 */
import { chat_metadata, saveSettingsDebounced, name1 } from '../../../../../script.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../../extensions.js';
import { resolveConnectionConfig, getSettings } from '../settings.js';
import { callAI } from './ai/ai.js';
import { meroNames } from './mero-names-pure.js';
import { vaultIndex, fieldDefinitions } from './state.js';
import { applyFolderFilter, applyContextualGating, buildExemptionPolicy } from './stages.js';
import { DEFAULT_FIELD_DEFINITIONS } from './fields.js';
import { currentCharacter, effectiveFolderFilter } from './characters.js';
import { runOf } from './characters-pure.js';
import { BOARD_KEY } from './storyboard-pure.js';
import { readActiveTrackers, readTrackers } from './trackers.js';
import { writerBlock, describe as describeTracker } from './trackers-pure.js';
import { peopleOf } from './world/messages-pure.js';
import { personNow } from './cast-pure.js';
import { liveWriterLines, liveStepJudgeSection, live } from './board-live.js';
import { GLOW_KEY, asGlow, glowNow, recentMoments, momentOpener } from './mero-glow-pure.js';
import { getCurrentForChat } from './verdict/verdict-store.js';
import {
    MERO_KEY, CHAT_NOTES_KEY, asStore, guidesIn, guidesText, normTalk, normNote, notesHere, inForce, hasRunOut, authorNotesBlock,
    splitOoc, buildMeroPrompt, askedForNote, parseMeroAnswer, fallbackTitle, scopeKey, WHERE_ARE_WE, CHATTY_PRESETS,
    askedForPitch, versionsOf, showVersion, addVersion, dropSwipes,
} from './mero-pure.js';
import { TOOL_DEFS, WEB_DEFS, WEB_TOOLS, MAX_TOOL_ROUNDS, MAX_LOOKUPS, argsOf, toolLabel, runTool, keptStep, passingError, handedLore } from './mero-tools-pure.js';
import { testPrimaryMatchOnly, clearScanTextCache } from '../core/matching.js';
import { webReady, runWebTool } from './mero-web.js';   // 🌐 (2026-11-03)
import { callWithTools, toolsPossible } from './ai/tool-call.js';
import { askAnswerText, answerAsks } from './ask-pure.js';
import { boardSummary, namedTrackers, trackerDetails, nowLine } from './mero-board-pure.js';
import { getMeroMap } from './board-store.js';
import { refreshMeroMap, editMeroMap } from './mero-map.js';
import { guess as playGuess } from './games/wordle-pure.js';
import { play as playFour, pickCol, replay as fourBoard } from './games/four-pure.js';
import { GAMES, TITLES, gameOf } from './games/games-pure.js';

const listeners = new Set();
/** The tab redraws when something changes (a talk, a note, Mero's answer). */
export function onMeroChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const changed = () => { for (const cb of listeners) { try { cb(); } catch { /* noop */ } } };

// ── storage ──────────────────────────────────────────────────────────────────

/** The store. Reading never creates anything in the settings (opening the tab leaves no trace); writing does. */
// Tidied once, then always the same object — handing out fresh copies would let a change land on a copy nobody saves.
const tidy = new WeakSet();
function storeW() {
    let s = extension_settings[MERO_KEY];
    if (!s || !tidy.has(s)) { s = extension_settings[MERO_KEY] = asStore(s); tidy.add(s); }
    return s;
}
function store() { return extension_settings[MERO_KEY] ? storeW() : asStore(null); }
function saveStore() { saveSettingsDebounced(); changed(); }
const chatNotes = () => (Array.isArray(chat_metadata?.[CHAT_NOTES_KEY]) ? chat_metadata[CHAT_NOTES_KEY] : []);
function setChatNotes(list) { chat_metadata[CHAT_NOTES_KEY] = list; saveMetadataDebounced(); changed(); }

/** Who and where: the character (talks live with it), the run, the board. */
export function meroWhere() {
    const c = currentCharacter();
    return { charKey: c?.key || '', character: c?.name || '', run: runOf(chat_metadata?.deeplore_context || {}), board: chat_metadata?.[BOARD_KEY] || '', chatId: getContext()?.getCurrentChatId?.() || '' };
}

/** The name of Mero's AI (her connection profile, Settings › AI & connections), or '' when none is picked. */
export function meroConnectionName() {
    const id = getSettings().meroProfileId;
    if (!id) return '';
    const p = (extension_settings?.connectionManager?.profiles || []).find(x => x.id === id);
    return p?.name || 'a profile';
}

const charBag = () => { const w = meroWhere(); if (!w.charKey) return null; const s = storeW(); return (s.chars[w.charKey] ||= { talks: [] }); };
export function meroTalks() { const w = meroWhere(); return (w.charKey && store().chars[w.charKey]?.talks) || []; }
const findTalk = id => meroTalks().find(t => t.id === id) || null;

// ── talks ──────────────────────────────────────────────────────────────────

export function newTalk(tag = 'yap') {
    const bag = charBag(); if (!bag) return null;
    const t = normTalk({ tag, title: 'A new talk' });
    bag.talks.unshift(t); saveStore(); return t;
}
export function updateTalk(id, patch) {
    const t = findTalk(id); if (!t) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) { t.title = patch.title.trim().slice(0, 80); t.mine = true; }
    if (patch.tag) { t.tag = patch.tag; t.tagMine = true; }   // she picked it: Mero's [[KIND]] no longer changes it
    if (patch.state) t.state = patch.state;
    t.updated = new Date().toISOString(); saveStore(); return t;
}
/** Delete a talk; its notes: 'keep' · 'archive' (ended) · 'delete' (Miinthe decides — design §3). */
export function deleteTalk(id, notesWhat = 'keep') {
    const bag = charBag(); if (!bag) return false;
    bag.talks = bag.talks.filter(t => t.id !== id);
    if (notesWhat !== 'keep') forEachNoteList((list, set) => set(notesWhat === 'delete' ? list.filter(n => n.from !== id) : list.map(n => (n.from === id ? { ...n, ended: true, on: false } : n))));
    saveStore(); return true;
}

// ── notes ──────────────────────────────────────────────────────────────────

/** Walk every list of notes Mero can see here (the chat's and the store's rungs for this chat). */
function forEachNoteList(fn) {
    const w = meroWhere(), s = storeW();
    fn(chatNotes().map(normNote).filter(Boolean), l => setChatNotes(l));
    for (const sc of ['run', 'char', 'board']) {
        const k = scopeKey(sc, w); if (!k) continue;
        fn((s.notes[sc][k] || []).slice(), l => { if (l.length) s.notes[sc][k] = l; else delete s.notes[sc][k]; saveStore(); });
    }
}

/** The chat as the note rules need it: where the next reply goes, and which messages are AI replies. */
function replyCtx(type = 'normal') {
    const chat = getContext()?.chat || [];
    const isAi = k => !!chat[k] && !chat[k].is_user && !chat[k].is_system;
    const swipe = type === 'swipe' && chat.length && isAi(chat.length - 1);
    return { replyIndex: swipe ? chat.length - 1 : chat.length, lastIndex: chat.length - 1, isAi };
}

/** Every note that applies here, with whether it is in force now and whether its time ran out. */
export function meroNotes() {
    const ctx = replyCtx();
    return notesHere(store(), chatNotes(), meroWhere()).map(n => ({ ...n, inForce: inForce(n, ctx), runOut: hasRunOut(n, ctx) }));
}

/** Keep a note (from Mero's card or by hand). Returns the note. */
export function addNote(fields, { from = null } = {}) {
    const w = meroWhere();
    const scope = fields.scope === 'run' && !w.run ? 'chat' : fields.scope === 'board' && !w.board ? 'chat' : fields.scope || 'chat';
    const n = normNote({ ...fields, scope, from, made: { i: (getContext()?.chat || []).length - 1, at: new Date().toISOString() } });
    if (!n) return null;
    if (scope === 'chat') setChatNotes([...chatNotes(), n]);
    else { const s = storeW(), k = scopeKey(scope, w); (s.notes[scope][k] ||= []).push(n); saveStore(); }
    return n;
}
/** Change a note in place (text, on/off, kind, how long, ended) — or move it to another rung (`scope`). */
export function updateNote(id, patch) {
    let found = null;
    forEachNoteList((list, set) => {
        const i = list.findIndex(n => n.id === id); if (i === -1 || found) return;
        found = { ...list[i] };
        if (patch.scope && patch.scope !== list[i].scope) { list.splice(i, 1); set(list); }
        else { list[i] = normNote({ ...list[i], ...patch }); set(list); found = null; }
    });
    if (found) {   // moved: same note, same id, on its new rung
        const w = meroWhere(), n = normNote({ ...found, ...patch });
        if (n.scope === 'chat') setChatNotes([...chatNotes(), n]);
        else { const s = storeW(), k = scopeKey(n.scope, w); if (k) { (s.notes[n.scope][k] ||= []).push(n); saveStore(); } }
    }
    changed();
}
export function removeNote(id) { forEachNoteList((list, set) => { if (list.some(n => n.id === id)) set(list.filter(n => n.id !== id)); }); }

// other parts add their own lines to the author's notes: the slop guard's 🚫 phrases, a guided swipe's 🧭 (2026-11-02)
const writerSinks = new Set();
/** fn(type) → [{ kind: 'dont'|'steer'|'fact', text }] for the reply being written. */
export function addWriterSink(fn) { writerSinks.add(fn); return () => writerSinks.delete(fn); }

/** Only the sinks' lines (guided swipe, slop guard) for the reply being written — an NPC's own voice gets these too (cast-voice.js). */
export function writerSinkLines(type = 'normal') {
    const out = [];
    for (const fn of writerSinks) { try { out.push(...(fn(type) || [])); } catch (err) { console.warn('[Onyx Quill] writer line skipped:', err?.message || err); } }
    return out;
}

/** The `[Author's notes]` block for the reply being written now (index.js, every generation). */
export function authorNotesForGeneration(type = 'normal') {
    try {
        const list = notesHere(store(), chatNotes(), meroWhere());
        // the writer's initiative (Mero's ☆ settings) rides along as a 🧭 steer; "balanced" says nothing
        const ini = INITIATIVE[store().settings.initiative];
        if (ini) list.unshift({ id: 'initiative', kind: 'steer', text: ini, story: true, last: 'pinned', scope: 'char', on: true, made: { i: -1 } });
        // 🪜 running plans: the current beat, as the plan says the writer sees it (pitches.js)
        for (const text of pitchSink?.writerLines?.() || []) list.push({ id: 'plan', kind: 'steer', text, story: true, last: 'pinned', scope: 'char', on: true, made: { i: -1 } });
        for (const fn of writerSinks) { try { for (const x of fn(type) || []) list.push({ id: 'sink', kind: x.kind, text: x.text, story: true, last: 'pinned', scope: 'char', on: true, made: { i: -1 } }); } catch (err) { console.warn('[Onyx Quill] writer line skipped:', err?.message || err); } }
        return authorNotesBlock(list, replyCtx(type));
    } catch (err) { console.warn('[Onyx Quill] Mero notes skipped:', err?.message || err); return ''; }
}
/** The initiative dial, as the writer is told it (2 = balanced: nothing). */
export const INITIATIVE = [
    'Follow the user\'s lead. Do not start new events or have characters act on their own agenda; react to what the user does.',
    'Mostly follow the user\'s lead; small touches of your own are fine (a gesture, a remark), no new events.',
    '',
    'Bring events: let characters pursue their own goals and act unasked now and then; let the world move on its own.',
    'Take the wheel often: surprises, interruptions, characters acting on their own agendas — keep the story moving without waiting for the user.',
];

// ── talking to Mero ────────────────────────────────────────────────────────

const lastTold = new Map();   // talk id → the sections Mero was sent for her last answer (ⓘ)
export const meroTold = id => lastTold.get(id) || null;
let busy = 0;
const busyIn = new Map();   // talk id → Mero answers running there — "typing…" shows only in that talk (bug hunt 2026-11-03)
const busyOn = id => { busy++; busyIn.set(id, (busyIn.get(id) || 0) + 1); };
const busyOff = id => { busy--; const n = (busyIn.get(id) || 1) - 1; if (n > 0) busyIn.set(id, n); else busyIn.delete(id); };
export const meroBusy = () => busy > 0;
export const meroBusyIn = () => [...busyIn.keys()];

/** What Mero is told: the board, the latest replies, the lore the writer got, the cards, notes. */
function contextPackage() {
    const ctx = getContext(), chat = ctx?.chat || [], s = store();
    const n = s.settings.replies;
    const replies = [];
    for (let k = chat.length - 1; k >= 0 && replies.length < n; k--) {
        const m = chat[k]; if (!m || m.is_system || typeof m.mes !== 'string') continue;
        replies.unshift({ i: k, name: m.is_user ? (name1 || 'User') : m.name, text: splitOoc(m.mes).clean.slice(0, 2500) });
    }
    let board = [];
    let summarized = false; try { summarized = !!getMeroMap(live()?.board?.name)?.text; } catch { /* no board */ }
    try {
        const list = readActiveTrackers().filter(t => !summarized || !Array.isArray(t.steps) || t.ended?.branch || (t.took && Object.keys(t.took).length));
        board = [writerBlock(list, liveWriterLines()), liveStepJudgeSection()].filter(Boolean).join('\n').split('\n');
    } catch { /* no board */ }
    const verdict = getCurrentForChat(ctx?.getCurrentChatId?.());
    const titles = (verdict?.injectedSources || []).map(x => x.title).filter(Boolean).slice(0, 8);
    const entries = titles.map(t => { const e = (vaultIndex || []).find(x => x.title === t); return e ? { title: e.title, content: e.content || e.summary || '' } : null; }).filter(Boolean);
    const card = ctx?.characters?.[ctx?.characterId];
    const cards = card ? [`${card.name}: ${String(card.description || '').slice(0, 1500)}`, card.personality ? `Personality: ${String(card.personality).slice(0, 600)}` : '', card.scenario ? `Scenario: ${String(card.scenario).slice(0, 600)}` : ''].filter(Boolean).join('\n') : '';
    const persona = (ctx?.powerUserSettings?.persona_description || '').trim() ? `${name1 || 'User'} (persona): ${String(ctx.powerUserSettings.persona_description).slice(0, 1000)}` : '';
    const all = meroNotes();
    let moments = [];
    try { const L = live(); if (L) moments = recentMoments(L.board, L.state, chat.length - 1).map(m => `${m.text} (#${m.i})`); } catch { /* no board */ }
    let world = ''; try { world = worldSink?.digest?.() || ''; } catch { /* no world here */ }
    // the storyboard at a glance — names only, cheap (mero-board-pure.js); details only when a message names a tracker
    // the stored summary (made quietly when the board is saved, mero-map.js) + where each stands in this chat; names only until then
    let boardMap = [];
    try {
        const L = live();
        if (L) { const m = getMeroMap(L.board?.name); boardMap = m?.text ? [...m.text.split('\n'), nowLine(L.board, L.state)].filter(Boolean) : boardSummary(L.board, L.state); }
    } catch { /* no board */ }
    // her writing guides — only those in this chat's folders (mero-pure.js guidesIn; 2026-11-03)
    let guides = [];
    try { let f = null; try { f = effectiveFolderFilter(); } catch { /* no character */ } guides = guidesIn(vaultIndex || [], f).map(e => ({ title: e.title, content: e.content || '' })); } catch { /* no vault */ }
    return { boardMap, replies, board, entries, cards, persona, moments, world, guides, talkNotes: all.filter(x => !x.story && x.on && !x.ended), storyNotes: all.filter(x => x.inForce) };
}

// the world layer registers itself (world.js — no import loop): its summary, and the things the 📎 picker offers
let worldSink = null;
export function setWorldSink(s) { worldSink = s; }

/**
 * @-mentions in Mero's box (Miinthe, 2026-10-19: "Like @ tracker-relationship. or @ cast-kettle or @ worldmessage kettle-toaster
 * or @ reply-#"): everything that can be mentioned, as { tag, label, group, text() } — text only read when sent.
 */
const slug = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
function mentionables() {
    const out = [], chat = getContext()?.chat || [];
    for (let n = chat.length - 1; n >= 0 && n >= chat.length - 40; n--) {
        const m = chat[n]; if (!m || m.is_system || typeof m.mes !== 'string') continue;
        out.push({ tag: `reply-#${n}`, group: 'Replies', label: `#${n} ${m.name}: ${m.mes.replace(/\s+/g, ' ').slice(0, 50)}`, text: () => `#${n} ${m.name}: ${splitOoc(m.mes).clean.slice(0, 2500)}` });
    }
    let lines = []; try { lines = liveWriterLines(); } catch { /* no board */ }
    try {
        for (const t of readTrackers()) {
            if (!t?.name) continue;
            const mine = lines.filter(l => l.toLowerCase().includes(String(t.name).toLowerCase()));
            out.push({ tag: `tracker-${slug(t.name)}`, group: 'Trackers', label: `${t.name}: ${describeTracker(t)}`, text: () => [`${t.name}: ${describeTracker(t)}`, Array.isArray(t.steps) ? `Steps: ${t.steps.join(' → ')}` : '', ...mine].filter(Boolean).join('\n') });
        }
        // the main character too (Miinthe, H3: "I cannot mention the Toaster")
        const c = getContext(), card = c?.groupId ? null : c?.characters?.[c?.characterId];
        if (card?.name) out.push({ tag: `cast-${slug(card.name)}`, group: 'Cast', label: `${card.name} (the main character)`, text: () => [`${card.name} — the main character`, String(card.description || '').slice(0, 1500), card.personality ? `Personality: ${String(card.personality).slice(0, 600)}` : ''].filter(Boolean).join('\n') });
        const L = live();
        if (L) for (const x of peopleOf(L.board, L.state)) {
            const now = personNow(L.state, x.cast, x.p);
            out.push({ tag: `cast-${slug(x.p.name)}`, group: 'Cast', label: `${x.p.name}${now.here ? ' (in the scene)' : ''}`, text: () => [`${x.p.name} — ${now.here ? 'in the scene' : 'away'}`, now.wants ? `Wants: ${now.wants}` : '', now.plans.length ? `Plans: ${now.plans.map(p => p.text).join(' · ')}` : '', now.knows.length ? `Knows: ${now.knows.slice(-12).map(k => k.fact).join('; ')}` : '', x.p.note ? `Note: ${x.p.note}` : ''].filter(Boolean).join('\n') });
        }
    } catch { /* no board */ }
    try { for (const w of worldSink?.items?.() || []) out.push({ tag: w.tag, group: w.tagGroup || 'World', label: w.label, text: () => w.text }); } catch { /* no world */ }
    // only the lore this story reads (Miinthe, 2026-11-04: Mero is limited to the character's folders) — the board's first
    let pick = []; try { const { entries, prefer } = meroLore(), b = new Set(prefer.titles); pick = [...entries.filter(x => b.has(x.title)), ...entries.filter(x => !b.has(x.title))]; } catch { /* no vault */ }
    for (const e of pick.filter(x => x.title).slice(0, 600)) out.push({ tag: `lore-${slug(e.title)}`, group: 'Lore', label: e.title, text: () => String(e.content || e.summary || '').slice(0, 2000) });
    return out;
}
export const mentionList = () => mentionables().map(({ tag, label, group }) => ({ tag, label, group }));
/** The mentioned ones, as context for the message. Unknown tags are left as plain text. */
export function mentionResolve(tags) {
    const want = new Set((Array.isArray(tags) ? tags : []).map(t => String(t).toLowerCase()));
    if (!want.size) return [];
    return mentionables().filter(m => want.has(m.tag.toLowerCase())).slice(0, 8).map(m => ({ label: `@${m.tag} — ${m.label}`.slice(0, 120), text: m.text() }));
}

/**
 * 📎 picking (Miinthe, 2026-10-19: "click add context and then click the actual thing you want to add"): Mero's 📎 starts it,
 * she clicks a message in the chat, a post / news item / conversation in the world panel, or a lore entry in the Lore tab.
 * Resolves { label, text } or null (Esc, Cancel). A side panel lying over the chat steps aside while she picks.
 */
let picking = null;
/** Stop picking (Esc inside Mero's window, or 📎 again — the page's own Esc listener doesn't hear keys typed in her window). */
export function cancelPick() { picking?.(null); }
export function pickContext() {
    picking?.(null);
    return new Promise(resolve => {
        const panel = document.getElementById('deeplore-panel');
        const over = !!panel && (panel.classList.contains('dle-overlay-mode') || panel.classList.contains('dle-mobile'));
        document.body.classList.add('dle-picking'); if (over) document.body.classList.add('dle-picking-over');
        const bar = document.createElement('div'); bar.className = 'dle-pickbar';
        bar.innerHTML = '<span>📎 Click what Mero should see: a message in the chat, a post or conversation in the world panel, a lore entry</span><button type="button">Cancel</button>';
        document.body.append(bar);
        const what = el => {
            const mes = el.closest?.('#chat .mes[mesid]');
            if (mes) { const n = Number(mes.getAttribute('mesid')), m = getContext()?.chat?.[n]; return m ? { label: `#${n} ${m.name}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 60)}`, text: `#${n} ${m.name}: ${splitOoc(m.mes).clean.slice(0, 2500)}` } : null; }
            const lore = el.closest?.('#deeplore-panel [data-title][role="listitem"]');
            if (lore) { const e = meroLore().entries.find(x => x.title === lore.dataset.title); return e ? { label: `Lore: ${e.title}`, text: String(e.content || e.summary || '').slice(0, 2000) } : null; }
            try { return worldSink?.pick?.(el) || null; } catch { return null; }
        };
        const finish = v => {
            picking = null;
            document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); document.removeEventListener('mouseover', hover, true);
            document.querySelectorAll('.dle-pick-hi').forEach(x => x.classList.remove('dle-pick-hi'));
            document.body.classList.remove('dle-picking', 'dle-picking-over'); bar.remove();
            resolve(v);
        };
        const click = e => {
            if (bar.contains(e.target)) { if (e.target.closest('button')) finish(null); return; }
            const v = what(e.target);
            if (!v) return;   // anything else works as usual (switching a tab, scrolling, opening a conversation)
            e.preventDefault(); e.stopPropagation(); finish(v);
        };
        const hover = e => { document.querySelectorAll('.dle-pick-hi').forEach(x => x.classList.remove('dle-pick-hi')); const t = e.target.closest?.('#chat .mes[mesid], #deeplore-panel [data-title][role="listitem"], .dle-world [data-post-id], .dle-world [data-art], .dle-world [data-peek], .dle-world .bw'); if (t && what(t)) t.classList.add('dle-pick-hi'); };
        const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
        document.addEventListener('click', click, true); document.addEventListener('keydown', key, true); document.addEventListener('mouseover', hover, true);
        picking = finish;
    });
}

/** What Mero knows, for her other jobs (💡 pitches): the talk package, who she is, where, Miinthe's name. */
export function meroKnows() { return { pkg: contextPackage(), who: store().settings.persona, where: meroWhere(), user: name1 || 'User', names: meroNames(store().settings) }; }

// 💡 pitch cards Mero offers in a talk go to the pitches (pitches.js registers itself — no import loop)
let pitchSink = null;
export function setPitchSink(fn) { pitchSink = fn; }

/** The talk as one readable text — for the ⓘ view only (it is sent as real turns). */
const flatten = (messages, names = meroNames(store().settings)) => messages.map(m => `${m.role === 'user' ? (names.you || 'You') : names.me}: ${m.content}`).join('\n\n');

// ── 🔎 lookups (Miinthe, 2026-11-02: tool calls, shown while she works and in the reply's header afterwards) ─────────

const working = new Map();   // talk id → [{ label, got }] — the lookups of the answer being written now (memory only)
/** What Mero is looking up right now, per talk — for "Mero is typing…" with one line per lookup. */
export const meroWorking = () => Object.fromEntries([...working].map(([id, steps]) => [id, steps.map(x => ({ ...x }))]));
const noTools = new Set();   // profiles that refused tools this session: Mero answers the old way there
const low = s => String(s ?? '').toLowerCase().trim();

/** Every entry title linked anywhere on a board (steps, detours, items, places…). */
function boardTitles(board) {
    const out = new Set();
    const walk = (v, depth) => {
        if (depth > 6 || !v || typeof v !== 'object') return;
        if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
        for (const [k, x] of Object.entries(v)) {
            if (k === 'entries' && Array.isArray(x)) x.forEach(t => { if (typeof t === 'string' && t.trim()) out.add(t); });
            else walk(x, depth + 1);
        }
    };
    walk(board?.trackers, 0);
    return out;
}

/**
 * The lore Mero may read (Miinthe, 2026-11-04: Mero is "limited to the folders attached to the character … however the board
 * does have priority"; "looking it up would work similar like just vanilla deeplore"): the vault without the guides,
 * through DeepLore's own filters — the chat's folders (character + run + chat) and the field gating (run letter, era…),
 * exactly as the writer's lore is picked. The open board's linked entries are never gated away (she plans ahead: a later
 * step's entry must stay readable) but must still be in those folders. `prefer` ranks the board first in her searches.
 */
export function meroLore() {
    const all = (vaultIndex || []).filter(e => e && !e.guide);
    let folders = null; try { folders = effectiveFolderFilter(); } catch { /* no character: the chat's own folders or none */ }
    let L = null; try { L = live(); } catch { /* no board */ }
    const titles = boardTitles(L?.board);
    const prefer = { titles: [...titles], folders: Array.isArray(L?.board?.folders) ? L.board.folders : [] };
    const settings = getSettings();
    const policy = buildExemptionPolicy(all, chat_metadata?.deeplore_pins || [], chat_metadata?.deeplore_blocks || [], false);
    const inFolders = folders && folders.length ? applyFolderFilter(all, folders, policy, false) : all;
    let entries = inFolders;
    const ctx = chat_metadata?.deeplore_context;
    if (ctx && typeof ctx === 'object' && Object.keys(ctx).length) {
        try {
            const kept = new Set(applyContextualGating(inFolders, ctx, policy, false, settings, fieldDefinitions.length ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS));
            entries = inFolders.filter(e => kept.has(e) || titles.has(e.title));
        } catch (err) { console.warn('[Onyx Quill] Mero lore: gating skipped:', err?.message || err); }
    }
    return { entries, prefer };
}

/** Everything the lookups read — gathered once per answer, only when she looks something up. */
function lookupData() {
    const chat = getContext()?.chat || [];
    let L = null; try { L = live(); } catch { /* no board */ }
    let cast = [];
    try { cast = mentionables().filter(m => m.group === 'Cast'); } catch { /* none */ }
    const nameOf = m => m.label.replace(/\s*\((?:in the scene|the main character)\)$/, '');
    const lore = meroLore();
    return {
        entries: lore.entries, prefer: lore.prefer,
        chat: chat.map((m, i) => ({ m, i })).filter(({ m }) => m && !m.is_system && typeof m.mes === 'string').map(({ m, i }) => ({ i, name: m.is_user ? (name1 || 'User') : m.name, text: splitOoc(m.mes).clean })),
        board: L?.board || null, state: L?.state || null,
        // every tracker as the writer sees it (meters, collections, places, state…), for open_tracker on those (2026-11-03)
        boardLines: (() => { try { return writerBlock(readActiveTrackers(), liveWriterLines()).split('\n').filter(Boolean); } catch { return []; } })(),
        entryText: title => String(lore.entries.find(e => e.title === title)?.content || ''),
        castNames: cast.map(nameOf),
        castText: name => { const q = low(name); const hit = cast.find(m => low(nameOf(m)) === q) || cast.find(m => low(nameOf(m)).includes(q) || q.includes(low(nameOf(m)).split(/\s+/)[0])); return hit ? hit.text() : ''; },
    };
}

/**
 * The rounds: Mero may look things up (TOOL_DEFS) before she answers; every lookup shows at once in `steps` (the live
 * list). The last round offers no lookups, so she has to answer. Returns { text, steps }.
 */
async function answerWithLookups(system, messages, conn, steps, onStep, { web = false } = {}) {
    const tools = web ? [...TOOL_DEFS, ...WEB_DEFS] : TOOL_DEFS;
    const msgs = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
    let data = null, used = 0;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const last = round === MAX_TOOL_ROUNDS || used >= MAX_LOOKUPS;
        const r = await callWithTools(msgs, tools, conn, { choice: last ? 'none' : 'auto' });
        if (!r.calls.length || last) return { text: r.text };
        msgs.push({ role: 'assistant', content: r.text || '', tool_calls: r.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args || {}) } })), ...(r.reasoning ? { reasoning_content: r.reasoning } : {}) });
        for (const c of r.calls) {
            const a = argsOf(c.args);
            let res;
            if (used >= MAX_LOOKUPS) res = { text: 'No more lookups for this answer — answer with what you have.', got: '' };
            else {
                used++;
                const step = { label: toolLabel(c.name, a) }; steps.push(step); onStep();
                if (web && WEB_TOOLS.has(c.name)) res = await runWebTool(c.name, a);
                else try { data ||= lookupData(); res = runTool(c.name, a, data); } catch (err) { res = { text: `The lookup failed: ${err?.message || err}`, got: 'failed' }; }
                step.got = res.got; onStep();
            }
            msgs.push({ role: 'tool', tool_call_id: c.id, content: res.text });
        }
    }
    return { text: '' };
}

/** Whether Mero's connection can look things up (a profile that takes tools, and hasn't refused them this session). */
export function meroCanLookUp() {
    const conn = resolveConnectionConfig('mero');
    return !!conn.profileId && conn.mode === 'profile' && !getSettings().aiForceUserRole && !noTools.has(conn.profileId) && toolsPossible(conn.profileId);
}

/**
 * The board window's Mero (board-window.js, the talk job) looks things up like in her talks — the same lore (only what
 * this story reads, the board first), the board, the chat, the Cast. Miinthe, 2026-11-04: Find gaps made up a poisoner for
 * A Stolen Eternity, because she had only the board's names. `build(lookups)` → { system, user }: the prompt says what
 * she can do. Falls back to one plain call when the connection can't look things up. Returns { text, steps }.
 */
export async function boardMeroAnswer(build) {
    // room for thinking + lookups + the JSON answer (her 1500 cut the answer off mid-sentence, 2026-11-04); a model only
    // bills what it writes, so a higher ceiling costs nothing extra
    const base = resolveConnectionConfig('mero'), conn = { ...base, maxTokens: Math.max(Number(base.maxTokens) || 0, 4000) };
    const steps = [];
    if (meroCanLookUp()) {
        const { system, user } = build(true);
        try {
            const r = await answerWithLookups(system, [{ role: 'user', content: user }], conn, steps, () => {}, { web: false });
            if (String(r.text || '').trim()) return { text: r.text, steps: steps.map(x => keptStep(x.label, x.got)) };
        } catch (err) {
            console.warn('[Onyx Quill] Mero on the board: lookups failed, answering without them:', err?.message || err);
            if (!passingError(err)) noTools.add(conn.profileId);   // can't take tools: the old way for this session
        }
    }
    const { system, user } = build(false);
    const r = await callAI(system, user, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
    return { text: r?.text ?? '', steps: [] };
}

/**
 * Mero answers the talk as it is in `history` (the messages before her answer). `said` = Miinthe's message she answers
 * (for the board lookups and "she asked for a pitch"). opener: Mero speaks first — `said` is only her cue.
 * Returns { version: { t, at, cards?, steps? }, kind, title, raw } — throws when the call fails.
 */
async function answerFor(t, history, said, { opener = false } = {}) {
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) throw new Error('Mero has no connection yet — pick one in Settings › AI & connections › Mero ☆');
    // "Mero is typing…" from the first moment — the board summary below can take up to 20 seconds, and nothing showing
    // then looked like she was broken (Miinthe, 2026-11-02)
    busyOn(t.id); changed();
    try { return await answerInner(t, history, said, { opener }, conn); } finally { busyOff(t.id); changed(); }
}
async function answerInner(t, history, said, { opener }, conn0) {
    // room for thinking + lookups + her answer: with DeepSeek her 1500 sometimes came back EMPTY ("…") — 2026-11-04. A ceiling, not
    // a length: how long she talks is her chattiness setting; only what is written is billed. A vault review keeps its own length.
    const conn = { ...conn0, maxTokens: Math.max(Number(conn0.maxTokens) || 0, 4000) };
    // her summary of the board, written now if the board changed since (quiet, one call; mero-map.js)
    // — at most 20 seconds: a slow call must not hold her answer up; it finishes in the background for the next one
    try { const n = live()?.board?.name; if (n) await Promise.race([refreshMeroMap(n).catch(() => null), new Promise(r => setTimeout(r, 20000))]); } catch { /* names only this time */ }
    const w = meroWhere(), pkg = contextPackage();
    const vault = t.review ? reviewEntries() : null;
    const lookups = !vault && conn.mode === 'profile' && !getSettings().aiForceUserRole && !noTools.has(conn.profileId) && toolsPossible(conn.profileId);
    const web = lookups && store().settings.web !== false && webReady();   // 🌐 her switch, and a search set up in SillyTavern
    const first = !history.some(m => m.who === 'mero');
    const pitchAsked = !opener && askedForPitch(said);
    const built = buildMeroPrompt({ settings: store().settings, talk: { ...t, msgs: history }, character: w.character, ...pkg, vault, firstAnswer: first && !t.mine, lookups, web, pitchAsked });
    const { system } = built, messages = opener ? [...built.messages, { role: 'user', content: said }] : built.messages;
    if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('Nothing for Mero to answer here.');
    // looked up on the board (Miinthe 2026-10-26): the trackers her message names, their details for THIS message only —
    // never stored in the talk, so later messages don't carry them again
    let lookedUp = [], handed = { text: '', titles: [] };
    if (!opener) {
        try {
            const L = live();
            if (L) { const mine = meroLore().entries; lookedUp = namedTrackers(said, L.board).map(id => trackerDetails(L.board, id, L.state, title => String(mine.find(e => e.title === title)?.content || ''))).filter(Boolean); }
        } catch { /* no board */ }
        // the entries her words name, by DeepLore's own key matching (Miinthe, 2026-11-04) — handed along, no AI call
        if (!vault && said) {
            try {
                const { entries: mine, prefer } = meroLore(), sent = new Set(pkg.entries.map(e => e.title)), st = getSettings();
                const hits = mine.filter(e => !e.constant && !sent.has(e.title) && Array.isArray(e.keys) && e.keys.length && testPrimaryMatchOnly(e, String(said), st));
                handed = handedLore(hits, prefer);
            } catch (err) { console.warn('[Onyx Quill] Mero: handing the named entries failed:', err?.message || err); }
            finally { try { clearScanTextCache(); } catch { /* noop */ } }
        }
        const last = messages[messages.length - 1];
        const extra = [lookedUp.length ? `[Looked up on the board]\n${lookedUp.join('\n\n')}` : '', handed.titles.length ? `[Entries your message names — handed to you]\n${handed.text}` : ''].filter(Boolean).join('\n\n');
        if (extra && last?.role === 'user') messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${extra}` };
    }
    const steps = [];
    working.set(t.id, steps);
    lastTold.set(t.id, { model: conn.profileId, sections: [
        ['☆ Who Mero is', store().settings.persona], ['📝 Notes just for your talks', pkg.talkNotes.map(n => n.text).join('\n')], [`☆ Secrets for Mero (${pkg.guides.length})`, guidesText(pkg.guides)],
        ['📍 Where each tracker stands', pkg.boardMap.filter(l => l.startsWith('Where each stands')).join('\n')], ...(lookedUp.length ? [['🔎 Looked up for this message', lookedUp.join('\n\n')]] : []), ...(handed.titles.length ? [['📖 Entries your message names', handed.titles.join(' · ')]] : []), ['🗺 Where the story stands now', pkg.board.join('\n')], [`📜 The latest replies (${pkg.replies.length})`, pkg.replies.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n')],
        ['✨ Big moments lately', pkg.moments.join('\n')], ['🌍 The world around the story', pkg.world], vault ? [`📚 The lore this story reads (${vault.length} entries)`, vault.map(e => e.title).join(' · ')] : [`📚 Entries Onyx Quill sent the writer (${pkg.entries.length})`, pkg.entries.map(e => e.title).join(' · ')], ['🎭 Character and persona cards', [pkg.cards, pkg.persona].filter(Boolean).join('\n\n')],
        ['💬 This talk', flatten(messages)],
        ['🔎 Her lookups', lookups ? `She can look things up (lore, board, chat, Cast${web ? ', the web' : ''}) — what she looked up shows above her answer.` : 'Not with this connection — she sees only what is listed here.'],
    ] });
    try {
        let raw = '', nolook = false, lookSkip = false;
        if (lookups) {
            try { raw = (await answerWithLookups(system, messages, conn, steps, changed, { web })).text; }
            catch (err) {
                // a profile that can't do tools: remember it for this session, answer the old way
                console.warn('[Onyx Quill] Mero: lookups failed, answering without them:', err?.message || err);
                // e.g. LM Studio: the model's template can't take tools (or, after a few lookups, tool results) — but a
                // timeout / rate limit / server hiccup is not that: lookups stay on for the next answer
                if (!passingError(err)) noTools.add(conn.profileId); else lookSkip = true;   // a hiccup: on again next answer
                nolook = !steps.length;
                steps.length = 0; raw = '';
            }
        }
        if (!raw.trim()) {
            // a vault review: the answer length from Settings (Answer length for /oq-review), and time to read it all
            const rt = getSettings().reviewResponseTokens;
            const callConn = vault ? { ...conn, ...(rt > 0 ? { maxTokens: rt } : {}), timeout: Math.max(conn.timeout || 0, 300000) } : conn;
            // the talk as real turns: her last message, the ones before as history (a pasted script let a model write Miinthe's lines)
            const r = await callAI(system, messages[messages.length - 1].content, { ...callConn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, history: messages.slice(0, -1) });
            raw = r?.text ?? '';
            if (!raw.trim()) console.warn('[Onyx Quill] Mero: the model sent back an empty answer', r);
        }
        const told = lastTold.get(t.id); if (told) told.raw = raw;
        const a = parseMeroAnswer(raw, meroNames(store().settings));
        // notes only when asked (Miinthe 2026-10-26: "too quick to make notes") — everywhere now; in a fixing talk she asks first
        if (a.cards.length && !opener && !askedForNote(said)) a.cards = [];
        // her AI can't look things up: the reply's header says so instead of staying empty
        if (!vault && !lookSkip && (nolook || noTools.has(conn.profileId) || (conn.mode === 'profile' && !toolsPossible(conn.profileId)))) nolook = true;
        if (lookSkip) nolook = false;
        const version = { t: a.text || '…', at: new Date().toISOString(), ...(a.cards.length ? { cards: a.cards } : {}), ...(steps.length || handed.titles.length ? { steps: [...(handed.titles.length ? [keptStep(`📖 Handed to her: ${handed.titles.length} entr${handed.titles.length > 1 ? 'ies' : 'y'} your message names`, handed.titles.slice(0, 4).join(' · '))] : []), ...steps.map(x => keptStep(x.label, x.got))].slice(0, MAX_LOOKUPS + 1) } : {}), ...(nolook && !steps.length ? { nolook: true } : {}), ...(lookSkip && !steps.length ? { lookskip: true } : {}), ...(a.asks.length ? { asks: a.asks } : {}) };
        return { version, kind: a.kind, title: a.title, pitchAsked };
    } finally { working.delete(t.id); changed(); }
}

/** The tag fills itself in from what she says the talk is about — unless Miinthe picked it, or it is a game. */
function autoTag(t, kind) { if (kind && !t.tagMine && t.tag !== 'game' && !t.review) t.tag = kind; }

/** Miinthe asked for a pitch: the talk is written up as pitch cards right after the answer (pitches.js). */
async function pitchIfAsked(t, asked) {
    if (!asked || !pitchSink?.fromTalk) return null;
    try { const r = await pitchSink.fromTalk(t.id); return r?.ok ? null : r?.error || null; } catch (err) { return err?.message || String(err); }
}

/**
 * Miinthe says something in a talk; Mero answers. Returns { ok, talk } or { ok: false, error } — the talk keeps
 * Miinthe's message either way. `text` may be the 🧭 question. `opener`: Mero speaks first (a big moment) — `text`
 * is then only her cue, never shown as Miinthe's message.
 */
export async function sendToMero(talkId, text, { opener = false, ctx = [] } = {}) {
    const t = findTalk(talkId); if (!t) return { ok: false, error: 'no such talk' };
    const said = String(text || '').trim(); if (!said) return { ok: false, error: 'nothing to send' };
    const extra = (Array.isArray(ctx) ? ctx : []).filter(c => c && c.label).slice(0, 6).map(c => ({ label: String(c.label).slice(0, 120), text: String(c.text || '').slice(0, 2000) }));
    dropSwipes(t.msgs);   // she wrote again: the swipes of Mero's last answer are gone (Miinthe 2026-11-02)
    if (!opener) t.msgs.push({ who: 'author', t: said, at: new Date().toISOString(), ...(extra.length ? { ctx: extra } : {}) });
    if (t.state !== 'open') t.state = 'open';
    t.updated = new Date().toISOString(); saveStore();
    if (!resolveConnectionConfig('mero').profileId) return { ok: false, error: 'Mero has no connection yet — pick one in Settings › AI & connections › Mero ☆' };
    const first = !t.msgs.some(m => m.who === 'mero');
    try {
        const r = await answerFor(t, t.msgs.slice(), said, { opener });
        const t2 = findTalk(talkId) || t;
        t2.msgs.push({ who: 'mero', ...r.version });
        if (first && !t2.mine) t2.title = r.title || fallbackTitle(said);
        autoTag(t2, r.kind);
        t2.updated = new Date().toISOString(); saveStore();
        const pitchError = await pitchIfAsked(t2, r.pitchAsked);
        return { ok: true, talk: findTalk(talkId) || t2, ...(pitchError ? { pitchError } : {}) };
    } catch (err) {
        console.warn('[Onyx Quill] Mero could not answer:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
}

// ── ↻ redo, swipes, delete, edit (Miinthe, 2026-11-02: "I have no way to re-do the mero reply, to delete a mero reply
// or to edit my own reply") — swipes only until she writes again, never stored for long ──────────────────────────

const lastMeroIndex = t => { for (let k = t.msgs.length - 1; k >= 0; k--) if (t.msgs[k].who === 'mero') return k; return -1; };
const authorBefore = (t, k) => { for (let i = k - 1; i >= 0; i--) if (t.msgs[i].who === 'author') return t.msgs[i].t; return ''; };

/** ↻ Mero answers her last message again; the old answer stays as a swipe (◀ 1/2 ▶). */
export async function redoMero(talkId, k) {
    const t = findTalk(talkId); if (!t) return { ok: false, error: 'no such talk' };
    if (k !== lastMeroIndex(t) || t.msgs.slice(k + 1).some(m => m.who === 'author')) return { ok: false, error: 'Only her last answer can be redone.' };
    // only an answer to Miinthe's message — a write-up, Pitch's questions, "nothing to pitch" follow Mero's own words (bug hunt 2026-11-03)
    const mk = t.msgs[k];
    if (t.msgs[k - 1]?.who !== 'author' || (mk.pitchIds || []).length || mk.pcheck) return { ok: false, error: 'This one can\'t be answered again — it isn\'t an answer to your message.' };
    const history = t.msgs.slice(0, k);
    if (!history.some(m => m.who === 'author')) return { ok: false, error: 'She spoke first here — there is nothing to answer again.' };
    try {
        const r = await answerFor(t, history, authorBefore(t, k));
        const t2 = findTalk(talkId); const m = t2?.msgs[k];
        if (!m || m.who !== 'mero') return { ok: false, error: 'The talk changed meanwhile.' };
        addVersion(m, r.version);
        autoTag(t2, r.kind);
        t2.updated = new Date().toISOString(); saveStore();
        return { ok: true };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

/** ◀ ▶ Show another version of Mero's last answer. */
export function swipeMero(talkId, k, dir) {
    const t = findTalk(talkId), m = t?.msgs[k];
    if (!m || m.who !== 'mero') return false;
    const { list, at } = versionsOf(m);
    const n = at + (dir < 0 ? -1 : 1);
    if (n < 0 || n >= list.length) return false;
    showVersion(m, n); saveStore(); return true;
}

/** 🗑 Delete one message of the talk (hers or Mero's). */
export function deleteMsg(talkId, k) {
    const t = findTalk(talkId); if (!t || !t.msgs[k]) return false;
    t.msgs.splice(k, 1);
    t.updated = new Date().toISOString(); saveStore(); return true;
}

/**
 * ✏ Miinthe changes her own message. `again`: everything after it goes and Mero answers the new words (only for her
 * last message — Save & ask again).
 */
export async function editMsg(talkId, k, text, { again = false } = {}) {
    const t = findTalk(talkId), m = t?.msgs[k];
    const said = String(text || '').trim();
    if (!m || m.who !== 'author' || !said) return { ok: false, error: 'Nothing to save.' };
    m.t = said;
    if (!again) { t.updated = new Date().toISOString(); saveStore(); return { ok: true }; }
    if (t.msgs.slice(k + 1).some(x => x.who === 'author')) { saveStore(); return { ok: false, error: 'Only your last message can be asked again.' }; }
    if (busyIn.has(t.id)) { saveStore(); return { ok: false, error: 'Mero is still answering — your words are saved; ask again when she is done.' }; }
    t.msgs.splice(k + 1);
    dropSwipes(t.msgs);
    t.updated = new Date().toISOString(); saveStore();
    try {
        const r = await answerFor(t, t.msgs.slice(), said);
        const t2 = findTalk(talkId) || t;
        t2.msgs.push({ who: 'mero', ...r.version });
        autoTag(t2, r.kind);
        t2.updated = new Date().toISOString(); saveStore();
        const pitchError = await pitchIfAsked(t2, r.pitchAsked);
        return { ok: true, ...(pitchError ? { pitchError } : {}) };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

/** 💡 The talk's pitches were written up (pitches.js): Mero's line, with the cards under it. */
export function noteTalkPitches(talkId, { text, pitchNos = [], planNos = [], pitchIds = [], asks = [] } = {}) {
    const t = findTalk(talkId); if (!t) return;
    dropSwipes(t.msgs);
    // a new write-up or new questions: older question sets she never answered close (bug hunt 2026-11-03: two live
    // "Skip, write it as is" sets showed at once)
    for (const m of t.msgs) if (m.who === 'mero' && Array.isArray(m.asks) && m.asks.length && !m.asks.some(a => a.done)) m.asks.forEach(a => { a.done = 'skipped'; });
    t.msgs.push({ who: 'mero', t: String(text || '…'), at: new Date().toISOString(), ...(pitchNos.length ? { pitchNos, planNos, pitchIds } : {}), ...(asks.length ? { asks, pcheck: true } : {}) });
    t.updated = new Date().toISOString(); saveStore();
}

/**
 * ❓ Miinthe answers Mero's question cards on message k (answers: [{ picked: [i], own }] per card). Her answers become her
 * message, and Mero answers it — or, for the cards 💡 Pitch asked first, the talk is written up right after (skipped:
 * written up as it is, the open points stay open).
 */
export async function answerTalkAsks(talkId, k, answers = [], { skipped = false, detail = '', talk = false } = {}) {
    const t = findTalk(talkId), m = t?.msgs[k];
    if (!m || m.who !== 'mero' || !Array.isArray(m.asks) || !m.asks.length) return { ok: false, error: 'Those questions are gone.' };
    if (t.msgs.slice(k + 1).some(x => x.who === 'author')) return { ok: false, error: 'You wrote since — answer in the box instead.' };
    const asks = answerAsks(m.asks, answers, { skipped });
    // "Anything to add?" (Miinthe, 2026-11-02: "I do not seem to have a chance to add more details in between")
    const more = String(detail || '').trim();
    const said = [skipped ? '' : askAnswerText(asks), more].filter(Boolean).join('\n\n');
    if (!skipped && !said) return { ok: false, error: 'Pick an answer, write your own, or add something.' };
    m.asks = asks;
    if (m.pcheck && !talk) {
        if (said) { dropSwipes(t.msgs); t.msgs.push({ who: 'author', t: said, at: new Date().toISOString() }); }
        t.updated = new Date().toISOString(); saveStore();
        if (!pitchSink?.fromTalk) return { ok: false, error: 'Pitches are not ready yet.' };
        return pitchSink.fromTalk(talkId, { ask: false });
    }
    saveStore();
    // a normal card, or "Keep talking" on Pitch's questions: her answers are her message and Mero answers it
    return sendToMero(talkId, said);
}

/** 🧭 Where are we? — asked in this talk, or a new 💭 talk when none is open. */
export async function whereAreWe(talkId = null) {
    let t = talkId && findTalk(talkId);
    if (!t) { t = newTalk('yap'); if (!t) return { ok: false, error: 'no character' }; t.title = 'Where are we?'; }
    return sendToMero(t.id, WHERE_ARE_WE);
}

/** Keep a card Mero offered (message k of the talk, card c); `fields` may change kind / how long / where. */
export function keepCard(talkId, k, c, fields = {}) {
    const t = findTalk(talkId); const card = t?.msgs[k]?.cards?.[c]; if (!card) return null;
    const n = addNote({ ...card, ...fields }, { from: talkId });
    if (n) { card.state = 'kept'; card.noteId = n.id; saveStore(); }
    return n;
}
export function dropCard(talkId, k, c) { const card = findTalk(talkId)?.msgs[k]?.cards?.[c]; if (card) { card.state = 'no'; saveStore(); } }

/**
 * Mero's settings (personality, how chatty in three parts, the writer's initiative, how many replies she reads, her job, sign-off).
 * `reset` (Miinthe, 2026-10-05: "a reset to default"): 'settings' — everything but who she is · 'persona' — the first draft.
 */
export function meroSettings(patch = null, { reset = null } = {}) {
    if (reset) {
        const s = storeW(), fresh = asStore(null).settings;
        s.settings = reset === 'persona' ? { ...s.settings, persona: fresh.persona } : { ...fresh, persona: s.settings.persona };
        saveStore();
    } else if (patch) {
        // a preset (Quiet / Chatty / Very chatty) sets its three parts; a part changed on its own makes it "custom"
        const p = CHATTY_PRESETS[patch.chatty] ? { ...patch, ...CHATTY_PRESETS[patch.chatty] } : patch;
        const s = storeW(); s.settings = asStore({ settings: { ...s.settings, ...p } }).settings; saveStore();
    }
    return store().settings;
}

// ── [OOC: …] from the story box ──────────────────────────────────────────────

/**
 * In the generate interceptor: Miinthe's [OOC: …] brackets are taken out of the copy the writer sees (the stored
 * message stays as she wrote it) and go to Mero — the most recent open ✋ Feedback talk, else a new one.
 * Returns { onlyOoc } — a message that was only [OOC] should not start a story reply.
 */
export function routeOoc(chatMessages) {
    if (!Array.isArray(chatMessages) || !chatMessages.length) return { onlyOoc: false };
    const k = chatMessages.length - 1, m = chatMessages[k];
    let found = false;
    for (let i = 0; i < chatMessages.length; i++) {
        const x = chatMessages[i];
        if (!x?.is_user || typeof x.mes !== 'string' || !/\[OOC:/i.test(x.mes)) continue;
        chatMessages[i] = { ...x, mes: splitOoc(x.mes).clean };   // replace the slot — never touch the stored message
        if (i === k) found = true;
    }
    if (!found || !m?.is_user) return { onlyOoc: false };
    const sp = splitOoc(m.mes);
    if (!sp.said.length || m.extra?.deeplore_ooc_sent) return { onlyOoc: sp.onlyOoc };
    // Hunt 2 (2026-11-03): SillyTavern hands the interceptor shallow COPIES of the messages — `extra` is still the stored
    // message's own object. Replacing it (as this did) marked only the copy, so every swipe / regenerate sent the same
    // [OOC] to Mero again; marking it in place keeps the mark on her message.
    try { if (m.extra && typeof m.extra === 'object') m.extra.deeplore_ooc_sent = true; else m.extra = { deeplore_ooc_sent: true }; } catch { /* noop */ }
    let t = meroTalks().find(x => x.tag === 'fb' && x.state === 'open');
    if (!t) { t = newTalk('fb'); if (t) t.title = 'From the story box'; }
    if (t) void sendToMero(t.id, sp.said.map(x => `[OOC: ${x}]`).join('\n'));
    return { onlyOoc: sp.onlyOoc };
}

// ── the glow (how chatty — design §11, mock-up v13) ──────────────────────────

const glowStore = () => asGlow(chat_metadata?.[GLOW_KEY]);
function putGlow(g) { chat_metadata[GLOW_KEY] = g; saveMetadataDebounced(); changed(); }

/** Does 💬 glow, and for what (big moments; at Very chatty also threads gone quiet). Reads the board's log only. */
export function meroGlow() {
    try {
        const L = live();
        if (!L) return { glows: false, moments: [] };
        return glowNow(store().settings.glow, L.board, L.state, (getContext()?.chat || []).length - 1, glowStore());
    } catch { return { glows: false, moments: [] }; }
}
/** Miinthe looked (opened the talks): the glow goes out; the moments stay listed until talked about or set aside. */
export function seeGlow() {
    const { moments } = meroGlow(), g = glowStore();
    const fresh = moments.map(m => m.key).filter(k => !g.seen.includes(k));
    if (fresh.length) putGlow({ ...g, seen: [...g.seen, ...fresh] });
}
/** "Not now": these moments are set aside for good. */
export function setMomentsAside(keys) { const g = glowStore(); putGlow({ ...g, done: [...g.done, ...keys.filter(k => !g.done.includes(k))] }); }

/** "Talk about it": a new 💭 talk that Mero opens herself, reacting to the moments. */
export async function talkAboutMoments(keys) {
    const moments = meroGlow().moments.filter(m => keys.includes(m.key));
    if (!moments.length) return { ok: false, error: 'that moment is gone (its message was deleted?)' };
    if (!resolveConnectionConfig('mero').profileId) return { ok: false, error: 'Mero has no connection yet — pick one in Settings › AI & connections › Mero ☆' };
    const t = newTalk('yap'); if (!t) return { ok: false, error: 'Open a character chat first.' };
    t.title = moments[0].quiet ? `Quiet: ${moments[0].tracker}` : `Big moment: ${moments[0].text}`.slice(0, 80); t.mine = true;
    setMomentsAside(keys);
    return sendToMero(t.id, momentOpener(moments, meroNames(store().settings)), { opener: true });
}

/** What a vault review shows her: every entry the writer may see (guides never — they are not story lore). */
/** A vault review reads what this story may read — not the whole vault (Miinthe, 2026-11-04). */
export const reviewEntries = () => meroLore().entries;

/**
 * 📚 Review the vault (/oq-review, ⋯ → Review the vault with Mero): a new talk where the lore this story reads is in front of
 * Mero for every answer in it. Miinthe 2026-10-18: it used to go into the story chat as her message and stay there.
 * Returns { talk, done } — `done` resolves like sendToMero — or { error }.
 */
export function startVaultReview(question = '') {
    if (!resolveConnectionConfig('mero').profileId) return { error: 'Mero has no connection yet — pick one in Settings › AI & connections › Mero ☆' };
    const t = newTalk('yap'); if (!t) return { error: 'Open a character chat first.' };
    t.title = '📚 Vault review'; t.mine = true; t.review = true; saveStore();
    const ask = String(question || '').trim() || 'Could you look over my lore for this story? What doesn\'t fit together, what is missing, which entries could be connected?';
    return { talk: t, done: sendToMero(t.id, ask) };
}

/** "Redo with this note": keep the note, then swipe the last reply — a swipe, so the board's rolls and moves stay. */
export async function redoWithNote(talkId, k, c, fields = {}) {
    const card = findTalk(talkId)?.msgs[k]?.cards?.[c];
    if (card && card.state !== 'kept') keepCard(talkId, k, c, fields);
    const ctx = getContext(), chat = ctx?.chat || [];
    const last = chat.length - 1;
    if (last < 0 || chat[last].is_user) return { ok: false, error: 'the last message is not a reply' };
    if (ctx.swipe?.to) await ctx.swipe.to(null, 'right', { forceSwipeId: Array.isArray(chat[last].swipes) ? chat[last].swipes.length : 1 });
    else await ctx.swipe?.right?.();
    return { ok: true };
}

/** Her summary of this chat's board, for the ⓘ view: { name, map } or null (no board here). */
export function boardMapHere() {
    const n = live()?.board?.name;
    return n ? { name: n, map: getMeroMap(n) } : null;
}
/** Keep Miinthe's version (text), go back to Mero's (null), or write it again (force). */
export async function setBoardMapHere(text) { const n = live()?.board?.name; if (n) await editMeroMap(n, text); return boardMapHere(); }
export async function remakeBoardMapHere() { const n = live()?.board?.name; if (n) await refreshMeroMap(n, { force: true }); return boardMapHere(); }

// ── 🎲 games (Miinthe, 2026-10-27: "mini games with Mero … just for funnies") ─────────────────────────────────────────
// The game picks the word and colors the letters (games/wordle-pure.js); Mero only talks — one short call per line,
// with nothing of the story in it. No AI picked, or the call fails: a ready-made line, and the game goes on.

const lineAsked = new Map();   // talk id → the newest line asked for; an older answer that arrives late is dropped
const rounds = new Map();      // talk id → the round (↻ New word / New game); a line from an older round is dropped (bug hunt)

async function gameLine(t, what, extra = {}) {
    if (store().settings.gameTalk === false && what !== 'hint') return;   // she's kept quiet: only a hint speaks
    const ask = (lineAsked.get(t.id) || 0) + 1; lineAsked.set(t.id, ask);
    const round = rounds.get(t.id) || 0;
    const game = t.game, conn = resolveConnectionConfig('mero');
    let line = '';
    if (conn.profileId) {
        busyOn(t.id); changed();
        try {
            const st = store().settings;
            const before = t.msgs.filter(m => m.who === 'mero').map(m => m.t);
            const { system, user } = gameOf(game).linePrompt(game, what, { persona: st.persona, names: meroNames(st), before, ...extra });
            const r = await callAI(system, user, { ...conn, maxTokens: Math.min(Number(conn.maxTokens) || 300, 300), caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
            line = gameOf(game).safeLine(r?.text, game, what);
        } catch (err) { console.warn('[Onyx Quill] Mero (games): no line, a ready-made one instead:', err?.message || err); }
        finally { busyOff(t.id); }
    }
    // a guess made meanwhile asked for a newer line: this one is old news (the end of a game always speaks)
    if (lineAsked.get(t.id) !== ask && !['won', 'lost', 'draw'].includes(what)) { changed(); return; }
    if ((rounds.get(t.id) || 0) !== round) { changed(); return; }   // a new round started meanwhile: "Another one?" is old news
    const t2 = findTalk(t.id); if (!t2) { changed(); return; }
    t2.msgs.push({ who: 'mero', t: line || gameOf(game).stockLine(game, what), at: new Date().toISOString() });
    t2.updated = new Date().toISOString(); saveStore();
}

/** Start a game in a talk (or a new one after the last): a fresh word / board, Mero says hi. */
export function startGame(talkId, kind = 'wordle') {
    const t = findTalk(talkId); if (!t || !GAMES[kind]) return { ok: false, error: 'no such game' };
    rounds.set(t.id, (rounds.get(t.id) || 0) + 1);
    t.tag = 'game'; t.game = GAMES[kind].newGame(t.game?.kind === kind ? t.game : null);
    t.msgs = [];   // a round is a throwaway: the talk keeps only this round's lines
    if (!t.mine) { t.title = TITLES[kind]; t.mine = true; }
    if (t.state !== 'open') t.state = 'open';
    t.updated = new Date().toISOString(); saveStore();
    gameLine(t, 'start');
    return { ok: true };
}

/** Four in a Row: Miinthe drops in column c (0–6), Mero answers at once; she speaks only when something happened. */
export function gameDrop(talkId, c) {
    const t = findTalk(talkId); if (t?.game?.kind !== 'four') return { ok: false, why: 'over' };
    const r = playFour(t.game, c);
    if (!r.ok) return r;
    t.game = r.game; t.updated = new Date().toISOString(); saveStore();
    if (r.what) gameLine(t, r.what, { facts: r.facts });
    return { ok: true };
}

/** Play a guess. → { ok } or { ok: false, why: 'short' | 'word' | 'over' } (not a word: it doesn't count, Mero teases). */
export function gameGuess(talkId, word) {
    const t = findTalk(talkId); if (t?.game?.kind !== 'wordle') return { ok: false, why: 'over' };
    const r = playGuess(t.game, word);
    if (!r.ok) { if (r.why === 'word') gameLine(t, 'notword', { word }); return r; }
    t.game = r.game; t.updated = new Date().toISOString(); saveStore();
    gameLine(t, r.game.over || 'guess');
    return { ok: true, over: r.game.over };
}

/** A hint. Wordle: from Mero (she is told the word for this one line only). Four in a Row: the game shows a column — no call. */
export function gameHint(talkId) {
    const t = findTalk(talkId); if (!t?.game || t.game.over) return { ok: false };
    if (t.game.kind === 'four') {
        const b = fourBoard(t.game); if (b.over || b.turn !== 'r') return { ok: false };
        const c = pickCol(t.game, Math.random, { hint: true }); if (c < 0) return { ok: false };
        t.game.hints += 1; saveStore();
        return { ok: true, col: c };
    }
    t.game.hints += 1; saveStore();
    gameLine(t, 'hint');
    return { ok: true };
}
