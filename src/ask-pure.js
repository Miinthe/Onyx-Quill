/**
 * Question cards (Miinthe, 2026-11-02: "give the mero chat [the ability] to ask questions — multi selection to wrap up the
 * plan, like Claude does … would be useful for storyboard Mero as well"). Pure; tested in test/mero-tools.test.mjs.
 *
 * Mero asks something with a few clear answers as a card: the question, 2–4 answers to click (one, or several), and
 * always "your own". Used by Mero's talks (markup in her answer), 💡 Pitch from a talk (what is still open, before she
 * writes it up) and the storyboard's Mero (JSON "asks").
 *   ask = { q, many (several may be picked), opts: [text], picked?: [index], own?: text, done?: 'answered'|'skipped' }
 */
const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clip = (s, n) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : t; };

export const MAX_ASKS = 3;
export const MAX_OPTS = 5;

/** One card, cleaned: a question and at least two different answers — or null. */
export function normAsk(a) {
    if (!a || typeof a !== 'object') return null;
    const q = clip(a.q ?? a.question, 240);
    const opts = [];
    for (const o of arr(a.opts ?? a.options ?? a.answers)) { const t = clip(typeof o === 'string' ? o : o?.text ?? o?.label, 160); if (t && !opts.some(x => x.toLowerCase() === t.toLowerCase())) opts.push(t); }
    if (!q || opts.length < 2) return null;
    const many = a.many === true || /^(many|multi|several|yes|true)$/i.test(str(a.pick ?? a.many));
    const picked = [...new Set(arr(a.picked).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < Math.min(opts.length, MAX_OPTS)))];
    return { q, many, opts: opts.slice(0, MAX_OPTS), ...(picked.length ? { picked: many ? picked : picked.slice(0, 1) } : {}), ...(str(a.own).trim() ? { own: clip(a.own, 400) } : {}), ...(a.done === 'answered' || a.done === 'skipped' ? { done: a.done } : {}) };
}
export const normAsks = list => arr(list).map(normAsk).filter(Boolean).slice(0, MAX_ASKS);

/** How Mero writes a card in a talk answer (the talk is plain text, so markup — taken out before Miinthe reads it). */
export const ASK_FORMAT = `When you ask Miinthe something that has a few clear possible answers, ask it as a question card instead of in your text — on its own lines at the end:
[[ASK one]] The question?
- a first answer
- a second answer
- a third answer
[[/ASK]]
"one" = she picks one; "many" = she may pick several. 2 to 4 short answers that really differ; she can always write her own. At most ${MAX_ASKS} cards in an answer, and only when you need to know. A question with no clear answers stays in your text.`;

const ASK_RE = /\[\[ASK\b([^\]]*)\]\]([\s\S]*?)\[\[\/ASK\]\]/gi;
/** The cards out of a talk answer: { text (without them), asks }. */
export function takeAsks(text) {
    const asks = [];
    const t = str(text).replace(ASK_RE, (_, attrs, body) => {
        const lines = str(body).split('\n').map(l => l.trim()).filter(Boolean);
        const q = lines.filter(l => !/^[-*•]|^\d+[.)]/.test(l)).join(' ');
        const opts = lines.filter(l => /^[-*•]|^\d+[.)]/.test(l)).map(l => l.replace(/^(?:[-*•]|\d+[.)])\s*/, ''));
        const a = normAsk({ q, opts, pick: /many|multi|several/i.test(attrs) ? 'many' : 'one' });
        if (a && asks.length < MAX_ASKS) asks.push(a);
        return '';
    });
    return { text: t.replace(/\n{3,}/g, '\n\n').trim(), asks };
}

/** What Miinthe's answers say, as her message ("The question? → this; that"). Unanswered cards are left out. */
export function askAnswerText(asks) {
    return normAsks(asks).map(a => {
        const got = [...arr(a.picked).map(i => a.opts[i]), ...(a.own ? [a.own] : [])].filter(Boolean);
        return got.length ? `${a.q} → ${got.join('; ')}` : '';
    }).filter(Boolean).join('\n');
}

/** Miinthe's picks put on the cards (from the window): [{ picked: [i], own }] per card; all marked answered (or skipped). */
export function answerAsks(asks, answers = [], { skipped = false } = {}) {
    return normAsks(asks).map((a, k) => {
        if (skipped) return { ...a, done: 'skipped' };
        const x = arr(answers)[k] || {};
        return normAsk({ ...a, picked: x.picked, own: x.own, done: 'answered' });
    });
}

/**
 * A Mero message as the AI sees it again: her question cards are cut out of the text, so they go back in as one line
 * (bug hunt 2026-11-03: a question Miinthe ignored was invisible to the next answer and to 💡 Pitch's rule "a question
 * you asked that she didn't answer is open").
 */
export function withAsked(m) {
    const t = typeof m?.t === 'string' ? m.t : '';
    const q = (Array.isArray(m?.asks) ? m.asks : []).map(a => (typeof a?.q === 'string' ? a.q.trim() : '')).filter(Boolean);
    return q.length ? `${t}\n[asked: ${q.join(' · ')}]`.trim() : t;
}
