/**
 * What Mero knows of the storyboard (Miinthe, 2026-10-26). Pure; tested in test/mero.test.mjs.
 *
 * She gets a SUMMARY with every message: each tracker with its step names and where it stands now — cheap (~200 tokens
 * on Dragon) and enough for her gut ("that's where the story is heading"). The full board (~8,400 tokens) is never sent.
 * When Miinthe's message names a tracker or one of its steps, that tracker's DETAILS go with that one message only: each
 * step with a short look at its own entry. She is told plainly that she sees names only otherwise — so she says
 * "I only see the step name" instead of pretending she looked it up (Miinthe: "she pretended to know … she basically lied").
 */

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : '');
const low = s => str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const clip = (s, n) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : t; };

const stepTrackers = board => arr(board?.trackers).filter(t => t && t.kind === 'steps' && arr(t.steps).length);
const nameOf = s => (s && typeof s === 'object' ? str(s.name) : str(s));
const idOf = s => (s && typeof s === 'object' ? str(s.id) : str(s));
const nowOf = (state, t) => str(state?.trackers?.[t.id]?.at);

/** One line per step tracker: "Name: A → B ← now → C" ("not started" when it has no step yet). */
export function boardSummary(board, state) {
    return stepTrackers(board).map(t => {
        const at = nowOf(state, t);
        const steps = arr(t.steps).map(s => (idOf(s) && idOf(s) === at ? `${nameOf(s)} ← now` : nameOf(s)));
        return `${str(t.name)}: ${steps.join(' → ')}${at ? '' : ' (not started)'}`;
    });
}

// words too common to point at one tracker
const COMMON = new Set(['story', 'their', 'there', 'where', 'about', 'after', 'before', 'first', 'second', 'friend', 'lover', 'begins', 'return', 'public', 'pressure', 'price']);
const words = s => low(s).match(/[\p{L}\p{N}]{6,}/gu) || [];

/**
 * The step trackers Miinthe's message points at: by the tracker's name, a step's name, or a distinctive word of the
 * tracker's name ("eternity" → A Stolen Eternity). At most `max`, best first.
 */
export function namedTrackers(text, board, max = 2) {
    const t = low(text);
    if (!t.trim()) return [];
    const hit = [];
    for (const tr of stepTrackers(board)) {
        let score = 0;
        if (t.includes(low(tr.name))) score = 3;
        else if (arr(tr.steps).some(s => nameOf(s) && t.includes(low(nameOf(s))))) score = 2;
        else if (words(tr.name).some(w => !COMMON.has(w) && t.includes(w))) score = 1;
        if (score) hit.push({ id: str(tr.id), score });
    }
    return hit.sort((a, b) => b.score - a.score).slice(0, max).map(h => h.id);
}

/**
 * A tracker's details for one message: each step, marked now / done / to come, with a short look at its own entry
 * (the first linked entry that is not a judge note and not shared by every step). `entryText(title)` → text or ''.
 */
export function trackerDetails(board, id, state, entryText = () => '', { perStep = 350 } = {}) {
    const t = stepTrackers(board).find(x => str(x.id) === id);
    if (!t) return '';
    const steps = arr(t.steps), at = nowOf(state, t), atI = steps.findIndex(s => idOf(s) === at);
    const shared = new Set(steps.length > 1 ? arr(steps[0]?.entries).filter(e => steps.every(s => arr(s?.entries).includes(e))) : []);
    const lines = [`${str(t.name)}${at ? '' : ' (not started)'}`];
    steps.forEach((s, k) => {
        const kinds = (s && s.kinds) || {};
        const own = arr(s?.entries).find(e => kinds[e] !== 'judge' && !shared.has(e));
        const look = own ? clip(entryText(own), perStep) : '';
        const where = atI === -1 ? '' : k === atI ? ' [NOW]' : k < atI ? ' [done]' : ' [to come]';
        lines.push(`- ${nameOf(s)}${where}${look ? `: ${look}` : ''}`);
    });
    return lines.join('\n');
}

// ── the stored summary (Miinthe, 2026-10-26: "it generates at saving the board and is viewable through the per board
// general setting … rather silent") — made once per board save when the trackers changed, never announced ──────────

/** A fingerprint of what the summary is made from: the step trackers, their steps and linked entries. */
export function mapHash(board) {
    const src = JSON.stringify(stepTrackers(board).map(t => [str(t.id), str(t.name), arr(t.steps).map(s => [nameOf(s), arr(s?.entries)])]));
    let h = 5381; for (let k = 0; k < src.length; k++) h = ((h * 33) ^ src.charCodeAt(k)) >>> 0;
    return h.toString(36);
}

/** The one call that writes it: one plain line per tracker on what it is about, from its steps and their entries. */
export function mapPrompt(board, entryText = () => '') {
    const system = [
        'You write a short map of a storyboard for a co-writer who chats with the author about the story.',
        'For EACH tracker: one plain line (at most 25 words) on what it is about — the arc, what changes, where it ends. Use only what the steps and their entries say; never invent. No spoiler warnings, no style notes.',
        'Answer with JSON only: {"trackers":[{"id":"<tracker id>","about":"…"}]}',
    ].join('\n');
    const user = stepTrackers(board).map(t => `## ${str(t.name)} (id: ${str(t.id)})\n${trackerDetails(board, str(t.id), null, entryText, { perStep: 220 }).split('\n').slice(1).join('\n')}`).join('\n\n');
    return { system, user };
}

/** The answer → { [tracker id]: about }. Anything unreadable → {} (the summary then shows names only). */
export function parseMapAbouts(text) {
    const raw = String(text ?? '').replace(/```(?:json)?/gi, '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        const out = {};
        for (const x of arr(v?.trackers)) if (x && str(x.id) && str(x.about).trim()) out[str(x.id)] = clip(x.about, 220);
        return out;
    }
    return {};
}

/** The summary as Miinthe sees and edits it: per tracker its name, what it is about (when known) and its steps. */
export function mapText(board, abouts = {}) {
    return stepTrackers(board).map(t => {
        const about = str(abouts[str(t.id)]).trim();
        return `${str(t.name)}${about ? ` — ${about}` : ''}\n  Steps: ${arr(t.steps).map(nameOf).join(' → ')}`;
    }).join('\n');
}

/** Where each tracker stands in THIS chat — added live to the stored summary (free, no AI). */
export function nowLine(board, state) {
    const parts = stepTrackers(board).map(t => {
        const at = nowOf(state, t), s = arr(t.steps).find(x => idOf(x) === at);
        return `${str(t.name)}: ${s ? nameOf(s) : 'not started'}`;
    });
    return parts.length ? `Where each stands in this chat — ${parts.join(' · ')}` : '';
}
