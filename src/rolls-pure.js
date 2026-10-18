/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — triggers + odds in play (storyboard stage 3).
 * Pure rules on the v2 board and chat state; tested in test/rolls.test.mjs.
 * Design: `6 merge roadmap.md` §4 G2 (decided with Miinthe, 2026-10-04).
 *
 * ODDS ("1 in 3") count only on two kinds of line:
 *  - "starts when"  — The Broken Fuse starts when Relationship reaches Friends, 1 in 3;
 *  - triggers       — when the Fuse ends in Fail, Relationship moves to Strangers.
 * Never on needs / blocks / only one at a time: whether a step is reached is the judge's
 * business, and dice don't overrule a judge (those lines hold as if certain — `certain`).
 *
 * A ROLL happens once, the first time the line's condition holds, and belongs to that message:
 * deleting the message undoes it (logged in state.log like every other change). A swipe keeps it.
 * A failed roll is closed for good, or rolls again after N messages (retry: 5 / 10), or rolls
 * again on each new visit (retry: 'visit' — the condition stops holding and holds again later).
 *
 * A TRIGGER fires once per chat when its line holds (dice included) and its tracker runs —
 * waiting or paused, it waits. It moves the tracker even backwards and even against "forward
 * only" (a deliberate move the author put on the board) and ignores the target step's needs
 * (proposal, as the mock-up does). Undo of its move means "don't fire this again" (`denied`).
 * The writer hears about it for one reply: JUST HAPPENED.
 *
 * A TRIGGER ON AN ITEM ("there to be found" — Miinthe's pantry glue, part 2): while its line holds
 * (dice included), the item is there to be found — the writer is told `TO FIND HERE: Glue` and
 * the helper may move it (with a quote, like any item) — but only then: an item with such lines
 * can't be taken while none holds. The dice decide what exists; the story decides what happens.
 * A good roll stays good (the glue is there on every visit until taken).
 *
 * State (chat_metadata.deeplore_board_state):
 *   rolls:  { [lineKey]: { ok, face, odds, i, retry?, away? } }
 *   fired:  { [lineKey]: { i, from, to } }        denied: [lineKey]
 */
import { holds, certain, lineKey, trackerOf, stepOf, condBase, isActive, isWaiting, runOf, itemState, capLog } from './board-model-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const clone = o => JSON.parse(JSON.stringify(o));
const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The key of a find line (item + condition). */
export const findKey = (col, it, c) => lineKey('find', `${col.id}/${it.id}`, c);

/** Every line that can roll: starts with odds (steps trackers), triggers and finds with odds. */
export function oddsLines(board) {
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind === 'collection') for (const it of t.items) for (const c of arr(it.finds)) if (c.odds > 1) out.push({ kind: 'find', t, it, c, key: findKey(t, it, c) });
        if (t.kind !== 'steps') continue;
        for (const c of t.starts) if (c.odds > 1) out.push({ kind: 'start', t, c, key: lineKey('start', t.id, c) });
        for (const c of arr(t.triggers)) if (c.odds > 1) out.push({ kind: 'trigger', t, c, key: lineKey('trigger', t.id, c) });
    }
    return out;
}

/** Does a start / trigger line hold now — its condition, and its roll if it has odds? */
export function lineHolds(board, st, c, key) {
    if (!holds(board, st, certain(c))) return false;
    if (!(c.odds > 1)) return true;
    return st?.rolls?.[key]?.ok === true;
}

const fired = (st, key) => !!st?.fired?.[key];
/** Does a line with odds still matter? A start: its tracker waits. A trigger: not fired, not stopped, its tracker runs. A find: the item not taken yet. */
export function defaultLive(board, L, s) {
    if (L.kind === 'start') return isWaiting(board, s, L.t);
    if (L.kind === 'find') return runOf(s, L.t) == null && itemState(s, L.t, L.it.id) === L.t.states[0].id;
    return !fired(s, L.key) && !denied(s, L.key) && isActive(board, s, L.t);
}
const denied = (st, key) => arr(st?.denied).includes(key);

/**
 * Roll every line with odds whose condition now holds and that hasn't been rolled (or may roll again).
 * `live(line, st)` says whether the line still matters: a start whose tracker is still waiting,
 * a trigger not fired yet whose tracker runs. Returns { state, rolled: [{ kind, t, c, key, face, ok }], changed }.
 */
export function rollTurn(board, st, i, { rand = Math.random, live = null, at = new Date().toISOString() } = {}) {
    const next = clone(st);
    next.rolls ||= {};
    next.log = arr(next.log);
    const isLive = live || ((L, s) => defaultLive(board, L, s));
    const rolled = [];
    let changed = false;
    for (const L of oddsLines(board)) {
        if (!isLive(L, next)) continue;
        const r = next.rolls[L.key];
        if (!holds(board, next, certain(L.c))) {
            // "each new visit": once the condition stops holding, the next time it holds rolls again
            if (r && !r.ok && r.retry === 'visit' && !r.away) { next.rolls[L.key] = { ...r, away: true }; changed = true; }
            continue;
        }
        if (r) {
            if (r.ok) continue;
            const again = r.retry === 'visit' ? !!r.away : r.retry > 0 ? i - r.i >= r.retry : false;
            if (!again) continue;
        }
        const face = 1 + Math.floor(rand() * L.c.odds), ok = face === 1;
        const to = { ok, face, odds: L.c.odds, i: Math.floor(i || 0), ...(L.c.retry ? { retry: L.c.retry } : {}) };
        next.rolls[L.key] = to;
        next.log.push({ id: newId('r'), i: Math.floor(i || 0), key: `roll:${L.key}`, kind: 'roll', col: L.t.id, line: L.key, from: r || null, to, who: 'roll', at });
        rolled.push({ ...L, face, ok });
        changed = true;
    }
    capLog(next);
    return { state: next, rolled, changed };
}

/**
 * Fire every trigger whose line holds (rolled already, if it has odds), once, while its tracker runs.
 * `isOn(t, st)` — does tracker t run (defaults to the board's own rule). Returns
 * { state, fired: [{ key, t, c, from, to, moved, why, logId }] } — the caller moves the engine's tracker.
 */
export function fireTriggers(board, st, i, { isOn = null, at = new Date().toISOString() } = {}) {
    const next = clone(st);
    next.fired ||= {};
    next.log = arr(next.log);
    const on = isOn || ((t, s) => isActive(board, s, t));
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        for (const c of arr(t.triggers)) {
            const key = lineKey('trigger', t.id, c);
            if (fired(next, key) || denied(next, key) || !stepOf(t, c.to)) continue;
            if (runOf(next, t) === 'abandoned' || !on(t, next)) continue;    // waiting / paused: the trigger waits
            if (!lineHolds(board, next, c, key)) continue;
            const from = next.trackers[t.id]?.at ?? null, moved = from !== c.to;
            const why = condBase(board, c);
            next.fired[key] = { i: Math.floor(i || 0), from, to: c.to };
            if (moved) { next.trackers[t.id] = { ...(next.trackers[t.id] || {}), at: c.to }; delete next.trackers[t.id].aside; }
            const logId = newId('g');
            next.log.push({ id: logId, i: Math.floor(i || 0), key: `trigger:${key}`, kind: 'trigger', col: t.id, line: key, from, to: c.to, moved, why, who: 'trigger', at });
            out.push({ key, t, c, from, to: c.to, moved, why, logId });
        }
    }
    capLog(next);
    return { state: next, fired: out };
}

/** Undo of a trigger's move: it is forgotten from the log and never fires again in this chat. */
export function denyTrigger(st, logId) {
    const e = arr(st?.log).find(x => x.id === logId && x.kind === 'trigger');
    if (!e) return { state: st, error: 'already undone or rolled back' };
    const next = clone(st);
    next.log = next.log.filter(x => x.id !== logId);
    next.denied = [...arr(next.denied).filter(k => k !== e.line), e.line].slice(-100);
    if (e.moved && next.trackers?.[e.col]) next.trackers[e.col].at = e.from;
    return { state: next, entry: e };
}

// ── what people are told ────────────────────────────────────────────────────

const retryText = r => (r === 'visit' ? 'it rolls again on the next visit' : r > 0 ? `it rolls again in ${r} messages` : 'closed for good');

/** Director's notice for a roll: "🎲 The Broken Fuse starts when … — rolled 1 of 3: it happens". */
export function describeRoll(board, r) {
    const head = r.kind === 'find' ? `${r.it.name} is there to be found when ${condBase(board, r.c)}`
        : r.kind === 'start' ? `${r.t.name} starts when ${condBase(board, r.c)}`
        : `When ${condBase(board, r.c)}, ${r.t.name} moves to ${stepOf(r.t, r.c.to)?.name ?? '?'}`;
    return `🎲 ${head} — rolled ${r.face} of ${r.c.odds}: ${r.ok ? 'it happens' : `not this time, ${retryText(r.c.retry)}`}`;
}

/** "⚡ Relationship moved to Strangers — because The Broken Fuse ends in Fail" */
export function describeTrigger(board, f) {
    return `⚡ ${f.t.name} moved to ${stepOf(f.t, f.to)?.name ?? '?'} — because ${f.why}`;
}

/**
 * The writer's line for the one reply after a trigger fired: triggers fired at message `since`
 * or later (the caller passes the index of the last AI reply before the one being written —
 * so a swipe of that reply still hears it, and the reply after does not).
 */
export function justHappenedLines(board, st, since) {
    return arr(st?.log).filter(e => e.kind === 'trigger' && e.moved && e.i >= since).map(e => {
        const t = trackerOf(board, e.col);
        return `JUST HAPPENED: ${t?.name ?? '?'} moved to ${stepOf(t, e.to)?.name ?? '?'} (because ${e.why})`;
    });
}

/** Does this board have anything for the board's turn to do (lines with odds, triggers)? */
export const hasRollsOrTriggers = board => arr(board?.trackers).some(t => (t.kind === 'steps' && (arr(t.triggers).length || t.starts.some(c => c.odds > 1)))
    || (t.kind === 'collection' && t.items.some(it => arr(it.finds).some(c => c.odds > 1))));

// ── items to find ───────────────────────────────────────────────────────────

/** The find lines of an item that hold right now (empty: not there to be found). Only while it is still in its first state. */
export function findingNow(board, st, col, it) {
    if (!arr(it?.finds).length || runOf(st, col) != null || itemState(st, col, it.id) !== col.states[0].id) return [];
    return it.finds.filter(c => lineHolds(board, st, c, findKey(col, it, c)));
}
/** Has the item lines that offer it — so it can only be taken while one holds? */
export const isFindItem = it => arr(it?.finds).length > 0;

/** Every item there to be found right now: [{ col, it, here }] — `here` when one of its holding lines is a place. */
export function findables(board, st) {
    const out = [];
    for (const col of arr(board?.trackers)) {
        if (col.kind !== 'collection') continue;
        for (const it of col.items) { const h = findingNow(board, st, col, it); if (h.length) out.push({ col, it, here: h.some(c => c.place) }); }
    }
    return out;
}

/** The writer's and judge's lines: "TO FIND HERE: Glue" (a place) · "TO FIND: Tape" (anything else). */
export function toFindLines(board, st) {
    const f = findables(board, st), out = [];
    const here = f.filter(x => x.here).map(x => x.it.name), other = f.filter(x => !x.here).map(x => x.it.name);
    if (here.length) out.push(`TO FIND HERE: ${here.join(', ')}`);
    if (other.length) out.push(`TO FIND: ${other.join(', ')}`);
    return out;
}
