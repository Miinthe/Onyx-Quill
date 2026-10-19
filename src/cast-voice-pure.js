/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the Cast, build step 3: their own voice (`12 cast and agendas design.md` §5, §6, §11b).
 * Pure rules; tested in test/cast-voice.test.mjs. Glue: cast-voice.js (generating, posting, the hooks), cast-queue.js.
 *
 * AN NPC'S OWN MESSAGE (proved by the experiment, §13): SillyTavern's normal generate runs, and while the NPC speaks
 * the prompt is swapped for hers — her card, her example line, what she plans and knows, the story's state (never
 * another NPC's plans or knowledge), her own entries, the newest messages as "Name: text". The message gets her name,
 * her avatar and a mark (`extra.dle_npc`). The model's "Kettle:" at the start is taken off.
 *
 * THE WRITER'S SIDE: an NPC's message must reach the main character's writer as SOMEONE ELSE talking (user side,
 * "Kettle: …") — left as the writer's own earlier reply, the writer's next answer came back empty (experiment).
 *
 * THE ROUND (Miinthe, 2026-10-13 — see below): your half (your message, NPC lines you write) in your order, then the AI
 * half (NPCs the AI writes, the main character). The director's wishes fill the next round: "steps in by themselves"
 * joins the AI half, "suggests themselves" is offered, "call only" never joins by itself.
 */
import { personNow, presentPeople, runningCasts, HOW_WORDS, KNOWS_TOLD } from './cast-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

export const SPEAKS = ['call', 'suggest', 'self', 'mine'];   // mine: you write their lines (Miinthe 2026-10-18)
export const SPEAKS_WORDS = { call: '🔔 call only', suggest: '✨ suggests themselves', self: '🎬 steps in by themselves (every round while here)', mine: '✍️ you write their lines' };
/** How many recent messages an NPC reads before speaking. */
export const NPC_WINDOW = 14;

// ── the NPC's prompt ────────────────────────────────────────────────────────

/**
 * The chat-completion messages for an NPC speaking now.
 * @param {object} o
 *  - npc: { name, description, personality, mes_example } (her card; {{char}} / {{user}} filled in here)
 *  - userName, mainName
 *  - now: personNow(...) — plans and knowledge
 *  - storyLines: the board's lines for the writer WITHOUT the cast's (no other NPC's plans or knowledge)
 *  - lore: her own entries' text
 *  - messages: [{ name, mes }] oldest first (the message being swiped already left out)
 */
export function npcPrompt({ npc, userName = 'User', mainName = 'Character', now = null, storyLines = [], lore = '', messages = [], exit = null }) {
    const name = npc.name;
    const fill = s => String(s || '').replaceAll('{{char}}', name).replaceAll('{{user}}', userName);
    const parts = [`You are ${name}, a character in an ongoing roleplay between ${userName} and ${mainName}. ${name} speaks now — in their own message.`];
    const card = [fill(npc.description), npc.personality ? `Personality: ${fill(npc.personality)}` : ''].filter(Boolean).join('\n');
    if (card) parts.push(`[${name}]\n${card}`);
    const ex = fill(npc.mes_example).replace(/<START>\s*/gi, '').trim();
    if (ex) parts.push(`How ${name} talks:\n${ex}`);
    if (now?.plans?.length) parts.push(`What ${name} is set on right now (act on it; never say it outright):\n${now.plans.map(p => `- ${p.text}`).join('\n')}`);
    if (now?.knows?.length) parts.push(`What ${name} knows:\n${now.knows.slice(-12).map(k => `- ${k.fact} (${HOW_WORDS[k.how] || k.how})`).join('\n')}\nAnything else, ${name} doesn't know — never let them know more.`);
    if (arr(storyLines).length) parts.push(`Where the story stands:\n${storyLines.join('\n')}`);
    if (lore) parts.push(`About ${name} (lore):\n${clip(lore, 2000)}`);
    // leaving of their own accord: they say so and go, in this message (Miinthe: "they should say so in their reply and not just magically disappear")
    if (exit) parts.push(`In this message ${name} leaves the scene${exit.why ? ` (${exit.why})` : ''}: let them say so, in their own way, and go. By the end of it they are gone.`);
    parts.push(`Write only ${name}'s next message: their words and actions. Never write for ${userName} or ${mainName}. As long as it needs to be — usually one or two paragraphs. Don't start with "${name}:".`);
    const lines = arr(messages).map(m => `${m.name}: ${norm(m.mes)}`);
    return [
        { role: 'system', content: parts.join('\n\n') },
        { role: 'user', content: `The story so far:\n\n${lines.join('\n\n')}\n\nWrite ${name}'s message now.` },
    ];
}

/** The board's lines without the cast's (who is here stays; plans and knowledge of NPCs are theirs alone). */
export const storyLinesFor = lines => arr(lines).filter(l => !/\(acts on this, never says it outright\)| knows: |'s own messages — never write them/.test(l));

/** Take off "Kettle:" (once or twice, as models do) from the start of her message. */
export function stripName(name, text) {
    return String(text ?? '').replace(new RegExp(`^\\s*(\\*{0,2}${escRe(name)}(\\s*:\\*{0,2}|\\*{0,2}\\s*:)\\s*)+`, 'i'), '');
}

// ── the writer's side ───────────────────────────────────────────────────────

/**
 * The main writer's prompt (chat completion): every message that is an NPC's own becomes someone else talking —
 * user side, "Kettle: …". `npcMessages`: [{ name, mes }] of the chat's NPC messages. Changes `chat` in place; returns
 * how many it turned.
 */
export function writerSeesNpcs(chat, npcMessages) {
    const list = arr(npcMessages).map(m => ({ name: m.name, mes: norm(m.mes) })).filter(m => m.mes);
    if (!list.length) return 0;
    let n = 0;
    for (const m of arr(chat)) {
        if (m?.role !== 'assistant' || typeof m.content !== 'string') continue;
        const c = norm(m.content);
        const hit = list.find(x => c === x.mes || stripName(x.name, c) === x.mes || (x.mes.length > 40 && stripName(x.name, c).startsWith(x.mes.slice(0, 200))));
        if (!hit) continue;
        m.role = 'user';
        m.content = `${hit.name}: ${stripName(hit.name, m.content).trim()}`;
        delete m.name;
        n++;
    }
    return n;
}

// ── the round (Miinthe, 2026-10-13) ─────────────────────────────────────────────
//
// "If I write the NPC, the sequence should be up to me in whatever constellations, and then the AI characters after …
// queueing up an AI reply and a human reply in one go gives me no chance to reply to that AI reply." So a round has two
// halves: YOUR HALF — your own message ("you") and NPC lines you write (npc + text), in any order you like — then the
// AI HALF — NPCs the AI writes (npc, no text) and the main character ("main"), in their order. An AI line never goes
// above one of yours; after the AI half it is your turn again. Items:
//   { id, kind: 'you' } · { id, kind: 'npc', cast, person, text? , why? } · { id, kind: 'main' }

const qid = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const speaksOf = p => (SPEAKS.includes(p?.speaks) ? p.speaks : 'suggest');
/** Yours: your message, or an NPC line you wrote. */
export const isMine = x => x?.kind === 'you' || (x?.kind === 'npc' && typeof x.text === 'string' && x.text.trim() !== '');
/** Your half first, then the AI half — each in its own order. */
const halves = q => [...arr(q).filter(isMine), ...arr(q).filter(x => !isMine(x))];

/** A stored round, repaired: known people only, one "you" and one "main" at most, your half first. */
export function normalizeQueue(raw, board) {
    const people = new Set(runningCasts(board, {}).flatMap(c => arr(c.people).map(p => `${c.id}:${p.id}`)));
    const out = [];
    let you = false, main = false;
    for (const x of arr(raw)) {
        if (!isObj(x)) continue;
        if (x.kind === 'you') { if (!you) { you = true; out.push({ id: String(x.id || qid()), kind: 'you' }); } continue; }
        if (x.kind === 'main') { if (!main) { main = true; out.push({ id: String(x.id || qid()), kind: 'main' }); } continue; }
        if (x.kind === 'npc' && people.has(`${x.cast}:${x.person}`)) out.push({ id: String(x.id || qid()), kind: 'npc', cast: String(x.cast), person: String(x.person), ...(x.why ? { why: String(x.why) } : {}), ...(x.stay ? { stay: true } : {}), ...(x.exit ? { exit: { why: x.exit.why ? String(x.exit.why) : null } } : {}), ...(typeof x.text === 'string' && x.text.trim() ? { text: x.text } : {}) });
    }
    return halves(out);
}

/**
 * A new round: You, then the AI half — the NPCs set to "steps in by themselves" who want to speak, then the main
 * character. Those set to "suggests themselves" come back as suggestions (one click adds them); "call only" never.
 * `wishes`: [{ cast, person, why }] from the director (people in the scene).
 */
export function newRound(board, st, wishes = []) {
    const here = presentPeople(board, st);
    const seen = new Set(), auto = [], suggest = [];
    for (const w of arr(wishes)) {
        const x = here.find(h => h.cast.id === w.cast && h.p.id === w.person);
        const k = x && `${x.cast.id}:${x.p.id}`;
        if (!x || x.now.muted || seen.has(k)) continue;
        seen.add(k);
        const it = { cast: x.cast.id, person: x.p.id, ...(w.why ? { why: clip(w.why, 160) } : {}) };
        if (speaksOf(x.p) === 'self') auto.push({ id: qid(), kind: 'npc', ...it });
        else if (speaksOf(x.p) === 'suggest') suggest.push(it);
    }
    return { queue: [{ id: qid(), kind: 'you' }, ...auto, { id: qid(), kind: 'main' }], suggest };
}

/** Move an item up (-1) or down (+1) — within its own half (an AI line never goes above one of yours). */
export function moveItem(q, id, d) {
    const all = halves(q), k = all.findIndex(x => x.id === id);
    if (k < 0) return all;
    const j = k + d;
    if (j < 0 || j >= all.length || isMine(all[j]) !== isMine(all[k])) return all;
    [all[k], all[j]] = [all[j], all[k]];
    return all;
}
export const removeItem = (q, id) => arr(q).filter(x => x.id !== id);
/**
 * Add to the round: "you" (once) and NPC lines you write at the end of your half; an NPC the AI writes before the main
 * character; the main character (once) at the end.
 */
export function addItem(q, item) {
    const out = halves(q);
    if (item.kind === 'you') { if (!out.some(x => x.kind === 'you')) out.push({ id: qid(), kind: 'you' }); return halves(out); }
    if (item.kind === 'main') { if (!out.some(x => x.kind === 'main')) out.push({ id: qid(), kind: 'main' }); return halves(out); }
    const it = { id: qid(), kind: 'npc', cast: item.cast, person: item.person, ...(item.text ? { text: item.text } : {}), ...(item.why ? { why: item.why } : {}), ...(item.stay ? { stay: true } : {}), ...(item.exit ? { exit: item.exit } : {}) };
    if (isMine(it)) return halves([...out, it]);
    const m = out.findIndex(x => x.kind === 'main');
    if (m >= 0) out.splice(m, 0, it); else out.push(it);
    return halves(out);
}
/** Write as them (text) or let the AI write again (no text) — the line moves to that half (yours last / before the main character). */
export function setText(q, id, text) {
    const x = arr(q).find(y => y.id === id);
    if (!x || x.kind !== 'npc') return halves(q);
    const t = String(text ?? '').trim();
    const { text: _old, ...base } = x;
    const it = t ? { ...base, text: t } : base;
    const out = halves(arr(q).filter(y => y.id !== id));
    if (isMine(it)) return halves([...out, it]);
    const m = out.findIndex(y => y.kind === 'main');
    if (m >= 0) out.splice(m, 0, it); else out.push(it);
    return halves(out);
}
/** The AI half's NPC lines (what runs after the main character when you just press Send). */
export const aiNpcs = q => arr(q).filter(x => x.kind === 'npc' && !isMine(x));

/** The queue as words, for the tab and the notices: "Anna → Miinthe" (the persona's name, never "You"). */
export function queueText(board, q, { user = '{{user}}', main = 'Main character' } = {}) {
    const nameOf = x => (x.kind === 'you' ? user : x.kind === 'main' ? main : arr(board?.trackers).find(t => t.id === x.cast)?.people?.find(p => p.id === x.person)?.name ?? '?');
    return arr(q).map(nameOf).join(' → ');
}

/** The NPC messages of a chat, for writerSeesNpcs: [{ name, mes }]. */
export const npcMessagesOf = chat => arr(chat).filter(m => m && !m.is_user && m.extra?.dle_npc && typeof m.mes === 'string').map(m => ({ name: m.name, mes: m.mes }));

/** Which person a message belongs to ({ cast, person } from its mark), or null. */
export const npcOfMessage = m => (isObj(m?.extra?.dle_npc) && m.extra.dle_npc.person ? { cast: m.extra.dle_npc.cast, person: m.extra.dle_npc.person } : null);

/** The person's state in words for the tab's one-line summary. */
export function personSummary(st, cast, p) {
    const n = personNow(st, cast, p);
    return [n.here ? 'in the scene' : 'away', n.plans.length ? `${n.plans.length} plan${n.plans.length > 1 ? 's' : ''}` : '', n.knows.length ? `knows ${Math.min(n.knows.length, 99)}` : ''].filter(Boolean).join(' · ');
}
export { KNOWS_TOLD };

/**
 * Regenerate, like a group chat (Miinthe, 2026-10-13 — a one-on-one regenerate deleted only Kettle's message, and the main
 * character, now answering its own reply, came back empty): the whole ROUND after your last message is redone. The
 * round: every AI message after the last message that is yours — your own messages and lines you wrote as an NPC
 * (they are yours; they stay). Returns { from, speakers } — `from`: the round's first index; `speakers`: the NPCs who
 * spoke in it, in order; `seq`: the round's AI turns in their order — { kind: 'main' } or { kind: 'npc', cast, person } —
 * so the new round plays in the same order (Miinthe, 2026-10-13: "regen made toaster speak first even though before regen
 * Kettle talked first") — or null when the round has no NPC message (then SillyTavern's own regenerate is right).
 */
export function regenRound(chat) {
    const c = arr(chat);
    let k = c.length - 1;
    const mine = m => m?.is_user || m?.extra?.dle_npc?.byYou;
    while (k >= 0 && !mine(c[k]) && !c[k]?.is_system) k--;
    const from = k + 1;
    if (from >= c.length) return null;
    const round = c.slice(from);
    const speakers = round.map(npcOfMessage).filter(Boolean);
    const seq = round.filter(m => !m?.is_system).map(m => { const n = npcOfMessage(m); return n ? { kind: 'npc', ...n } : { kind: 'main' }; });
    return speakers.length ? { from, speakers, seq } : null;
}

// ── who has something to add this round (Miinthe, 2026-10-19: "they should sit out at times. just because they're in the
// same scene doesn't mean they have anything to add every time. I also think that counts for the main character") ──

export const SPEAKS_SYSTEM = `You direct a group roleplay. The player just wrote the newest message. Below are the people in the scene who could speak next. For each, decide whether they have something to add RIGHT NOW: they were spoken to or about (spoken to everyone — "all of you", "everyone" — means each of them), it touches their wants, plans or secrets, or they would naturally react. Someone with nothing to add stays quiet this round — that's normal and good; a busy scene doesn't need everyone. At least one person speaks. Answer with JSON only: {"speak": ["exact name", ...]}`;
export const SPEAKS_SCHEMA = { name: 'cast_speaks', strict: false, value: { type: 'object', properties: { speak: { type: 'array', items: { type: 'string' } } }, required: ['speak'] } };
/** o: { messages: [{ name, mes }], people: [{ name, main?, wants? }] } */
export function speaksUser({ messages = [], people = [] }) {
    return [`THE NEWEST MESSAGES (last is newest)\n${arr(messages).map(m => `${m.name}: ${clip(m.mes, 700)}`).join('\n\n')}`,
        `WHO COULD SPEAK NOW\n${arr(people).map(p => `- ${p.name}${p.main ? ' (the main character)' : ''}${p.wants ? ` — wants: ${clip(p.wants, 140)}` : ''}`).join('\n')}`,
        'Who speaks this round?'].join('\n\n');
}
/** The names that speak (known ones only); null when the answer can't be read (then everyone speaks, as before). */
export function parseSpeaks(text, names) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const known = new Map(arr(names).map(n => [String(n).trim().toLowerCase(), n]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!v || !Array.isArray(v.speak)) continue;
        const out = [...new Set(v.speak.map(n => known.get(String(n).trim().toLowerCase())).filter(Boolean))];
        return out.length ? out : null;
    }
    return null;
}
