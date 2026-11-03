/**
 * World layer, stage 1 — Messages, the pure part (Miinthe, 2026-10-19; design: docs/storyboard/19 world layer design.md §2, §2d).
 *
 * People: {{user}} ('user') and everyone in the board's Cast ('<castId>:<personId>'). A conversation is a pair of them.
 * Every message is a record in the per-chat world store (world-pure.js), tagged with the main chat's message index at
 * the time it was written, so deleting main-chat messages takes it back.
 *
 * Story time comes from the board: the first state tracker with a Day field ("Day 2 · morning" when it also has a
 * cycle field). A board without one stamps by message number. Letters (the Letters look) are "on their way" until the
 * story moves on: the next story day, or — on a board without days — the next exchange in the main chat.
 */
import { RUMOR, NEWS } from './rumor-pure.js';
import { castsOf, runningCasts, personNow, MAX_PLANS } from '../cast-pure.js';
import { stateTrackersOf } from '../state-pure.js';
import { stateNow, fieldValue } from '../board-model-pure.js';
import { GOSSIP_RULE } from './feed-pure.js';   // who people never gossip about (Miinthe 2026-10-26)

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export const USER = 'user';
/** The chat's main character (Miinthe, 2026-10-19: "I can't message Toaster which is the main character"). */
export const MAIN = 'main';
export const keyOf = (cast, p) => `${cast.id}:${p.id}`;
export const convKey = (a, b) => [a, b].sort().join('|');
export const partnerIn = (conv, me) => { const [a, b] = String(conv).split('|'); return a === me ? b : a; };

/** Everyone in the board's running casts: [{ key, cast, p }]. */
export function peopleOf(board, st) {
    // someone taken out of the world (world.people[key].out) writes, posts and shows up nowhere in it — the Cast keeps them
    return runningCasts(board, st).flatMap(cast => arr(cast.people).map(p => ({ key: keyOf(cast, p), cast, p }))).filter(x => board?.world?.people?.[x.key]?.out !== true);
}
/** A person by key, or null (someone removed from the board). */
export function personByKey(board, key) {
    const [cid, pid] = String(key).split(':');
    const cast = castsOf(board).find(c => c.id === cid);
    const p = arr(cast?.people).find(x => x.id === pid);
    return cast && p ? { key, cast, p } : null;
}

// ── story time ──────────────────────────────────────────────────────────────

/** Where the story's clock stands: { day, part } from the first running state tracker with a Day field, or null. */
export function storyClock(board, st) {
    for (const t of stateTrackersOf(board)) {
        const fields = arr(t.fields), dayF = fields.find(f => f.type === 'day');
        if (!dayF) continue;
        const cyc = fields.find(f => f.type === 'cycle');
        return { day: stateNow(st, t).day, part: cyc ? String(fieldValue(st, t, cyc) ?? '') : '' };
    }
    return null;
}
/** The stamp a new message carries. */
export const stampNow = (clock, i) => (clock ? { day: clock.day, part: clock.part || '' } : { msg: i });
/** "Day 2 · morning", "Day 2", or "after message #44". */
export function stampText(stamp) {
    if (!isObj(stamp)) return '';
    if (Number.isFinite(stamp.day)) return `Day ${stamp.day}${stamp.part ? ' · ' + stamp.part : ''}`;
    if (Number.isFinite(stamp.msg)) return `after message #${stamp.msg}`;
    return '';
}

// ── letters on their way ────────────────────────────────────────────────────

/** When a letter written now arrives: the next story day, or (no days on the board) the next exchange. */
export const arrivalFor = (clock, i) => (clock ? { day: clock.day + 1 } : { after: i + 1 });
/** Has it arrived? */
export function arrived(m, clock, lastI) {
    const a = m?.arrives;
    if (!isObj(a)) return true;
    if (Number.isFinite(a.day)) return !clock || clock.day >= a.day;   // no story days any more (the Day tracker gone): it's there
    if (Number.isFinite(a.after)) return lastI >= a.after;
    return true;
}
// ── reply times (Miinthe, 2026-10-19: "not every member would have the same reply schedule" — all of these stack) ──

/** Night on the story clock (its time-of-day field says so). */
export const isNight = part => /night|midnight|small hours|nacht|nuit|noche/i.test(String(part ?? ''));
/**
 * How long someone takes to answer, or null (right away). Stacked: their Messages dial (`m` 1–3: high answers at once,
 * average sometimes after the next exchange, low often after one or two), busy while in the main scene (`here`), asleep
 * at night on the story clock. `from` = the main-chat message it was written at.
 */
export function replyWait({ m = 2, here = false, clock = null, lastI, rand = Math.random }) {
    const w = {};
    const r = rand();
    if ((m <= 1 && r < 0.7) || (m === 2 && r < 0.35)) w.after = lastI + (m <= 1 && rand() < 0.5 ? 4 : 2);
    if (here) w.away = true;
    if (clock && isNight(clock.part)) w.wake = true;
    return Object.keys(w).length ? { ...w, from: lastI } : null;
}
/** Is the wait over? Busy ends when they leave the scene (or after 4 messages); asleep ends when it's no longer night; never longer than 12. */
export function waitOver(w, { lastI, here = false, clock = null }) {
    if (!isObj(w)) return true;
    if (Number.isFinite(w.from) && lastI >= w.from + 12) return true;
    if (Number.isFinite(w.after) && lastI < w.after) return false;
    if (w.away && here && lastI < (w.from ?? 0) + 4) return false;
    if (w.wake && clock && isNight(clock.part)) return false;
    return true;
}
/** The grey status under a name: asleep · busy (in the scene) · slow to reply · online. */
export function replyStatus({ m = 2, here = false, clock = null }) {
    if (clock && isNight(clock.part)) return 'asleep';
    if (here) return 'busy (in the scene)';
    if (m <= 1) return 'slow to reply';
    return 'online';
}

export const arrivalText = a => (Number.isFinite(a?.day) ? `Day ${a.day}` : 'once the story moves on');

// ── the store's messages ────────────────────────────────────────────────────

export const msgsOf = store => arr(store?.records).filter(r => r.kind === 'msg');
export const textOf = m => (Array.isArray(m.alts) && m.alts.length ? m.alts[Math.min(m.s || 0, m.alts.length - 1)] : m.text || '');

/** The thread between `me` and `other`, oldest first, letters still on their way included (marked). */
export function threadOf(store, me, other, clock, lastI) {
    const k = convKey(me, other);
    return msgsOf(store).filter(m => m.conv === k).map(m => ({ ...m, onWay: !arrived(m, clock, lastI) }));
}
/** What `me` can't have read yet: their messages, arrived, not opened. */
export const isUnread = (m, me, clock, lastI) => m.to === me && !m.read && arrived(m, clock, lastI);
export function unreadFor(store, me, clock, lastI) { return msgsOf(store).filter(m => isUnread(m, me, clock, lastI)).length; }

/**
 * The conversation list for `me`: every person of the board (so a first message can be started), newest talk first.
 * [{ key, name, card, last, unread }]
 */
export function conversationsFor(store, board, st, me, clock, lastI, main = null, { rumor = false, news = false } = {}) {
    // stage 5: the rumor account can be messaged (a tip; Miinthe: "I as the user with whatever persona ever. could text that rumor spreader")
    const all = [{ key: USER }, ...(main ? [{ key: MAIN, p: main }] : []), ...peopleOf(board, st).map(x => ({ key: x.key, cast: x.cast, p: x.p })), ...(rumor ? [{ key: RUMOR }] : []), ...(news ? [{ key: NEWS }] : [])].filter(x => x.key !== me);   // the news account: once it has written (a request for a comment)
    return all.map(x => {
        const th = threadOf(store, me, x.key, clock, lastI).filter(m => !m.onWay || m.from === me);
        const last = th.at(-1) || null;
        return { key: x.key, name: x.p?.name, card: x.p?.card || '', last, unread: th.filter(m => isUnread(m, me, clock, lastI)).length };
    }).sort((a, b) => (b.last ? b.last.n : -1) - (a.last ? a.last.n : -1));
}

/**
 * "Between others" (Miinthe, 2026-10-19: peek without switching who you write as): conversations `me` is not part of,
 * newest first — [{ conv, a, b, last }]. Letters still on their way are left out.
 */
export function othersConversations(store, me, clock, lastI) {
    const by = new Map();
    for (const m of msgsOf(store)) {
        if (m.group) continue;   // groups are listed on their own (groups-pure.js)
        const [a, b] = String(m.conv).split('|');
        if (a === me || b === me || !arrived(m, clock, lastI)) continue;
        const cur = by.get(m.conv);
        if (!cur || m.n > cur.last.n) by.set(m.conv, { conv: m.conv, a, b, last: m });
    }
    return [...by.values()].sort((x, y) => y.last.n - x.last.n);
}
/** A conversation by its key, oldest first (peeking: both sides, nothing marked read). */
export function convThread(store, conv, clock, lastI) {
    return msgsOf(store).filter(m => m.conv === conv && arrived(m, clock, lastI));
}

// ── what the main character learns in messages (they have no Cast knowledge list) ──

export const mainFacts = store => arr(store?.records).filter(r => r.kind === 'mknow');
/** Records for what the main character learned from message `msgId` (the caller adds them at index i). */
export function mainLearned(learned, fromName, msgId, newIdFn) {
    return arr(learned).filter(x => String(x.kind || '').toLowerCase() !== 'everyday').slice(0, 2)
        .map(x => ({ kind: 'mknow', id: newIdFn('k'), fact: clip(x.fact, 160), from: fromName, msg: msgId }));
}
/** The main writer's line: what the main character knows from messages (newest 6). */
export function mainKnowsLine(store, mainName, userName) {
    const f = mainFacts(store).slice(-6).map(r => r.fact);
    return f.length ? `${String(mainName).toUpperCase()} knows from messages with ${userName} and others (off-screen; use it when it fits): ${f.join('; ')}` : '';
}

/** The next running number for ordering (records are tagged by main-chat index; several can share one). */
export const nextN = store => msgsOf(store).reduce((mx, m) => Math.max(mx, Number(m.n) || 0), 0) + 1;

/** A new message record (the caller adds it with addRecord(store, rec, i)). */
export function newMessage({ store, from, to, text, clock, i, look, id }) {
    return {
        kind: 'msg', id, n: nextN(store), conv: convKey(from, to), from, to,
        text: clip(text, 4000), stamp: stampNow(clock, i),
        ...(look === 'letters' ? { letter: true, arrives: arrivalFor(clock, i) } : {}),
    };
}

/** Change one message in the store (a copy): edit, swipe, mark read, attach knowledge log ids. */
export function updateMessage(store, id, patch) {
    return { ...store, records: arr(store?.records).map(r => (r.kind === 'msg' && r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)) };
}
export function removeMessage(store, id) {
    return { ...store, records: arr(store?.records).filter(r => !(r.kind === 'msg' && r.id === id)) };
}
/** Opening a thread: everything `me` received there (and that has arrived) is read. */
export function markRead(store, me, other, clock, lastI, at) {
    const k = convKey(me, other);
    let changed = false;
    const records = arr(store?.records).map(r => {
        if (r.kind === 'msg' && r.conv === k && isUnread(r, me, clock, lastI)) { changed = true; return { ...r, read: at }; }
        return r;
    });
    return changed ? { ...store, records } : store;
}
/** A swipe on their message: the next version, or a new one to be written (null = write one). */
export function swipeTo(m, dir) {
    const n = arr(m.alts).length || 1, s = (m.s || 0) + dir;
    if (s < 0) return { s: 0 };
    if (s >= n) return null;
    return { s };
}

// ── pacing (Miinthe, 2026-10-19: "her message back... was too fast … a little bit of a whiplash given that it's suppose to be a messenger") ──

/**
 * How a texted answer unfolds: Delivered → Read after `readMs` → typing dots for `typingMs` → the answer.
 * Reading takes 1.5–4.5 s; typing about 9 characters a second, between 2.5 and 12 s. A slower AI is never held back further.
 */
export function pacing(text, rand = Math.random) {
    const readMs = Math.round(1500 + rand() * 3000);
    const typingMs = Math.round(Math.min(12000, Math.max(2500, String(text || '').length / 9 * 1000)));
    return { readMs, typingMs };
}

// ── who answers, and what they are told ─────────────────────────────────────

/** Letters the other side hasn't answered yet, now that they arrived: [{ msg, to }] — a reply is due for each. */
export function repliesDue(store, clock, lastI) {
    const ms = msgsOf(store);
    // only what SHE wrote (as anyone): between others, answers go through nextThread — slow, auto, with its limits
    return ms.filter(m => !m.group && m.to !== USER && (m.mine || m.from === USER) && arrived(m, clock, lastI) && !m.answered && !ms.some(x => x.conv === m.conv && x.n > m.n && x.from === m.to));
}

/**
 * The second, small call (the Cast's lesson: a side job in the same call gets dropped — live, DeepSeek answered
 * {"reply", "learnedAllowed"} once): what the reader learned from the message, and whether a meet-up was settled.
 */
export const EXTRACT_SCHEMA = {
    name: 'world_extract', strict: false,
    value: { type: 'object', properties: {
        plan: { type: ['string', 'null'] },
        learned: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, kind: { type: 'string' } }, required: ['fact'] } },
    }, required: ['plan', 'learned'] },
};
export function extractPrompt({ reader, writer, message, reply }) {
    return {
        system: `You read one exchange of private messages from a roleplay and answer two questions. Answer with JSON only, both keys always present: {"plan": null or "...", "learned": [...]}.
1. "plan": did this exchange settle that ${reader} and ${writer} will meet or do something together later? Yes if ${reader} agrees (even grudgingly, even with conditions) or a day or time is fixed. Then one short line about ${reader}: what, where, when — e.g. "go to the beach with ${writer} next Wednesday, pick-up at nine". If nothing is settled: null.
2. "learned": what ${reader} has just learned from ${writer}'s message itself — only what that message says — if it matters to the story (a secret, a clue, a promise, a lie, feelings, a danger, a plan): [{"fact": "under 20 words", "kind": "secret|clue|promise|lie|feelings|danger|plan|everyday"}]. Not small talk. Usually [] or one item.`,
        user: `${writer.toUpperCase()} WROTE:\n${clip(message, 1500)}\n\n${reader.toUpperCase()} ANSWERED:\n${clip(reply, 1500)}`,
    };
}
export function parseExtract(text) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        try { const v = JSON.parse(t); if (v && typeof v === 'object') return { learned: arr(v.learned).filter(x => x && typeof x.fact === 'string' && x.fact.trim()), plan: typeof v.plan === 'string' && v.plan.trim() && v.plan.trim().toLowerCase() !== 'null' ? clip(v.plan, 160) : null }; } catch { /* next */ }
    }
    return { learned: [], plan: null };
}

/**
 * The prompt for `name` answering a message (or a letter).
 * o: { name, card, now (personNow), fromName, look, thread: [{ who, text, stamp }], story: [{ name, mes }], storyLines, when, mayPass, quirks, feed, discretion }
 */
export function replyPrompt({ name, card = '', now = null, fromName, look = 'phone', thread = [], story = [], storyLines = [], when = '', mayPass = false, quirks = '', feed = [], discretion = '', photos = true }) {
    const letters = look === 'letters';
    const parts = [
        `You are ${name}, a character in an ongoing roleplay. You are not in the scene with ${fromName} right now; ${fromName} has just ${letters ? 'sent you a letter' : 'texted you'}, and you answer ${letters ? 'with a letter of your own' : 'by text'}.`,
    ];
    if (card) parts.push(`[${name}]\n${clip(card, 2500)}`);
    if (now?.wants) parts.push(`What ${name} wants (never say it outright): ${now.wants}`);
    if (arr(now?.plans).length) parts.push(`What ${name} is set on right now (act on it; never say it outright):\n${now.plans.map(p => `- ${p.text}`).join('\n')}`);
    if (arr(now?.knows).length) parts.push(`What ${name} knows:\n${now.knows.slice(-12).map(k => `- ${k.fact}`).join('\n')}\nAnything else${arr(feed).length ? ' (besides what is going around publicly, below)' : ''}, ${name} doesn't know — never let them know more.`);
    // what's public in the feed (Miinthe, 2026-10-19: Whispers posted about Kettle, and in the DM Kettle "didn't seem to know what
    // I was talking about"): posts, news and rumors are out there for everyone — who posted a rumor stays hidden
    if (arr(feed).length) parts.push(`Going around publicly lately (the feed, the news — ${name} has likely seen it, and HAS seen anything about ${name} — though they may deny it if that's who they are; they have their own view of it):\n${feed.map(f => `- ${clip(f, 240)}`).join('\n')}`);
    if (arr(storyLines).length) parts.push(`Where the story stands:\n${storyLines.join('\n')}`);
    if (when) parts.push(`In the story it is now ${when}.`);
    parts.push(letters
        ? `Write ${name}'s letter: in their own voice, shaped by who they are and the time they live in. A few short paragraphs at most. No "Dear …" line and no signature — those are added.`
        : `Write ${name}'s text message(s): in their own voice — the way this person would text (some use emoji and shorthand, some write properly). Short, like real texting: usually one to three lines.${photos ? ' Rarely, when it fits, they send a photo: describe it as [photo: what it shows].' : ''}`);
    if (quirks) parts.push(quirkRule(name, quirks, letters));
    if (discretion) parts.push(discretion);
    parts.push(GOSSIP_RULE);
    if (mayPass) parts.push(`${name} doesn't have to answer. If they wouldn't reply now — or the conversation has run its course — answer exactly: (no reply)`);
    parts.push(`Answer with ${name}'s ${letters ? 'letter' : 'message'} only — no name in front, no notes.`);
    const lines = arr(thread).map(m => `${m.who}${m.stamp ? ` (${m.stamp})` : ''}: ${m.text}`);
    const recent = arr(story).map(m => `${m.name}: ${clip(m.mes, 600)}`);
    return {
        system: parts.join('\n\n'),
        user: [recent.length ? `THE MAIN STORY, NEWEST MESSAGES (${name} is in this scene and saw it):\n\n${recent.join('\n\n')}` : '',
            `YOUR ${letters ? 'LETTERS' : 'MESSAGES'} WITH ${fromName.toUpperCase()} (oldest first):\n\n${lines.join('\n')}`,
            `Write ${name}'s answer now.`].filter(Boolean).join('\n\n'),
    };
}

/** How this person writes (the board's World tab › Quirks) — and the way to send several messages in a row. */
export function quirkRule(name, quirks, letters = false) {
    const q = clip(quirks, 600);
    if (!q) return '';
    return `How ${name} writes — follow this closely: ${q}` + (letters ? '' : `\nIf ${name} sends several messages in a row, put a line with only --- between them.`);
}
/** One answer → the messages it holds (split on "---" lines; at most 5; empty parts dropped). */
export function splitParts(text) {
    const parts = [[]];
    for (const line of String(text ?? '').split('\n')) { if (/^\s*-{3,}\s*$/.test(line)) parts.push([]); else parts.at(-1).push(line); }
    return parts.map(p => p.join('\n').trim()).filter(Boolean).slice(0, 5);
}

/**
 * 🎨 What the picture maker is asked for one 📷 photo (Miinthe, 2026-11-03: "image generation for the DMs"). SillyTavern's
 * Image Generation adds her own style words in front (its prompt prefix), so this is only what the photo shows.
 */
export function picPrompt(desc, { from = '', letters = false } = {}) {
    const d = clip(String(desc ?? '').replace(/\s+/g, ' ').trim(), 300);
    return d ? `${d}${letters ? ', an old photograph' : ', a casual phone photo'}${from ? ` sent by ${clip(from, 60)}` : ''}` : '';
}
/**
 * The photos of a thread to draw by themselves: messages from `picsFrom` on, theirs only when `theirs`, one not drawn
 * and not tried yet (`tried`: a Set of "id|description"). → [{ m, desc }]
 */
export function picsDue(th, { me, picsFrom = 0, theirs = true, tried = new Set(), photosIn = () => [] } = {}) {
    const out = [];
    for (const m of arr(th)) {
        if (!(Number(m?.n) >= picsFrom) || (!theirs && m.from !== me)) continue;
        for (const d of photosIn(textOf(m))) if (!m.pics?.[d] && !tried.has(`${m.id}|${d}`)) out.push({ m, desc: d });
    }
    return out;
}

/** "(no reply)": they chose not to answer (AI-to-AI threads may pass). */
export const isPass = text => /^\(?\s*no reply\s*\)?\.?$/i.test(String(text ?? '').trim());

/** Read the answer: { reply, learned } or null. Plain text (a model ignoring JSON) counts as the reply. */
export function parseReply(text, name = '') {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        try { const v = JSON.parse(t); if (v && typeof v.reply === 'string' && v.reply.trim()) return { reply: stripLead(v.reply, name), learned: arr(v.learned).filter(x => x && typeof x.fact === 'string' && x.fact.trim()), plan: typeof v.plan === 'string' && v.plan.trim() ? clip(v.plan, 160) : null }; } catch { /* next */ }
    }
    if (raw.startsWith('{')) return null;
    return { reply: stripLead(raw, name), learned: [], plan: null };
}
const stripLead = (s, name) => String(s).trim().replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '').trim();

/** The knowledge a reply brings: Cast "knows" changes for the one who read the message (everyday facts dropped, at most 2). */
export function learnedChanges(cast, p, learned, fromName, newIdFn) {
    return arr(learned).filter(x => String(x.kind || '').toLowerCase() !== 'everyday').slice(0, 2).map(x => ({
        kind: 'cast', col: cast.id, person: p.id, field: 'knows', key: `knows:${cast.id}:${p.id}`,
        add: { id: newIdFn('k'), fact: clip(x.fact, 160), how: 'told', via: 'message', from: fromName }, quote: null, who: 'world', reason: `in a message from ${fromName}`,
    }));
}

// ── meet-ups (Miinthe, 2026-10-19: "if I chat with spoon and want to go to the beach next wednesday, then it should be later on in the
// story instead of instantly") — the agreement becomes one of their Cast plans; the director brings them when the time comes ──

/** The Cast change that adds a meet-up to their plans (their newest MAX_PLANS kept). */
export function meetupChange(cast, p, now, text, newIdFn) {
    const t = clip(text, 160);
    if (!t || arr(now?.plans).some(x => String(x.text).trim().toLowerCase() === t.toLowerCase())) return null;
    const to = [...arr(now?.plans), { id: newIdFn('p'), text: t }].slice(-MAX_PLANS);
    return { kind: 'cast', col: cast.id, person: p.id, field: 'plans', from: now?.plans, to, who: 'world', reason: 'agreed in messages' };
}
/** The main character has no plan list: a world record the main writer is told about. */
export const mainPlans = store => arr(store?.records).filter(r => r.kind === 'mplan');
export function mainPlanLine(store) {
    const p = mainPlans(store).slice(-3).map(r => r.text);
    return p.length ? `PLANNED (agreed in messages; let it happen when the story gets there, not before): ${p.join('; ')}` : '';
}

// ── leaks (Miinthe, 2026-10-19: "on spied messages you can select: leak … the same counts for your own messages") ──

/** What leaked messages tell whoever hears them: one fact per message, as an overheard quote. */
export function leakFacts(msgs, nameOf) {
    return arr(msgs).map(m => clip(`${nameOf(m.from)} wrote to ${nameOf(m.to)}: "${clip(textOf(m), 110)}"`, 160));
}
/** Cast "knows" changes for one listener (how: heard, via: leak). */
export function leakChanges(cast, p, facts, newIdFn) {
    return arr(facts).map(fact => ({
        kind: 'cast', col: cast.id, person: p.id, field: 'knows', key: `knows:${cast.id}:${p.id}`,
        add: { id: newIdFn('k'), fact, how: 'heard', via: 'leak' }, quote: null, who: 'world', reason: 'a leak',
    }));
}

/** The stamp headers of a thread, WhatsApp-style: a header wherever the stamp changes (Miinthe, 2026-10-19). [{ header? , m }] */
export function withHeaders(thread) {
    let last = null;
    return arr(thread).map(m => { const t = stampText(m.stamp); const h = t && t !== last ? t : null; if (t) last = t; return { header: h, m }; });
}

// ── AI-to-AI threads (Miinthe, 2026-10-19: "one exchange max per main chat exchange but only when it makes sense. and also not
// every main exchange") — slow on purpose: AI talking to AI escalates fast ──

export const THREAD_GAP = 4;      // main-chat messages since the last AI-to-AI answer (≈ every other exchange at most)
export const THREAD_STREAK = 4;   // AI-to-AI messages in a row in one conversation, then it rests until someone stirs it

/** How many messages at the end of a conversation the world wrote by itself (planned ones and answers). */
export function aiStreak(store, conv) {
    let n = 0;
    for (const m of msgsOf(store).filter(x => x.conv === conv).sort((a, b) => b.n - a.n)) { if (!m.auto) break; n++; }
    return n;
}
/** The one message an AI-to-AI answer may go to now, or null: neither side {{user}}, arrived, unanswered, the gap kept, the thread not tired. Oldest first. */
export function nextThread(store, clock, lastI, skip = () => false) {
    const last = arr(store?.records).filter(r => r.kind === 'thread').at(-1);
    if (last && lastI - last.i < THREAD_GAP) return null;
    const open = msgsOf(store).filter(m => !m.group && m.from !== USER && m.to !== USER && !m.mine && !m.toMine && m.from !== RUMOR && m.to !== RUMOR && m.from !== NEWS && m.to !== NEWS && !m.answered && arrived(m, clock, lastI)
        && !msgsOf(store).some(x => x.conv === m.conv && x.n > m.n) && aiStreak(store, m.conv) < THREAD_STREAK && !skip(m));
    return open.sort((a, b) => a.n - b.n)[0] || null;
}

export { personNow };
