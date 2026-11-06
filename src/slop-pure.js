/**
 * The slop guard (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/ByQff64nfdyDB4acfqYm7N, views 1–2) — the rules,
 * no page. Tested in test/slop.test.mjs. Glue: slop.js.
 *
 * Her phrase list: phrases the writer shouldn't lean on. Each one is BANNED (don't use it) or USE LESS (allowed, but
 * only where it really fits), and applies everywhere, to one story (the board) or to one character. Phrases come from
 * her (typed in) or are LEARNED: after each reply DeepLore counts, with no AI, the phrases the writer keeps reusing,
 * and Mero asks about one that passes the limit — Ban it · Use it less · It's fine (never asked again).
 *
 * What the writer gets: one or two 🚫 lines among the author's notes, with ONLY the phrases it actually used lately —
 * never the whole list (keeps the prompt small, and doesn't put the words in its head). In the chat a listed phrase is
 * underlined: a banned one wherever it shows up, a "use less" one only when it comes back too soon.
 *
 * Store (extension_settings.onyxquill_slop):
 *   { phrases: [{ id, t, m: 'ban'|'less', sc: 'all'|'board'|'char', k, kn, src: 'learned'|'mine', at }],
 *     fine: [{ t, sc, k, kn }], asked: [t] }
 */

export const SLOP_KEY = 'onyxquill_slop';   // was deeplore_slop
export const WINDOW = 15;        // the replies looked at
export const MIN_REPLIES = 4;     // a phrase in this many of them is "used over and over"
export const LATELY = WINDOW;    // a listed phrase goes to the writer when one of these replies used it
export const TOO_SOON = 5;       // a "use less" phrase is underlined when one of the 5 replies before used it too

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : '');
export const normText = t => str(t).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();

const SCOPES = ['all', 'board', 'char'];
function normPhrase(p) {
    if (!p || typeof p !== 'object') return null;
    const t = normText(p.t).replace(/^[\s.,;:!?'-]+|[\s.,;:!?'-]+$/g, '').slice(0, 80);
    if (!t) return null;
    const sc = SCOPES.includes(p.sc) ? p.sc : 'all';
    const k = sc === 'all' ? '' : str(p.k);
    if (sc !== 'all' && !k) return null;
    return { id: str(p.id) || 'p' + Math.random().toString(36).slice(2, 9), t, m: p.m === 'less' ? 'less' : 'ban', sc, k, kn: sc === 'all' ? '' : str(p.kn) || k, src: p.src === 'learned' ? 'learned' : 'mine', at: str(p.at) };
}
function normFine(f) {
    const p = normPhrase(f); return p ? { t: p.t, sc: p.sc, k: p.k, kn: p.kn } : null;
}

/** The store, tidied. */
export function asSlop(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const phrases = arr(s.phrases).map(normPhrase).filter(p => p && !seen.has(`${p.t}|${p.sc}|${p.k}`) && seen.add(`${p.t}|${p.sc}|${p.k}`));
    return { phrases, fine: arr(s.fine).map(normFine).filter(Boolean), asked: [...new Set(arr(s.asked).map(normText).filter(Boolean))].slice(-300) };
}

/** Does this rung apply here? where: { charKey, board } */
const applies = (p, w = {}) => p.sc === 'all' || (p.sc === 'board' && !!w.board && p.k === w.board) || (p.sc === 'char' && !!w.charKey && p.k === w.charKey);
export const phrasesHere = (store, w) => asSlop(store).phrases.filter(p => applies(p, w));
export const fineHere = (store, w) => asSlop(store).fine.filter(p => applies(p, w));

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The phrase as a pattern: whole words, any case, any run of spaces, straight or curly apostrophes. */
export const phraseRe = (t, flags = 'gi') => new RegExp(`(?<![\\p{L}\\p{N}])${esc(normText(t)).replace(/ /g, '\\s+').replace(/'/g, "['’]")}(?![\\p{L}\\p{N}])`, flags + 'u');
export const usedIn = (text, t) => phraseRe(t, 'i').test(str(text).replace(/[“”"]/g, ''));

// ── learning: what the writer keeps reusing ──────────────────────────────────

const STOP = new Set(('a an the and or but if then so of to in on at by for with from into onto over under about as is was were be been being '
    + 'he she it they them him her his hers its their theirs i me my mine you your yours we us our this that these those there here '
    + 'not no do did does done have has had would could should will can just than too very up down out off again once all any some '
    + 'what which who whom when where why how one each other more most such only own same both few while still even back '
    + 's t don didn doesn isn wasn aren weren won couldn wouldn shouldn hadn hasn haven ll re ve d m').split(' '));

const words = s => normText(s).match(/[\p{L}\p{N}']+/gu) || [];

/**
 * Phrases (3–5 words) the writer used in at least MIN_REPLIES of the last WINDOW replies. replies: their texts, oldest
 * first. names: the people's names (never a phrase: "Corvin said" isn't slop). skip: phrases already listed, fine or
 * asked. → [{ t, n }], the most used first; a longer phrase wins over the shorter ones inside it.
 */
export function repeats(replies, { names = [], skip = [], minReplies = MIN_REPLIES, window = WINDOW } = {}) {
    const recent = arr(replies).slice(-window);
    if (recent.length < minReplies) return [];
    const nameWords = new Set(arr(names).flatMap(words));
    const skipSet = new Set(arr(skip).map(normText));
    const counts = new Map();
    for (const text of recent) {
        const seen = new Set();
        // inside one sentence only
        for (const part of str(text).split(/[.!?;:\n…—()[\]*"“”]+/)) {
            const w = words(part);
            for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= w.length; i++) {
                const g = w.slice(i, i + n);
                if (g.some(x => nameWords.has(x) || /^\d+$/.test(x))) continue;
                const content = g.filter(x => !STOP.has(x));
                if (!(content.some(x => x.length >= 4) || content.length >= 2)) continue;
                if (STOP.has(g[g.length - 1]) && STOP.has(g[0])) continue;   // "of the edge of": no clean edges
                seen.add(g.join(' '));
            }
        }
        for (const g of seen) counts.set(g, (counts.get(g) || 0) + 1);
    }
    const hits = [...counts].filter(([t, n]) => n >= minReplies && !skipSet.has(t) && ![...skipSet].some(s => t.includes(s) || s.includes(t)))
        .map(([t, n]) => ({ t, n })).sort((a, b) => b.t.split(' ').length - a.t.split(' ').length || b.n - a.n);
    const kept = [];
    for (const h of hits) if (!kept.some(k => k.t.includes(h.t) && k.n >= h.n)) kept.push(h);
    return kept.sort((a, b) => b.n - a.n || b.t.length - a.t.length);
}

/** How many of these replies used the phrase. */
export const usedCount = (replies, t) => arr(replies).filter(x => usedIn(x, t)).length;

// ── what the writer gets ─────────────────────────────────────────────────────

/** The 🚫 lines for the writer: listed phrases the last LATELY replies used. → [{ kind: 'dont', text }] */
export function writerLines(phrases, replies) {
    const recent = arr(replies).slice(-LATELY);
    const used = arr(phrases).filter(p => recent.some(r => usedIn(r, p.t)));
    const q = l => l.map(p => `"${p.t}"`).join(', ');
    const ban = used.filter(p => p.m === 'ban'), less = used.filter(p => p.m === 'less');
    const out = [];
    // close variants count too (Miinthe, 2026-11-05: told to drop a phrase, the AI "cheats and says a ridiculous similar phrase")
    if (ban.length) out.push({ kind: 'dont', text: `Don't use these phrases, and don't swap in a close variant of them either (the same image or gesture in other words, like a reworded or synonym version): ${q(ban)}. Write the moment differently.` });
    if (less.length) out.push({ kind: 'dont', text: `Use these rarely, only where they really fit, and the same goes for close variants of them: ${q(less)}.` });
    return out;
}

/** Which listed phrases to underline in one reply. before: the replies before it (oldest first). */
export function toUnderline(text, phrases, before = []) {
    const prev = arr(before).slice(-TOO_SOON);
    return arr(phrases).filter(p => usedIn(text, p.t) && (p.m === 'ban' || prev.some(b => usedIn(b, p.t))));
}

// ── rewriting a passage ──────────────────────────────────────────────────────

export const REWRITES = { polish: 'Polish', shorten: 'Shorten', longer: 'Longer', own: 'Your own…' };
const ASK = {
    polish: 'Polish it: smoother, more precise wording. Same length, same meaning.',
    shorten: 'Make it shorter and tighter. Keep what matters.',
    longer: 'Make it a little longer and richer, with concrete detail. Don\'t add new events.',
    slop: 'Say the same thing in fresh wording.',
};

/**
 * The one call for a rewrite. what: polish · shorten · longer · own (with `instruction`) · slop (with `phrase`).
 * before / after: the text around it, for the flow (never rewritten). avoid: listed phrases to steer clear of.
 */
export function rewritePrompt(what, passage, { before = '', after = '', instruction = '', phrase = '', avoid = [] } = {}) {
    const ask = what === 'own' ? str(instruction).trim() || ASK.polish : what === 'slop' ? `${ASK.slop} Don't use "${phrase}" or anything close to it.` : ASK[what] || ASK.polish;
    const system = [
        'You are a careful fiction editor. You rewrite ONE passage of a roleplay story and nothing else.',
        'Keep the point of view, tense, names, and what happens. Keep the formatting the passage uses (*actions*, "dialogue", line breaks).',
        'Answer with the rewritten passage only: no quotes around it, no notes, no options.',
    ].join('\n');
    const avoidList = arr(avoid).map(p => normText(p)).filter(Boolean).slice(0, 20);
    const user = [
        before ? `Text before it (for the flow, don't rewrite):\n${str(before).slice(-600)}` : '',
        `The passage to rewrite:\n${passage}`,
        after ? `Text after it (for the flow, don't rewrite):\n${str(after).slice(0, 400)}` : '',
        `What to do: ${ask}`,
        avoidList.length ? `Avoid these phrases: ${avoidList.map(x => `"${x}"`).join(', ')}.` : '',
    ].filter(Boolean).join('\n\n');
    return { system, user };
}

/** The editor's answer, cleaned: no label, no wrapping quotes it added. '' when nothing usable came back. */
export function cleanRewrite(text, passage = '') {
    let t = str(text).trim().replace(/^(?:here(?:'s| is)[^:\n]*:|rewritten(?: passage)?:)\s*/i, '').trim();
    const wrapped = /^["“].*["”]$/s.test(t) && !/^["“]/.test(str(passage).trim());
    if (wrapped) t = t.slice(1, -1).trim();
    // wrapped as an *action* when the passage was plain narration (bug hunt 2026-11-03: Keep would have turned it into one)
    const P = str(passage).trim();
    if (/^\*[^*]+\*$/s.test(t) && !/^\*/.test(P) && !/\*$/.test(P)) t = t.slice(1, -1).trim();
    return t.length > Math.max(4000, str(passage).length * 4) ? '' : t;
}

/**
 * Where the selected text sits in the message's own text (the screen shows it formatted: no asterisks, curly quotes).
 * → { start, end } in `source`, or null when it can't be found exactly once.
 */
export function locate(source, picked) {
    const src = str(source), want = str(picked).trim();
    if (!want) return null;
    const once = (s, w) => { const i = s.indexOf(w); return i !== -1 && s.indexOf(w, i + 1) === -1 ? i : -1; };
    let i = once(src, want);
    if (i !== -1) return { start: i, end: i + want.length };
    // loose: every run of spaces, the formatting marks and the quote styles may differ
    const parts = want.split(/\s+/).map(w => esc(w.replace(/[*_"“”]/g, '')).replace(/'|’/g, "['’]")).filter(Boolean);
    if (!parts.length) return null;
    const re = new RegExp(`[*_"“”]*${parts.join('[*_"“”]*\\s+[*_"“”]*')}[*_"“”]*`, 'g');
    const all = [...src.matchAll(re)];
    if (all.length !== 1) return null;
    // keep the formatting marks that open and close outside the selection where they were
    let s = all[0].index, e = s + all[0][0].length;
    const lead = all[0][0].match(/^[*_"“”]*/)[0].length, trail = all[0][0].match(/[*_"“”]*$/)[0].length;
    if (!/^[*_"“”]/.test(want)) s += lead;
    if (!/[*_"“”]$/.test(want)) e -= trail;
    return { start: s, end: e };
}

/** The sentence around a phrase's first match in a text, for "Rewrite this line". → { start, end } or null */
export function sentenceAround(text, t) {
    const src = str(text), m = phraseRe(t, 'i').exec(src.replace(/[“”]/g, '"'));
    if (!m) return null;
    let s = m.index, e = m.index + m[0].length;
    while (s > 0 && !/[.!?\n]/.test(src[s - 1])) s--;
    while (e < src.length && !/[.!?\n]/.test(src[e])) e++;
    if (e < src.length && /[.!?]/.test(src[e])) e++;
    while (e < src.length && /["”*]/.test(src[e])) e++;
    while (s < m.index && /\s/.test(src[s])) s++;
    return { start: s, end: e };
}
