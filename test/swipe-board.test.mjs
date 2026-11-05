/**
 * LOCAL PATCH suite — each swipe keeps its own board (Miinthe, 2026-11-04: "since it's a swipe each swipe should keep the
 * info … the changes should show in the changes and be live when zapping through the swipes").
 * Failures to avoid: flipping back shows another swipe's board; Re-evaluate's fresh board stored over the old swipe's;
 * a new swipe losing the board it came from; a deleted swipe leaving the boards one off.
 * Run: npm run test:swipe-board
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { SWIPE_BOARD_KEY, storeFor, onSwipe, keepShown, onSwipeDeleted } from '../src/swipe-board-pure.js';

const A = { s: { at: 'Kitchen' } }, Bb = { s: { at: 'Cellar' } }, Cc = { s: { at: 'Garden' } };

test('the store belongs to one reply — another reply starts fresh', () => {
    assertEqual(SWIPE_BOARD_KEY, 'onyxquill_swipe_board');
    const s = storeFor({ v: 1, at: 7, shown: 1, byId: { 0: A } }, 7);
    assertEqual([s.at, s.shown, Object.keys(s.byId)], [7, 1, ['0']]);
    assertEqual(storeFor({ v: 1, at: 7, shown: 1, byId: { 0: A } }, 9, 0), { v: 1, at: 9, shown: 0, byId: {} }, 'a new reply: fresh, on screen is what she sees');
    assertEqual(storeFor(null, 3, 2).shown, 2);
});

test('a new swipe keeps the board it came from; flipping back brings each board back', () => {
    let s = storeFor(null, 5, 0);
    let r = onSwipe(s, 1, A);                          // swipe 0 (board A) → a brand-new swipe 1
    assertEqual([r.restore, r.store.byId[0], r.store.shown], [null, A, 1], 'new swipe: nothing to restore, swipe 0 keeps A');
    r = onSwipe(r.store, 0, Bb);                       // swipe 1 now has board B → back to 0
    assertEqual([r.restore, r.store.byId[1]], [A, Bb], 'back to 0: A comes back, swipe 1 keeps B');
    r = onSwipe(r.store, 1, A);
    assertEqual(r.restore, Bb, 'and forward again: B');
    assertEqual(onSwipe(r.store, 1, Cc).restore, null, 'the same swipe again: nothing changes');
});

test('Re-evaluate: the shown swipe keeps its board, the new swipe keeps the fresh evaluation', () => {
    let s = keepShown(storeFor(null, 5, 0), 0, A);     // before the rewind
    assertEqual([s.byId[0], s.shown], [A, 0]);
    let r = onSwipe(s, 1, Cc, { skipSave: true });     // the fresh evaluation (C) is now on the board
    assertEqual([r.store.byId[0], r.restore, r.store.byId[1]], [A, null, undefined], 'A stays with swipe 0 — not overwritten by C');
    r = onSwipe(r.store, 0, Cc);                       // flip back
    assertEqual([r.restore, r.store.byId[1]], [A, Cc], 'back to 0 gives A; swipe 1 keeps C');
});

test('a deleted swipe: its board goes, the later ones move down, the one on screen comes back', () => {
    const s = { v: 1, at: 5, shown: 1, byId: { 0: A, 1: Bb, 2: Cc } };
    const r = onSwipeDeleted(s, 1, 1);                 // swipe 1 deleted, swipe 2 is now number 1
    assertEqual([r.store.byId[0], r.store.byId[1], r.store.byId[2], r.restore], [A, Cc, undefined, Cc]);
    assertEqual(onSwipeDeleted({ v: 1, at: 5, shown: 0, byId: { 1: Bb } }, 0, 0).restore, Bb, 'deleting the first: the next one shows with its board');
});

summary('swipe-board');
