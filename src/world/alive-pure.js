/**
 * World layer, stage 2 — people write first, and how alive the world is (Miinthe, 2026-10-19; design §2b, §2d).
 *
 * The board's mix (World tab): catch up when opened · when something big happens · when story time passes · every X
 * exchanges · when nothing is happening — plus Pause. "Big" and "quiet" come from the story helper's reading it already
 * does each turn ("moment"); the rest from the chat and the story clock. When the world ticks, ONE call decides who, if
 * anyone, writes to {{user}} now (from their wants, plans, what they know, whether they're away) and what they write.
 * Each tick is a world record of its own; what it makes is marked `auto`, so a swipe of that reply replaces it.
 */
import { GOSSIP_RULE } from './feed-pure.js';   // who people never gossip about (Miinthe 2026-10-26)
const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

/** The mix as the board stores it (Miinthe's defaults for a new story: open · big · time on; X starts at 10). */
export function normAlive(raw) {
    const a = isObj(raw) ? raw : {};
    const n = Math.round(Number(a.everyN));
    return {
        open: a.open !== false, big: a.big !== false, time: a.time !== false,
        every: a.every === true, everyN: Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 10,
        quiet: a.quiet === true,
        pulse: a.pulse !== false,   // small moves after every main reply (Miinthe, 2026-10-19: "it still slightly feels like the world is waiting for me")
        ...pulseRange(a),
        realReplies: a.realReplies !== false,   // reply times: chatty dial, busy in the scene, asleep at night (Miinthe, 2026-10-19); off = everyone answers right away
    };
}

/**
 * How many small moves after each reply, per board (Miinthe, 2026-10-19: "0-4 is default … lively world with 1-6 movements,
 * and quiet world with would be 0-2 movements and then freeform where you can chose your own range").
 */
export const PULSE_PRESETS = { quiet: [0, 2], normal: [0, 4], lively: [1, 6] };
export function pulseRange(a) {
    const preset = ['quiet', 'normal', 'lively', 'own'].includes(a?.pace) ? a.pace : 'normal';
    if (preset !== 'own') { const [min, max] = PULSE_PRESETS[preset]; return { pace: preset, movesMin: min, movesMax: max }; }
    const r = v => Math.max(0, Math.min(10, Math.round(Number(v)) || 0));
    const lo = r(a.movesMin), hi = Math.max(r(a.movesMax), lo, 1);
    return { pace: 'own', movesMin: lo, movesMax: hi };
}
/** Who may write to {{user}} first. */
export function normFirst(raw) {
    const f = isObj(raw) ? raw : {};
    return { cast: f.cast !== false, main: f.main !== false };
}

/**
 * The last tick in the store: { i, day } (i = -1 when the world never ticked in this chat). `busy`: the last tick that
 * was not only {{user}} opening the panel — the quiet stretch counts from there (Miinthe, 2026-10-19: she kept looking at
 * the panel while humming, and every look started the quiet stretch over).
 */
export function lastTick(store) {
    const ticks = arr(store?.records).filter(r => r.kind === 'tick');
    const t = ticks.at(-1), b = ticks.filter(r => r.reason !== 'open').at(-1);
    return t ? { i: t.i, day: Number.isFinite(t.day) ? t.day : null, busy: b ? b.i : -1 } : { i: -1, day: null, busy: -1 };
}

/** Main-chat messages since the last tick. */
const since = (nowI, last) => nowI - last.i;

/**
 * Should the world tick now — and why? null = no.
 * o: { alive, paused, trigger: 'open'|'reply'|'moment', moment: 'big'|'quiet'|'normal'|null, nowI, day, last }
 * Never twice for the same main-chat message.
 */
export function tickReason({ alive, paused = false, trigger, moment = null, nowI, day = null, last }) {
    const a = normAlive(alive);
    if (paused || !Number.isInteger(nowI) || nowI < 0 || last.i >= nowI) return null;
    const gap = since(nowI, last);
    if (a.time && Number.isFinite(day) && Number.isFinite(last.day) && day > last.day) return 'time';
    if (trigger === 'moment' && a.big && moment === 'big' && gap >= 2) return 'big';
    if (trigger === 'moment' && a.quiet && moment === 'quiet' && nowI - (last.busy ?? last.i) >= 6) return 'quiet';
    if (a.every && gap >= a.everyN * 2) return 'every';   // an exchange = your message + the reply
    if (trigger === 'open' && a.open && gap >= 4) return 'open';
    return null;
}

export const REASON_WORDS = {
    open: '{{user}} just looked at their phone after a while',
    big: 'something big just happened in the story',
    quiet: 'nothing much is happening in the story right now',
    time: 'story time has moved on (a new day)',
    every: 'some time has passed in the story',
};

export const TICK_SCHEMA = {
    name: 'world_tick', strict: false,
    value: { type: 'object', properties: {
        messages: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, text: { type: 'string' }, why: { type: 'string' } }, required: ['from', 'text'] } },
    }, required: ['messages'] },
};

/**
 * The world's prompt: who, if anyone, writes to {{user}} now.
 * people: [{ name, card, here, wants, plans: [text], knows: [text], last: [{ who, text }] }]
 */
export function tickPrompt({ userName, people, reason, look = 'phone', when = '', story = [], event = '', max = 2 }) {
    const letters = look === 'letters';
    const sys = `You run the off-screen lives of the people in a roleplay. ${userName} is the player. Right now ${REASON_WORDS[reason]?.replace('{{user}}', userName) || 'time has passed'}. Decide who, if anyone, ${letters ? 'sends ' + userName + ' a letter' : 'texts ' + userName} now — and write it.
- Usually ONE person writes now: whoever has the best reason — a plan of theirs calls for it (a meet-up coming, something to ask or hide), they heard about what just happened, they just learned something, or they simply want to chat, the way that person would (a lonely one reaches out, a nosy one fishes for news). Nobody writes only if truly no one has any reason.
- People in the scene with ${userName} right now don't ${letters ? 'write letters' : 'text'}; they'd just talk.
- Each message in that person's own voice${letters ? ', a short letter (no "Dear…" line, no signature — those are added)' : ', the way they would text (short; some use emoji, some write properly)'}. Never more than they know. Never write for ${userName}.
Someone who sends several messages in a row: put a line with only --- between them inside their text.
${GOSSIP_RULE}
Answer with JSON only: {"messages": [{"from": "exact name", "text": "...", "why": "a few words"}]} — at most ${max}, often [].`;
    const blocks = arr(people).map(p => [
        `## ${p.name}${p.here ? ' (in the scene now)' : ' (away)'}`,
        p.card ? clip(p.card, 900) : '',
        p.wants ? `Wants: ${p.wants}` : '',
        p.quirks ? `How they write (follow it): ${clip(p.quirks, 400)}` : '',
        p.discretion || '',
        arr(p.plans).length ? `Plans: ${p.plans.join(' · ')}` : '',
        arr(p.knows).length ? `Knows: ${p.knows.slice(-6).join('; ')}` : '',
        arr(p.last).length ? `Last messages with ${userName}:\n${p.last.map(m => `  ${m.who}: ${clip(m.text, 200)}`).join('\n')}` : `No messages with ${userName} yet.`,
    ].filter(Boolean).join('\n'));
    const user = [when ? `IN THE STORY IT IS NOW ${when}.` : '',
        event ? `WHAT JUST HAPPENED (it was loud enough that word of it may reach people who weren't there):\n${clip(event, 700)}` : '',
        'THE PEOPLE', ...blocks,
        arr(story).length ? `\nTHE MAIN STORY, NEWEST MESSAGES (only people in the scene saw this):\n${story.map(m => `${m.name}: ${clip(m.mes, 400)}`).join('\n\n')}` : '',
        '\nWho writes now, if anyone?'].filter(Boolean).join('\n\n');
    return { system: sys, user };
}

/** The answer: [{ from (name), text, why }], at most `max`, only names that exist. */
export function parseTick(text, names, max = 2) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const known = new Map(arr(names).map(n => [String(n).trim().toLowerCase(), n]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        try {
            const v = JSON.parse(t);
            if (!v || !Array.isArray(v.messages)) continue;
            const seen = new Set();
            return v.messages.filter(m => m && typeof m.text === 'string' && m.text.trim())
                .map(m => ({ from: known.get(String(m.from || '').trim().toLowerCase()), text: clip(m.text, 1200), why: clip(m.why, 120) }))
                .filter(m => m.from && !seen.has(m.from) && seen.add(m.from)).slice(0, max);
        } catch { /* next */ }
    }
    return [];
}

/** The story helper's extra field when the world layer is on (one word; its reading happens anyway). */
export const MOMENT_RULES = `- MOMENT: "moment" — "big" when the newest messages hold something the people around would talk about (a public scene, a fight, an accident, news, a scandal, a party); "quiet" when little happens (small talk, waiting, routine); otherwise "normal".`;
export const MOMENT_SCHEMA_PART = { moment: { type: 'string', enum: ['big', 'quiet', 'normal'] } };
export function parseMoment(text) {
    const raw = String(text ?? ''), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) { try { const v = JSON.parse(t); if (['big', 'quiet', 'normal'].includes(v?.moment)) return v.moment; } catch { /* next */ } }
    return null;
}
