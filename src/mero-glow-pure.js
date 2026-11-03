/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆'s glow (`10 co-writer design.md` §11, mock-up v13): how chatty, pure.
 *
 * The glow — one of chattiness's three parts (Miinthe, 2026-10-05): off · big moments (the 💬 icon glows after a big
 * moment on the board: "want to talk about it?") · big moments + quiet threads. Quiet / Chatty / Very chatty set it.
 * Costs nothing until clicked: the moments are read from the board's own log, no AI call.
 *
 * A big moment is a step tracker's move: forward to a new step, a branch taken at a fork, a start, an ending.
 * (Back-moves are left out — mostly corrections.) Read live from the chat's log, so a deleted message takes its
 * moment away too.
 */
import { trackerOf, stepOf, stepIndex, branchOf } from './board-model-pure.js';
import { named } from './mero-names-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
export const GLOW_KEY = 'deeplore_mero_glow';   // chat_metadata: { seen: [keys], done: [keys] }
export const RECENT = 30;                       // a moment counts as "now" for this many messages
export const QUIET_AFTER = 25;                  // a running thread with no move for this many messages has gone quiet
export const SHOWN = 3;                         // the newest moments shown (the rest wait behind them, never a wall of cards)

export function asGlow(v) {
    const o = v && typeof v === 'object' ? v : {};
    const keys = x => arr(x).filter(k => typeof k === 'string').slice(-300);
    return { seen: keys(o.seen), done: keys(o.done) };
}

const name = (t, id) => stepOf(t, id)?.name ?? null;

/** The big moments of one step log entry (several can happen at once: a branch and an ending). */
export function momentsOf(board, e) {
    // a meter crossing into another band is a big moment too (meters, 2026-10-12); a move inside a band stays quiet
    if (e?.kind === 'meter') {
        const t = trackerOf(board, e.col), bf = t?.meter?.bands?.find(b => b.id === e.bandFrom), bt = t?.meter?.bands?.find(b => b.id === e.bandTo);
        return t && bf && bt && bf.id !== bt.id ? [{ key: `${e.id}:band`, i: e.i, tracker: t.name, icon: t.icon || '', text: `${t.name}: ${bf.name} → ${bt.name}`, quote: e.quote || '' }] : [];
    }
    if (e?.kind !== 'step') return [];
    const t = trackerOf(board, e.col);
    if (!t) return [];
    const a = e.from || {}, b = e.to || {}, out = [];
    const add = (what, text) => out.push({ key: `${e.id}:${what}`, i: e.i, tracker: t.name, icon: t.icon || '', text, quote: e.quote || '' });
    const began = b.started && !a.started;
    if (began) add('start', `${t.name} began${stepIndex(t, b.at) > 0 ? ` at ${name(t, b.at)}` : ''}`);
    else if (b.at && b.at !== a.at && stepIndex(t, b.at) > stepIndex(t, a.at ?? a.waitAt)) add('step', `${t.name} → ${name(t, b.at)}`);
    for (const [stepId, brId] of Object.entries(b.forks || {})) {
        if (a.forks?.[stepId] === brId) continue;
        const br = branchOf(t, stepId, brId);
        if (br) add(`fork-${stepId}`, `${t.name} took “${br.name}” after ${name(t, stepId)}`);
    }
    if (b.ended && !a.ended) add('end', `${t.name} ended`);
    return out;
}

/** The big moments of the last RECENT messages that Miinthe hasn't talked about or set aside, newest first. */
export function recentMoments(board, state, lastIndex, glow = asGlow(null)) {
    const out = [];
    for (const e of arr(state?.log)) {
        if ((e?.kind !== 'step' && e?.kind !== 'meter') || !(e.i > lastIndex - RECENT)) continue;
        for (const m of momentsOf(board, e)) if (!glow.done.includes(m.key)) out.push(m);
    }
    return out.sort((x, y) => y.i - x.i);
}

/**
 * Threads gone quiet (Very chatty): a step tracker that runs (started or without start lines, not ended, not
 * paused) and hasn't moved for QUIET_AFTER messages. Its key changes with its last move, so it can come back later.
 */
export function quietThreads(board, state, lastIndex, glow = asGlow(null)) {
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        const p = state?.trackers?.[t.id] || {};
        if (p.ended || p.run || (arr(t.starts).length && !p.started)) continue;
        const moves = arr(state?.log).filter(e => e?.kind === 'step' && e.col === t.id).map(e => e.i);
        const last = moves.length ? Math.max(...moves) : 0;
        if (lastIndex - last < QUIET_AFTER) continue;
        const key = `quiet:${t.id}:${last}`;
        if (glow.done.includes(key)) continue;
        out.push({ key, i: last, tracker: t.name, icon: t.icon || '', text: `${t.name} hasn't moved in ${lastIndex - last} messages${p.at ? ` (still at ${name(t, p.at)})` : ''}`, quiet: true });
    }
    return out;
}

/**
 * Everything that may make 💬 glow at this level (the newest SHOWN, one per text — "→ Sweethearts" twice is one
 * moment), and whether it glows (something not seen yet).
 */
export function glowNow(level, board, state, lastIndex, glow = asGlow(null)) {
    if (level === 'off' || !board) return { glows: false, moments: [] };
    const seenText = new Set();
    const moments = [...recentMoments(board, state, lastIndex, glow), ...(level === 'quiet' ? quietThreads(board, state, lastIndex, glow) : [])]
        .filter(m => !seenText.has(m.text) && seenText.add(m.text)).slice(0, SHOWN);
    return { glows: moments.some(m => !glow.seen.includes(m.key)), moments };
}

/** What Mero is told when she opens a talk about these moments herself. */
export function momentOpener(moments, names = {}) {
    const lines = arr(moments).map(m => `- ${m.text}${m.i ? ` (message #${m.i})` : ''}${m.quote ? ` — “${m.quote}”` : ''}`);
    return `(${named("{{author}} hasn't written yet", names)} — you open this talk. Something just happened on the board:\n${lines.join('\n')}\nReact to it like their story bestie: what you think it means for the story, how you feel about it, and one question back. Short.)`;
}
