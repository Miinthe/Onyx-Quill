/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — storyboard conditions (roadmap §4 G+, "gates").
 * Pure rules; tested in test/conditions.test.mjs.
 *
 * Two kinds, both "X reaches Y" (that step or any later one):
 *   - starts: a tracker WAITS until all its start conditions hold, then starts —
 *     "The Broken Fuse starts when Relationship reaches Sweethearts".
 *   - needs:  one of a tracker's steps can only be reached once a condition holds —
 *     "Repair is only possible once Relationship reaches Married".
 *
 * A WAITING tracker is completely quiet: the helper does not watch it, the writer
 * and the judge are not told about it, and its step-linked entries are hidden.
 * Once started it keeps running (onFall 'keep', the default) or pauses while a start
 * condition no longer holds (onFall 'pause') — paused counts as quiet too.
 *
 * On the definition (the board):  starts: [{ tracker, step, color }]
 *                                  needs:  [{ step, tracker, reach, color }]
 *                                  onFall: 'keep' | 'pause'
 * On the place (the chat):         started: true, startedAt: { i, at, why }
 * `tracker` is the other tracker's id (its name works too); steps are matched by
 * name, case-insensitively.
 */

import { branchHolds, branchText } from './forks-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): lines waiting for a fork branch

const low = s => String(s ?? '').trim().toLowerCase();

// LOCAL PATCH (Miinthe, 2026-10-05): lines waiting for a collection, counter, place or state
// ({ ext: <v2 condition> }) are answered by the board (board-live.js) — set from outside so
// these rules stay pure. Unset (tests, no board): such a line never holds. The engine's list being
// evaluated is passed along, so the board sees positions from this very save (2026-10-04).
let extHolds = () => false;
let extText = () => '(a condition on the board)';
export function setExternalConditions(holdsFn, textFn) { extHolds = holdsFn; extText = textFn; }

export function findTracker(list, ref) {
    const k = low(ref);
    return list.find(t => t.id && low(t.id) === k) || list.find(t => low(t.name) === k) || null;
}

const stepIndex = (t, name) => t.steps.findIndex(s => low(s) === low(name));

export const hasStarts = t => Array.isArray(t?.starts) && t.starts.length > 0;
/** Paused or abandoned by Miinthe in this chat (the Story tab, the board window) — LOCAL PATCH 2026-10-04. */
export const heldOff = t => t?.run === 'paused' || t?.run === 'abandoned';

/** Has tracker `c.tracker` (started, not waiting) reached step `stepName` or later? */
function reached(list, ref, stepName) {
    const src = findTracker(list, ref);
    if (!src) return false;
    if (hasStarts(src) && !src.started) return false;          // a waiting tracker has reached nothing
    if (src.run === 'abandoned') return false;                 // nor has an abandoned one (lines on it wait again)
    const k = stepIndex(src, stepName);
    return k >= 0 && Math.min(Math.max(src.index, 0), src.steps.length - 1) >= k;
}

export function startHolds(c, list) { return c?.ext ? extHolds(c.ext, list) : c?.branch ? branchHolds(c, list) : reached(list, c.tracker, c.step); }

export function allStartsHold(t, list) {
    return (t.starts || []).every(c => startHolds(c, list));
}

/** Running (not waiting, not paused)? */
export function isActive(t, list) {
    if (typeof t?.active === 'boolean') return t.active;   // engine on v2, step 7c: the board's verdict (trackers.js verdictOf)
    if (heldOff(t)) return false;
    if (!hasStarts(t)) return true;
    if (!t.started) return false;
    return t.onFall === 'pause' ? allStartsHold(t, list) : true;
}

/** Waiting / paused / running — for the Story tab and the board. */
export function stateOf(t, list) {
    if (t?.state) return t.state;   // engine on v2, step 7c: the board's verdict
    if (t?.run === 'abandoned') return 'abandoned';
    if (t?.run === 'paused') return 'paused';
    if (!hasStarts(t)) return 'running';
    if (!t.started) return 'waiting';
    return isActive(t, list) ? 'running' : 'paused';
}

/** "Relationship reaches Sweethearts" */
export function conditionText(c, list) {
    if (c?.ext) return extText(c.ext);
    if (c?.branch) return branchText(c, list);
    const src = findTracker(list, c.tracker);
    return `${src ? src.name : c.tracker} reaches ${c.step ?? c.reach}`;
}


/** After a delete/rewind to `messageIndex`: a start that happened later is undone. */
export function unstartAfter(t, messageIndex) {
    if (!t.started || !t.startedAt || t.startedAt.i <= messageIndex) return t;
    const { startedAt: _startedAt, ...rest } = t;
    return { ...rest, started: false };
}

/** The `needs` of tracker `t` that block reaching step `toIndex` right now. */
export function unmetNeeds(t, toIndex, list) {
    if (t?.unmet) return t.unmet[toIndex] || [];   // engine on v2, step 7c: needs and step blocks, by the board ({ text })
    const step = t.steps[toIndex];
    return (t.needs || []).filter(n => low(n.step) === low(step) && !(n.ext ? extHolds(n.ext, list) : n.branch ? branchHolds(n, list) : reached(list, n.tracker, n.reach)));
}

/** Only the running trackers — what the helper, the writer and the judge get. */
export function activeOnly(list) {
    return list.filter(t => isActive(t, list));
}
