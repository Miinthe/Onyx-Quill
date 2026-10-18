/**
 * LOCAL PATCH suite — the board window ⇄ stored board translator (2026-10-05, stage 2).
 * Failures to avoid: a line that points at the wrong step after a save (positions vs ids),
 * a step that loses its id (and with it every line and every chat's place) on a round trip,
 * a new step from the window without an id, a chat's fork choice / items / purse lost.
 * Run: npm run test:board-window
 */
import { listAt } from '../src/convert-pure.js';
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, holds, toEngineList } from '../src/board-model-pure.js';
import { toWindowBoard, fromWindowBoard, toWindowChat, fromWindowChat, toV1Board, v1Sig, reconcile, withVaultLinks, journalWindowMoves } from '../src/board-window-pure.js';

const board = () => normalizeBoard({
    v: 2, name: 'Toaster & Kettle', folders: ['Plot/'],
    trackers: [
        { id: 'rel', name: 'Relationship', icon: '💞', color: '#d0145e', steps: [
            { id: 'strangers', name: 'Strangers', entries: ['Rung 1 · Strangers'], oneWay: true },
            { id: 'neighbours', name: 'Neighbours', detours: [{ id: 'broken', name: 'broken up', entries: ['Breakup · Still next door'] }] },
            { id: 'friends', name: 'Friends', fork: { branches: [{ id: 'conf', name: 'Confesses' }, { id: 'chick', name: 'Chickens out', then: { kind: 'back', step: 'neighbours' } }] } },
            { id: 'sweet', name: 'Sweethearts', fallTo: { step: 'neighbours', detour: 'broken' } },
            { id: 'married', name: 'Married', needs: [{ world: 'world', due: 'party', color: 2 }] },
        ], triggers: [{ collection: 'stash', item: 'ring', to: 'married' }] },
        { id: 'fuse', name: 'The Broken Fuse', direction: 'forward', starts: [{ tracker: 'rel', step: 'sweet', odds: 3 }], steps: [
            { id: 'calm', name: 'Calm' }, { id: 'sparks', name: 'Sparks' },
            { id: 'repair', name: 'Repair', needs: [{ tracker: 'rel', step: 'married' }, { collection: 'stash', item: 'tape', amount: 1 }],
                fork: { by: 'roll', branches: [{ id: 'success', name: 'Success' }, { id: 'fail', name: 'Fail', weight: 2 }] } },
        ] },
        { id: 'secret', name: "Kettle's Secret", starts: [{ tracker: 'fuse', at: 'repair', branch: 'fail' }], blocks: [{ tracker: 'rel', running: true }], steps: [{ id: 'hidden', name: 'Hidden' }] },
        { id: 'stash', kind: 'collection', name: 'Kitchen stash', amounts: true,
            states: [{ id: 'none', label: 'not yet' }, { id: 'have', label: 'have' }], purse: [{ id: 'usd', unit: '$', start: 8 }],
            items: [{ id: 'tape', name: 'Tape', cost: { purse: 'usd', amount: 5 } }, { id: 'ring', name: 'Ring' }] },
        { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'cellar', name: 'Cellar' }] },
        { id: 'world', kind: 'state', name: 'World', fields: [{ id: 'day', type: 'day', name: 'Day' }, { id: 'tod', type: 'cycle', name: 'Time of day', values: ['Morning', 'Night'] }],
            dates: [{ id: 'party', name: 'Party', due: 4 }] },
        { id: 'coins', kind: 'counter', name: 'Coins', start: 3 },
    ],
});

test('board → window: lines point at positions and names, objects keep their ids', () => {
    const w = toWindowBoard(board());
    const fuse = w.trackers.find(t => t.id === 'fuse'), rel = w.trackers[0], sec = w.trackers[2];
    assertEqual(fuse.starts[0], { tracker: 'rel', step: 3, odds: 3 }, 'start line at position 3 (Sweethearts)');
    assertEqual(fuse.steps[2].needs[1].item, 'Tape', 'item by name');
    assertEqual(sec.starts[0], { tracker: 'fuse', at: 2, branch: 'Fail' }, 'branch line: position + branch name');
    assertEqual(rel.steps[2].fork.map(b => b.name), ['Confesses', 'Chickens out'], 'fork is a list of branches');
    assertEqual(rel.steps[2].fork[1].then, { kind: 'back', step: 1 }, 'back-to step as a position');
    assertEqual(fuse.steps[2].forkBy, 'roll', 'decided by roll');
    assertEqual(rel.steps[3].fallTo, { step: 1, detour: 'broken up' }, 'fall-to: position + detour name');
    assertEqual(rel.triggers[0], { collection: 'stash', item: 'Ring', to: 4 }, 'trigger: target step as a position');
    assertEqual(rel.steps.map(s => s.id), ['strangers', 'neighbours', 'friends', 'sweet', 'married'], 'step ids ride along');
});

test('round trip: board → window → board is unchanged', () => {
    const b = board();
    assertEqual(fromWindowBoard(toWindowBoard(b)), b);
});

test('a step moved in the window: lines follow, ids stay', () => {
    const w = toWindowBoard(board());
    const rel = w.trackers[0];
    // the window moves Sweethearts before Friends and renumbers its lines itself
    [rel.steps[2], rel.steps[3]] = [rel.steps[3], rel.steps[2]];
    w.trackers[1].starts[0].step = 2;
    w.trackers[0].steps[3].fork[1].then.step = 1;
    const b = fromWindowBoard(w);
    assertEqual(b.trackers[0].steps.map(s => s.id), ['strangers', 'neighbours', 'sweet', 'friends', 'married']);
    assertEqual(b.trackers[1].starts[0].step, 'sweet', 'still Sweethearts');
});

test('renames in the window keep every line', () => {
    const w = toWindowBoard(board());
    w.trackers[0].steps[3].name = 'Dating';
    w.trackers[1].steps[2].fork[1].name = 'Sparks fly';      // the window renames the branch in its lines too
    w.trackers[2].starts[0].branch = 'Sparks fly';
    w.trackers[3].items[0].name = 'Duct tape';
    w.trackers[1].steps[2].needs[1].item = 'Duct tape';
    const b = fromWindowBoard(w);
    assertEqual(b.trackers[1].starts[0].step, 'sweet', 'renamed step: same id');
    assertEqual(b.trackers[2].starts[0], { tracker: 'fuse', at: 'repair', branch: 'fail' }, 'renamed branch: same id');
    assertEqual(b.trackers[1].steps[2].needs[1].item, 'tape', 'renamed item: same id');
});

test('new things from the window get ids; a line to them works', () => {
    const w = toWindowBoard(board());
    w.trackers[0].steps.push({ name: 'Old married couple', entries: [] });
    w.trackers[3].items.push({ name: 'Spare fuse', entries: [] });
    w.trackers[1].steps[1].needs = [{ tracker: 'rel', step: 5 }, { collection: 'stash', item: 'Spare fuse' }];
    w.trackers.push({ name: 'Brand new', steps: ['One', 'Two'] });
    const b = fromWindowBoard(w);
    assertEqual(b.trackers[0].steps[5].id, 'old-married-couple');
    assertEqual(b.trackers[1].steps[1].needs.map(c => c.step || c.item), ['old-married-couple', 'spare-fuse']);
    assertEqual(b.trackers.at(-1).id, 'brand-new');
    assertEqual(b.trackers.at(-1).steps.map(s => s.id), ['one', 'two']);
});

test('a line to something deleted in the window is dropped, not misplaced', () => {
    const w = toWindowBoard(board());
    w.trackers[1].starts[0].step = 9;        // a stale position
    w.trackers[2].starts[0].branch = 'Gone';
    const b = fromWindowBoard(w);
    assertEqual(b.trackers[1].starts, []);
    assertEqual(b.trackers[2].starts, []);
});

test('chat: stored → window bag', () => {
    const b = board(), st = freshState(b);
    st.trackers.rel = { at: 'friends', started: true, forks: { friends: 'chick' }, run: 'paused' };
    st.collections.stash.items.tape = { state: 'have', amount: 2 };
    st.collections.stash.purse.usd = 3;
    st.places.where = 'cellar'; st.counters.coins = 7;
    st.states.world = { day: 3, vals: { tod: 'Night' } };
    st.runs = { where: 'abandoned' };
    const bag = toWindowChat(b, st);
    assertEqual(bag.rel, 2); assertEqual(bag.run_rel, 'paused'); assertEqual(bag.fork_rel_2, 'Chickens out');
    assertEqual(bag.fuse, null, 'waiting');
    assertEqual(bag.stash, { Tape: 'have', '#Tape': 2, $usd: 3 });
    assertEqual([bag.where, bag.run_where, bag.coins, bag.world], ['cellar', 'abandoned', 7, { day: 3, vals: { tod: 'Night' } }]);
});

test('chat: round trip keeps everything, and what the window does not show', () => {
    const b = board(), st = freshState(b);
    st.trackers.rel = { at: 'neighbours', aside: 'broken', started: true, startedAt: 12, forks: { friends: 'conf' } };
    st.trackers.fuse = { at: 'repair', forks: { repair: 'fail' } };
    st.collections.stash.items.ring = { state: 'have' };
    st.collections.stash.pending = [{ name: 'Rusty key', m: 31 }];
    const back = fromWindowChat(b, toWindowChat(b, st), st);
    assertEqual(back.trackers.rel, st.trackers.rel, 'detour + start time kept while on the same step');
    assertEqual(back.trackers.fuse.forks, { repair: 'fail' });
    assert(holds(b, back, { tracker: 'fuse', at: 'repair', branch: 'fail' }), 'branch line holds after the trip');
    assertEqual(back.collections.stash.items, { ring: { state: 'have' } });
    assertEqual(back.collections.stash.pending, [{ name: 'Rusty key', m: 31 }]);
});

test('chat: moved in the window → the detour of the old step goes, the move is kept', () => {
    const b = board(), st = freshState(b);
    st.trackers.rel = { at: 'neighbours', aside: 'broken', started: true };
    const bag = toWindowChat(b, st);
    bag.rel = 3;
    const back = fromWindowChat(b, bag, st);
    assertEqual(back.trackers.rel, { at: 'sweet', started: true, forks: {} });
});

test('chat: odd bags do not throw', () => {
    const b = board();
    const back = fromWindowChat(b, { rel: 'x', stash: 5, world: 'no', fork_rel_9: 'Nope' }, null);
    assertEqual(back.trackers.rel.at, 'strangers');
    assertEqual(back.collections.stash.items, {});
    assertEqual(fromWindowBoard(null).trackers, []);
});

test('v1 copy for the engine: step trackers only, step names, conditions by name', () => {
    const v1 = toV1Board(board());
    assertEqual(v1.trackers.map(t => t.id), ['rel', 'fuse', 'secret']);
    assertEqual(v1.trackers[0].steps, ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married']);
    // a start with odds is rolled and answered by the board (rolls-pure.js) — it rides along with its line key
    assertEqual(v1.trackers[1].starts.map(c => [c.ext?.tracker, c.ext?.step, c.ext?.odds, !!c.ext?.line]), [['rel', 'sweet', 3, true]]);
    assertEqual(v1.trackers[1].needs, [{ step: 'Repair', tracker: 'rel', reach: 'Married' }, { step: 'Repair', ext: { collection: 'stash', item: 'tape', amount: 1 } }], 'a collection line rides along for the board to answer');
});

test('reconcile: unchanged v1 → the v2 board as stored', () => {
    const b = board(), v1 = toV1Board(b);
    const r = reconcile(b, v1Sig(v1), v1);
    assertEqual(r.changed, []); assertEqual(r.board, b);
});

test('reconcile: a command renamed a step / added a tracker since → taken in, extras elsewhere kept', () => {
    const b = board(), v1 = toV1Board(b), sig = v1Sig(v1);
    v1.trackers[0].steps[3] = 'Dating';
    v1.trackers.push({ id: 'new', name: 'New one', steps: ['A', 'B'] });
    const r = reconcile(b, sig, v1);
    assertEqual(r.changed, ['Relationship', 'New one']);
    assertEqual(r.board.trackers[0].steps[3].name, 'Dating');
    assertEqual(r.board.trackers[0].icon, '💞', 'look kept');
    assert(r.board.trackers.some(t => t.id === 'stash'), 'collection kept');
    assertEqual(r.board.trackers[1].steps[2].fork.by, 'roll', 'untouched tracker keeps its fork');
    assertEqual(r.board.trackers.at(-1).id, 'new');
});

test('reconcile: no v2 yet → v1 converted', () => {
    const r = reconcile(null, '', { name: 'Old', trackers: [{ id: 'a', name: 'A', steps: ['x', 'y'] }] }, 'Old');
    assertEqual(r.board.trackers[0].steps.map(s => s.id), ['x', 'y']);
});

test('v1 copy keeps the colours of lines (a save without changes leaves the v1 board identical)', () => {
    const v1 = { name: 'T', trackers: [
        { id: 'a', name: 'A', steps: ['x', 'y'], direction: 'both', skip: false },
        { id: 'b', name: 'B', steps: ['p', 'q'], direction: 'both', skip: false, starts: [{ tracker: 'a', step: 'y', color: 1 }], needs: [{ step: 'q', tracker: 'a', reach: 'y', color: 4 }] },
    ] };
    const { board } = reconcile(null, '', v1, 'T');
    assertEqual(toV1Board(board).trackers, v1.trackers);
});

test('entries that name their step in the vault show on that step', () => {
    const b = withVaultLinks(board(), [
        { title: 'Rung 3 · Friends', storyStep: { tracker: 'relationship', steps: ['friends'] } },
        { title: 'Rung 1 · Strangers', storyStep: { tracker: 'Relationship', steps: ['Strangers'] } },     // already there
        { title: 'Elsewhere', storyStep: { tracker: 'Nope', steps: ['x'] } },
        { title: 'No link' },
    ]);
    assertEqual(b.trackers[0].steps[2].entries, ['Rung 3 · Friends']);
    assertEqual(b.trackers[0].steps[0].entries, ['Rung 1 · Strangers']);
});

test('cloud bug hunt 2026-10-04: a move made in the window is journalled — a delete or reopening keeps it', () => {
    const b = board();
    const prev = toEngineList(b, freshState(b), []).map(t => ({ ...t, journal: [{ i: 0, index: 0, aside: null }] }));
    const st = fromWindowChat(b, { ...toWindowChat(b, freshState(b)), rel: 2 }, freshState(b));
    const list = journalWindowMoves(toEngineList(b, st, prev), prev, 7, 'T');
    const rel = list.find(t => t.id === 'rel');
    assertEqual(rel.index, 2);
    assertEqual(rel.journal.at(-1).i, 7);
    assertEqual(rel.journal.at(-1).who, 'hand');
    // the history's rules (convert-pure listAt — what the old roll back did; step 6 builds the v2 log from it)
    assertEqual(listAt(list, 7).find(t => t.id === 'rel').index, 2, 'opening the chat again: still there');
    assertEqual(listAt(list, 6).find(t => t.id === 'rel').index, 0, 'deleting back past the move undoes it');
    const fuse = list.find(t => t.id === 'fuse'), fusePrev = prev.find(t => t.id === 'fuse');
    assertEqual(fuse.journal, fusePrev.journal, 'an unmoved tracker is left alone');
    const again = journalWindowMoves(toEngineList(b, st, list), list, 9, 'T');
    assertEqual(again.find(t => t.id === 'rel').journal.length, rel.journal.length, 'saving again without a move adds nothing');
});

summary('board-window');
