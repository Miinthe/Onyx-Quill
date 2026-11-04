/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆, the co-writer: pure rules. Tested in test/mero.test.mjs.
 * Design: `10 co-writer design.md` (mock-up v13, https://claude.ai/artifact/U271PKBDid3MQEcZkBYDLx).
 *
 * THE ONE RULE: what's said in a talk stays in the talk. Only NOTES Miinthe keeps reach the story.
 *
 * TALKS live with the character (Miinthe, 2026-10-05): every chat and run of a character sees them.
 *   { id, title, mine (Miinthe renamed it), tag: 'yap'|'plan'|'fb'|'game', tagMine? (Miinthe picked the tag — Mero's
 *     [[KIND]] no longer changes it), state: 'open'|'resolved'|'archived', created, updated, summary,
 *     msgs: [{ who: 'author'|'mero', t, at, ctx?, cards?, pitchNos?, planNos?, steps? (Mero's lookups for this answer),
 *              sw? + swi? (↻ redo: every version of Mero's LAST answer, until Miinthe writes again) }],
 *     game? (a 🎲 Games talk: games/games-pure.js — Wordle, Four in a Row) }
 * NOTES — one list, each:
 *   { id, kind: 'dont'|'steer'|'idea'|'fact', text, story (true: the writer gets it; false: only Mero),
 *     last: 'flash'|'sticky'|'pinned', until: { replies?: n }, scope: 'chat'|'run'|'char'|'board',
 *     on, ended?, from? (talk id), made: { i (the chat's last message when it was made), at }, hidden? }
 *   - ⚡ flash: the next reply only — its swipes keep it.   📌 sticky: until N replies.   📍 pinned: until removed.
 *   - A reply counts when the AI writes a NEW message; swipes don't count.
 *   - Where a note applies is a ladder (this chat · this run · the character · the board); all that apply are
 *     in force together. A chat note made at message i is undone when the chat is cut back before i.
 * The writer gets one `[Author's notes]` block: 🚫 first, then 🧭, 📄, then 💡 as "a possible thread — never force it".
 */

export const MERO_KEY = 'onyxquill_mero';              // extension_settings: { v, chars: { [avatar]: { talks } }, notes: { char, run, board }, settings }
export const CHAT_NOTES_KEY = 'deeplore_mero_notes';  // chat_metadata: [notes] for this chat

export const TAGS = { yap: '💭 Yapping', plan: '🗺 Planning', fb: '✋ Feedback', game: '🎲 Games' };
export const KINDS = { dont: '🚫', steer: '🧭', idea: '💡', fact: '📄' };
export const LASTS = ['flash', 'sticky', 'pinned'];
export const SCOPES = ['chat', 'run', 'char', 'board'];

import { normSteps } from './mero-tools-pure.js';
import { ASK_FORMAT, takeAsks, normAsks, withAsked } from './ask-pure.js';
import { meroNames, named, nameRule } from './mero-names-pure.js';
import { normGame } from './games/games-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const MAX_TALK_MSGS = 400;   // a talk keeps its newest messages (settings stay a sane size)

// ── the store ──────────────────────────────────────────────────────────────

const normCards = cards => arr(cards).filter(c => isObj(c) && str(c.text).trim()).map(c => ({ kind: KINDS[c.kind] ? c.kind : 'steer', last: LASTS.includes(c.last) ? c.last : 'pinned', scope: SCOPES.includes(c.scope) ? c.scope : 'chat', text: c.text.trim(), ...(c.state === 'kept' || c.state === 'no' ? { state: c.state } : {}), ...(c.noteId ? { noteId: String(c.noteId) } : {}) }));
const nums = v => arr(v).map(Number).filter(Number.isFinite).slice(0, 10);

/** One version of Mero's answer: what she said and everything that came with it. */
function normVersion(m) {
    return {
        t: str(m.t), ...(m.at ? { at: String(m.at) } : {}),
        ...(normCards(m.cards).length ? { cards: normCards(m.cards) } : {}),   // the note cards she offered, and what Miinthe did with each
        ...(nums(m.pitchNos).length ? { pitchNos: nums(m.pitchNos) } : {}),   // 💡 pitches made from this message (their numbers)
        ...(nums(m.planNos).length ? { planNos: nums(m.planNos) } : {}),      // …of which these are 🪜 plans
        ...(arr(m.pitchIds).length ? { pitchIds: arr(m.pitchIds).map(String).slice(0, 10) } : {}),   // …their ids (numbers repeat across chats)
        ...(normSteps(m.steps).length ? { steps: normSteps(m.steps) } : {}),  // 🔎 her lookups for this answer
        ...(m.nolook ? { nolook: true } : {}),                                  // …or: her AI can't look things up
        ...(normAsks(m.asks).length ? { asks: normAsks(m.asks) } : {}),         // ❓ her question cards, with Miinthe's picks once answered (ask-pure.js)
        ...(m.pcheck ? { pcheck: true } : {}),                                  // …asked before 💡 Pitch writes the talk up
    };
}
function normMsg(m) {
    const out = { who: m.who === 'mero' ? 'mero' : 'author', ...normVersion(m) };   // the old label 'miinthe' becomes 'author'   // (📎 context stays in memory only, as before)
    if (m.who === 'mero' && arr(m.sw).length > 1) {
        const sw = arr(m.sw).filter(isObj).slice(-12).map(normVersion);
        out.sw = sw; out.swi = Math.max(0, Math.min(sw.length - 1, Math.round(Number(m.swi) || 0)));
    }
    return out;
}

/** ↻ The versions of message k (only Mero's last answer has more than one): [version], current index. */
export function versionsOf(m) { return arr(m?.sw).length > 1 ? { list: m.sw, at: m.swi || 0 } : { list: [normVersion(m || {})], at: 0 }; }
/** Show version `i` of a message: its fields become the message's; the versions stay. */
export function showVersion(m, i) {
    const { list, at } = versionsOf(m);
    const k = Math.max(0, Math.min(list.length - 1, i));
    const saved = list.slice(); saved[at] = normVersion(m);   // what changed on the shown one (a card kept) is kept with it
    for (const f of ['t', 'at', 'cards', 'pitchNos', 'planNos', 'pitchIds', 'steps', 'nolook', 'asks', 'pcheck']) delete m[f];
    Object.assign(m, saved[k]); m.sw = saved; m.swi = k;
    return m;
}
/** ↻ Add a new version (the redo's answer) and show it. */
export function addVersion(m, v) {
    const { list, at } = versionsOf(m);
    const saved = list.slice(); saved[at] = normVersion(m);
    saved.push(normVersion(v));
    return showVersion(Object.assign(m, { sw: saved, swi: at }), saved.length - 1);
}
/** Miinthe wrote again: the swipes are gone — every message keeps only the version shown (no long-term storage, Miinthe 2026-11-02). */
export function dropSwipes(msgs) { for (const m of arr(msgs)) { delete m.sw; delete m.swi; } return msgs; }

export function normTalk(t) {
    if (!isObj(t)) return null;
    return {
        id: str(t.id) || newId('t'), title: str(t.title, 'A new talk').trim() || 'A new talk', ...(t.mine ? { mine: true } : {}),
        ...(t.review ? { review: true } : {}),   // a vault review (Miinthe 2026-10-18: out of the story chat, into Mero)
        tag: TAGS[t.tag] ? t.tag : 'yap', ...(t.tagMine ? { tagMine: true } : {}), state: ['open', 'resolved', 'archived'].includes(t.state) ? t.state : 'open',
        created: str(t.created) || new Date().toISOString(), updated: str(t.updated) || str(t.created) || new Date().toISOString(),
        summary: str(t.summary),
        ...(normGame(t.game) ? { game: normGame(t.game) } : {}),   // 🎲 Games (Miinthe, 2026-10-27)
        msgs: arr(t.msgs).filter(m => isObj(m) && (m.who === 'author' || m.who === 'miinthe' || m.who === 'mero') && typeof m.t === 'string').slice(-MAX_TALK_MSGS).map(normMsg),   // 'miinthe' = the author's messages before 2026-11-03
    };
}

export function normNote(n) {
    if (!isObj(n) || !str(n.text).trim()) return null;
    const last = LASTS.includes(n.last) ? n.last : 'pinned';
    const replies = Math.max(1, Math.round(Number(n.until?.replies) || 5));
    return {
        id: str(n.id) || newId('n'), kind: KINDS[n.kind] ? n.kind : 'steer', text: n.text.trim(), story: n.story !== false,
        last, ...(last === 'sticky' ? { until: { replies } } : {}), scope: SCOPES.includes(n.scope) ? n.scope : 'chat',
        on: n.on !== false, ...(n.ended ? { ended: true } : {}), ...(n.from ? { from: String(n.from) } : {}), ...(n.hidden ? { hidden: true } : {}),
        ...(n.taste === 'up' || n.taste === 'down' ? { taste: n.taste } : {}),   // 💡 what Miinthe liked / didn't (pitches-pure.js)
        made: { i: Number.isFinite(Number(n.made?.i)) ? Math.floor(Number(n.made.i)) : 0, at: str(n.made?.at) || new Date().toISOString() },
    };
}

export function asStore(raw) {
    const s = isObj(raw) ? raw : {};
    const chars = {};
    for (const [k, c] of Object.entries(isObj(s.chars) ? s.chars : {})) {
        if (!k || !isObj(c)) continue;
        chars[k] = { talks: arr(c.talks).map(normTalk).filter(Boolean) };
    }
    const notes = { char: {}, run: {}, board: {} };
    for (const sc of ['char', 'run', 'board']) for (const [k, l] of Object.entries(isObj(s.notes?.[sc]) ? s.notes[sc] : {})) {
        const list = arr(l).map(normNote).filter(Boolean);
        if (list.length) notes[sc][k] = list;
    }
    const st = isObj(s.settings) ? s.settings : {};
    return {
        v: 1, chars, notes,
        settings: {
            persona: str(st.persona, DEFAULT_PERSONA),
            callMe: str(st.callMe).trim().slice(0, 40),     // what she calls the author ('' = no name) — mero-names-pure.js
            ...chattiness(st),
            initiative: Math.max(0, Math.min(4, Math.round(Number(st.initiative ?? 2)))),
            replies: Math.max(2, Math.min(40, Math.round(Number(st.replies) || 12))),   // the latest replies Mero reads
            // her job — the lore upkeep (Miinthe, 2026-10-05: not under one three-option setting, "its risky"): how often she
            // checks the entries; and, apart from it, whether a change needs Miinthe's sign-off (default yes). Before: one
            // "entry changes" setting — off became Off duty, "apply on their own" became no sign-off.
            job: JOBS.includes(st.job) ? st.job : st.entryChanges === 'off' ? 'off' : 'part',
            signoff: typeof st.signoff === 'boolean' ? st.signoff : st.entryChanges !== 'auto',
            gameTalk: st.gameTalk !== false,   // 🎲 Mero comments on the games (Miinthe, 2026-11-03: off if you like — hints still come); switched in the game itself
            web: st.web !== false,   // 🌐 she may search the web when she needs to (2026-11-03; needs a search set up in SillyTavern — mero-web.js)
        },
    };
}

/** Mero's job (Miinthe's idea, 2026-10-05): 🛋 off duty · 🧾 freelancer (when hired) · 🕐 part-timer · 💼 full-timer. */
export const JOBS = ['off', 'freelance', 'part', 'full'];

/**
 * How chatty — three parts (Miinthe, 2026-10-05), with Quiet / Chatty / Very chatty as one-click presets; any other mix
 * is "custom". How MUCH she talks (Miinthe: "the yapper setting is how much she talks not HOW she talks" — her style is
 * in her personality) · whether she brings things up herself · the glow (off · big moments · + quiet threads).
 */
export const CHATTY_PRESETS = {
    quiet: { talk: 'little', bringUp: false, glow: 'off' },
    chatty: { talk: 'some', bringUp: false, glow: 'big' },
    very: { talk: 'lots', bringUp: true, glow: 'quiet' },
};
const OLD_TALK = { short: 'little', warm: 'some', yapper: 'lots' };   // the names of the first build (same day)
function chattiness(st) {
    const base = CHATTY_PRESETS[st.chatty] || CHATTY_PRESETS.chatty;   // an older store had only the preset
    const c = {
        talk: ['little', 'some', 'lots'].includes(st.talk) ? st.talk : OLD_TALK[st.talk] || base.talk,
        bringUp: typeof st.bringUp === 'boolean' ? st.bringUp : base.bringUp,
        glow: ['off', 'big', 'quiet'].includes(st.glow) ? st.glow : base.glow,
    };
    // Custom picked on purpose stays Custom (its three parts show under it), even while they match a preset (2026-11-03)
    if (st.chatty === 'custom') return { chatty: 'custom', ...c };
    const preset = Object.keys(CHATTY_PRESETS).find(k => Object.entries(CHATTY_PRESETS[k]).every(([f, v]) => c[f] === v));
    return { chatty: preset || 'custom', ...c };
}

export const DEFAULT_PERSONA = 'Warm, nerdy co-author and story bestie. Gets excited about angst and slow burn, teases a little, isn\'t afraid to disagree, never lectures. Calls things out honestly and always says why.';

/** Where a note of `scope` lives in the store (chat notes live in the chat, not here). */
export const scopeKey = (scope, { charKey = '', run = '', board = '' } = {}) => (scope === 'char' ? charKey : scope === 'run' ? (charKey && run ? `${charKey}|${run}` : '') : scope === 'board' ? board : '');

// ── notes in force ─────────────────────────────────────────────────────────

/**
 * How many NEW AI replies the chat has after message `i`, up to (not including) `replyIndex`.
 * `isAi(k)` tells whether message k is an AI reply. Swipes are the same message, so they never count.
 */
export function repliesAfter(i, replyIndex, isAi) {
    let n = 0;
    for (let k = i + 1; k < replyIndex; k++) if (isAi(k)) n++;
    return n;
}

/**
 * Is a story note in force for the reply being written at `replyIndex` (the index the new AI message gets —
 * on a swipe, the index of the message being swiped)? Ended or off notes never are.
 * A chat note made after the chat's current end (`lastIndex`) was undone by a delete.
 */
export function inForce(n, { replyIndex, lastIndex = replyIndex - 1, isAi = () => true }) {
    if (!n || !n.on || n.ended || !n.story) return false;
    if (n.scope === 'chat' && n.made.i > lastIndex) return false;
    const done = repliesAfter(n.made.i, replyIndex, isAi);
    if (n.last === 'flash') return done === 0;
    if (n.last === 'sticky') return done < (n.until?.replies || 5);
    return true;
}

/** A note whose time is up is ended (flash after its reply, sticky after N replies) — for the 📝 list. */
export function hasRunOut(n, { lastIndex, isAi = () => true }) {
    if (!n || n.ended || n.last === 'pinned') return false;
    const done = repliesAfter(n.made.i, lastIndex + 1, isAi);
    return n.last === 'flash' ? done >= 1 : done >= (n.until?.replies || 5);
}

/** All notes that apply here, from every rung of the ladder (chat, run, character, board). */
export function notesHere(store, chatNotes, ctx = {}) {
    const s = asStore(store);
    const out = arr(chatNotes).map(normNote).filter(Boolean).map(n => ({ ...n, scope: 'chat' }));
    for (const sc of ['run', 'char', 'board']) {
        const k = scopeKey(sc, ctx);
        if (k) out.push(...arr(s.notes[sc][k]).map(n => ({ ...n, scope: sc })));
    }
    return out;
}

const KIND_ORDER = ['dont', 'steer', 'fact', 'idea'];
const KIND_LINE = { dont: 'DON\'T', steer: 'STEER', fact: 'FACT', idea: 'POSSIBLE THREAD (never force it)' };

/** The `[Author's notes]` block for the writer ('' when nothing is in force). */
export function authorNotesBlock(notes, ctx) {
    const live = arr(notes).filter(n => inForce(n, ctx));
    if (!live.length) return '';
    live.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    return ['[Author\'s notes — follow these]', ...live.map(n => `${KINDS[n.kind]} ${KIND_LINE[n.kind]}: ${n.text}`), '[End of author\'s notes]'].join('\n');
}

// ── [OOC: …] ───────────────────────────────────────────────────────────────

const OOC_RE = /\[OOC:\s*([^\]]*)\]/gi;
/** Miinthe's `[OOC: …]` brackets in a story message: the text without them (for the writer) and what they said (for Mero). */
export function splitOoc(text) {
    const said = [];
    const clean = String(text ?? '').replace(OOC_RE, (_, x) => { if (x.trim()) said.push(x.trim()); return ''; }).replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
    return { clean, said, onlyOoc: said.length > 0 && !clean };
}

// ── talking to Mero ────────────────────────────────────────────────────────

/**
 * Mero reads the room (Miinthe, 2026-11-02: the tags are "a little clumsy in the long run" — a yap turns into planning,
 * and the tag stayed put). One rule for every talk; the tag only sorts the list and fills itself in ([[KIND]]).
 * Planning stays the partner of 2026-10-26 ("plan like discussing with a partner"), and it ends in a REAL pitch:
 * the 💡 Pitch button under the talk writes up what the two of them worked out (pitches.js pitchFromTalk).
 */
const READ_ROOM = `Read the room: what {{author}} writes tells you what this talk is right now, and it may change as you go.
- A hello or small talk: a short, friendly answer.
- Talking about the story: react, have opinions, enjoy it with them.
- Planning (where the story goes, a scene, an arc, an event): think it through WITH them, like a writing partner across the table. Build on their ideas and bring your own, one thing at a time; say honestly what works and what clashes with the story or the board. Don't pile up questions. When something is settled, sum it up in one line ("So far: …").
- Feedback on a reply ("I don't like that"): look at the latest replies, say out of character what went wrong, and work out the fix with them.`;
/** How a plan becomes real (Miinthe 2026-11-02: "just discussing it in the mero chat is not enough … both should give me a real pitch"). */
const PITCH_BUTTON = '{{author}} turns what you two planned into real pitch cards with the 💡 Pitch button under this talk: it writes up what you worked out together (their ideas and yours), and from there they send it to the writer, keeps it, edits it or drops it. When a plan has clearly come together, you may say ONCE that they can press 💡 Pitch now. Never write pitch cards or markup yourself, and never say you can\'t make pitches.';
const PITCH_ASKED = '{{author}} just asked for a pitch: right after your answer the app writes this talk up as pitch cards for them. So keep your answer to a line or two — what goes into it, or what is still open — and don\'t write the pitch out in full.';
/** The tag fills itself in (unless Miinthe picked one). */
const KIND_ASK = 'At the very end, on its own line: [[KIND]]yap|plan|fb[[/KIND]] — what this talk is mostly about now: yap (talking about the story), plan (planning where it goes), fb (fixing a reply).';
// how MUCH she says — never how (that's "who Mero is")
const TALK = {
    little: 'Say little: answer what {{author}} asks in a few sentences, nothing extra.',
    some: 'Answer at a natural length; now and then add a thought of your own or a question back.',
    lots: 'Say a lot: long, full answers — add your own thoughts, side tracks and questions back.',
};
const BRING_UP = 'Bring things up yourself: what just happened on the board, a thread gone quiet, something you noticed.';

export const NOTE_FORMAT = 'To offer a note, add on its own line at the end: [[NOTE kind=dont|steer|idea|fact last=flash|sticky|pinned scope=chat|run|char|board]] the note text [[/NOTE]] — one per note. Offer a note ONLY when {{author}} asks for one ("make that a note", a wrap-up). In a talk about fixing a reply you may ASK once whether they want it as a note — don\'t write the card until they say yes. Never right after {{author}} corrects you. A note is SHORT — one or two plain sentences the writer can follow, no explanations (those belong in your answer). {{author}} decides whether to keep it.';

/**
 * Mero's prompt: who she is, the kind of talk, what she knows (the board, the latest replies, the lore the
 * writer got, the cards, notes just for these talks), then the talk itself as messages.
 * Returns { system, messages: [{ role: 'user'|'assistant', content }] }.
 */
/** Said last, after the story replies (Miinthe, 2026-10-20: Mero acted as the writer, made up story details, and wrote Miinthe's lines). */
const GROUND_HEAD = `\n## Ground rules for this talk (read these last)
- You are NOT the writer of the roleplay: a separate writer writes the story replies, you only talk about them with {{author}}. Never say you will write, use or avoid something in the story yourself.
- The replies above are reference material. Never continue them or write in their voice.
- Answer ONLY as Mero. Never write {{author}}'s side, and never start a line with "{{author}}:" or "Mero:".
- Don't add story details {{author}} hasn't given you that aren't in the replies, the board or the lore. If you are guessing, say "I'm guessing".
- When {{author}} tells you what they want (a plan, a pitch, a scene, an event), build it with them right away from what they gave you. Don't question their premise or re-argue what they decided; ask at most ONE question, and only after you've built something.
- Planning ahead is not the current scene. What the latest replies or the story state show right now never overrules a plan {{author}} describes for later — plan forward from their idea.
- Don't just agree. If an idea doesn't fit, say so kindly and say why — once, briefly, then help with what they chose.`;
const GROUND_NAMES_ONLY = `- You see the storyboard as a summary: each tracker, at most a line on what it is about, its step names, and where each stands. You do NOT know what happens in a step unless its details were looked up for this message (marked "Looked up on the board"). When {{author}} points at a tracker or step you have no details of, say so plainly and ask — never pretend you looked it up or know what it says. Your hunches from the names are welcome; say they are hunches.`;
// with lookups (2026-11-02): "look it up" replaces "say you can't see it" — the old rules made her timid and vague
const GROUND_LOOKUPS = `- You can look things up: search_lore and read_lore (their lore), open_tracker (a tracker of the board in detail), search_chat and read_messages (the WHOLE roleplay, not only the latest replies), check_cast (someone in the Cast). When {{author}} points at something you weren't given, or you would be guessing about the lore, the board or something that happened earlier: look it up first, then answer. Don't ask them to tell you what you can look up, and never pretend you looked. If a lookup finds nothing, say so plainly. Don't look up what is already in front of you.`;
const GROUND_TAIL = `- When {{author}} corrects you or points at something, first say in one line what you understood, and check it against what you were given. Don't jump to a new idea or a note in the same answer.
- Keep it conversational unless {{author}} asks for more.`;
/** Said last, after the story replies (Miinthe, 2026-10-20: Mero acted as the writer, made up story details, and wrote Miinthe's lines). */
// 🌐 the web (2026-11-03): only for the real world — her story is never "corrected" from it
const GROUND_WEB = `- You can also search the web (search_web, then read_page for a result worth reading) — for real-world facts and official game or book lore you don't know or need to check. Search only when it helps; say where a fact came from. Their own lore, board and chat ALWAYS win: when the web disagrees with their story, their story is right and the difference is their choice.`;
export const groundRules = (lookups, web = false) => [GROUND_HEAD, lookups ? GROUND_LOOKUPS : GROUND_NAMES_ONLY, ...(lookups && web ? [GROUND_WEB] : []), GROUND_TAIL].join('\n');
export const GROUND_RULES = groundRules(false);

/** A vault review talk: the whole vault is in front of her (what /oq-review used to post into the story chat). */
const VAULT_REVIEW = '{{author}} asked you to review their lore vault (all of it is below). Be concrete and name the entries: contradictions between entries, gaps, connections they may not have made, entries that say too little to be useful. Never rewrite their entries — say what you would change and why, and let them decide.';

/**
 * Notes for Mero ☆ (vault notes with the `lorebook-guide` tag — DeepLore called them writing guides): never sent to the
 * writing AI — Mero reads them, in her talks and her pitches (Miinthe, 2026-11-03: they were Emma's; since she left nothing
 * read them). Named apart from the board's 🧭 guidance (an entry kind that DOES go to the writer) — Miinthe: "we need to give
 * it two different names". Only those in this chat's folders (a
 * story's style guide stays with that story; notes outside any folder count everywhere).
 */
export const GUIDE_MAX = 4000;   // characters for all guides together
export const GUIDE_HEADING = "Notes {{author}} wrote for you only (the writer never sees them) — background, plans and secrets for your ideas, notes and pitches; never spoil them, and they are not story events";
export function guidesIn(entries, folders = null) {
    const fs = Array.isArray(folders) && folders.length ? folders : null;
    return arr(entries).filter(e => e && e.guide && str(e.title).trim() && (!fs || !e.folderPath || fs.some(f => e.folderPath === f || String(e.folderPath).startsWith(f + '/'))));
}
/** The guides as text for a prompt, the whole set capped at GUIDE_MAX (each one at most 1500 characters). */
export function guidesText(guides) {
    let out = '';
    for (const g of arr(guides)) {
        const one = `### ${str(g.title).trim()}\n${String(g.content || '').trim().slice(0, 1500)}`;
        if (out && out.length + one.length + 2 > GUIDE_MAX) break;
        out += (out ? '\n\n' : '') + one.slice(0, GUIDE_MAX);
    }
    return out;
}

export function buildMeroPrompt({ settings = {}, talk, character = '', persona = '', cards = '', board = [], replies = [], entries = [], talkNotes = [], storyNotes = [], moments = [], world = '', vault = null, guides = [], firstAnswer = false, boardMap = [], lookups = false, web = false, pitchAsked = false } = {}) {
    const st = { persona: DEFAULT_PERSONA, talk: 'some', bringUp: false, ...settings };
    const names = meroNames(st), N = t => named(t, names);   // the chosen names, in her instructions only
    const sec = (h, body) => (body && String(body).trim() ? `\n## ${N(h)}\n${String(body).trim()}` : '');
    const system = [
        N(`You are Mero ☆, {{author}}'s co-writer and story bestie for their roleplay${character ? ` with ${character}` : ''}.`) + ` ${st.persona}`,
        N('You talk with {{author}} OUT OF CHARACTER, about the story. Nothing you say reaches the story — only notes {{author}} keeps do. Never write story prose for the roleplay unless they ask for an example.'),
        N('Say what you actually think. Be specific about the story: names, moments, quotes. Never invent facts about the story or {{author}}\'s lore; if you don\'t know, say so.'),
        nameRule(names),
        N(READ_ROOM),
        N(TALK[st.talk] || TALK.some),
        // Miinthe 2026-10-18: "Mero is jumping right into the story with a lot of text even though I said just hello"
        N(st.bringUp
            ? 'Match what {{author}} writes: a hello or small talk gets a short, friendly answer — at most one thing you noticed, in a sentence or two.'
            : 'Match what {{author}} writes: a hello or small talk gets a short, friendly answer (ask what they feel like doing) — go into the story only once they bring something up.'),
        st.bringUp ? N(BRING_UP) : '',
        N(NOTE_FORMAT),
        vault ? '' : N(PITCH_BUTTON),
        vault ? '' : N(ASK_FORMAT),   // question cards (Miinthe, 2026-11-02)
        pitchAsked && !vault ? N(PITCH_ASKED) : '',
        talk?.tagMine || vault ? '' : KIND_ASK,
        firstAnswer ? 'This is the first answer of the talk: also add on its own line at the very end [[TITLE]] a short title for this talk, 2-6 words [[/TITLE]].' : '',
        sec('Notes just for your talks (what you know about {{author}})', talkNotes.map(n => `- ${n.text}`).join('\n')),
        sec('Notes the writer follows right now', storyNotes.map(n => `- ${KINDS[n.kind]} ${n.text}`).join('\n')),
        sec(GUIDE_HEADING, guidesText(guides)),   // her writing guides (sec runs the heading through N)
        sec('The storyboard at a glance (a summary — you may know more than the writer; never spoil it unasked)', arr(boardMap).join('\n')),
        sec('Where the story stands now (what the writer is told)', board.join('\n')),
        sec(st.bringUp ? 'Big moments lately (bring them up yourself if {{author}} hasn\'t yet)' : 'Big moments lately', moments.map(m => `- ${m}`).join('\n')),
        // world layer stage 5 (Miinthe, 2026-10-19: Mero gets "a short summary of the world", can talk about it and pitch from it)
        sec('The world around the story (chatter, rumors, messages — people in the story know only what they heard)', world),
        vault ? N(VAULT_REVIEW) : '',
        vault ? sec(`{{author}}'s whole lore vault (${vault.length} entries)`, vault.map(e => `### ${e.title}\n${String(e.content || '').trim()}`).join('\n\n')) : '',
        vault ? '' : sec('Lore the writer was given for the last reply', entries.map(e => `### ${e.title}\n${String(e.content || '').slice(0, 1200)}`).join('\n\n')),
        sec('Character and persona', [cards, persona].filter(Boolean).join('\n\n')),
        sec('The latest replies of the roleplay', replies.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n')),
        N(groundRules(lookups, web)),
    ].filter(Boolean).join('\n');
    // context Miinthe added to a message (the 📎 picker: a post, a rumor, a conversation, a lore entry) goes with it
    const withCtx = m => (arr(m.ctx).length ? `${m.t}\n\n${N('[Context {{author}} added]')}\n${m.ctx.map(c => `### ${c.label}\n${String(c.text || '').slice(0, 2000)}`).join('\n\n')}` : m.t);
    const messages = arr(talk?.msgs).map(m => ({ role: m.who === 'author' ? 'user' : 'assistant', content: m.who === 'author' ? withCtx(m) : withAsked(m) }));
    return { system, messages };
}

/**
 * Did Miinthe ask for a note in this message? (Miinthe 2026-10-26: "too quick to make notes".) Outside Feedback talks, note
 * cards are kept only then — the instruction alone let one slip through in six test answers.
 */
export const askedForNote = text => /\bnotes?\b|wrap[ -]?up|make (?:that|this|it) (?:a|into a)\b|note card/i.test(String(text ?? ''));

/**
 * Did Miinthe ask for a pitch in this message? (Miinthe 2026-11-02: "how the fuck is it suppose to turn into a real pitch?")
 * Then the talk is written up as pitch cards right after Mero's answer — the same as pressing 💡 Pitch.
 */
export const askedForPitch = text => {
    const t = String(text ?? '').toLowerCase();
    if (/\b(?:don'?t|do not|no need to|not yet)\b[^.?!]{0,25}\b(?:make|turn|write|pitch)/.test(t)) return false;
    return /\b(?:make|turn|writ|put|giv|want|need|get|suggest|offer)\w*\b[^.?!]{0,40}\bpitch(?:es)?\b/.test(t) || /\bpitch (?:it|this|that|me)\b|\bas (?:a )?pitch(?:es)?\b|\binto (?:a )?pitch|\bpitch card/.test(t);
};

const NOTE_RE = /\[\[NOTE([^\]]*)\]\]([\s\S]*?)\[\[\/NOTE\]\]/gi;
const TITLE_RE = /\[\[TITLE\]\]([\s\S]*?)\[\[\/TITLE\]\]/i;
const KIND_RE = /\[\[KIND\]\]\s*(\w+)\s*\[\[\/KIND\]\]/i;
// leftovers of the old inline pitch markup are never shown (the 💡 Pitch button makes pitches now)
const OLD_PITCH_RE = /\[\[PITCH[^\]]*\]\][\s\S]*?\[\[\/PITCH\]\]/gi;
/** Mero's answer: the text Miinthe reads, the note cards she offered, a title (first answer), what the talk is about now ([[KIND]]). */
export function parseMeroAnswer(text, names = {}) {
    const cards = [];
    let title = null, kind = null;
    // a model that finishes an "author: … Mero: …" script may open with "Mero:" and then write the author's next line — keep
    // only Mero's part. The author's line starts with their chosen name or "The author" / "Author" (never the persona's
    // name: Mero may quote a story line that starts with it).
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const who = ['The author', 'Author', ...[names.you].filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())].map(esc).join('|');
    const me = esc(String(names.me || '').trim() || 'Mero');
    text = String(text ?? '').replace(new RegExp(`^\\s*(?:${me}|Mero)\\s*:\\s*`, 'i'), '').split(new RegExp(`\\n[ \\t]*(?:${who})[ \\t]*:`, 'i'))[0];
    let t = String(text ?? '').replace(OLD_PITCH_RE, '').replace(KIND_RE, (_, x) => { const k = x.toLowerCase(); if (['yap', 'plan', 'fb'].includes(k)) kind = k; return ''; }).replace(TITLE_RE, (_, x) => { title = x.replace(/\s+/g, ' ').trim().replace(/^["“]|["”.]$/g, '').slice(0, 60) || null; return ''; });
    t = t.replace(NOTE_RE, (_, attrs, body) => {
        const a = Object.fromEntries([...String(attrs).matchAll(/(\w+)=([\w|]+)/g)].map(m => [m[1], m[2].split('|')[0]]));
        const n = normNote({ kind: a.kind, last: a.last, scope: a.scope, text: body.trim() });
        if (n) cards.push({ kind: n.kind, last: n.last, scope: n.scope, text: n.text });
        return '';
    });
    const q = takeAsks(t);
    return { text: q.text, cards, title, kind, asks: q.asks };
}

/** A smart title from Miinthe's first message when Mero gave none (a fallback, never Miinthe's own title). */
export function fallbackTitle(t) {
    const w = String(t ?? '').replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    return w ? (w.length > 48 ? w.slice(0, 48).replace(/\s\S*$/, '') + '…' : w) : 'A new talk';
}

/** The 🧭 Where are we? question, as Miinthe's message in the talk. */
export const WHERE_ARE_WE = '🧭 Where are we? Give me a short recap: where each running tracker stands and how long since it last moved, open threads, what\'s coming up (dates), what\'s around the scene — and whether the story has wandered off the board.';
