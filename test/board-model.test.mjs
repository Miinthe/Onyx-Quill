/**
 * LOCAL PATCH suite — the storyboard data model v2 (2026-10-05, stage 1).
 * Failures to avoid: a line that breaks when a step is renamed or moved; an old board
 * that loses its conditions on conversion; a condition that holds when it shouldn't
 * (a waiting tracker "reaching" a step, an unrolled 1-in-3 line opening); a chat state
 * that keeps pointing at something deleted; sentences that read wrong.
 * Run: npm run test:board-model
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import {
    normalizeBoard, migrateV1, freshState, normalizeState, holds, rollKey, pausedBy, isActive, isWaiting,
    unmetNeeds, startsNow, setRun, waitsAtFork, condText, lines, checkBoard, toEngineList, fromEngineList,
    thenOf, chainOf, trackerOf, stepOf, BOARD_VERSION,
} from '../src/board-model-pure.js';

// The mock-up's example board, in v2 terms.
const toaster = () => normalizeBoard({
    v: 2, name: 'Toaster & Kettle', folders: ['Ladder/', 'Plot/'],
    trackers: [
        { id: 'rel', name: 'Relationship', direction: 'both', steps: [
            { id: 'strangers', name: 'Strangers', entries: ['Rung 1 · Strangers'], oneWay: true },
            { id: 'neighbours', name: 'Neighbours', detours: [{ id: 'broken', name: 'broken up' }] },
            { id: 'friends', name: 'Friends', fork: { branches: [{ id: 'conf', name: 'Confesses' }, { id: 'chick', name: 'Chickens out', then: { kind: 'back', step: 'friends' } }] } },
            { id: 'sweet', name: 'Sweethearts' },
            { id: 'married', name: 'Married', needs: [{ world: 'world', due: 'party' }] },
        ] },
        { id: 'fuse', name: 'The Broken Fuse', direction: 'forward', starts: [{ tracker: 'rel', step: 'sweet' }], steps: [
            { id: 'calm', name: 'Calm' }, { id: 'sparks', name: 'Sparks' },
            { id: 'repair', name: 'Repair', needs: [{ tracker: 'rel', step: 'married' }, { collection: 'stash', item: 'tape', amount: 1 }],
                fork: { by: 'roll', branches: [{ id: 'success', name: 'Success' }, { id: 'fail', name: 'Fail', weight: 2 }] } },
        ], triggers: [{ tracker: 'fuse', at: 'repair', branch: 'fail', to: 'calm' }] },
        { id: 'secret', name: "Kettle's Secret", starts: [{ tracker: 'fuse', step: 'sparks' }, { tracker: 'rel', step: 'friends' }], steps: [
            { id: 'hidden', name: 'Hidden' }, { id: 'suspected', name: 'Suspected' },
            { id: 'revealed', name: 'Revealed', needs: [{ collection: 'clues', count: 3, state: 'uncovered', odds: 3, retry: 5 }, { place: 'where', at: 'cellar' }] },
        ] },
        { id: 'world', kind: 'state', name: 'World', fields: [
            { id: 'tod', type: 'cycle', name: 'Time of day', values: ['Morning', 'Noon', 'Evening', 'Night'], addsDay: true },
            { id: 'day', type: 'day', name: 'Day', start: 1 },
            { id: 'weather', type: 'choice', name: 'Weather', values: ['Sunny', 'Raining'] },
        ], dates: [{ id: 'party', name: 'Party at the harbor', due: 4, by: 'ai', m: 29, q: 'In two days…' }], datesGrow: true },
        { id: 'clues', kind: 'collection', name: 'Clues', states: [{ id: 'hidden', label: 'hidden' }, { id: 'uncovered', label: 'uncovered' }, { id: 'lost', label: 'lost', strike: true }],
            items: [{ id: 'cord', name: 'Burnt cord' }, { id: 'scorch', name: 'Scorch mark', needs: [{ tracker: 'fuse', at: 'repair', branch: 'fail' }] }, { id: 'alibi', name: "Kettle's alibi" }, { id: 'crumbs', name: 'Crumb trail' }] },
        { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'counter', name: 'Counter', parent: 'kitchen' }, { id: 'cellar', name: 'Cellar' }] },
        { id: 'stash', kind: 'collection', name: 'Kitchen stash', amounts: true, purse: [{ id: 'usd', unit: '$', start: 8 }],
            states: [{ id: 'none', label: 'not yet' }, { id: 'have', label: 'have' }, { id: 'used', label: 'used up' }],
            items: [{ id: 'tape', name: 'Tape', cost: { purse: 'usd', amount: 5 } }] },
        { id: 'days', kind: 'counter', name: 'Days', start: 1 },
    ],
    exclusive: [{ a: 'secret', b: 'days' }],
});
const at = (st, id, step) => { st.trackers[id] = { ...(st.trackers[id] || {}), at: step }; return st; };

test('a v2 board keeps its shape; normalizing twice changes nothing', () => {
    const b = toaster();
    assertEqual(b.v, BOARD_VERSION, 'version 2');
    assertEqual(JSON.stringify(normalizeBoard(b)), JSON.stringify(b), 'idempotent');
    assertEqual(b.trackers.map(t => t.kind).join(','), 'steps,steps,steps,state,collection,place,collection,counter', 'kinds');
    assertEqual(stepOf(trackerOf(b, 'fuse'), 'repair').fork.by, 'roll', 'fork decided by a roll');
    assertEqual(b.trackers[1].triggers.length, 1, 'trigger kept');
});

test('a v1 board converts: steps get ids, conditions point at them, step needs move onto the step', () => {
    const v1 = { name: 'Old', trackers: [
        { id: 'rel', name: 'Relationship', steps: ['Strangers', 'Friends', 'Married'], direction: 'both', skip: false },
        { id: 'fuse', name: 'The Broken Fuse', steps: ['Calm', 'Sparks', 'Repair'], starts: [{ tracker: 'rel', step: 'Friends' }],
            needs: [{ step: 'Repair', tracker: 'Relationship', reach: 'Married' }], onFall: 'pause' },
    ] };
    const b = migrateV1(v1);
    const fuse = trackerOf(b, 'fuse'), rel = trackerOf(b, 'rel');
    assertEqual(fuse.starts[0].step, rel.steps[1].id, 'starts → step id');
    assertEqual(stepOf(fuse, fuse.steps[2].id).needs[0].step, rel.steps[2].id, 'needs moved onto Repair, reach → step id');
    assertEqual(fuse.onFall, 'pause', 'onFall kept');
    assertEqual(condText(b, fuse.starts[0]), 'Relationship reaches Friends', 'still reads the same');
    assertEqual(normalizeBoard(v1).v, 2, 'normalizeBoard converts too');
});

test('ids keep lines intact when a step is renamed or the steps are reordered', () => {
    const b = toaster();
    const rel = trackerOf(b, 'rel');
    rel.steps.find(s => s.id === 'sweet').name = 'Lovers';
    rel.steps.reverse();
    const fuse = trackerOf(normalizeBoard(b), 'fuse');
    assertEqual(condText(b, fuse.starts[0]), 'Relationship reaches Lovers', 'the line follows the rename');
});

test('a fresh chat: first step, waiting trackers waiting, items in their first state, first place, day 1', () => {
    const b = toaster(), st = freshState(b);
    assertEqual(st.trackers.rel.at, 'strangers', 'rel at the first step');
    assertEqual(st.trackers.fuse.at, null, 'fuse waits');
    assert(isWaiting(b, st, trackerOf(b, 'fuse')), 'waiting');
    assertEqual(st.places.where, 'kitchen', 'first place');
    assertEqual(st.states.world.day, 1, 'day 1');
    assertEqual(st.collections.stash.purse.usd, 8, 'purse at its start');
});

test('"reaches" = that step or later; a waiting tracker has reached nothing', () => {
    const b = toaster(), st = freshState(b);
    const c = { tracker: 'rel', step: 'sweet' };
    assert(!holds(b, at(st, 'rel', 'friends'), c), 'Friends is not Sweethearts');
    assert(holds(b, at(st, 'rel', 'married'), c), 'Married counts');
    assert(!holds(b, st, { tracker: 'fuse', step: 'calm' }), 'a waiting tracker reaches nothing');
});

test('collections, the purse, counters, places, state and dates', () => {
    const b = toaster(), st = freshState(b);
    st.collections.clues.items = { cord: { state: 'uncovered' }, alibi: { state: 'uncovered' } };
    assert(!holds(b, st, { collection: 'clues', count: 3, state: 'uncovered' }), '2 of 3');
    st.collections.clues.items.crumbs = { state: 'uncovered' };
    assert(holds(b, st, { collection: 'clues', count: 3, state: 'uncovered' }), '3 of 3');
    assert(holds(b, st, { collection: 'clues', item: 'cord', state: 'uncovered' }), 'one item');
    assert(!holds(b, st, { collection: 'stash', item: 'tape', amount: 1 }), 'no tape yet');
    st.collections.stash.items.tape = { state: 'have', amount: 2 };
    assert(holds(b, st, { collection: 'stash', item: 'tape', amount: 2 }), '2 × tape');
    assert(holds(b, st, { collection: 'stash', purse: 'usd', min: 8 }) && !holds(b, st, { collection: 'stash', purse: 'usd', min: 9 }), 'purse');
    assert(holds(b, st, { counter: 'days', min: 1 }) && !holds(b, st, { counter: 'days', min: 2 }), 'counter');
    st.places.where = 'counter';
    assert(holds(b, st, { place: 'where', at: 'kitchen' }), 'inside the kitchen counts as the kitchen');
    assert(!holds(b, st, { place: 'where', at: 'cellar' }), 'not the cellar');
    assert(holds(b, st, { world: 'world', field: 'weather', is: 'Sunny' }), 'first value until changed');
    assert(!holds(b, st, { world: 'world', due: 'party' }), 'not due on day 1');
    st.states.world.day = 4;
    assert(holds(b, st, { world: 'world', due: 'party' }) && holds(b, st, { world: 'world', field: 'day', min: 4 }), 'due on day 4');
});

test('odds: a line with odds is closed until it was rolled, then the roll decides', () => {
    const b = toaster(), st = freshState(b);
    st.collections.clues.items = { cord: { state: 'uncovered' }, alibi: { state: 'uncovered' }, crumbs: { state: 'uncovered' } };
    const c = stepOf(trackerOf(b, 'secret'), 'revealed').needs[0];
    assertEqual(c.odds, 3, '1 in 3'); assertEqual(c.retry, 5, 'retry after 5');
    assert(!holds(b, st, c), 'not rolled yet → closed');
    assert(holds(b, st, c, { [rollKey(c)]: true }), 'rolled a hit → open');
    assert(!holds(b, st, c, { [rollKey(c)]: false }), 'rolled a miss → closed');
    assertEqual(rollKey({ ...c, color: 4 }), rollKey(c), 'the roll is the same line whatever its colour');
});

test('forks: a tracker waits at an undecided fork; branch lines hold once taken; afterwards defaults', () => {
    const b = toaster(), st = at(freshState(b), 'rel', 'friends');
    const rel = trackerOf(b, 'rel'), fuse = trackerOf(b, 'fuse');
    assert(waitsAtFork(b, st, rel), 'waits at the interlude');
    st.trackers.rel.forks = { friends: 'conf' };
    assert(!waitsAtFork(b, st, rel), 'decided');
    assert(holds(b, st, { tracker: 'rel', at: 'friends', branch: 'conf' }), 'branch line holds');
    assertEqual(thenOf(rel, 'friends', { name: 'x' }), 'on', 'in the middle: on to the next step');
    assertEqual(thenOf(fuse, 'repair', { name: 'x' }), 'end', 'at the end: ends here');
    assertEqual(thenOf(rel, 'friends', stepOf(rel, 'friends').fork.branches[1]), 'back', 'a set afterwards wins');
});

test('blocks and pauses: by you, a block on a step, while running, once a branch, only one at a time', () => {
    const b = toaster(); let st = freshState(b);
    const fuse = trackerOf(b, 'fuse'), days = trackerOf(b, 'days');
    st = setRun(b, st, trackerOf(b, 'rel'), 'paused');
    assertEqual(pausedBy(b, st, trackerOf(b, 'rel')), 'you paused it', 'paused by you');
    fuse.blocks = [{ tracker: 'rel', step: 'neighbours' }];
    st = setRun(b, st, trackerOf(b, 'rel'), null);
    at(st, 'rel', 'neighbours'); at(st, 'fuse', 'calm');
    assertEqual(pausedBy(b, st, fuse), 'while Relationship is at Neighbours', 'a block on a step is "while at", not "reached"');
    at(st, 'rel', 'friends');
    assertEqual(pausedBy(b, st, fuse), null, 'moved on → free');
    fuse.blocks = [{ tracker: 'rel', at: 'friends', branch: 'chick' }];
    st.trackers.rel.forks = { friends: 'chick' };
    assertEqual(pausedBy(b, st, fuse), 'once Relationship takes “Chickens out” after Friends', 'once a branch is taken');
    at(st, 'secret', 'hidden');
    assertEqual(pausedBy(b, st, days), "Kettle's Secret holds the floor", 'only one at a time');
});

test('a step stays closed while a need is missing or a block holds', () => {
    const b = toaster(), st = at(freshState(b), 'rel', 'sweet');
    const fuse = trackerOf(b, 'fuse');
    assertEqual(unmetNeeds(b, st, fuse, 'repair').length, 2, 'Married and tape missing');
    at(st, 'rel', 'married'); st.collections.stash.items.tape = { state: 'have', amount: 1 };
    assertEqual(unmetNeeds(b, st, fuse, 'repair').length, 0, 'open');
});

test('waiting trackers start when their conditions hold — a chain in one go', () => {
    const b = toaster(), st = at(freshState(b), 'rel', 'sweet');
    let r = startsNow(b, st);
    assertEqual(r.started.map(x => x.id).join(','), 'fuse', 'fuse starts; secret still waits for Sparks');
    assertEqual(r.started[0].why, 'Relationship reaches Sweethearts', 'says why');
    at(r.state, 'fuse', 'sparks');
    r = startsNow(b, r.state);
    assertEqual(r.started.map(x => x.id).join(','), 'secret', 'then the secret');
    assertEqual(startsNow(b, r.state).started.length, 0, 'only once');
});

test('abandon resets and switches off; reactivate waits for the start conditions again; every kind', () => {
    const b = toaster(); let st = at(at(freshState(b), 'rel', 'sweet'), 'fuse', 'sparks');
    st = setRun(b, st, trackerOf(b, 'fuse'), 'abandoned');
    assertEqual(st.trackers.fuse.at, null, 'back to the start (waiting)');
    assert(!isActive(b, st, trackerOf(b, 'fuse')) && !isWaiting(b, st, trackerOf(b, 'fuse')), 'switched off, not waiting');
    assert(!holds(b, st, { tracker: 'fuse', step: 'calm' }), 'nothing waiting on it opens');
    st = setRun(b, st, trackerOf(b, 'fuse'), null);
    assert(isWaiting(b, st, trackerOf(b, 'fuse')), 'reactivated: waits again');
    st.collections.clues.items = { cord: { state: 'uncovered' } };
    st = setRun(b, st, trackerOf(b, 'clues'), 'abandoned');
    assertEqual(Object.keys(st.collections.clues.items).length, 0, 'items back to their first state');
    assert(!isActive(b, st, trackerOf(b, 'clues')), 'collection switched off');
    st = setRun(b, st, trackerOf(b, 'clues'), null);
    assert(isActive(b, st, trackerOf(b, 'clues')), 'and on again');
});

test('a stored chat state is repaired against its board', () => {
    const b = toaster();
    const raw = { v: 2, trackers: { rel: { at: 'gone', forks: { friends: 'nope' } }, ghost: { at: 'x' } }, places: { where: 'nowhere' }, states: { world: { day: 3, vals: { weather: 'Snow', tod: 'Noon' } } },
        collections: { clues: { items: { cord: { state: 'uncovered' }, ghost: { state: 'uncovered' }, alibi: { state: 'weird' } } } } };
    const st = normalizeState(raw, b);
    assertEqual(st.trackers.rel.at, 'strangers', 'a deleted step → the start');
    assertEqual(Object.keys(st.trackers.rel.forks).length, 0, 'a deleted branch choice is dropped');
    assert(!st.trackers.ghost, 'a deleted tracker drops out');
    assertEqual(st.places.where, 'kitchen', 'a deleted place → the first');
    assertEqual(JSON.stringify(st.states.world.vals), '{"tod":"Noon"}', 'only valid values survive');
    assertEqual(Object.keys(st.collections.clues.items).join(','), 'cord', 'unknown items and states drop');
});

test('the sentence builder reads like the mock-up', () => {
    const b = toaster(), T = l => lines(b).find(x => x.key === l)?.text;
    assertEqual(T('s|fuse|0'), 'The Broken Fuse starts when Relationship reaches Sweethearts', 'starts');
    assertEqual(T('n|fuse|repair|1'), 'Repair (The Broken Fuse) only possible once the Kitchen stash has 1 × Tape', 'needs an item');
    assertEqual(T('n|secret|revealed|0'), "Revealed (Kettle's Secret) only possible once 3 of the Clues are uncovered, with a 1 in 3 chance", 'count + odds');
    assertEqual(T('n|secret|revealed|1'), "Revealed (Kettle's Secret) only possible once the scene is at 📍 Cellar", 'place');
    assertEqual(T('n|rel|married|0'), 'Married (Relationship) only possible once Party at the harbor is due', 'date');
    assertEqual(T('g|fuse|0'), 'When The Broken Fuse ends in Fail, The Broken Fuse moves to Calm', 'trigger');
    assertEqual(T('i|clues|scorch|0'), 'Scorch mark (Clues) can only become uncovered once The Broken Fuse ends in Fail', 'item need');
    assertEqual(T('e|0'), "Only one of Kettle's Secret and Days at a time — whichever starts first holds the floor", 'only one');
    assertEqual(condText(b, { collection: 'clues', count: 1, state: 'lost' }), '1 of the Clues is lost', 'singular');
    assertEqual(condText(b, { world: 'world', field: 'day', min: 5 }), 'it is at least Day 5', 'day');
    assertEqual(condText(b, { world: 'world', field: 'weather', is: 'Raining' }), 'the weather is Raining', 'weather');
    assertEqual(condText(b, { tracker: 'rel', at: 'friends', branch: 'conf' }), 'Relationship takes “Confesses” after Friends', 'interlude');
    assertEqual(condText(b, { counter: 'days', min: 3 }), 'Days is at least 3', 'counter');
});

test('Check finds what is broken', () => {
    const b = toaster();
    assertEqual(checkBoard(b).filter(i => i.sev === 'error').length, 0, 'the example board has no problems');
    const fuse = trackerOf(b, 'fuse');
    stepOf(fuse, 'repair').needs.push({ tracker: 'rel', step: 'deleted' });
    stepOf(fuse, 'repair').fork.branches.pop();
    stepOf(trackerOf(b, 'rel'), 'friends').fork.branches[1].then = { kind: 'back', step: 'gone' };
    fuse.triggers[0].branch = 'fail';
    trackerOf(b, 'rel').starts = [{ tracker: 'secret', step: 'hidden' }];
    const issues = checkBoard(b), text = issues.map(i => i.text).join('\n');
    assert(/points at a step that no longer exists/.test(text), 'missing step');
    assert(/has only one branch/.test(text), 'one-branch fork');
    assert(/goes to a step that no longer exists/.test(text), 'branch goes nowhere');
    assert(/a branch that no longer exists/.test(text), 'trigger on a removed branch');
    assert(/wait on each other and never start/.test(text), 'a circle');
    assert(issues.some(i => i.sev === 'warn' && /has no entry/.test(i.text)), 'steps without entries warn');
});

test('the v1 engine list ⇄ v2 chat state, so today\'s helper keeps working', () => {
    const b = toaster(); let st = at(freshState(b), 'rel', 'neighbours');
    st.trackers.rel.aside = 'broken';
    const list = toEngineList(b, st, [{ id: 'rel', journal: [{ i: 0, index: 0 }], lastAuto: { x: 1 } }]);
    assertEqual(list.map(t => t.id).join(','), 'rel,fuse,secret', 'only steps trackers');
    const rel = list[0], fuse = list[1];
    assertEqual(rel.index, 1, 'position'); assertEqual(rel.aside, 'broken up', 'detour by name');
    assertEqual(rel.journal.length, 1, 'journal kept'); assert(rel.lastAuto, 'last move kept');
    assertEqual(JSON.stringify(fuse.starts), '[{"tracker":"rel","step":"Sweethearts"}]', 'v1 starts by step name');
    assertEqual(fuse.started, false, 'waiting'); assertEqual(fuse.needs[0].reach, 'Married', 'v1 needs by name');
    // the helper moves rel to Sweethearts and starts the fuse
    const moved = list.map(t => (t.id === 'rel' ? { ...t, index: 3, aside: null } : t.id === 'fuse' ? { ...t, started: true, index: 0 } : t));
    st = fromEngineList(b, st, moved);
    assertEqual(st.trackers.rel.at, 'sweet', 'position back'); assert(!st.trackers.rel.aside, 'detour cleared');
    assertEqual(st.trackers.fuse.at, 'calm', 'fuse started');
});

test('real v1 chats: an unset "started" still means waiting; a detour typed by hand survives as text', () => {
    const b = toaster();
    const list = [{ id: 'rel', name: 'Relationship', steps: ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married'], index: 2, aside: 'Nuisance' },
        { id: 'fuse', name: 'The Broken Fuse', steps: ['Calm', 'Sparks', 'Repair'], index: 0, starts: [{ tracker: 'rel', step: 'Sweethearts' }] }];
    const st = fromEngineList(b, freshState(b), list);
    assertEqual(st.trackers.fuse.at, null, 'still waiting');
    assertEqual(st.trackers.rel.asideText, 'Nuisance', 'kept as text');
    const back = toEngineList(b, st, list);
    assertEqual(back[0].aside, 'Nuisance', 'and given back');
    assertEqual(back[1].started, false, 'not started');
});

test('chainOf walks out through the places a place sits in', () => {
    const b = toaster();
    assertEqual(chainOf(trackerOf(b, 'where'), 'counter').map(p => p.id).join(','), 'counter,kitchen', 'counter, then kitchen');
});

test('normalizeState keeps a paused collection / place, drops runs of unknown trackers', () => {
    const b = toaster(), st = freshState(b);
    const col = b.trackers.find(t => t.kind === 'collection');
    st.runs = { [col.id]: 'paused', ghost: 'paused', rel: 'paused' };
    assertEqual(normalizeState(st, b).runs, { [col.id]: 'paused' });
});

test('cloud bug hunt 2026-10-04: a tracker stored as waiting whose start lines were removed runs from its first step', () => {
    const b = normalizeBoard({ v: 2, name: 'B', trackers: [{ id: 'fuse', name: 'Fuse', steps: [{ id: 'calm', name: 'Calm' }, { id: 'sparks', name: 'Sparks' }] }] });
    assertEqual(normalizeState({ v: 2, trackers: { fuse: { at: null } } }, b).trackers.fuse.at, 'calm');
    const w = normalizeBoard({ v: 2, name: 'B', trackers: [{ id: 'rel', name: 'Rel', steps: [{ id: 'a', name: 'A' }] }, { id: 'fuse', name: 'Fuse', starts: [{ tracker: 'rel', step: 'a' }], steps: [{ id: 'calm', name: 'Calm' }] }] });
    assertEqual(normalizeState({ v: 2, trackers: { fuse: { at: null } } }, w).trackers.fuse.at, null, 'with a start line it still waits');
});

summary();
