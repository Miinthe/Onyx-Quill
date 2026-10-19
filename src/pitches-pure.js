/**
 * LOCAL PATCH (Miinthe, 2026-10-14) — Mero ☆'s 💡 pitches, the upgraded Pathweaver: pure rules. Tested in test/pitches.test.mjs.
 * Design: `10 co-writer design.md` §9; mock-up v4 (https://claude.ai/artifact/WfhQXXBf7ghebbyQDSB7FJ). Glue: pitches.js.
 *
 * Pitches come only when Miinthe asks, always from her story (no genre templates). Each one says what it grew from.
 * The 💡 drawer has two views: home (the menu, what's out in the story, what's kept) and the pick view (one batch, one
 * menu for the picked cards). Leaving the pick view drops what wasn't used or kept — "↩ Bring back" once.
 *
 * A PITCH (chat_metadata[PITCHES_KEY].list):
 *   { id, no, kind: 'twist'|'acts'|'callback'|'ask', strength: 'nudge'|'turn'|'bomb', who?: person name, src:
 *     'cast'|'board'|'lore'|'loose'|'talk', from, text, st, made: index, msg?: the message it was pitched from, ... }
 * st (what happened to it):
 *   fresh   — in the pick view, waiting           kept   — 📌 kept as an idea (home view)
 *   dir     — ✍️ goes with the next reply (a ⚡ flash steer note, noteId) → landed / skipped (checked with a quote)
 *   draft   — 📝 Mero drafted Miinthe's next line     played — Miinthe sent a message after the draft
 *   given   — 🎭 a Cast member's plan now (gaveTo: { cast, person, name, planId })
 *   hidden  — 🙈 waits for its moment (moment, mine: Miinthe named it, fb: use it anyway after N messages, armed: index)
 *   fired   — the moment came (or the fallback): it went to the writer as a hidden flash note (firedAt, firedQ)
 *   running / done / abandoned — a 🪜 PLAN (a multistep pitch, `plan` below) on its way, finished, or given up
 *
 * A PLAN (§10, built 2026-10-14 — Miinthe: "first this happens and then this … based on replies can make it feel rushed"):
 *   plan: { goal, beats: [{ id, text, floor, done?: { i, quote } }], at (the current beat), since (the message the current
 *     beat started at), sees: 'beat'|'summary'|'all', timer (replies without a beat before Miinthe is asked; 0 = off),
 *     asked?: the message the timer last asked at, review?: { mode: 'redirect'|'evolve'|'extend', goal, beats: [text] } }
 *   - A beat is ticked only by the story helper, with a word-for-word quote, and never before its floor ("not before N
 *     replies" — a floor, not a deadline). The writer is told to work toward the current beat gently, over several replies.
 *   - A deleted or swiped message takes its tick back (rewindPlan).
 */
import { findQuoteMatch } from './quote-match-pure.js';

export const PITCHES_KEY = 'deeplore_mero_pitches';   // chat_metadata: { list, next, menu, dropped }

export const KINDS = { twist: '🌀 twist', acts: '🎭 a character acts', callback: '🔁 callback', ask: '❓ a question to you' };
export const STRENGTHS = { nudge: '🌱 nudge', turn: '🔀 turn', bomb: '💥 bombshell' };
export const SOURCES = { cast: '🎭', board: '🗺', lore: '📚', loose: '🔁', talk: '💬' };
export const STATES = ['fresh', 'kept', 'dir', 'landed', 'skipped', 'draft', 'played', 'given', 'hidden', 'fired', 'running', 'done', 'abandoned'];
/** Taken back out of the pick view by ← Back (or replaced by a new batch). */
export const PICKING = ['fresh'];
/** "Out in the story" on the home view. */
export const OUT = ['dir', 'landed', 'skipped', 'draft', 'played', 'given', 'hidden', 'fired', 'running', 'done', 'abandoned'];
export const SEES = { beat: 'the current beat only', summary: 'summary + current beat', all: 'the whole plan' };
export const TIMERS = [10, 15, 25, 0];
export const DEFAULT_FLOOR = 2;   // replies a beat takes at least (Claude's proposal, 2026-10-14 — Miinthe can change it per beat)
export const MAX_BEATS = 7;
export const MAX_KEPT_LIST = 60;           // a chat keeps this many pitches (newest); fresh ones never count against it
export const MAX_N = 5;
export const MAX_TASTE = 16;               // taste notes kept (the oldest 👍 go first)
export const LOOSE_AFTER = 20;             // lore not mentioned for this many messages counts as "hasn't come up lately"

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const low = s => String(s ?? '').trim().toLowerCase();
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d);
const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── the store ────────────────────────────────────────────────────────────────

export const DEFAULT_MENU = { shape: 'one', vis: 'show', n: 3, str: 'turn', tone: 'sfw', focus: '', moment: '', fb: 10, fbOn: true, sees: 'beat', timer: 15 };

export function normMenu(m) {
    const o = isObj(m) ? m : {};
    return {
        shape: o.shape === 'multi' ? 'multi' : 'one',
        vis: o.vis === 'hide' ? 'hide' : 'show',
        n: Math.max(1, Math.min(MAX_N, int(o.n, DEFAULT_MENU.n))),
        str: STRENGTHS[o.str] ? o.str : DEFAULT_MENU.str,
        tone: o.tone === 'nsfw' ? 'nsfw' : 'sfw',
        focus: clip(o.focus, 200),
        moment: clip(o.moment, 160),
        fb: Math.max(2, Math.min(60, int(o.fb, DEFAULT_MENU.fb))),
        fbOn: o.fbOn !== false,
        sees: SEES[o.sees] ? o.sees : 'beat',
        timer: TIMERS.includes(int(o.timer, 15)) ? int(o.timer, 15) : 15,
    };
}

const beatId = () => newId('b');
export function normPlan(pl) {
    if (!isObj(pl)) return null;
    const beats = arr(pl.beats).map(b => (typeof b === 'string' ? { text: b } : b)).filter(b => isObj(b) && str(b.text).trim()).slice(0, MAX_BEATS + 6).map(b => ({
        id: str(b.id) || beatId(), text: clip(b.text, 300), floor: Math.max(0, Math.min(40, int(b.floor, DEFAULT_FLOOR))),
        ...(isObj(b.done) && Number.isFinite(Number(b.done.i)) ? { done: { i: int(b.done.i, 0), quote: clip(b.done.quote, 300) } } : {}),
    }));
    if (beats.length < 2) return null;
    const rv = isObj(pl.review) && ['redirect', 'evolve', 'extend'].includes(pl.review.mode) && arr(pl.review.beats).length
        ? { mode: pl.review.mode, goal: clip(pl.review.goal, 300), beats: arr(pl.review.beats).map(t => clip(typeof t === 'string' ? t : t?.text, 300)).filter(Boolean).slice(0, MAX_BEATS) } : null;
    return {
        goal: clip(pl.goal, 300), beats, at: Math.max(0, Math.min(beats.length, int(pl.at, 0))), since: int(pl.since, 0), start: int(pl.start, int(pl.since, 0)),
        sees: SEES[pl.sees] ? pl.sees : 'beat', timer: TIMERS.includes(int(pl.timer, 15)) ? int(pl.timer, 15) : 15,
        ...(Number.isFinite(Number(pl.asked)) ? { asked: int(pl.asked, 0) } : {}), ...(rv ? { review: rv } : {}),
    };
}

export function normPitch(p) {
    if (!isObj(p) || !str(p.text).trim()) return null;
    const st = STATES.includes(p.st) ? p.st : 'fresh';
    const out = {
        id: str(p.id) || newId('p'), no: Math.max(1, int(p.no, 1)),
        kind: KINDS[p.kind] ? p.kind : 'twist', strength: STRENGTHS[p.strength] ? p.strength : 'turn',
        ...(str(p.who).trim() ? { who: clip(p.who, 60) } : {}),
        src: SOURCES[p.src] ? p.src : 'loose', from: clip(p.from, 160), text: clip(p.text, 600), st,
        made: int(p.made, 0), ...(p.tone === 'nsfw' ? { tone: 'nsfw' } : {}),
    };
    for (const k of ['msg', 'at', 'armed', 'firedAt', 'fb']) if (Number.isFinite(Number(p[k]))) out[k] = int(p[k], 0);
    for (const k of ['quote', 'noteId', 'moment', 'firedQ', 'draft']) if (str(p[k]).trim()) out[k] = clip(p[k], k === 'draft' ? 1200 : 300);
    if (p.mine) out.mine = true;
    if (p.peek) out.peek = true;
    const plan = normPlan(p.plan);
    if (plan) out.plan = plan;
    if (p.hide) out.hide = true;   // a hidden plan: blurred for Miinthe too
    if (isObj(p.gaveTo) && p.gaveTo.cast && p.gaveTo.person) out.gaveTo = { cast: String(p.gaveTo.cast), person: String(p.gaveTo.person), name: clip(p.gaveTo.name, 60), planId: str(p.gaveTo.planId) };
    return out;
}

export function asPitches(raw) {
    const o = isObj(raw) ? raw : {};
    const list = arr(o.list).map(normPitch).filter(Boolean);
    const next = Math.max(int(o.next, 1), 1 + Math.max(0, ...list.map(p => p.no)));
    return { list, next, menu: normMenu(o.menu), dropped: arr(o.dropped).map(normPitch).filter(Boolean) };
}

/** Keep the store a sane size: fresh and running ones always stay; the oldest finished ones go first. */
export function trimPitches(store) {
    const s = asPitches(store);
    const keep = p => p.st === 'fresh' || p.st === 'kept' || p.st === 'hidden' || p.st === 'dir' || p.st === 'draft' || p.st === 'running';
    const done = s.list.filter(p => !keep(p));
    const room = Math.max(0, MAX_KEPT_LIST - s.list.filter(keep).length);
    const gone = new Set(done.sort((a, b) => b.no - a.no).slice(room).map(p => p.id));
    return { ...s, list: s.list.filter(p => !gone.has(p.id)) };
}

/**
 * A new batch replaces the one in the pick view (the old one is simply gone — a new batch is a deliberate click).
 * `fresh`: parsed pitches. Returns the new store; the numbers go on from the chat's counter.
 */
export function addBatch(store, fresh, { made = 0, msg = null, tone = 'sfw', replace = true } = {}) {
    const s = asPitches(store);
    let next = s.next;
    const list = replace ? s.list.filter(p => !PICKING.includes(p.st)) : s.list.slice();
    const add = arr(fresh).map(p => normPitch({ ...p, id: newId('p'), no: next++, st: p.st || 'fresh', made, ...(msg != null ? { msg } : {}), tone })).filter(Boolean);
    return trimPitches({ ...s, list: [...add, ...list], next, dropped: replace ? [] : s.dropped });
}

/** ← Back: the pitches nobody used or kept leave; they can come back once ("↩ Bring back"). Not a 👎. */
export function dropPicking(store) {
    const s = asPitches(store);
    const gone = s.list.filter(p => PICKING.includes(p.st));
    return { ...s, list: s.list.filter(p => !PICKING.includes(p.st)), dropped: gone };
}
export function bringBack(store) {
    const s = asPitches(store);
    return { ...s, list: [...s.dropped.map(p => ({ ...p, st: 'fresh' })), ...s.list], dropped: [] };
}

export const setPitch = (store, id, patch) => { const s = asPitches(store); return { ...s, list: s.list.map(p => (p.id === id ? normPitch({ ...p, ...patch }) : p)) }; };
export const removePitch = (store, id) => { const s = asPitches(store); return { ...s, list: s.list.filter(p => p.id !== id) }; };

// ── the writer ───────────────────────────────────────────────────────────────

/** What the writer is told for ✍️ "next reply" (a ⚡ flash steer note — the next reply only, its swipes keep it). */
export const directionText = p => `Work this into this reply, naturally and in character (it may only begin here): ${clip(p.text, 500)}`;
/** A hidden pitch whose moment came: the same, and never hinted at before it happens. */
export const surpriseText = p => `Now is the moment for this — work it into this reply, naturally, as a surprise: ${clip(p.text, 500)}`;

// ── what Mero is told ────────────────────────────────────────────────────────

const PITCH_RULES = [
    'Build pitches ONLY from this story — its people, threads, places, lore and what just happened. Never from genre templates or stock tropes.',
    'Each pitch grows from something specific below; name it in "from" in a few words (e.g. "Mara\'s plan: win back the shop", "the cellar door, last mentioned at #12", "Relationship stuck on Friends for 22 messages", "lore: The Old Debt").',
    'Kinds: "twist" — something unexpected happens · "acts" — a character does something on their own, out of what they want, plan or know (name them in "who") · "callback" — something mentioned earlier and left open comes back · "ask" — a question to Miinthe about her story whose answer would unlock better ideas (at most one per batch, never for a single pitch).',
    'Strength: "nudge" — small, could happen in passing · "turn" — changes where the scene is going · "bomb" — a bombshell that changes the story.',
    'Each pitch is one or two concrete sentences that the next reply or two can play. Make the pitches of a batch different from each other — different people, threads and kinds.',
    'Never go against a DON\'T note. Never invent facts about the lore or the characters\' pasts; small new details in the scene are fine.',
    'Miinthe plays her own character — never decide what her character does, says or feels.',
].join('\n');

const ITEM = '{"kind": "twist"|"acts"|"callback"|"ask", "strength": "nudge"|"turn"|"bomb", "who": "a CAST name" or null, "source": "cast"|"board"|"lore"|"loose", "from": "what it grew from, a few words", "text": "the pitch"}';
const PLAN_ITEM = '{"kind": "twist"|"acts"|"callback", "strength": "nudge"|"turn"|"bomb", "who": "a CAST name" or null, "source": "cast"|"board"|"lore"|"loose", "from": "what it grew from, a few words", "goal": "where the plan leads, one sentence", "beats": ["first this happens", "then this", …]}';
const PLAN_RULES = 'This is a MULTISTEP pitch — a PLAN: 3 to 5 beats in order, each one concrete thing that happens in the story and can be recognized when it does ("Mara notices the stranger keeps looking at the door"), building slowly toward the goal. The story will take several replies per beat — so no beat is a whole scene\'s worth, and no beat depends on what Miinthe\'s character decides.';

/**
 * The prompt for a batch (visible) or one hidden pitch.
 * ctx: { persona (who Mero is), character, user (Miinthe's name), taste: [text], donts: [text], notes: [text], board: [line],
 *   quiet: [text], cast: [line], lore: [line], cards, replies: [{ i, name, text }], fromMsg: { i, name, text } | null,
 *   already: [text] }
 * menu: normMenu; comment: Miinthe's free text; like: [pitch text] for "more like these".
 */
export function pitchPrompt(menu, ctx = {}, { comment = '', like = [] } = {}) {
    const m = normMenu(menu);
    const hidden = m.vis === 'hide';
    const multi = m.shape === 'multi';
    const n = hidden ? 1 : m.n;
    const sec = (h, body) => (body && String(body).trim() ? `\n## ${h}\n${String(body).trim()}` : '');
    const list = x => arr(x).filter(Boolean).map(t => `- ${t}`).join('\n');
    const system = [
        `You are Mero ☆, ${ctx.user || 'Miinthe'}'s co-writer for her roleplay${ctx.character ? ` with ${ctx.character}` : ''}. ${ctx.persona || ''}`.trim(),
        multi
            ? (hidden ? `${ctx.user || 'Miinthe'} asked for ONE HIDDEN plan — a surprise for her too: she will not read it; the writer is led through it beat by beat.` : `${ctx.user || 'Miinthe'} asked for ${n} plan${n > 1 ? 's' : ''}: multistep ideas for where her story could go. She picks.`)
            : hidden
                ? `${ctx.user || 'Miinthe'} asked for ONE HIDDEN pitch — a surprise for her too: she will not read it until it has happened. Also give the MOMENT it should happen: a plain situation in the story that can be recognized in a message ("when someone goes into the garden", "when Mara is alone with the stranger") — never a count of messages.${m.moment ? ' Miinthe named the moment herself — use hers.' : ''}`
                : `${ctx.user || 'Miinthe'} asked for ${n} pitch${n > 1 ? 'es' : ''}: short ideas for where her story could go next. She picks.`,
        PITCH_RULES,
        multi ? PLAN_RULES : '',
        multi
            ? (hidden ? `Answer with JSON only: {"plan": ${PLAN_ITEM}}` : `Answer with JSON only: {"plans": [${PLAN_ITEM}, …]} — exactly ${n}.`)
            : hidden
                ? `Answer with JSON only: {"pitch": ${ITEM}, "moment": "the moment it waits for"}`
                : `Answer with JSON only: {"pitches": [${ITEM}, …]} — exactly ${n}.`,
    ].filter(Boolean).join('\n\n');
    const want = [
        `How many: ${n}${multi ? ` plan${n > 1 ? 's' : ''}` : ''}${hidden ? ' (hidden)' : ''}`,
        `Strength wanted: ${m.str}`,
        `Tone: ${m.tone === 'nsfw' ? 'NSFW is allowed where it fits the story' : 'SFW — nothing sexual'}`,
        m.focus ? `Focus on: ${m.focus}` : 'Focus: anything — surprise her',
        hidden && !multi && m.moment ? `The moment (Miinthe's words): ${m.moment}` : '',
        comment.trim() ? `Miinthe's wish: ${comment.trim()}` : '',
        arr(like).length ? `More like these (same spirit, new ideas — don't repeat them):\n${list(like)}` : '',
    ].filter(Boolean).join('\n');
    const user = [
        sec('What Miinthe wants now', want),
        ctx.fromMsg ? sec(`Pitch from this message (#${ctx.fromMsg.i}, ${ctx.fromMsg.name})`, clip(ctx.fromMsg.text, 2000)) : '',
        sec('Miinthe\'s taste (from earlier pitches)', list(ctx.taste)),
        sec('DON\'T — never pitch against these', list(ctx.donts)),
        sec('Other notes the writer follows', list(ctx.notes)),
        sec('The board — where the story stands', arr(ctx.board).join('\n')),
        sec('Threads that have gone quiet', list(ctx.quiet)),
        sec('The world around the story (chatter, rumors, messages) — a pitch may come from it: a rumor reaching the scene, a feud in the messages', ctx.world),
        sec('The cast — the story\'s side characters', arr(ctx.cast).join('\n')),
        sec('Lore of this story that hasn\'t come up lately', arr(ctx.lore).join('\n')),
        sec('Character and persona', ctx.cards),
        sec('The latest messages', arr(ctx.replies).map(r => `#${r.i} ${r.name}: ${r.text}`).join('\n\n')),
        sec('Already pitched in this chat — don\'t repeat', list(arr(ctx.already).slice(0, 12))),
    ].filter(Boolean).join('\n').trim();
    return { system, user };
}

function jsonOf(text) {
    const raw = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) { if (!t) continue; try { return JSON.parse(t); } catch { /* next */ } }
    return null;
}
const kindOf = k => { const x = low(k); return KINDS[x] ? x : /act|charact/.test(x) ? 'acts' : /call/.test(x) ? 'callback' : /ask|question/.test(x) ? 'ask' : 'twist'; };
const strOf = s => { const x = low(s); return STRENGTHS[x] ? x : /bomb/.test(x) ? 'bomb' : /nudge|small/.test(x) ? 'nudge' : 'turn'; };
const srcOf = s => { const x = low(s); return SOURCES[x] && x !== 'talk' ? x : /cast|char/.test(x) ? 'cast' : /board|track|thread/.test(x) ? 'board' : /lore|entr/.test(x) ? 'lore' : 'loose'; };
function itemOf(x, castNames = []) {
    if (!isObj(x) || !str(x.text).trim()) return null;
    const who = str(x.who).trim();
    const known = who && castNames.find(n => low(n) === low(who) || low(n).split(/\s+/)[0] === low(who).split(/\s+/)[0]);
    return { kind: kindOf(x.kind), strength: strOf(x.strength), ...(known ? { who: known } : {}), src: srcOf(x.source ?? x.src), from: clip(x.from, 160), text: clip(x.text, 600) };
}

/** A batch answer → [pitch fields] (at most `n`; one "ask" at most; duplicates out). */
export function parsePitches(text, n = 3, castNames = []) {
    const v = jsonOf(text);
    const raw = Array.isArray(v) ? v : arr(v?.pitches);
    const out = [];
    for (const x of raw) {
        const p = itemOf(x, castNames);
        if (!p || out.some(y => low(y.text) === low(p.text))) continue;
        if (p.kind === 'ask' && (n === 1 || out.some(y => y.kind === 'ask'))) continue;
        out.push(p);
        if (out.length >= n) break;
    }
    return out;
}

/** A hidden answer → { pitch fields, moment } or null. Miinthe's own moment wins over Mero's. */
export function parseHidden(text, castNames = [], mine = '') {
    const v = jsonOf(text);
    const p = itemOf(v?.pitch ?? (Array.isArray(v?.pitches) ? v.pitches[0] : v), castNames);
    if (!p || p.kind === 'ask') return null;
    const moment = clip(mine, 160) || clip(v?.moment, 160);
    return { ...p, moment: moment || '' };
}

// ── did it land? and: has the moment come? (the story helper, a quote word for word) ──

export const LAND_SYSTEM = `You check one thing about a roleplay. The author asked the writer to work an idea into a reply. Read the idea and the reply written right after it: did the reply use the idea — does its main thing happen, or clearly start to happen? A passing mention or a vague hint does not count. Answer with JSON only: {"landed": true or false, "quote": "the words of the reply that show it, copied WORD FOR WORD" or null}`;
export const LAND_SCHEMA = { name: 'pitch_landed', strict: false, value: { type: 'object', properties: { landed: { type: 'boolean' }, quote: { type: ['string', 'null'] } }, required: ['landed'] } };
export const landUser = (p, reply) => `THE IDEA:\n${clip(p.text, 600)}\n\nTHE REPLY:\n${String(reply ?? '').trim()}`;

export const MOMENT_SYSTEM = `You check one thing about a roleplay. A surprise is waiting for a moment in the story. Read the moment and the newest messages: has that moment come — is the situation it describes happening now? Something only being talked about, or planned for later, does not count. Answer with JSON only: {"came": true or false, "quote": "the words that show it, copied WORD FOR WORD from the messages" or null}`;
export const MOMENT_SCHEMA = { name: 'pitch_moment', strict: false, value: { type: 'object', properties: { came: { type: 'boolean' }, quote: { type: ['string', 'null'] } }, required: ['came'] } };
export const momentUser = (moment, messages) => `THE MOMENT: ${clip(moment, 200)}\n\nTHE NEWEST MESSAGES:\n${arr(messages).map(m => `${m.name}: ${String(m.mes ?? '').trim()}`).join('\n\n')}`;

/** The checker's answer → the quote (found word for word in `texts`), or null. key: 'landed' | 'came'. */
export function checkFrom(answer, texts, key) {
    const v = jsonOf(answer);
    if (v?.[key] !== true) return null;
    const quote = String(v.quote ?? '').trim();
    return quote && findQuoteMatch(quote, arr(texts).map(t => ({ mes: String(t ?? '') }))) !== -1 ? quote : null;
}

/** A hidden pitch whose fallback is due: armed at `armed`, `fb` messages later it goes anyway. */
export const fallbackDue = (p, lastIndex) => p?.st === 'hidden' && Number(p.fb) > 0 && lastIndex - int(p.armed, 0) >= Number(p.fb);

// ── what pitches grow from ───────────────────────────────────────────────────

/** Every entry title the board names anywhere (steps, bands, branches, people, keep). */
export function boardEntryTitles(board) {
    const out = new Set();
    const walk = o => {
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (!isObj(o)) return;
        for (const [k, v] of Object.entries(o)) {
            if (k === 'entries' && Array.isArray(v)) v.forEach(t => { if (typeof t === 'string' && t.trim()) out.add(t.trim()); });
            else if (k === 'entry' && typeof v === 'string' && v.trim()) out.add(v.trim());
            else if (typeof v === 'object') walk(v);
        }
    };
    walk(board?.trackers);
    return [...out];
}

/**
 * Lore of this story that hasn't come up lately: entries (title, keys, a short text) the story uses — the board's and
 * the ones sent to the writer lately — whose title or keys aren't in the last LOOSE_AFTER messages. Newest-forgotten
 * first: those mentioned once and then dropped beat those never mentioned. → [{ title, last (index or -1), text }]
 */
export function quietLore(entries, chat, { recent = LOOSE_AFTER, max = 6 } = {}) {
    const msgs = arr(chat).map((m, i) => ({ i, t: low(m?.mes) })).filter(m => m.t);
    const lastIndex = arr(chat).length - 1;
    const seen = new Set(), out = [];
    for (const e of arr(entries)) {
        const title = str(e?.title).trim();
        if (!title || seen.has(low(title))) continue;
        seen.add(low(title));
        const words = [title, ...arr(e.keys)].map(k => low(k)).filter(k => k.length >= 3 && !/^judge\b/.test(k));
        let last = -1;
        for (let k = msgs.length - 1; k >= 0; k--) if (words.some(w => msgs[k].t.includes(w))) { last = msgs[k].i; break; }
        if (last !== -1 && lastIndex - last < recent) continue;
        out.push({ title, last, text: clip(e.summary || e.content, 260) });
    }
    return out.sort((a, b) => b.last - a.last).slice(0, max);
}

/** The cast as Mero sees it for pitches: everyone, here or away, with wants and plans (and thoughts unless hidden). */
export function castForPitches(people, { immersion = false } = {}) {
    return arr(people).map(({ name, here, wants, plans, thoughts, knows, hidden }) => {
        const secret = hidden || immersion;
        return [`- ${name} (${here ? 'in the scene' : 'away'})${secret ? ' — keep their secrets out of visible pitches' : ''}`,
            wants ? `  wants: ${clip(wants, 200)}` : '',
            arr(plans).length ? `  plans: ${arr(plans).map(x => clip(x, 160)).join('; ')}` : '',
            thoughts && !secret ? `  thinks right now: ${clip(thoughts, 200)}` : '',
            arr(knows).length ? `  knows: ${arr(knows).slice(-4).map(x => clip(x, 120)).join('; ')}` : '',
        ].filter(Boolean).join('\n');
    });
}

// ── taste ────────────────────────────────────────────────────────────────────

export const TASTE_REASONS = ['too much', 'not like them', 'not now', 'wrong tone'];
/** The note text for 👍 (Miinthe used a pitch) and 👎 (with an optional reason). */
export const tasteText = (p, up, why = '') => (up ? `Liked (used): ${clip(p.text, 120)}` : `Not my thing${why ? ` (${why})` : ''}: ${clip(p.text, 120)}`);
/** Which taste notes to drop to stay at MAX_TASTE: the oldest 👍 first, then the oldest 👎. → [id] */
export function tasteOverflow(notes) {
    const list = arr(notes).filter(n => n?.taste);
    if (list.length <= MAX_TASTE) return [];
    const over = list.length - MAX_TASTE;
    const byAge = (a, b) => String(a.made?.at || '').localeCompare(String(b.made?.at || ''));
    return [...list.filter(n => n.taste === 'up').sort(byAge), ...list.filter(n => n.taste === 'down').sort(byAge)].slice(0, over).map(n => n.id);
}

/** A few words for the "more like these" and talk hand-offs. */
export const pitchLine = p => `#${p.no} ${KINDS[p.kind] || ''} (${STRENGTHS[p.strength] || ''}) — ${p.text}${p.from ? ` [from: ${p.from}]` : ''}`;

// ── pitches offered in a talk (Mero turns an idea into a card) ────────────────

export const PITCH_FORMAT = 'When an idea in this talk becomes a concrete pitch (or Miinthe asks to combine or change pitches), add it on its own line at the end: [[PITCH kind=twist|acts|callback strength=nudge|turn|bomb who=Name]] the pitch, one or two sentences [[/PITCH]] — it goes to Miinthe\'s 💡 Pitches, where she can use it. Only when it truly helps.';
const PITCH_RE = /\[\[PITCH([^\]]*)\]\]([\s\S]*?)\[\[\/PITCH\]\]/gi;
/** Mero's talk answer → { text without the cards, pitches: [fields] }. */
export function takePitchCards(text, castNames = []) {
    const pitches = [];
    const t = String(text ?? '').replace(PITCH_RE, (_, attrs, body) => {
        const a = Object.fromEntries([...String(attrs).matchAll(/(\w+)=("[^"]*"|[^\s\]]+)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '').split('|')[0]]));
        const p = itemOf({ kind: a.kind, strength: a.strength, who: a.who, source: 'loose', from: '', text: body.trim() }, castNames);
        if (p && p.kind !== 'ask') pitches.push({ ...p, src: 'talk', from: 'your talk with Mero' });
        return '';
    });
    return { text: t.replace(/\n{3,}/g, '\n\n').trim(), pitches };
}

// ── 🪜 plans ─────────────────────────────────────────────────────────────────

function planOf(x, castNames) {
    const p = itemOf({ ...x, text: x?.goal || x?.text }, castNames);
    const beats = arr(x?.beats).map(b => clip(typeof b === 'string' ? b : b?.text, 300)).filter(Boolean).slice(0, MAX_BEATS);
    if (!p || p.kind === 'ask' || beats.length < 2) return null;
    return { ...p, plan: { goal: p.text, beats: beats.map(text => ({ text })) } };
}
/** A plans answer → [pitch fields with `plan`] (at most `n`, each 2+ beats). */
export function parsePlans(text, n = 3, castNames = []) {
    const v = jsonOf(text);
    const raw = Array.isArray(v) ? v : arr(v?.plans).length ? v.plans : v?.plan ? [v.plan] : [];
    const out = [];
    for (const x of raw) { const p = planOf(x, castNames); if (p && !out.some(y => low(y.text) === low(p.text))) out.push(p); if (out.length >= n) break; }
    return out;
}

/** Start a plan (from the pick view or the kept ideas): beat 1 from now. */
export const startPlan = (p, { i = 0, sees = 'beat', timer = 15 } = {}) => ({ st: 'running', plan: { ...p.plan, at: 0, since: i, start: i, sees, timer, beats: p.plan.beats.map(b => ({ ...b, done: undefined })), asked: undefined, review: undefined } });

/** AI replies after message `i`, up to and with `last` (isAi(k): is message k an AI reply — Miinthe's messages never count). */
export function repliesSince(i, last, isAi = () => true) { let n = 0; for (let k = i + 1; k <= last; k++) if (isAi(k)) n++; return n; }

/**
 * What the writer is told for a running plan (lines for the [Author's notes] block), per "how much the writer sees".
 * Before the beat's floor: build toward it, it must not happen yet.
 */
export function planLines(p, replies = 0) {
    const pl = p?.plan;
    if (p?.st !== 'running' || !pl || pl.at >= pl.beats.length) return [];
    const beat = pl.beats[pl.at];
    const early = replies + 1 < beat.floor;   // `replies`: AI replies since the beat started; the one being written is the next
    const pace = early ? 'Only build toward it in this reply — it must NOT happen yet.' : 'Work toward it gently, over several replies — never all in one.';
    if (pl.sees === 'all') return [`PLAN: ${pl.goal}`, ...pl.beats.map((b, k) => `${k < pl.at ? '✓' : k === pl.at ? '→ NOW:' : '·'} ${b.text}`), pace];
    const dot = t => String(t).replace(/[.\s]+$/, '');
    if (pl.sees === 'summary') return [`PLAN: ${dot(pl.goal)}. Now: ${dot(beat.text)}. ${pace}`];
    return [`Where the story is heading next: ${dot(beat.text)}. ${pace}`];
}

export const BEAT_SYSTEM = `You check one thing about a roleplay. A plan moves through beats in order; read the current beat and the newest reply: did the reply make this beat happen — is its main thing there now, not just hinted at or about to happen? Answer with JSON only: {"happened": true or false, "quote": "the words of the reply that show it, copied WORD FOR WORD" or null}`;
export const BEAT_SCHEMA = { name: 'plan_beat', strict: false, value: { type: 'object', properties: { happened: { type: 'boolean' }, quote: { type: ['string', 'null'] } }, required: ['happened'] } };
export const beatUser = (p, reply) => `THE PLAN: ${clip(p.plan.goal, 300)}\nTHE CURRENT BEAT: ${p.plan.beats[p.plan.at]?.text || ''}\n\nTHE NEWEST REPLY:\n${String(reply ?? '').trim()}`;

/** May the current beat be checked after a reply at `idx`? Running, a beat left, its floor reached (counting this reply). */
export function beatDue(p, idx, isAi = () => true) {
    const pl = p?.plan;
    if (p?.st !== 'running' || !pl || pl.at >= pl.beats.length || pl.review) return false;
    return repliesSince(pl.since, idx, isAi) >= Math.max(1, pl.beats[pl.at].floor);
}

/** Tick the current beat at message `i` (with its quote). The last beat ends the plan ('done'). → pitch patch */
export function tickBeat(p, i, quote) {
    const pl = p.plan, beats = pl.beats.map((b, k) => (k === pl.at ? { ...b, done: { i, quote } } : b));
    const at = pl.at + 1;
    return { st: at >= beats.length ? 'done' : 'running', plan: { ...pl, beats, at, since: i, asked: undefined } };
}

/** A delete or a swipe: ticks at or after message `from` are taken back (in order). → pitch patch, or null (nothing to undo) */
export function rewindPlan(p, from) {
    const pl = p?.plan;
    if (!pl || !['running', 'done'].includes(p.st)) return null;
    const k = pl.beats.findIndex(b => b.done && b.done.i >= from);
    if (k === -1) return null;
    const beats = pl.beats.map((b, j) => (j >= k ? { ...b, done: undefined } : b));
    const since = k > 0 ? pl.beats[k - 1].done.i : Math.min(pl.start, from - 1);
    return { st: 'running', plan: { ...pl, beats, at: k, since, asked: undefined } };
}

/** Has the timer run out (replies since the beat started ≥ the timer, and not asked about this stretch yet)? */
export function timerDue(p, last, isAi = () => true) {
    const pl = p?.plan;
    if (p?.st !== 'running' || !pl || !pl.timer || pl.review) return false;
    if (Number.isFinite(pl.asked) && pl.asked >= pl.since) return false;
    return repliesSince(pl.since, last, isAi) >= pl.timer;
}

/** ⏳ Linger: stay on this beat longer — its floor goes past where the story is now. */
export function lingerPatch(p, last, isAi = () => true, more = 3) {
    const pl = p.plan;
    const beats = pl.beats.map((b, k) => (k === pl.at ? { ...b, floor: Math.min(40, repliesSince(pl.since, last, isAi) + more) } : b));
    return { plan: { ...pl, beats } };
}

const REWRITE = {
    redirect: 'The story went elsewhere. Rewrite the REMAINING beats so they lead from where the story is NOW back to the same goal — a new path, the same goal.',
    evolve: 'The story went elsewhere. Rewrite the plan to FOLLOW where the story actually went: a new goal and new remaining beats that grow out of it.',
    extend: 'Miinthe loves this story and doesn\'t want the plan to end. Write NEW beats that continue from the current beat — the plan goes on (the goal may grow).',
};
/** Mero rewrites a plan (↩️ Redirect · 🌱 Evolve · Extend). Miinthe reviews the answer before it is used. */
export function rewritePrompt(p, mode, ctx = {}) {
    const pl = p.plan;
    const system = [
        `You are Mero ☆, ${ctx.user || 'Miinthe'}'s co-writer. ${ctx.persona || ''}`.trim(),
        REWRITE[mode] || REWRITE.redirect,
        PLAN_RULES.replace('3 to 5 beats', '2 to 4 beats'),
        'Miinthe plays her own character — never decide what her character does, says or feels.',
        'Answer with JSON only: {"goal": "the goal, one sentence", "beats": ["…", "…"]} — only the beats still to come.',
    ].join('\n\n');
    const user = [
        `## The plan\nGoal: ${pl.goal}`,
        `## Beats done\n${pl.beats.filter(b => b.done).map(b => `- ${b.text} (#${b.done.i})`).join('\n') || '(none yet)'}`,
        `## Beats still to come\n${pl.beats.filter(b => !b.done).map((b, k) => `- ${k === 0 ? 'NOW: ' : ''}${b.text}`).join('\n')}`,
        ctx.board?.length ? `## The board\n${ctx.board.join('\n')}` : '',
        `## The latest messages\n${arr(ctx.replies).map(r => `#${r.i} ${r.name}: ${r.text}`).join('\n\n')}`,
    ].filter(Boolean).join('\n\n');
    return { system, user };
}
export function parseRewrite(text, mode) {
    const v = jsonOf(text);
    const beats = arr(v?.beats).map(b => clip(typeof b === 'string' ? b : b?.text, 300)).filter(Boolean).slice(0, MAX_BEATS);
    return beats.length ? { mode, goal: clip(v?.goal, 300), beats } : null;
}
/** Use a reviewed rewrite: done beats stay; the rest is replaced (redirect / evolve) or added after the current (extend). */
export function applyReview(p, last) {
    const pl = p.plan, rv = pl.review;
    if (!rv) return null;
    const done = pl.beats.filter(b => b.done);
    const fresh = rv.beats.map(text => ({ id: beatId(), text, floor: DEFAULT_FLOOR }));
    const beats = rv.mode === 'extend' ? [...pl.beats, ...fresh] : [...done, ...fresh];
    const restart = rv.mode !== 'extend';
    return { st: 'running', plan: { ...pl, goal: rv.mode === 'redirect' ? pl.goal : rv.goal || pl.goal, beats, at: Math.min(rv.mode === 'extend' ? pl.at : done.length, beats.length - 1), since: restart ? last : pl.since, asked: undefined, review: undefined } };
}
