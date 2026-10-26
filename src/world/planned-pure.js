/**
 * World layer, stage 3 — planned messages on the board (Miinthe, 2026-10-19; design §2d, mock-up v5).
 *
 * The board keeps a list of messages planned ahead: from whom, to whom, when (one of the board's own conditions —
 * a story day, a tracker step, a place, someone in the scene — checked with board-model-pure's holds(), plus an
 * optional chance), and the words: hers exactly, or a note the AI writes up in the moment. Each fires once per chat
 * (a new run is a new chat, so every run gets them fresh); a condition that is already past when it is checked still
 * holds, so a message the story skipped past arrives late. Firing is a world record (`kind: 'fired'`, auto).
 */
import { holds, normCond } from '../board-model-pure.js';
import { GOSSIP_RULE } from './feed-pure.js';   // who people never gossip about (Miinthe 2026-10-26)

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export const WHEN_KINDS = ['day', 'step', 'place', 'arrive'];

/** One planned message, repaired (null when it can't be used). */
export function normPlan(p) {
    if (!isObj(p) || typeof p.id !== 'string' || !p.id) return null;
    const cond = normCond(p.cond);
    const odds = Math.round(Number(p.odds));
    return {
        id: p.id, kind: ['post', 'news', 'rumor'].includes(p.kind) ? p.kind : 'msg', from: String(p.from || ''), to: String(p.to || 'user'),
        cond, ...('cond2' in p ? { cond2: normCond(p.cond2) } : {}),   // a second condition: both must hold (null = picked, not set yet)
        words: p.words === 'mine' ? 'mine' : 'note', text: clip(p.text, 2000),
        ...(Number.isFinite(odds) && odds > 1 ? { odds } : {}),
    };
}
export const normPlans = list => arr(list).map(normPlan).filter(Boolean);

/** Plans already fired (or rolled and missed) in this chat: id → record. */
export function firedOf(store) {
    const m = new Map();
    for (const r of arr(store?.records)) if (r.kind === 'fired' && r.plan) m.set(r.plan, r);
    return m;
}

/**
 * Which plans go out now: their condition holds, they haven't fired here yet, a sender is set.
 * Returns [{ plan, hit }] — `hit` false = the chance was rolled and missed (recorded too, so it isn't rolled again
 * while the condition keeps holding).
 */
export function duePlans(board, st, plans, store, rand = Math.random, muted = () => false) {
    const fired = firedOf(store);
    const out = [];
    for (const p of normPlans(plans)) {
        if (!p.cond || !p.from || fired.has(p.id)) continue;
        if ((p.to === 'user' || p.kind !== 'msg') && muted(p.from)) continue;   // muted: it waits (and arrives late once unmuted); a muted person posts nothing
        if (!holds(board, st, p.cond) || ('cond2' in p && !holds(board, st, p.cond2))) continue;
        out.push({ plan: p, hit: p.odds ? rand() < 1 / p.odds : true });
    }
    return out;
}

/** The prompt for a note written up in the moment, in the sender's voice. */
export function plannedPrompt({ name, card = '', now = null, toName, note, look = 'phone', when = '', quirks = '', kind = 'msg', discretion = '' }) {
    const letters = look === 'letters';
    const what = kind === 'rumor' ? (letters ? 'an unsigned note with a rumor, pinned to the town board at night' : 'a rumor, posted anonymously through the story\'s gossip account') : kind === 'news' ? (letters ? 'a short article for the gazette' : 'a short news item') : kind === 'post' ? (letters ? 'a note to pin on the town board' : 'a post for the local feed') : (letters ? `a letter to ${toName}` : `a text message to ${toName}`);
    const parts = [`You are ${name}, a character in an ongoing roleplay. You write ${what} now.`];
    if (card) parts.push(`[${name}]\n${clip(card, 2500)}`);
    if (now?.wants) parts.push(`What ${name} wants (never say it outright): ${now.wants}`);
    if (arr(now?.plans).length) parts.push(`What ${name} is set on: ${now.plans.map(p => p.text || p).join(' · ')}`);
    if (arr(now?.knows).length) parts.push(`What ${name} knows:\n${now.knows.slice(-12).map(k => `- ${k.fact || k}`).join('\n')}\nNever let them know more.`);
    if (when) parts.push(`In the story it is now ${when}.`);
    if (quirks) parts.push(`How ${name} writes — follow this closely: ${clip(quirks, 600)}` + (letters ? '' : `\nIf ${name} sends several messages in a row, put a line with only --- between them.`));
    if (kind !== 'rumor') { if (discretion) parts.push(discretion); parts.push(GOSSIP_RULE); }
    parts.push(`What the message is about (the author's note — write it as ${name} would, don't copy it): ${clip(note, 600)}`);
    if (kind === 'news') parts.push('First line: the headline. Then the article: a few short paragraphs, in the voice of the publication.');
    else if (kind === 'rumor') parts.push('Write it short and juicy, as gossip — never name who is behind it.');
    else if (kind === 'post') parts.push(`Write the post the way ${name} would — short, in their own voice.`);
    else parts.push(letters ? `Write the letter: a few short paragraphs at most, in ${name}'s voice. No "Dear …" line and no signature — those are added.` : `Write the text: short, the way ${name} would text.`);
    parts.push('Answer with that text only.');
    return { system: parts.join('\n\n'), user: `Write ${name}'s ${letters ? 'letter' : 'message'} to ${toName} now.` };
}

/** "Day 3", "Fuse plot reaches Caught", "at the Kitchen", "when Kettle is in the scene" — for the board's list. */
export function whenText(board, cond) {
    const c = normCond(cond);
    if (!c) return 'not set yet';
    const t = arr(board?.trackers).find(x => x.id === (c.world || c.tracker || c.place || c.cast));
    if (!t) return 'a tracker that was removed';
    if (c.world && c.min) return `on Day ${c.min} or later`;
    if (c.world && c.is !== undefined) return `when ${t.name}'s ${arr(t.fields).find(f => f.id === c.field)?.name || 'field'} is ${c.is}`;
    if (c.tracker && c.step) return `when ${t.name} reaches ${arr(t.steps).find(s => s.id === c.step)?.name || 'a step'}`;
    if (c.place) return `when the scene is at ${arr(t.places).find(p => p.id === c.at)?.name || 'a place'}`;
    if (c.cast) return `when ${arr(t.people).find(p => p.id === c.person)?.name || 'someone'} is in the scene`;
    return 'a condition';
}
