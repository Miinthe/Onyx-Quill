/**
 * LOCAL PATCH suite — pause / continue / abandon / reactivate and the board switched off (2026-10-04).
 * Failures to avoid: a paused tracker still watched or told; an abandoned one keeping its step or
 * its branches; a tracker waiting on an abandoned one starting anyway; a delete that leaves a
 * tracker abandoned at an old step (or un-abandons it at the wrong one); the pause lost on a
 * window save or on the way through the v2 state; Undo not putting it back exactly.
 * Run: npm run test:run
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { moveTo } from '../src/trackers-pure.js';
import { isActive, stateOf, activeOnly } from '../src/conditions-pure.js';
import { normalizeBoard, freshState, toEngineList, fromEngineList, setRun, isActive as v2Active } from '../src/board-model-pure.js';
import { journalWindowMoves } from '../src/board-window-pure.js';

const rel = () => ({ id: 'rel', name: 'Relationship', steps: ['Strangers', 'Friends', 'Married'], index: 1, aside: 'Nuisance', took: { Friends: 'Confesses' }, journal: [{ i: 0, index: 0, aside: null }, { i: 5, index: 1, aside: 'Nuisance' }] });
const fuse = () => ({ id: 'fuse', name: 'The Broken Fuse', steps: ['Calm', 'Sparks'], index: 0, aside: null, journal: [{ i: 0, index: 0, aside: null }], starts: [{ tracker: 'rel', step: 'Friends' }] });






const board = () => normalizeBoard({ v: 2, name: 'B', trackers: [
    { id: 'rel', name: 'Relationship', steps: [{ id: 's', name: 'Strangers' }, { id: 'f', name: 'Friends' }] },
    { id: 'clues', kind: 'collection', name: 'Clues', states: [{ id: 'h', label: 'hidden' }, { id: 'u', label: 'uncovered' }], items: [{ id: 'cord', name: 'Cord' }] },
] });

test('the pause travels: engine list ⇄ v2 state; a window save journals it', () => {
    const b = board();
    const st = setRun(b, freshState(b), b.trackers[0], 'paused');
    const list = toEngineList(b, st);
    assertEqual(list[0].run, 'paused');
    assertEqual(fromEngineList(b, freshState(b), list).trackers.rel.run, 'paused');
    assertEqual(fromEngineList(b, st, [{ ...list[0], run: undefined }]).trackers.rel.run, undefined, 'continued on the engine → gone in v2 too');
    assertEqual(v2Active(b, st, b.trackers[0]), false);
    const prev = toEngineList(b, freshState(b));
    const j = journalWindowMoves(list.map(t => ({ ...t, journal: [{ i: 0, index: 0 }] })), prev, 7);
    assertEqual(j[0].journal.at(-1), { i: 7, index: 0, aside: null, who: 'hand', at: j[0].journal.at(-1).at, run: 'paused' });
});

test('a collection abandoned: its items reset, it is quiet; reactivate switches it on', () => {
    const b = board();
    let st = freshState(b);
    st.collections.clues.items.cord = { state: 'u' };
    st = setRun(b, st, b.trackers[1], 'abandoned');
    assertEqual([st.collections.clues.items, st.runs.clues, v2Active(b, st, b.trackers[1])], [{}, 'abandoned', false]);
    assertEqual(v2Active(b, setRun(b, st, b.trackers[1], null), b.trackers[1]), true);
});

summary('run');
