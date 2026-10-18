/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆, the co-writer: pure rules. Tested in test/mero.test.mjs.
 * Design: `10 co-writer design.md` (mock-up v13, https://claude.ai/artifact/U271PKBDid3MQEcZkBYDLx).
 *
 * THE ONE RULE: what's said in a talk stays in the talk. Only NOTES Miinthe keeps reach the story.
 *
 * TALKS live with the character (Miinthe, 2026-10-05): every chat and run of a character sees them.
 *   { id, title, mine (Miinthe renamed it), tag: 'yap'|'plan'|'fb', state: 'open'|'resolved'|'archived',
 *     created, updated, summary, msgs: [{ who: 'miinthe'|'mero', t, at }] }
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

export const MERO_KEY = 'deeplore_mero';              // extension_settings: { v, chars: { [avatar]: { talks } }, notes: { char, run, board }, settings }
export const CHAT_NOTES_KEY = 'deeplore_mero_notes';  // chat_metadata: [notes] for this chat

export const TAGS = { yap: '💭 Yapping', plan: '🗺 Planning', fb: '✋ Feedback' };
export const KINDS = { dont: '🚫', steer: '🧭', idea: '💡', fact: '📄' };
export const LASTS = ['flash', 'sticky', 'pinned'];
export const SCOPES = ['chat', 'run', 'char', 'board'];

import { PITCH_FORMAT } from './pitches-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const MAX_TALK_MSGS = 400;   // a talk keeps its newest messages (settings stay a sane size)

// ── the store ──────────────────────────────────────────────────────────────

export function normTalk(t) {
    if (!isObj(t)) return null;
    return {
        id: str(t.id) || newId('t'), title: str(t.title, 'A new talk').trim() || 'A new talk', ...(t.mine ? { mine: true } : {}),
        ...(t.review ? { review: true } : {}),   // a vault review (Miinthe 2026-10-18: out of the story chat, into Mero)
        tag: TAGS[t.tag] ? t.tag : 'yap', state: ['open', 'resolved', 'archived'].includes(t.state) ? t.state : 'open',
        created: str(t.created) || new Date().toISOString(), updated: str(t.updated) || str(t.created) || new Date().toISOString(),
        summary: str(t.summary),
        msgs: arr(t.msgs).filter(m => isObj(m) && (m.who === 'miinthe' || m.who === 'mero') && typeof m.t === 'string').slice(-MAX_TALK_MSGS).map(m => ({ who: m.who, t: m.t, ...(m.at ? { at: String(m.at) } : {}),
            // the note cards Mero offered with this message, and what Miinthe did with each (kept / no)
            ...(arr(m.pitchNos).length ? { pitchNos: arr(m.pitchNos).map(Number).filter(Number.isFinite).slice(0, 10) } : {}),   // 💡 pitches Mero made in this message
            ...(arr(m.cards).length ? { cards: arr(m.cards).filter(c => isObj(c) && str(c.text).trim()).map(c => ({ kind: KINDS[c.kind] ? c.kind : 'steer', last: LASTS.includes(c.last) ? c.last : 'pinned', scope: SCOPES.includes(c.scope) ? c.scope : 'chat', text: c.text.trim(), ...(c.state === 'kept' || c.state === 'no' ? { state: c.state } : {}), ...(c.noteId ? { noteId: String(c.noteId) } : {}) })) } : {}) })),
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
            ...chattiness(st),
            initiative: Math.max(0, Math.min(4, Math.round(Number(st.initiative ?? 2)))),
            replies: Math.max(2, Math.min(40, Math.round(Number(st.replies) || 12))),   // the latest replies Mero reads
            // her job — the lore upkeep (Miinthe, 2026-10-05: not under one three-option setting, "its risky"): how often she
            // checks the entries; and, apart from it, whether a change needs Miinthe's sign-off (default yes). Before: one
            // "entry changes" setting — off became Off duty, "apply on their own" became no sign-off.
            job: JOBS.includes(st.job) ? st.job : st.entryChanges === 'off' ? 'off' : 'part',
            signoff: typeof st.signoff === 'boolean' ? st.signoff : st.entryChanges !== 'auto',
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

const TAG_RULES = {
    yap: 'This is a YAPPING talk: just talk about the story — react, have opinions, enjoy it with Miinthe. Offer no notes unless Miinthe asks for one.',
    plan: 'This is a PLANNING talk: bring ideas, ask good questions, and when something is agreed, offer it as an idea note.',
    fb: 'This is a FEEDBACK talk ("I don\'t like that"): look at the latest replies, answer out of character, and offer a firm 🚫 note or a 🧭 steer note that would fix it.',
};
// how MUCH she says — never how (that's "who Mero is")
const TALK = {
    little: 'Say little: answer what Miinthe asks in a few sentences, nothing extra.',
    some: 'Answer at a natural length; now and then add a thought of your own or a question back.',
    lots: 'Say a lot: long, full answers — add your own thoughts, side tracks and questions back.',
};
const BRING_UP = 'Bring things up yourself: what just happened on the board, a thread gone quiet, something you noticed.';

export const NOTE_FORMAT = 'To offer a note, add on its own line at the end: [[NOTE kind=dont|steer|idea|fact last=flash|sticky|pinned scope=chat|run|char|board]] the note text [[/NOTE]] — one per note, only when it truly helps. A note is SHORT — one or two plain sentences the writer can follow, no explanations (those belong in your answer). Miinthe decides whether to keep it.';

/**
 * Mero's prompt: who she is, the kind of talk, what she knows (the board, the latest replies, the lore the
 * writer got, the cards, notes just for these talks), then the talk itself as messages.
 * Returns { system, messages: [{ role: 'user'|'assistant', content }] }.
 */
/** A vault review talk: the whole vault is in front of her (what /dle-review used to post into the story chat). */
const VAULT_REVIEW = 'Miinthe asked you to review her lore vault (all of it is below). Be concrete and name the entries: contradictions between entries, gaps, connections she may not have made, entries that say too little to be useful. Never rewrite her entries — say what you would change and why, and let her decide.';

export function buildMeroPrompt({ settings = {}, talk, character = '', persona = '', cards = '', board = [], replies = [], entries = [], talkNotes = [], storyNotes = [], moments = [], vault = null, firstAnswer = false } = {}) {
    const st = { persona: DEFAULT_PERSONA, talk: 'some', bringUp: false, ...settings };
    const sec = (h, body) => (body && String(body).trim() ? `\n## ${h}\n${String(body).trim()}` : '');
    const system = [
        `You are Mero ☆, Miinthe's co-writer and story bestie for her roleplay${character ? ` with ${character}` : ''}. ${st.persona}`,
        'You talk with Miinthe OUT OF CHARACTER, about the story. Nothing you say reaches the story — only notes Miinthe keeps do. Never write story prose for the roleplay unless she asks for an example.',
        'Say what you actually think. Be specific about the story: names, moments, quotes. Never invent facts about the story or Miinthe\'s lore; if you don\'t know, say so.',
        TAG_RULES[talk?.tag] || TAG_RULES.yap,
        TALK[st.talk] || TALK.some,
        // Miinthe 2026-10-18: "Mero is jumping right into the story with a lot of text even though I said just hello"
        st.bringUp
            ? 'Match what Miinthe writes: a hello or small talk gets a short, friendly answer — at most one thing you noticed, in a sentence or two.'
            : 'Match what Miinthe writes: a hello or small talk gets a short, friendly answer (ask what she feels like doing) — go into the story only once she brings something up.',
        st.bringUp ? BRING_UP : '',
        NOTE_FORMAT,
        talk?.tag !== 'fb' ? PITCH_FORMAT : '',   // Miinthe: "if I'm yapping anyways the AI could make it out to be a pitch"
        firstAnswer ? 'This is the first answer of the talk: also add on its own line at the very end [[TITLE]] a short title for this talk, 2-6 words [[/TITLE]].' : '',
        sec('Notes just for your talks (what you know about Miinthe)', talkNotes.map(n => `- ${n.text}`).join('\n')),
        sec('Notes the writer follows right now', storyNotes.map(n => `- ${KINDS[n.kind]} ${n.text}`).join('\n')),
        sec('Where the story stands (the board — you may know more than the writer; never spoil it unasked)', board.join('\n')),
        sec(st.bringUp ? 'Big moments lately (bring them up yourself if Miinthe hasn\'t yet)' : 'Big moments lately', moments.map(m => `- ${m}`).join('\n')),
        vault ? VAULT_REVIEW : '',
        vault ? sec(`Miinthe's whole lore vault (${vault.length} entries)`, vault.map(e => `### ${e.title}\n${String(e.content || '').trim()}`).join('\n\n')) : '',
        vault ? '' : sec('Lore the writer was given for the last reply', entries.map(e => `### ${e.title}\n${String(e.content || '').slice(0, 1200)}`).join('\n\n')),
        sec('Character and persona', [cards, persona].filter(Boolean).join('\n\n')),
        sec('The latest replies of the roleplay', replies.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n')),
    ].filter(Boolean).join('\n');
    const messages = arr(talk?.msgs).map(m => ({ role: m.who === 'miinthe' ? 'user' : 'assistant', content: m.t }));
    return { system, messages };
}

const NOTE_RE = /\[\[NOTE([^\]]*)\]\]([\s\S]*?)\[\[\/NOTE\]\]/gi;
const TITLE_RE = /\[\[TITLE\]\]([\s\S]*?)\[\[\/TITLE\]\]/i;
/** Mero's answer: the text Miinthe reads, the note cards she offered, and a title (first answer). */
export function parseMeroAnswer(text) {
    const cards = [];
    let title = null;
    let t = String(text ?? '').replace(TITLE_RE, (_, x) => { title = x.replace(/\s+/g, ' ').trim().replace(/^["“]|["”.]$/g, '').slice(0, 60) || null; return ''; });
    t = t.replace(NOTE_RE, (_, attrs, body) => {
        const a = Object.fromEntries([...String(attrs).matchAll(/(\w+)=([\w|]+)/g)].map(m => [m[1], m[2].split('|')[0]]));
        const n = normNote({ kind: a.kind, last: a.last, scope: a.scope, text: body.trim() });
        if (n) cards.push({ kind: n.kind, last: n.last, scope: n.scope, text: n.text });
        return '';
    });
    return { text: t.replace(/\n{3,}/g, '\n\n').trim(), cards, title };
}

/** A smart title from Miinthe's first message when Mero gave none (a fallback, never Miinthe's own title). */
export function fallbackTitle(t) {
    const w = String(t ?? '').replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    return w ? (w.length > 48 ? w.slice(0, 48).replace(/\s\S*$/, '') + '…' : w) : 'A new talk';
}

/** The 🧭 Where are we? question, as Miinthe's message in the talk. */
export const WHERE_ARE_WE = '🧭 Where are we? Give me a short recap: where each running tracker stands and how long since it last moved, open threads, what\'s coming up (dates), what\'s around the scene — and whether the story has wandered off the board.';
