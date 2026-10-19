/**
 * Regenerate keeps hand and world changes (src/regen-pure.js + the rewinds that take `keep`, 2026-10-19).
 * The bug (Miinthe): a hand move (Strangers → Neighbors) and her messages with the Cast vanished on Regenerate, because its
 * delete undid everything logged at the reply. Failures to avoid: a regenerate undoing a hand move or a world change; a
 * real delete keeping them; the helper's reading of the old reply surviving a regenerate.
 * Run: npm run test:regen
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { keptOnRegen, isRegenDelete, REGEN_WINDOW_MS } from '../src/regen-pure.js';
import { pruneAfter } from '../src/trackers-pure.js';
import { rewindCollections } from '../src/collections-pure.js';

test('what a regenerate keeps', () => {
    assertEqual(['hand', 'you', 'world', 'auto', 'director', 'engine', undefined].map(w => keptOnRegen({ who: w })), [true, true, true, false, false, false, false]);
    assertEqual(isRegenDelete(1000, 1000 + REGEN_WINDOW_MS - 1), true);
    assertEqual(isRegenDelete(1000, 1000 + REGEN_WINDOW_MS + 1), false);
    assertEqual(isRegenDelete(0, 5), false);
});

test('the step journal: a regenerate keeps the hand move, a real delete undoes it', () => {
    const j = [{ i: 40, index: 0 }, { i: 44, index: 1, who: 'hand' }, { i: 44, index: 2, who: 'auto' }];
    assertEqual(pruneAfter(j, 43, keptOnRegen).map(e => e.index), [0, 1]);
    assertEqual(pruneAfter(j, 43).map(e => e.index), [0]);
});

test('the board log: a regenerate keeps hand and world changes, the helper\'s go', () => {
    const board = { trackers: [{ id: 'c1', kind: 'cast', people: [{ id: 'k', name: 'Kettle' }] }] };
    const st = { cast: { c1: { k: { knows: [{ id: 'a', fact: 'from a message' }, { id: 'b', fact: 'from the reply' }] } } }, log: [
        { id: 'l1', i: 44, kind: 'cast', col: 'c1', person: 'k', field: 'knows', add: { id: 'a' }, who: 'world' },
        { id: 'l2', i: 44, kind: 'cast', col: 'c1', person: 'k', field: 'knows', add: { id: 'b' }, who: 'auto' },
    ] };
    const regen = rewindCollections(board, st, 43, keptOnRegen);
    assertEqual(regen.state.cast.c1.k.knows.map(k => k.id), ['a']);
    assertEqual(regen.state.log.map(e => e.id), ['l1']);
    const del = rewindCollections(board, st, 43);
    assertEqual(del.state.cast.c1.k.knows, undefined);
    assertEqual(del.state.log.length, 0);
});

summary();
