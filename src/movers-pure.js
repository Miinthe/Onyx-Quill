/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 3b part 2 (`13 engine on v2 plan.md`): the moves made by
 * hand, on the v2 chat state — ◀ ▶ / a step clicked, the detour, pause / continue / abandon / reactivate and their
 * Undo. Today's rules carried over one for one (trackers-pure.js moveTo / setAside / runTracker / undoRun), checked
 * by running the engine story on the old and the new movers (test/engine-characterization.test.mjs).
 * Each mutates the state it is given (a copy the caller made) and returns null or { error }.
 */
import { stepIndex, stepOf, branchOf } from './board-model-pure.js';
import { hasStarts, takeBranchV2 } from './turn-pure.js';

const low = s => String(s ?? '').trim().toLowerCase();
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const place = (st, t) => (st.trackers[t.id] = { ...(st.trackers[t.id] || {}) });
/** Not started yet — it has no step (the copy's rule, board-model-pure fromEngineList); `waitAt` is where it will start. */
const waits = (board, t, p) => t.starts.length > 0 && !p.started;
const indexOf = (t, p) => Math.max(0, stepIndex(t, p.at ?? p.waitAt));
const clamp = (t, k) => Math.min(Math.max(Math.floor(Number(k) || 0), 0), t.steps.length - 1);

/** Put the tracker at step index `k` (a waiting one only remembers it); a move to another step ends the detour. */
function standAt(board, t, p, k) {
    const to = t.steps[clamp(t, k)].id;
    if (to !== (p.at ?? p.waitAt ?? t.steps[0].id)) { delete p.aside; delete p.asideText; }
    if (waits(board, t, p)) { p.at = null; if (clamp(t, k) > 0) p.waitAt = to; else delete p.waitAt; }
    else { p.at = to; delete p.waitAt; }
}

/** ◀ ▶ / a step clicked: to step index `target` (clamped). */
export function moveStepV2(board, st, t, target) {
    standAt(board, t, place(st, t), target);
    return null;
}

/** Set (a detour of this step by name, else free text) or clear ('' / null) the detour. */
export function setAsideV2(board, st, t, aside) {
    const p = place(st, t);
    const text = typeof aside === 'string' && aside.trim() ? aside.trim() : null;
    delete p.aside; delete p.asideText;
    if (!text) return null;
    const det = stepOf(t, p.at ?? p.waitAt ?? t.steps[0].id)?.detours?.find(d => low(d.name) === low(text));
    if (det) p.aside = det.id; else p.asideText = text;
    return null;
}

/** Pause / continue / abandon / reactivate a step tracker in this chat. */
export function runStepV2(board, st, t, action) {
    const p = place(st, t);
    if (action === 'pause') { if (p.run) return { error: p.run === 'paused' ? 'already paused' : 'abandoned — reactivate it instead' }; p.run = 'paused'; return null; }
    if (action === 'continue') { if (p.run !== 'paused') return { error: 'not paused' }; delete p.run; return null; }
    if (action !== 'abandon' && action !== 'reactivate') return { error: `unknown: ${action}` };
    if (action === 'abandon' && p.run === 'abandoned') return { error: 'already abandoned' };
    if (action === 'reactivate' && p.run !== 'abandoned') return { error: 'not abandoned' };
    // back to the start: first step, no detour, no branches taken, not ended; one with start lines waits again
    delete p.aside; delete p.asideText; delete p.ended; delete p.waitAt;
    p.forks = {};
    if (hasStarts(board, t)) { delete p.started; delete p.startedAt; }
    p.at = waits(board, t, p) ? null : t.steps[0].id;
    if (action === 'abandon') p.run = 'abandoned'; else delete p.run;
    return null;
}

/**
 * Undo the last pause / continue / abandon / reactivate: `from` is what the engine's list remembered before it
 * ({ index, aside, took, ended, run, started, startedAt } — names, as the list keeps them).
 */
export function undoRunStepV2(board, st, t, from) {
    const p = place(st, t);
    if (from.run) p.run = from.run; else delete p.run;
    if (from.ended) p.ended = { ...from.ended }; else delete p.ended;
    if (hasStarts(board, t)) { if (from.started) p.started = true; else delete p.started; if (from.startedAt) p.startedAt = from.startedAt; else delete p.startedAt; }
    p.forks = {};
    for (const [stepName, brName] of Object.entries(isObj(from.took) ? from.took : {})) {
        const s = t.steps.find(x => low(x.name) === low(stepName));
        const b = s?.fork?.branches.find(x => low(x.name) === low(brName));
        if (s && b && branchOf(t, s.id, b.id)) p.forks[s.id] = b.id;
    }
    const k = clamp(t, from.index);
    if (waits(board, t, p)) { p.at = null; if (k > 0) p.waitAt = t.steps[k].id; else delete p.waitAt; } else { p.at = t.steps[k].id; delete p.waitAt; }
    delete p.aside; delete p.asideText;
    if (from.aside) setAsideV2(board, st, t, from.aside);
    return null;
}

// ── step 3b part 3: the helper's moves, branches, and the helper's Undo ─────────────────────────────────────

const stepByName = (t, name) => t.steps.find(s => low(s.name) === low(name)) || null;

/** The helper's move: to step index `toIndex`, with detour `toAside` (by name, on the new step — as the list kept it). */
export function helperMoveV2(board, st, t, toIndex, toAside) {
    const p = place(st, t);
    if (toIndex !== indexOf(t, p)) { p.at = t.steps[clamp(t, toIndex)].id; delete p.waitAt; }
    setAsideV2(board, st, t, toAside || '');
    return null;
}

/** Take branch `branchName` of the fork after step `stepName` (moving there first if it stands elsewhere). */
export function takeBranchAtV2(board, st, t, stepName, branchName, i, meta = {}) {
    const s = stepByName(t, stepName);
    if (!s?.fork?.branches?.length) return { error: `${t.name} has no fork after "${stepName}"` };
    const br = s.fork.branches.find(b => low(b.name) === low(branchName));
    if (!br) return { error: `"${branchName}" is not a branch after ${stepName}` };
    const p = place(st, t);
    if (indexOf(t, p) !== stepIndex(t, s.id)) { p.at = s.id; delete p.aside; delete p.asideText; delete p.waitAt; }   // a detour belongs to its step
    return takeBranchV2(board, st, t, br, i, meta);
}

/**
 * Undo the helper's last move (`m` = the list's lastAuto): a branch is forgotten (forks, history, an ending; a
 * tracker it started waits again), then back to its step and detour.
 */
export function undoAutoV2(board, st, t, m, other = null) {
    const p = place(st, t);
    if (m.branch) {
        p.forks = {};
        for (const [stepName, brName] of Object.entries(isObj(m.fromTook) ? m.fromTook : {})) {
            const s = stepByName(t, stepName), b = s?.fork?.branches.find(x => low(x.name) === low(brName));
            if (s && b) p.forks[s.id] = b.id;
        }
        const log = Array.isArray(p.branchLog) ? p.branchLog : [];
        p.branchLog = log.slice(0, m.fromLog ?? log.length);
        if (!p.branchLog.length) delete p.branchLog;
        if (m.fromEnded) p.ended = { ...m.fromEnded }; else delete p.ended;
        if (other) {
            const q = place(st, other), k = indexOf(other, q);
            delete q.started; delete q.startedAt;
            if (other.starts.length > 0) { q.at = null; if (k > 0) q.waitAt = other.steps[k].id; else delete q.waitAt; }
        }
    }
    if (m.fromIndex !== indexOf(t, p)) { p.at = t.steps[clamp(t, m.fromIndex)].id; delete p.waitAt; }
    setAsideV2(board, st, t, m.fromAside || '');
    return null;
}

export { indexOf as stepIndexOf };
