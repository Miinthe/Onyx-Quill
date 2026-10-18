/**
 * Overhaul — the Story tab's plain rules (no page, no SillyTavern): what a tracker card says, the folds' summaries,
 * how a change in the "What changed" fold reads. Tested in test/story-view.test.mjs. Glue: story-view.js.
 */

const arr = v => (Array.isArray(v) ? v : []);
const clamp = (i, n) => Math.min(Math.max(Math.floor(Number(i) || 0), 0), Math.max(0, n - 1));

/** Where a step tracker stands: { index, step (1-based, 0 while it waits), count, cur, pips: [filled…], first, last }. */
export function standing(t) {
    const steps = arr(t?.steps), count = steps.length;
    const index = clamp(t?.index, count);
    const waiting = t?.state === 'waiting';
    const step = !count || waiting ? 0 : index + 1;
    return {
        index, step, count,
        cur: waiting ? 'Waiting' : (steps[index] ?? ''),
        pips: steps.map((_, k) => k < step),
        first: index <= 0, last: index >= count - 1,
    };
}

/** Dimmed when it is not running (waiting, paused, abandoned, ended). */
export const isQuiet = t => !!t && (t.ended || (t.state ? t.state !== 'running' : t.run === 'paused' || t.run === 'abandoned'));

/**
 * The card's note lines, most important first. Each: { kind, text, undo?: 'auto'|'run', branches?: [names] }.
 * `cond(c)` turns a start condition into words ("Relationship reaches Sweethearts"); `fork` is pendingFork(t).
 */
export function cardNotes(t, { cond = c => String(c?.step ?? ''), fork = null } = {}) {
    if (!t) return [];
    const out = [];
    const lr = t.lastRun?.action;
    if (t.ended) out.push({ kind: 'ended', text: `Ended: ${t.ended.branch} (after ${t.ended.step}). Not followed any more.` });
    if (t.run === 'paused') out.push({ kind: 'run', text: 'Paused in this chat. Keeps its step; not followed, not told to the AI.', ...(lr === 'pause' ? { undo: 'run' } : {}) });
    else if (t.run === 'abandoned') out.push({ kind: 'run', text: 'Abandoned in this chat: back at the start, switched off.', ...(lr === 'abandon' ? { undo: 'run' } : {}) });
    else if (lr === 'continue' || lr === 'reactivate') out.push({ kind: 'run', text: lr === 'continue' ? 'Running again.' : 'Reactivated: on again from the start.', undo: 'run' });
    if (!t.run) {
        if (t.state === 'paused' && t.pausedWhy && t.pausedWhy !== 'its start no longer holds') out.push({ kind: 'wait', text: `Paused: ${t.pausedWhy}.` });
        else if ((t.state === 'waiting' || t.state === 'paused') && arr(t.starts).length) out.push({ kind: 'wait', text: `Starts when ${arr(t.starts).map(cond).join(' and ')}.` });
    }
    if (fork && !t.ended) out.push({ kind: 'fork', text: `Waits at the fork after ${fork.step}${fork.fork?.by === 'roll' ? ': a roll decides.' : ': the story decides, or pick one.'}`, branches: arr(fork.fork?.branches).map(b => b.name) });
    if (t.lastAuto) out.push({ kind: 'auto', text: `✨ “${t.lastAuto.quote || ''}”${t.lastAuto.message != null ? ` · moved at #${t.lastAuto.message}` : ''}`, undo: 'auto' });
    if (t.aside) out.push({ kind: 'aside', text: `Detour: currently ${t.aside}` });
    const took = t.took && typeof t.took === 'object' ? Object.entries(t.took) : [];
    if (took.length && !fork && !t.ended) out.push({ kind: 'took', text: took.map(([s, b]) => `after ${s}: ${b}`).join(' · ') });
    return out;
}

/** "Forward only" / "Both ways". */
export const directionLabel = d => (d === 'forward' ? 'Forward only' : 'Both ways');

/** The board fold's one-line summary from its rows' short words, e.g. "Day 3 · 📍 Kitchen · 🎒 Tape, $3". */
export function boardSummary(shorts) {
    const s = arr(shorts).filter(Boolean);
    if (!s.length) return 'no places, time or collections';   // the trackers above aren't counted here (bug hunt 2026-10-17)
    return s.join(' · ');
}

/** Plain text from a notice's HTML (all lines, joined). */
export function plain(html) {
    return String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** One change as a row: { title: the change, sub: its quote / reason / where it came from }. The trailing "Undo" goes. */
export function changeRow(x) {
    const lines = plain(x?.html).filter(l => !/^Undo( all)?$/i.test(l)).map(l => l.replace(/\s*Undo( all)?$/i, '')).filter(Boolean);
    const title = lines[0] || String(x?.title ?? '').trim() || 'A change';
    const rest = lines.slice(1).join(' · ');
    return { title, sub: rest || String(x?.title ?? '').trim() };
}

/** The Changes fold's header: { count, summary } for groups from groupFeed (newest message first). */
export function changesSummary(groups) {
    const g = arr(groups);
    const count = g.reduce((n, x) => n + arr(x.items).length, 0);
    if (!count) return { count: 0, summary: 'nothing yet in this chat' };
    const newest = arr(g[0].items).at(-1);
    return { count, summary: changeRow(newest).title };
}

/** The label above a message's changes. */
export const groupLabel = i => (Number.isFinite(i) && i >= 0 ? `Message #${i}` : 'Earlier');

/** Checks a tracker's edited name and steps: { ok, name, steps } or { error } (plain words). */
export function checkEdit({ name, steps, others = [], was = '' } = {}) {
    const n = String(name ?? '').trim();
    if (!n) return { error: 'The tracker needs a name.' };
    if (arr(others).some(o => String(o).toLowerCase() === n.toLowerCase() && String(o) !== String(was))) return { error: `There is already a tracker called “${n}”.` };
    const list = arr(steps).map(s => String(s ?? '').trim()).filter(Boolean);
    if (list.length < 2) return { error: 'A tracker needs at least two steps.' };
    const seen = new Set();
    for (const s of list) { const k = s.toLowerCase(); if (seen.has(k)) return { error: `The step “${s}” is there twice.` }; seen.add(k); }
    return { ok: true, name: n, steps: list };
}
