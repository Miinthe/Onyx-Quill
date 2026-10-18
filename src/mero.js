/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆, the co-writer: SillyTavern glue.
 * Rules: mero-pure.js (tested). Design: `10 co-writer design.md`. The tab itself is mero/mero.html (the approved
 * mock-up v13, in host mode), mounted by mero-window.js.
 *
 * Storage:
 *   extension_settings.deeplore_mero = { chars: { [avatar]: { talks } }, notes: { char, run, board }, settings }
 *   chat_metadata.deeplore_mero_notes = [notes for this chat]
 * Mero's AI connection is the pinned "Mero" profile in DeepLore's AI connections (no inherit).
 */
import { chat_metadata, saveSettingsDebounced, name1 } from '../../../../../script.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../../extensions.js';
import { resolveConnectionConfig, getSettings } from '../settings.js';
import { callAI } from './ai/ai.js';
import { vaultIndex } from './state.js';
import { currentCharacter } from './characters.js';
import { runOf } from './characters-pure.js';
import { BOARD_KEY } from './storyboard-pure.js';
import { readActiveTrackers } from './trackers.js';
import { writerBlock } from './trackers-pure.js';
import { liveWriterLines, liveStepJudgeSection, live } from './board-live.js';
import { GLOW_KEY, asGlow, glowNow, recentMoments, momentOpener } from './mero-glow-pure.js';
import { getCurrentForChat } from './verdict/verdict-store.js';
import {
    MERO_KEY, CHAT_NOTES_KEY, asStore, normTalk, normNote, notesHere, inForce, hasRunOut, authorNotesBlock,
    splitOoc, buildMeroPrompt, parseMeroAnswer, fallbackTitle, scopeKey, WHERE_ARE_WE, CHATTY_PRESETS,
} from './mero-pure.js';
import { takePitchCards } from './pitches-pure.js';

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
    if (patch.tag) t.tag = patch.tag;
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

/** The `[Author's notes]` block for the reply being written now (index.js, every generation). */
export function authorNotesForGeneration(type = 'normal') {
    try {
        const list = notesHere(store(), chatNotes(), meroWhere());
        // the writer's initiative (Mero's ☆ settings) rides along as a 🧭 steer; "balanced" says nothing
        const ini = INITIATIVE[store().settings.initiative];
        if (ini) list.unshift({ id: 'initiative', kind: 'steer', text: ini, story: true, last: 'pinned', scope: 'char', on: true, made: { i: -1 } });
        // 🪜 running plans: the current beat, as the plan says the writer sees it (pitches.js)
        for (const text of pitchSink?.writerLines?.() || []) list.push({ id: 'plan', kind: 'steer', text, story: true, last: 'pinned', scope: 'char', on: true, made: { i: -1 } });
        return authorNotesBlock(list, replyCtx(type));
    } catch (err) { console.warn('[DLE] Mero notes skipped:', err?.message || err); return ''; }
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
export const meroBusy = () => busy > 0;

/** What Mero is told: the board, the latest replies, the lore the writer got, the cards, notes. */
function contextPackage() {
    const ctx = getContext(), chat = ctx?.chat || [], s = store();
    const n = s.settings.replies;
    const replies = [];
    for (let k = chat.length - 1; k >= 0 && replies.length < n; k--) {
        const m = chat[k]; if (!m || m.is_system || typeof m.mes !== 'string') continue;
        replies.unshift({ i: k, name: m.is_user ? (name1 || 'Miinthe') : m.name, text: splitOoc(m.mes).clean.slice(0, 2500) });
    }
    let board = [];
    try { board = [writerBlock(readActiveTrackers(), liveWriterLines()), liveStepJudgeSection()].filter(Boolean).join('\n').split('\n'); } catch { /* no board */ }
    const verdict = getCurrentForChat(ctx?.getCurrentChatId?.());
    const titles = (verdict?.injectedSources || []).map(x => x.title).filter(Boolean).slice(0, 8);
    const entries = titles.map(t => { const e = (vaultIndex || []).find(x => x.title === t); return e ? { title: e.title, content: e.content || e.summary || '' } : null; }).filter(Boolean);
    const card = ctx?.characters?.[ctx?.characterId];
    const cards = card ? [`${card.name}: ${String(card.description || '').slice(0, 1500)}`, card.personality ? `Personality: ${String(card.personality).slice(0, 600)}` : '', card.scenario ? `Scenario: ${String(card.scenario).slice(0, 600)}` : ''].filter(Boolean).join('\n') : '';
    const persona = (ctx?.powerUserSettings?.persona_description || '').trim() ? `${name1 || 'Miinthe'} (persona): ${String(ctx.powerUserSettings.persona_description).slice(0, 1000)}` : '';
    const all = meroNotes();
    let moments = [];
    try { const L = live(); if (L) moments = recentMoments(L.board, L.state, chat.length - 1).map(m => `${m.text} (#${m.i})`); } catch { /* no board */ }
    return { replies, board, entries, cards, persona, moments, talkNotes: all.filter(x => !x.story && x.on && !x.ended), storyNotes: all.filter(x => x.inForce) };
}

/** What Mero knows, for her other jobs (💡 pitches): the talk package, who she is, where, Miinthe's name. */
export function meroKnows() { return { pkg: contextPackage(), who: store().settings.persona, where: meroWhere(), user: name1 || 'Miinthe' }; }

// 💡 pitch cards Mero offers in a talk go to the pitches (pitches.js registers itself — no import loop)
let pitchSink = null;
export function setPitchSink(fn) { pitchSink = fn; }

const flatten = messages => messages.map(m => `${m.role === 'user' ? 'Miinthe' : 'Mero'}: ${m.content}`).join('\n\n') + '\n\nMero:';

/**
 * Miinthe says something in a talk; Mero answers. Returns { ok, talk } or { ok: false, error } — the talk keeps
 * Miinthe's message either way. `text` may be the 🧭 question. `opener`: Mero speaks first (a big moment) — `text`
 * is then only her cue, never shown as Miinthe's message.
 */
export async function sendToMero(talkId, text, { opener = false } = {}) {
    const t = findTalk(talkId); if (!t) return { ok: false, error: 'no such talk' };
    const said = String(text || '').trim(); if (!said) return { ok: false, error: 'nothing to send' };
    const first = !t.msgs.some(m => m.who === 'mero');
    if (!opener) t.msgs.push({ who: 'miinthe', t: said, at: new Date().toISOString() });
    if (t.state !== 'open') t.state = 'open';
    t.updated = new Date().toISOString(); saveStore();
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: 'Mero has no connection yet — DeepLore settings → AI Connections → Mero ☆ → pick a profile' };
    const w = meroWhere(), pkg = contextPackage();
    const vault = t.review ? reviewEntries() : null;
    const built = buildMeroPrompt({ settings: store().settings, talk: t, character: w.character, ...pkg, vault, firstAnswer: first && !t.mine });
    const { system } = built, messages = opener ? [...built.messages, { role: 'user', content: said }] : built.messages;
    lastTold.set(t.id, { model: conn.profileId, sections: [
        ['☆ Who Mero is', store().settings.persona], ['📝 Notes just for your talks', pkg.talkNotes.map(n => n.text).join('\n')],
        ['🗺 The board — plans included', pkg.board.join('\n')], [`📜 The latest replies (${pkg.replies.length})`, pkg.replies.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n')],
        ['✨ Big moments lately', pkg.moments.join('\n')], vault ? [`📚 Your whole vault (${vault.length} entries)`, vault.map(e => e.title).join(' · ')] : [`📚 Entries DeepLore sent the writer (${pkg.entries.length})`, pkg.entries.map(e => e.title).join(' · ')], ['🎭 Character and persona cards', [pkg.cards, pkg.persona].filter(Boolean).join('\n\n')],
        ['💬 This talk', flatten(messages)],
    ] });
    busy++; changed();
    try {
        // a vault review: the answer length from Settings (Answer length for /dle-review), and time to read it all
        const rt = getSettings().reviewResponseTokens;
        const callConn = vault ? { ...conn, ...(rt > 0 ? { maxTokens: rt } : {}), timeout: Math.max(conn.timeout || 0, 300000) } : conn;
        const r = await callAI(system, flatten(messages), { ...callConn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
        const raw = r?.text ?? '';
        const told = lastTold.get(t.id); if (told) told.raw = raw;
        if (!raw.trim()) console.warn('[DLE] Mero: the model sent back an empty answer', r);
        const pc = takePitchCards(raw, pitchSink?.castNames?.() || []);
        const a = parseMeroAnswer(pc.text);
        const t2 = findTalk(talkId) || t;
        let pitchNos = [];
        if (pc.pitches.length && pitchSink) { try { pitchNos = pitchSink.add(pc.pitches) || []; } catch (err) { console.warn('[DLE] Mero: pitch cards skipped:', err?.message || err); } }
        t2.msgs.push({ who: 'mero', t: a.text || '…', at: new Date().toISOString(), ...(a.cards.length ? { cards: a.cards } : {}), ...(pitchNos.length ? { pitchNos } : {}) });
        if (first && !t2.mine) t2.title = a.title || fallbackTitle(said);
        t2.updated = new Date().toISOString(); saveStore();
        return { ok: true, talk: t2 };
    } catch (err) {
        console.warn('[DLE] Mero could not answer:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    } finally { busy--; changed(); }
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
    try { m.extra = { ...(m.extra || {}), deeplore_ooc_sent: true }; } catch { /* noop */ }
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
    if (!resolveConnectionConfig('mero').profileId) return { ok: false, error: 'Mero has no connection yet — DeepLore settings → AI Connections → Mero ☆ → pick a profile' };
    const t = newTalk('yap'); if (!t) return { ok: false, error: 'Open a character chat first.' };
    t.title = moments[0].quiet ? `Quiet: ${moments[0].tracker}` : `Big moment: ${moments[0].text}`.slice(0, 80); t.mine = true;
    setMomentsAside(keys);
    return sendToMero(t.id, momentOpener(moments), { opener: true });
}

/** What a vault review shows her: every entry the writer may see (guides never — they are not story lore). */
export const reviewEntries = () => (vaultIndex || []).filter(e => !e.guide);

/**
 * 📚 Review the vault (/dle-review, ⋯ → Review the vault with Mero): a new talk where the whole vault is in front of
 * Mero for every answer in it. Miinthe 2026-10-18: it used to go into the story chat as her message and stay there.
 * Returns { talk, done } — `done` resolves like sendToMero — or { error }.
 */
export function startVaultReview(question = '') {
    if (!resolveConnectionConfig('mero').profileId) return { error: 'Mero has no connection yet — DeepLore settings → AI Connections → Mero ☆ → pick a profile' };
    const t = newTalk('yap'); if (!t) return { error: 'Open a character chat first.' };
    t.title = '📚 Vault review'; t.mine = true; t.review = true; saveStore();
    const ask = String(question || '').trim() || 'Could you look over my whole vault? What doesn\'t fit together, what is missing, which entries could be connected?';
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
