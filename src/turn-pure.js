/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 3b (`13 engine on v2 plan.md`): the board's turn on the v2
 * chat state. Every save of the trackers runs it after the move that caused the save: in rounds (at most 5) —
 * the board's lines (rolls with odds, triggers), then the starts, then the forks decided by roll — until nothing
 * more happens. It replaces the loop in trackers.js `save()` that ran on the engine's list.
 *
 * The rules are today's engine's, carried over one for one (pinned by test/engine-characterization.test.mjs, which
 * runs with the old and the new turn): a start counts the lines the engine counted (odds first; a step reached; a
 * branch taken — EVER, by the branch history, not only the branch standing now; a collection / counter / place /
 * state line); a tracker set to pause when its start falls is not running while it doesn't hold; a branch goes on,
 * back, ends, or ends and starts another (`thenKind`). Nothing is stored here: the caller stores the state and
 * says what happened (the events).
 */
import { trackerOf, stepOf, stepIndex, forkAt, branchOf, holds, certain, lineKey, condText, capLog, isActive } from './board-model-pure.js';
import { rollTurn, fireTriggers, lineHolds, hasRollsOrTriggers, defaultLive } from './rolls-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const low = s => String(s ?? '').trim().toLowerCase();
const place = (st, t) => st.trackers?.[t.id] || {};
const steps = board => arr(board?.trackers).filter(t => t.kind === 'steps');
/** The step index the engine sees (a waiting tracker stands at its first step). */
const idxOf = (t, p) => Math.max(0, stepIndex(t, p?.at ?? p?.waitAt));   // waitAt: where a waiting one will start
const isLast = (t, k) => k === t.steps.length - 1;

// ── the start lines as the engine counts them ───────────────────────────────

function startLine(board, t, c) {
    if (c.odds > 1) return { kind: 'odds', c: { ...c, line: lineKey('start', t.id, c) } };
    if (c.tracker && c.step) return { kind: 'reach', c };
    const src = trackerOf(board, c.tracker);
    if (c.tracker && c.branch && stepOf(src, c.at) && branchOf(src, c.at, c.branch)) return { kind: 'branch', c };
    if (c.collection || c.counter || c.place || c.world) return { kind: 'ext', c: certain(c) };
    return null;   // a line the engine never counted (it dropped it)
}
const startLines = (board, t) => arr(t.starts).map(c => startLine(board, t, c)).filter(Boolean);
export const hasStarts = (board, t) => startLines(board, t).length > 0;
const heldOff = p => p?.run === 'paused' || p?.run === 'abandoned';

function lineHoldsNow(board, st, L, off) {
    // engine on v2, step 7c: the board's own rules (board-model-pure.js holds) — one set for the turn, the readers
    // and the window. A step reached: started, not abandoned, at it or later; a branch: taken, now or before.
    if (L.kind === 'reach' || L.kind === 'branch') return holds(board, st, L.c);
    if (off) return false;   // the board switched off here: its own lines don't hold
    return L.kind === 'odds' ? lineHolds(board, st, L.c, L.c.line) : holds(board, st, L.c);
}
const allStartsHold = (board, st, t, off) => startLines(board, t).every(L => lineHoldsNow(board, st, L, off));

/** Running as the board says (board-model-pure.js isActive): started, not paused by you, its start still holding
 *  when set to pause when it falls, not blocked, not waiting while another holds the floor. */
export const engineActive = (board, st, t) => t?.kind === 'steps' && isActive(board, st, t);

function lineText(board, st, L, off) {
    if (L.kind === 'odds' || L.kind === 'ext') return off ? '(a condition on the board)' : condText(board, L.c);
    const src = trackerOf(board, L.c.tracker);
    if (L.kind === 'branch') {
        const at = stepOf(src, L.c.at), br = branchOf(src, L.c.at, L.c.branch);
        return isLast(src, stepIndex(src, L.c.at)) ? `${src.name} ends in ${br.name}` : `${src.name} takes “${br.name}” after ${at.name}`;
    }
    return `${src ? src.name : L.c.tracker} reaches ${stepOf(src, L.c.step)?.name}`;
}

// ── the three parts of a round ──────────────────────────────────────────────

/** Waiting trackers whose start lines all hold start (each pass decides on the state before it — a chain resolves). */
function starts(board, st, i, at, off) {
    const out = [];
    for (let guard = 0; guard <= steps(board).length; guard++) {
        const now = structuredClone(st.trackers || {});
        const go = steps(board).filter(t => hasStarts(board, t) && !now[t.id]?.started && !heldOff(now[t.id]) && allStartsHold(board, { ...st, trackers: now }, t, off));
        if (!go.length) break;
        for (const t of go) {
            const why = startLines(board, t).map(L => lineText(board, { ...st, trackers: now }, L, off)).join(' and ');
            const p = st.trackers[t.id] = { ...(st.trackers[t.id] || {}) };
            p.at = p.at ?? t.steps[idxOf(t, p)]?.id ?? null;
            delete p.waitAt;
            p.started = true;
            p.startedAt = { i: Math.floor(i || 0), at, why };
            out.push({ kind: 'start', id: t.id, name: t.name, why });
        }
    }
    return out;
}

/** What a branch does afterwards — as the engine reads it (an "on" at the last step ends). */
function thenKind(t, k, br) {
    const kind = br?.then?.kind;
    if (['on', 'back', 'end', 'next'].includes(kind)) return kind === 'on' && isLast(t, k) ? 'end' : kind;
    return isLast(t, k) ? 'end' : 'on';
}
/** Forget branches of steps at or after where it stands (it went back) — not for an ended tracker. */
function dropForksAhead(t, p) {
    if (p.ended || !p.forks) return;
    const at = idxOf(t, p);
    for (const sid of Object.keys(p.forks)) { const k = stepIndex(t, sid); if (!(k >= 0 && k < at)) delete p.forks[sid]; }
}
const asideName = (t, p) => (p.aside ? stepOf(t, p.at)?.detours?.find(d => d.id === p.aside)?.name ?? null : p.asideText || null);
const moveAt = (t, p, k) => {
    const to = t.steps[Math.min(Math.max(k, 0), t.steps.length - 1)].id;
    if (to !== p.at) { delete p.aside; delete p.asideText; }
    p.at = to;
};

/** Take branch `br` of the fork at the step tracker `t` stands at (on the state); returns what happened. */
export function takeBranchV2(board, st, t, br, i, meta = {}) {   // at the step it stands at (takeBranchAtV2 moves it there first)
    const p = st.trackers[t.id] = { ...(st.trackers[t.id] || {}) };
    const k = idxOf(t, p), step = t.steps[k];
    const at = Math.floor(i || 0);
    const kind = thenKind(t, k, br);
    p.forks = { ...(p.forks || {}), [step.id]: br.id };
    p.branchLog = [...arr(p.branchLog), { at: step.id, branch: br.id, i: at }].slice(-50);
    const effect = { tracker: t.name, step: step.name, branch: br.name, kind };
    if (kind === 'on') { moveAt(t, p, k + 1); effect.to = stepOf(t, p.at).name; }
    else if (kind === 'back') {
        const target = stepOf(trackerOf(board, br.then?.tracker || t.id), br.then?.step)?.name;
        const j = t.steps.findIndex(s => low(s.name) === low(target));
        moveAt(t, p, j >= 0 ? j : k);
        dropForksAhead(t, p);   // forks from there on open again
        effect.to = stepOf(t, p.at).name;
    } else p.ended = { step: step.name, branch: br.name, i: at };
    if (kind === 'next') {
        const n = trackerOf(board, br.then?.tracker);
        if (n && n.kind === 'steps' && n.id !== t.id && !st.trackers[n.id]?.started) {   // one already running keeps running
            const q = st.trackers[n.id] = { ...(st.trackers[n.id] || {}) };
            q.at = q.at ?? n.steps[idxOf(n, q)]?.id ?? null;
            delete q.waitAt;
            q.started = true;
            q.startedAt = { i: at, at: meta.at, why: `${t.name} took “${br.name}”` };
            delete q.ended;
            effect.started = n.name;
            effect.startedId = n.id;
        }
    }
    return { id: t.id, effect };
}

/** Pick a branch by weight (1 if unset). */
function rollBranch(branches, rand) {
    const w = branches.map(b => Math.max(1, Math.round(Number(b.weight) || 1)));
    let r = rand() * w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < w.length; k++) { r -= w[k]; if (r < 0) return branches[k]; }
    return branches[branches.length - 1];
}
/** Every fork decided by roll that a running tracker stands at rolls (a roll leading to another rolls again). */
function rollForks(board, st, i, at, rand) {
    const out = [];
    for (let guard = 0; guard < 50; guard++) {
        const t = steps(board).find(x => {
            const p = place(st, x);
            if (!engineActive(board, st, x) || p.ended) return false;
            const s = x.steps[idxOf(x, p)];
            return s?.fork?.by === 'roll' && forkAt(x, s.id).length > 0 && !p.forks?.[s.id];
        });
        if (!t) break;
        const s = t.steps[idxOf(t, place(st, t))];
        const br = rollBranch(s.fork.branches, rand);
        const r = takeBranchV2(board, st, t, br, i, { who: 'roll', at });
        out.push({ kind: 'roll', id: t.id, effect: { ...r.effect, odds: s.fork.branches.map(b => `${b.name} ${Math.max(1, Math.round(Number(b.weight) || 1))}`).join(' : ') } });
    }
    return out;
}

/** The board's lines: rolls with odds, then triggers (rolls-pure.js), with the engine's idea of who runs. */
function boardLines(board, st, i, at) {
    if (!hasRollsOrTriggers(board)) return { state: st, events: [], rolled: [], fired: [] };
    const before = structuredClone(st);   // who runs is judged on the places before this part (as the engine did)
    const isOn = t => t.kind === 'steps' && engineActive(board, before, t);
    const isLive = (ln, s) => (ln.kind === 'start' ? hasStarts(board, ln.t) && !place(before, ln.t).started
        : ln.kind === 'find' ? defaultLive(board, ln, s)
            : !s.fired?.[ln.key] && !(s.denied || []).includes(ln.key) && isOn(ln.t));
    const r = rollTurn(board, st, i, { live: isLive, at });
    const f = fireTriggers(board, r.state, i, { isOn, at });
    const next = r.changed || f.fired.length ? f.state : st;
    const events = [...r.rolled.map(x => ({ kind: 'line-roll', id: x.t.id, x })), ...f.fired.filter(x => x.moved).map(x => {
        const p = place(before, x.t);
        return { kind: 'trigger', id: x.t.id, logId: x.logId, fromIndex: idxOf(x.t, p), fromAside: asideName(x.t, p), why: x.why, x };
    })];
    return { state: next, events, rolled: r.rolled, fired: f.fired };
}

/**
 * The whole turn. `st` is the v2 state with the move that caused the save already in it.
 * `quiet`: no board lines (Re-evaluate's roll back); `off`: the board is switched off in this chat.
 * Returns { state, events, rolled, fired } — events in order: { kind: 'line-roll' | 'trigger' | 'start' | 'roll', id, … }.
 */
export function stepTurn(board, st0, i, { quiet = false, off = false, rand = Math.random, at = new Date().toISOString() } = {}) {
    let st = structuredClone(st0);
    st.trackers ||= {};
    for (const t of steps(board)) if (st.trackers[t.id]) dropForksAhead(t, st.trackers[t.id]);
    const events = [], rolled = [], fired = [];
    for (let round = 0; round < 5; round++) {
        let lines = { events: [], rolled: [], fired: [] };
        if (!quiet && !off) { lines = boardLines(board, st, i, at); st = lines.state; }
        events.push(...lines.events); rolled.push(...lines.rolled); fired.push(...lines.fired);
        const s = starts(board, st, i, at, off);
        const r = rollForks(board, st, i, at, rand);
        events.push(...s, ...r);
        if (!s.length && !r.length && !lines.rolled.length && !lines.fired.length) break;
    }
    capLog(st);
    return { state: st, events, rolled, fired };
}
