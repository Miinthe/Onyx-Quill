/**
 * LOCAL PATCH suite — storyboard conditions (2026-10-03): "starts when" and
 * "only possible once". Failures to avoid: a waiting tracker leaking into the
 * prompt, starting too early, or a step reached that should be locked.
 * Run: npm run test:conditions
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { isActive, stateOf, unmetNeeds, activeOnly, unstartAfter, conditionText } from '../src/conditions-pure.js';
import { newTracker, moveTo, filterByStoryStep } from '../src/trackers-pure.js';
import { validateChanges } from '../src/autotrack-pure.js';
import { makeBoard, mergeBoard } from '../src/storyboard-pure.js';
import { normalizeBoard, freshState } from '../src/board-model-pure.js';
import { stepTurn } from '../src/turn-pure.js';

const rel = (i = 0) => ({ ...moveTo(newTracker('Relationship', ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married']), i, 1), id: 'rel' });
const fuse = (extra = {}) => ({ ...newTracker('The Broken Fuse', ['Calm', 'Sparks', 'Repair']), id: 'fuse', starts: [{ tracker: 'rel', step: 'Sweethearts' }], ...extra });
const secret = () => ({ ...newTracker("Kettle's Secret", ['Hidden', 'Suspected', 'Revealed']), id: 'secret', starts: [{ tracker: 'fuse', step: 'Sparks' }, { tracker: 'rel', step: 'Friends' }] });

// engine on v2, step 7: starting is the v2 turn's (turn-pure.js stepTurn) — the same board, by ids
const B = normalizeBoard({ v: 2, name: 'C', trackers: [
    { id: 'rel', name: 'Relationship', steps: [{ id: 'r0', name: 'Strangers' }, { id: 'r1', name: 'Neighbours' }, { id: 'r2', name: 'Friends' }, { id: 'r3', name: 'Sweethearts' }, { id: 'r4', name: 'Married' }] },
    { id: 'fuse', name: 'The Broken Fuse', starts: [{ tracker: 'rel', step: 'r3' }], steps: [{ id: 'f0', name: 'Calm' }, { id: 'f1', name: 'Sparks' }, { id: 'f2', name: 'Repair' }] },
    { id: 'secret', name: "Kettle's Secret", starts: [{ tracker: 'fuse', step: 'f1' }, { tracker: 'rel', step: 'r2' }], steps: [{ id: 'k0', name: 'Hidden' }, { id: 'k1', name: 'Suspected' }, { id: 'k2', name: 'Revealed' }] },
] }, 'C');
const state = (relAt, fuseP = {}) => { const s = freshState(B); s.trackers.rel.at = `r${relAt}`; Object.assign(s.trackers.fuse, fuseP); return s; };
const starts = (st, i) => stepTurn(B, st, i).events.filter(e => e.kind === 'start');

test('a tracker waits until its condition holds, then starts (once)', () => {
    const list = [rel(2), fuse()];
    assertEqual(stateOf(list[1], list), 'waiting', 'waiting at Friends');
    assertEqual(starts(state(2), 5).length, 0, 'not yet');
    const r = stepTurn(B, state(3), 7), s = r.events.filter(e => e.kind === 'start');
    assertEqual(s.length, 1, 'started at Sweethearts');
    assertEqual(r.state.trackers.fuse.startedAt.i, 7, 'remembers when');
    assertEqual(s[0].why, 'Relationship reaches Sweethearts', 'says why');
    assertEqual(starts(r.state, 8).length, 0, 'only once');
});

test('"reaches" means that step or later; a waiting tracker has reached nothing', () => {
    assertEqual(starts(state(4), 1).map(e => e.name), ['The Broken Fuse'], 'Married counts as reaching Sweethearts');
    // secret needs the fuse at Sparks — but the fuse is still waiting (Friends), even with Sparks as its step-to-be
    assertEqual(starts(state(2, { waitAt: 'f1' }), 3).length, 0, 'nothing starts off a waiting tracker');
});

test('chains resolve in one go; all conditions must hold', () => {
    assertEqual(starts(state(3, { waitAt: 'f1' }), 4).map(e => e.name).join(','), "The Broken Fuse,Kettle's Secret", 'fuse then secret');
    assertEqual(starts(state(1, { at: 'f1', started: true }), 4).length, 0, 'secret also needs Friends');
});

test('keep running vs pause when the condition stops holding', () => {
    const started = { ...fuse(), started: true };
    assert(isActive(started, [rel(1), started]), 'keep: still running after a fall back');
    const pausing = { ...started, onFall: 'pause' };
    assertEqual(stateOf(pausing, [rel(1), pausing]), 'paused', 'pause: paused');
    assertEqual(stateOf(pausing, [rel(4), pausing]), 'running', 'pause: running again');
});

test('quiet trackers stay out of the helper, the writer and the lore', () => {
    const list = [rel(2), fuse()];
    assertEqual(activeOnly(list).map(t => t.name).join(), 'Relationship', 'only running ones');
    const entries = [{ title: 'Fuse 1', storyStep: { tracker: 'The Broken Fuse', steps: ['Calm'] } }, { title: 'Rung 3', storyStep: { tracker: 'Relationship', steps: ['Friends'] } }];
    const active = new Set(activeOnly(list).map(t => t.name));
    assertEqual(filterByStoryStep(entries, list, () => false, t => active.has(t.name)).map(e => e.title).join(), 'Rung 3', 'waiting tracker\'s lore hidden');
});

test('only possible once: a locked step is refused for the helper, reported', () => {
    const f = { ...fuse(), started: true, index: 1, needs: [{ step: 'Repair', tracker: 'rel', reach: 'Married' }] };
    const list = [rel(3), f];
    assertEqual(unmetNeeds(f, 2, list).length, 1, 'locked at Sweethearts');
    assertEqual(unmetNeeds(f, 2, [rel(4), f]).length, 0, 'open once Married');
    const msgs = [{ mes: 'The toaster finally repairs the fuse with a strip of tape.' }];
    const r = validateChanges([{ tracker: 'The Broken Fuse', step: 'Repair', quote: 'finally repairs the fuse with a strip of tape' }], [f], msgs, (t, k) => unmetNeeds(t, k, list));
    assertEqual(r.moves.length, 0, 'not moved');
    assertEqual(r.rejected[0].reason, 'needs', 'reason');
    assertEqual(conditionText({ tracker: 'rel', step: 'Married' }, list), 'Relationship reaches Married', 'readable');
});

test('rewind: a start after the cut is undone', () => {
    const t = { ...fuse(), started: true, startedAt: { i: 9 } };
    assertEqual(unstartAfter(t, 5).started, false, 'undone');
    assertEqual(unstartAfter(t, 12).started, true, 'kept');
});

test('board carries conditions; the chat keeps whether it started', () => {
    const place = [rel(3), { ...fuse(), started: true }];
    const b = makeBoard('B', place);
    assertEqual(b.trackers[1].starts[0].step, 'Sweethearts', 'on the board');
    assert(!('started' in b.trackers[1]), 'started is the chat\'s');
    b.trackers[1].starts = [{ tracker: 'rel', step: 'Married' }];
    const { list } = mergeBoard(b, place, newTracker);
    assertEqual(list[1].starts[0].step, 'Married', 'board wins');
    assert(list[1].started, 'already started stays started');
});

await summary();
