/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆'s entry ideas (`10 co-writer design.md` §8b), pure.
 *
 * Mero reads the latest replies next to the entries that were sent with them and notices what an entry is missing
 * (Miinthe's yellow apple: the entry says apples are red and green; someone eats a yellow one). Each idea is ONE exact
 * change — a paragraph added at the end of the entry's text, or one exact passage rewritten — shown as before /
 * after. Miinthe's prose rule holds: by default nothing is written without her yes on that change (§8b setting
 * "ask me" · "apply on their own" (listed, with Undo) · "off").
 *
 * When Mero looks is her job (Miinthe, 2026-10-05): off duty — never · freelancer — only when hired (Check the lore) ·
 * part-timer — every 5 new replies · full-timer — after every reply. In the background, after the reply arrived.
 * Whether a change needs Miinthe's yes is a separate switch (sign-off), never part of the job.
 */
import { parseHelperAnswer } from './autotrack-pure.js';
import { named, nameRule } from './mero-names-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : '');
const low = s => String(s ?? '').trim().toLowerCase();
/** One paragraph = one line (Miinthe's vault is read in Obsidian; a hard break shows up mid-sentence). */
const oneLine = s => str(s).replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();

export const LORE_KEY = 'deeplore_mero_lore';   // chat_metadata: { last: index looked at up to, notCanon: [{ title, q }] }
export const ENTRY_CHANGES = ['ask', 'auto', 'off'];
const EVERY = { off: Infinity, freelance: Infinity, part: 5, full: 1 };

/** The chat's memory of Mero's lore looks. */
export function asLore(v) {
    const o = v && typeof v === 'object' ? v : {};
    return { last: Number.isFinite(o.last) ? o.last : -1, notCanon: arr(o.notCanon).filter(x => x && x.title && x.q) };
}

/** The AI replies after message `last` (a swipe is the same message, so it never counts again). */
export function newReplies(last, chatLength, isAi) {
    const out = [];
    for (let k = Math.max(0, last + 1); k < chatLength; k++) if (isAi(k)) out.push(k);
    return out;
}

/** Is it time for Mero to look on her own? (`job`: off · freelance · part · full) */
export function dueToLook(job, count) {
    return count >= (EVERY[job] ?? EVERY.part);
}

const sameQ = (a, b) => low(a).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ') === low(b).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ');
/** "Not canon" — Mero remembers the line and doesn't ask again for it. */
export const isNotCanon = (lore, title, q) => lore.notCanon.some(x => low(x.title) === low(title) && sameQ(x.q, q));

/** Mero's look: the instructions and what she reads. `entries` [{ title, content }], `replies` [{ i, name, text }]. */
export function buildLookPrompt({ entries = [], replies = [], persona = '', names = {} } = {}) {
    const system = [
        `You are Mero ☆, {{author}}'s co-writer and story bestie.${persona ? ` ${persona}` : ''} Right now you are checking {{author}}'s lore entries against the latest replies of their roleplay.`,
        'Find facts that the replies clearly show and that an entry is MISSING or CONTRADICTS — about that entry\'s own subject only. Example: the entry "Apple" says apples are red and green; in a reply someone eats a yellow apple → add that apples can also be yellow.',
        'Never invent anything. Never rephrase or restate what the entry already says. Ignore passing mood, dialogue and one-off actions — only lasting facts about the subject. If nothing is missing, return an empty list; that is the usual answer.',
        'Each change is either ADD (one short paragraph added at the end of the entry, in the entry\'s own style and tense) or REWRITE (`find` = an exact passage copied from the entry, `replace` = what it becomes). Write the new text as plain prose on one line.',
        'Answer with JSON only: {"changes":[{"entry":"exact entry title","msg":<reply number>,"quote":"the exact words from the reply that show it (at most 25 words)","add":"text to add" or null,"find":"exact passage" or null,"replace":"new passage" or null,"why":"a few words, in your voice"}]} — at most 3 changes.',
    ].map(t => named(t, names)).concat(nameRule(names)).join('\n');   // the chosen names (mero-names-pure.js)
    const user = [
        '## The entries',
        entries.map(e => `### ${e.title}\n${str(e.content).slice(0, 2500)}`).join('\n\n') || '(none)',
        '\n## The latest replies',
        replies.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n') || '(none)',
    ].join('\n');
    return { system, user };
}

/**
 * Mero's answer → change ideas, each checked: a known entry, a quote, ADD text or an exact REWRITE. Lines Miinthe called
 * "not canon" and ideas already waiting are left out. `waiting` [{ entry: { title }, change }].
 */
export function parseLook(text, { titles = [], lore = asLore(null), waiting = [] } = {}) {
    const known = new Map(arr(titles).map(t => [low(t), t]));
    const out = [];
    for (const c of parseHelperAnswer(text)) {
        if (!c || typeof c !== 'object') continue;
        const title = known.get(low(c.entry));
        const q = oneLine(c.quote);
        if (!title || !q) continue;
        const add = oneLine(c.add), find = str(c.find).trim(), replace = oneLine(c.replace);
        const change = find && replace ? { find, replace } : add ? { add } : null;
        if (!change || isNotCanon(lore, title, q)) continue;
        const dup = x => low(x.entry?.title) === low(title) && (sameQ(x.q || '', q) || (change.add && low(x.change?.add) === low(change.add)) || (change.find && x.change?.find === change.find));
        if (waiting.some(dup) || out.some(dup)) continue;
        out.push({ title, i: Number.isFinite(+c.msg) ? Math.floor(+c.msg) : null, q, why: oneLine(c.why).slice(0, 200), change });
        if (out.length >= 3) break;
    }
    return out;
}

/** A vault file split into its frontmatter (kept byte for byte) and its text. */
export function splitFile(content) {
    const s = str(content);
    const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
    return m ? { head: m[0], body: s.slice(m[0].length) } : { head: '', body: s };
}
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

/**
 * The file after the change, or { error }. ADD: a new paragraph at the end of the text. REWRITE: the passage must be
 * there exactly once (otherwise the entry was edited since, or the model misquoted it — nothing is written).
 */
export function applyChange(content, change) {
    const { head, body } = splitFile(content);
    if (change?.find) {
        const n = count(body, change.find);
        if (n !== 1) return { error: n ? 'that passage is in the entry more than once' : 'that passage isn\'t in the entry (any more)' };
        return { content: head + body.replace(change.find, () => change.replace) };
    }
    if (change?.add) {
        const trail = /\s*$/.exec(body)[0];
        const end = trail.includes('\n') ? trail : '\n';
        return { content: head + body.slice(0, body.length - trail.length) + (body.trim() ? '\n\n' : '') + change.add + end };
    }
    return { error: 'no change' };
}

/** The file with the change taken back, or { error } when the entry was edited since (then nothing is undone). */
export function undoChange(content, change) {
    const { head, body } = splitFile(content);
    if (change?.find) {
        if (count(body, change.replace) !== 1) return { error: 'the entry was edited since — undo it by hand' };
        return { content: head + body.replace(change.replace, () => change.find) };
    }
    if (change?.add) {
        const trail = /\s*$/.exec(body)[0], text = body.slice(0, body.length - trail.length);
        if (!text.endsWith(change.add)) return { error: 'the entry was edited since — undo it by hand' };
        return { content: head + text.slice(0, text.length - change.add.length).replace(/\s*$/, '') + trail };
    }
    return { error: 'no change' };
}

/** Before / after for the card: the passage that changes, with a little of what stands around it. */
export function beforeAfter(content, change) {
    const { body } = splitFile(content);
    if (change?.find) {
        const k = body.indexOf(change.find);
        const pre = k > 0 ? body.slice(Math.max(0, k - 80), k) : '', post = body.slice(k + change.find.length, k + change.find.length + 80);
        return { pre: (k > 80 ? '…' : '') + pre, before: change.find, after: change.replace, post: post + (k + change.find.length + 80 < body.length ? '…' : '') };
    }
    const text = body.trim();
    return { pre: (text.length > 160 ? '…' : '') + text.slice(-160), before: '', after: change?.add || '', post: '' };
}
