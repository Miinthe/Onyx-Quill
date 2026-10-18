/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 6 (`13 engine on v2 plan.md`): stored chats.
 *
 * Since step 1 every move is logged in the v2 chat state (`kind: 'step'`), but only from a chat's first save after
 * that (`v2since`), and saves that also rolled or fired a trigger on the old turn (until step 3b) logged nothing; the
 * engine's list remembered everything (its journal, the start times, the branch history). Here a chat's step log is
 * rebuilt from the list once (trackers.js completeChat) — by the old roll back's own rules: where each tracker stood at message m is what the old
 * roll back would have restored at m (`listAt`). Every message where something happened gets the step entries
 * between "just before m" and "at m". They go in FRONT of the log (a roll back undoes newest first, so at a message
 * the first save only copied, the rebuilt entry is undone last and its `from` wins). Then the log is complete back
 * to the start: `v2since` 0.
 */
import { freshState, fromEngineList, stepEntries, capLog } from './board-model-pure.js';
import { entryAt, pruneAfter } from './trackers-pure.js';
import { unstartAfter } from './conditions-pure.js';
import { unbranchAfter } from './forks-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const clamp = (t, k) => Math.min(Math.max(Math.floor(Number(k) || 0), 0), Math.max(arr(t.steps).length - 1, 0));
const clean = a => (typeof a === 'string' && a.trim() ? a.trim() : null);

/** The engine's list as the old roll back would leave it at message `k` (trackers-pure planRewind + applyPlans). */
export function listAt(list, k) {
    return arr(list).map(t0 => {
        const e = entryAt(t0.journal, k);
        let t = unbranchAfter(unstartAfter({ ...t0, journal: pruneAfter(t0.journal, k), refused: arr(t0.refused).filter(r => r.i <= k) }, k), k);
        if (!e) return t;   // before its first entry: as it is (the old roll back left it too)
        t = { ...t, index: clamp(t, e.index), aside: clean(e.aside), took: e.took && typeof e.took === 'object' ? { ...e.took } : {} };
        if (e.ended) t.ended = e.ended; else delete t.ended;
        if (e.run) t.run = e.run; else delete t.run;
        return t;
    });
}

/** Messages where something happened to a step tracker (journal, a start, a branch taken). */
export function eventMessages(list) {
    const m = new Set();
    for (const t of arr(list)) {
        for (const e of arr(t.journal)) if (Number.isFinite(e?.i)) m.add(e.i);
        if (Number.isFinite(t.startedAt?.i)) m.add(t.startedAt.i);
        for (const b of arr(t.branchLog)) if (Number.isFinite(b?.i)) m.add(b.i);
    }
    return [...m].filter(i => i > 0).sort((a, b) => a - b);
}

/**
 * The v2 state `st` with its log completed from `list` for every message up to `upTo` (the chat's `v2since`, or all
 * when it has none). Returns { state, added } — nothing stored.
 */
export function completeStepLog(board, st, list, upTo = Infinity) {
    const added = [];
    const places = l => fromEngineList(board, freshState(board), l);
    for (const m of eventMessages(list)) {
        if (m > upTo) break;
        const entry = id => arr(arr(list).find(t => t.id === id)?.journal).find(x => x.i === m) || null;
        const meta = id => { const e = entry(id); return e ? { who: e.who, why: e.why, quote: e.quote, reason: e.reason, confidence: e.confidence } : {}; };
        // `rebuilt`: made from the old history (step 6); the time is the move's own where the journal kept it
        added.push(...stepEntries(board, places(listAt(list, m - 1)), places(listAt(list, m)), m, meta).map(e => ({ ...e, at: entry(e.col)?.at || e.at, rebuilt: true })));
    }
    const next = structuredClone(st);
    next.log = [...added, ...arr(next.log)];
    capLog(next);
    next.v2steps = true;
    next.v2since = 0;
    return { state: next, added };
}
