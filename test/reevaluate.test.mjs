/**
 * LOCAL PATCH suite — Re-evaluate + swipe (2026-10-04, triggers + odds part 3).
 * Failures to avoid: re-evaluating the wrong turn (undoing older changes, or keeping this turn's);
 * the helper re-reading the reply being replaced; an Undo left pointing at a move that is gone.
 * Run: npm run test:reevaluate
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { turnOf, turnChanges, forgetTurnUndo } from '../src/reevaluate-pure.js';

const u = mes => ({ is_user: true, mes }), a = mes => ({ is_user: false, mes }), sys = mes => ({ is_system: true, mes });

test('the turn of the newest reply: Miinthe\'s message before it; changes at it or later are undone', () => {
    const chat = [a('greeting'), u('hi'), a('hello'), u('we go to the pantry'), a('dusty shelves…')];
    assertEqual(turnOf(chat), { reply: 4, start: 3, keep: 2, at: 3 });
});

test('several messages of Miinthe\'s (and a system note) in one turn: the turn starts after the previous reply', () => {
    const chat = [a('greeting'), u('one'), a('r1'), u('two'), sys('note'), u('three'), a('r2')];
    assertEqual(turnOf(chat), { reply: 6, start: 3, keep: 2, at: 5 });
});

test('nothing to re-evaluate: no reply at the end, only a greeting, two replies in a row, an empty chat', () => {
    assertEqual(turnOf([a('greeting'), u('hi')]), null);
    assertEqual(turnOf([a('greeting')]), null);
    assertEqual(turnOf([a('greeting'), u('hi'), a('r1'), a('r2')]), null);
    assertEqual(turnOf([]), null);
    assertEqual(turnOf(null), null);
});

test('a first reply after the greeting can be re-evaluated', () => {
    assertEqual(turnOf([a('greeting'), u('hi'), a('r1')]), { reply: 2, start: 1, keep: 0, at: 1 });
});

test('what would be undone: moves and starts of this turn, board changes by kind — nothing older', () => {
    const trackers = [
        { name: 'Relationship', journal: [{ i: 0, index: 0 }, { i: 2, index: 1 }, { i: 3, index: 2 }] },
        { name: 'The Broken Fuse', journal: [{ i: 0, index: 0 }], startedAt: { i: 3 } },
        { name: 'Quiet', journal: [{ i: 1, index: 1 }] },
    ];
    const log = [{ i: 2, kind: 'item' }, { i: 3, kind: 'place' }, { i: 3, kind: 'roll' }, { i: 3, kind: 'roll' }, { i: 3, kind: 'trigger' }, { i: 3, kind: 'state' }];
    const r = turnChanges(trackers, log, 3);
    assertEqual(r.lines, ['Relationship: a move', 'The Broken Fuse: started', '1 place change', '2 rolls', '1 trigger fired', '1 time / weather change']);
    assertEqual(turnChanges(trackers, log, 9).count, 0, 'a later start: nothing');
});

test('Undo memory of this turn is forgotten; an older one is kept', () => {
    const t = { name: 'R', lastAuto: { message: 3 }, lastTrigger: { message: 1 } };
    const f = forgetTurnUndo(t, 3);
    assert(!('lastAuto' in f), 'this turn\'s automatic move: forgotten');
    assertEqual(f.lastTrigger, { message: 1 }, 'an older trigger: kept');
    assertEqual(forgetTurnUndo({ name: 'S' }, 3), { name: 'S' });
});

summary('reevaluate');
