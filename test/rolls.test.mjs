/**
 * LOCAL PATCH suite — triggers + odds in play (2026-10-04, storyboard stage 3; roadmap §4 G2).
 * Failures to avoid: a start with odds that starts as if certain (the old translation dropped
 * odds) or never (nothing rolled); a roll made twice; a start and a trigger on the same
 * condition sharing one roll; a failed roll rolling again when it shouldn't (or not when it
 * should); a delete that leaves a roll or a fired trigger standing; a trigger firing twice, or
 * while its tracker waits; an Undo after which the trigger fires again; odds on a "needs" line
 * blocking a step.
 * Run: npm run test:rolls
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, normalizeState, toEngineList, lineKey, checkBoard, unmetNeeds, lines } from '../src/board-model-pure.js';
import { oddsLines, lineHolds, rollTurn, fireTriggers, denyTrigger, describeRoll, describeTrigger, justHappenedLines, hasRollsOrTriggers, findables, toFindLines, findKey } from '../src/rolls-pure.js';
import { rewindCollections, helperSection, validateCollectionChanges, filterByItems, applyCollectionChanges } from '../src/collections-pure.js';

// Relationship: Strangers → Friends → Sweethearts. The Fuse: Sparks → Repair / Fail (end).
// The Fuse starts when Relationship reaches Friends, 1 in 3 (retry as given);
// when the Fuse reaches Fail, Relationship moves back to Strangers.
const board = (startExtra = {}, trigExtra = {}) => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'rel', name: 'Relationship', steps: [{ id: 'strangers', name: 'Strangers' }, { id: 'friends', name: 'Friends' }, { id: 'sweet', name: 'Sweethearts' }],
        triggers: [{ tracker: 'fuse', step: 'fail', to: 'strangers', ...trigExtra }] },
    { id: 'fuse', name: 'The Broken Fuse', steps: [{ id: 'sparks', name: 'Sparks' }, { id: 'repair', name: 'Repair' }, { id: 'fail', name: 'Fail' }],
        starts: [{ tracker: 'rel', step: 'friends', odds: 3, ...startExtra }] },
] });
const at = (st, rel, fuse) => { st.trackers.rel = { at: rel }; st.trackers.fuse = { at: fuse ?? null, ...(fuse ? { started: true } : {}) }; return st; };
const roll = n => ({ rand: () => (n - 1 + 0.5) / 3 });   // exactly face n of 3

test('only starts and triggers roll; a start and a trigger on one condition roll apart', () => {
    const b = board({}, { odds: 2 });
    assertEqual(oddsLines(b).map(l => l.kind), ['trigger', 'start'], 'board order');
    assert(lineKey('start', 'fuse', b.trackers[1].starts[0]) !== lineKey('trigger', 'rel', b.trackers[0].triggers[0]), 'separate keys');
    assert(hasRollsOrTriggers(b));
    assert(!hasRollsOrTriggers(normalizeBoard({ v: 2, trackers: [{ id: 'a', name: 'A', steps: ['x', 'y'] }] })));
});

test('a start with odds rolls once, when its condition first holds — not before', () => {
    const b = board();
    let st = at(freshState(b), 'strangers');
    assertEqual(rollTurn(b, st, 3, roll(1)).rolled.length, 0, 'Relationship not at Friends yet: no roll');
    st = at(st, 'friends');
    const r = rollTurn(b, st, 4, roll(1));
    assertEqual(r.rolled.map(x => [x.face, x.ok]), [[1, true]]);
    assert(lineHolds(b, r.state, b.trackers[1].starts[0], r.rolled[0].key), 'the line holds after a good roll');
    assertEqual(rollTurn(b, r.state, 5, roll(2)).rolled.length, 0, 'never rolled twice');
});

test('a failed roll: closed for good by default', () => {
    const b = board(), st = at(freshState(b), 'friends');
    const r = rollTurn(b, st, 4, roll(3));
    assert(!r.rolled[0].ok);
    assert(!lineHolds(b, r.state, b.trackers[1].starts[0], r.rolled[0].key), 'a failed roll does not hold');
    assertEqual(rollTurn(b, r.state, 40, roll(1)).rolled.length, 0, 'never again');
});

test('a failed roll with "again in 5 messages" rolls again 5 messages later', () => {
    const b = board({ retry: 5 }), st = at(freshState(b), 'friends');
    const r = rollTurn(b, st, 4, roll(2));
    assertEqual(rollTurn(b, r.state, 8, roll(1)).rolled.length, 0, '4 messages later: not yet');
    const r2 = rollTurn(b, r.state, 9, roll(1));
    assertEqual(r2.rolled.map(x => x.ok), [true], '5 messages later: rolls, and this time it happens');
});

test('"each new visit": a failed roll rolls again only after the condition stopped holding and holds again', () => {
    const b = normalizeBoard({ v: 2, trackers: [
        { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'pantry', name: 'Pantry' }] },
        { id: 'mice', name: 'Mice', steps: ['Squeak', 'Nest'], starts: [{ place: 'where', at: 'pantry', odds: 3, retry: 'visit' }] },
    ] });
    let st = freshState(b); st.places.where = 'pantry';
    const r1 = rollTurn(b, st, 2, roll(2));
    assertEqual(r1.rolled.map(x => x.ok), [false]);
    assertEqual(rollTurn(b, r1.state, 3, roll(1)).rolled.length, 0, 'still in the pantry: no new roll');
    const away = rollTurn(b, { ...r1.state, places: { where: 'kitchen' } }, 4, roll(1));
    assert(away.changed && away.state.rolls[r1.rolled[0].key].away, 'left the pantry: marked');
    const back = rollTurn(b, { ...away.state, places: { where: 'pantry' } }, 6, roll(1));
    assertEqual(back.rolled.map(x => x.ok), [true], 'back in the pantry: rolls again');
});

test('a start whose tracker already started does not roll; the engine gets the start as a board line with its key', () => {
    const b = board(), st = at(freshState(b), 'friends', 'sparks');
    assertEqual(rollTurn(b, st, 4, roll(1)).rolled.length, 0);
    const e = toEngineList(b, st).find(t => t.id === 'fuse');
    assertEqual(e.starts.length, 1);
    assertEqual(e.starts[0].ext.line, lineKey('start', 'fuse', b.trackers[1].starts[0]));
    assertEqual(e.starts[0].ext.odds, 3);
});

test('a delete before the roll unmakes it (and it may roll again)', () => {
    const b = board(), st = at(freshState(b), 'friends');
    const r = rollTurn(b, st, 7, roll(3));
    const back = rewindCollections(b, r.state, 6).state;
    assertEqual(back.rolls, {}, 'roll gone');
    assertEqual(rollTurn(b, at(back, 'friends'), 7, roll(1)).rolled.map(x => x.ok), [true]);
    assertEqual(rewindCollections(b, r.state, 7).state.rolls, r.state.rolls, 'message 7 kept: roll kept (a swipe keeps it)');
});

test('a trigger fires once when its line holds, moving its tracker back; not while the tracker waits', () => {
    const b = board();
    const st = at(freshState(b), 'sweet', 'fail');
    const f = fireTriggers(b, st, 9);
    assertEqual(f.fired.map(x => [x.from, x.to, x.moved]), [['sweet', 'strangers', true]]);
    assertEqual(f.state.trackers.rel.at, 'strangers');
    assertEqual(describeTrigger(b, f.fired[0]), '⚡ Relationship moved to Strangers — because The Broken Fuse reaches Fail');
    assertEqual(fireTriggers(b, at(f.state, 'sweet', 'fail'), 12).fired.length, 0, 'once per chat');
    const waiting = normalizeBoard({ ...b, trackers: [{ ...b.trackers[0], starts: [{ tracker: 'fuse', step: 'sparks' }] }, b.trackers[1]] });
    const sw = freshState(waiting); sw.trackers.fuse = { at: 'fail', started: true }; sw.trackers.rel = { at: null };
    assertEqual(fireTriggers(waiting, sw, 9).fired.length, 0, 'a waiting tracker: the trigger waits');
});

test('a trigger that finds its tracker already there fires quietly (no move)', () => {
    const b = board(), f = fireTriggers(b, at(freshState(b), 'strangers', 'fail'), 9);
    assertEqual(f.fired.map(x => x.moved), [false]);
    assertEqual(justHappenedLines(b, f.state, 9), []);
});

test('the writer hears JUST HAPPENED for that one message only', () => {
    const b = board(), f = fireTriggers(b, at(freshState(b), 'sweet', 'fail'), 9);
    assertEqual(justHappenedLines(b, f.state, 9), ['JUST HAPPENED: Relationship moved to Strangers (because The Broken Fuse reaches Fail)']);
    assertEqual(justHappenedLines(b, f.state, 10), []);
});

test('a delete before the firing message lets it fire again; Undo stops it for good', () => {
    const b = board(), f = fireTriggers(b, at(freshState(b), 'sweet', 'fail'), 9);
    const back = rewindCollections(b, f.state, 8).state;
    assertEqual(back.fired, {}); assertEqual(back.trackers.rel.at, 'sweet');
    assertEqual(fireTriggers(b, at(back, 'sweet', 'fail'), 9).fired.length, 1, 'fires again');
    const u = denyTrigger(f.state, f.fired[0].logId);
    assertEqual(u.state.trackers.rel.at, 'sweet'); assert(u.state.denied.includes(f.fired[0].key));
    assertEqual(fireTriggers(b, at(u.state, 'sweet', 'fail'), 12).fired.length, 0, 'denied: never again');
    assertEqual(denyTrigger(u.state, f.fired[0].logId).error, 'already undone or rolled back');
});

test('a trigger with odds: rolled first, fires only on a good roll', () => {
    const b = board({}, { odds: 2 });
    const st = at(freshState(b), 'sweet', 'fail');
    assertEqual(fireTriggers(b, st, 9).fired.length, 0, 'not rolled: does not fire');
    const r = rollTurn(b, st, 9, { rand: () => 0.9 });
    assertEqual(r.rolled.map(x => [x.kind, x.ok]), [['trigger', false]]);
    assertEqual(fireTriggers(b, r.state, 9).fired.length, 0);
    const good = rollTurn(b, st, 9, { rand: () => 0.1 });
    assertEqual(fireTriggers(b, good.state, 9).fired.length, 1);
    assert(describeRoll(b, good.rolled[0]).startsWith('🎲 When The Broken Fuse reaches Fail, Relationship moves to Strangers — rolled 1 of 2: it happens'));
});

test('notices say what was rolled and what happens next', () => {
    const b = board({ retry: 'visit' }), r = rollTurn(b, at(freshState(b), 'friends'), 4, roll(2));
    assertEqual(describeRoll(b, r.rolled[0]), '🎲 The Broken Fuse starts when Relationship reaches Friends — rolled 2 of 3: not this time, it rolls again on the next visit');
});

test('odds on a "needs" line: the step is not blocked by dice (holds as if certain) and Check warns', () => {
    const b = normalizeBoard({ v: 2, trackers: [
        { id: 'rel', name: 'Relationship', steps: ['Strangers', 'Friends'] },
        { id: 'fuse', name: 'Fuse', steps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', needs: [{ tracker: 'rel', step: 'friends', odds: 3 }] }] },
    ] });
    const st = freshState(b); st.trackers.rel = { at: 'friends' };
    assertEqual(unmetNeeds(b, st, b.trackers[1], 'b').length, 0);
    assert(checkBoard(b).some(x => x.sev === 'warn' && x.text.includes('odds only count')));
    assert(!JSON.stringify(toEngineList(b, st)).includes('"odds"'), 'the engine never sees odds on a need');
});

test('rolls, fired and denied survive the state repair; retry "visit" is kept on the board', () => {
    const b = board({ retry: 'visit' });
    assertEqual(b.trackers[1].starts[0].retry, 'visit');
    const s = normalizeState({ ...freshState(b), rolls: { k: { ok: true } }, fired: { g: { i: 1 } }, denied: ['g'] }, b);
    assertEqual([s.rolls, s.fired, s.denied], [{ k: { ok: true } }, { g: { i: 1 } }, ['g']]);
});

// ── part 2: items to find (Miinthe's pantry glue) ──────────────────────────────
const pantry = (findExtra = { odds: 2 }) => normalizeBoard({ v: 2, name: 'P', trackers: [
    { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'pantry', name: 'Pantry' }] },
    { id: 'stash', kind: 'collection', name: 'Stash', states: [{ id: 'not', label: 'not found' }, { id: 'kept', label: 'kept' }],
        items: [{ id: 'glue', name: 'Glue', entries: ['Item · Glue'], finds: [{ place: 'where', at: 'pantry', ...findExtra }] }, { id: 'tape', name: 'Tape' }] },
] });
const inPantry = (b, where = 'pantry') => { const st = freshState(b); st.places.where = where; return st; };
const msgs = (text, i = 20) => [{ mes: text, _i: i }];
const take = (item, quote) => ({ collection: 'Stash', item, state: 'kept', quote, reason: 'r', confidence: 'high' });

test('a find line is a trigger line on the item; it rolls once in the pantry, not in the kitchen', () => {
    const b = pantry();
    assertEqual(lines(b).filter(l => l.kind === 'trigger').map(l => l.text), ['When the scene is at 📍 Pantry, with a 1 in 2 chance, Glue (Stash) is there to be found']);
    assert(hasRollsOrTriggers(b));
    assertEqual(rollTurn(b, inPantry(b, 'kitchen'), 3, roll(1)).rolled.length, 0, 'kitchen: no roll');
    const r = rollTurn(b, inPantry(b), 4, { rand: () => 0.1 });
    assertEqual(r.rolled.map(x => [x.kind, x.ok]), [['find', true]]);
    assertEqual(describeRoll(b, r.rolled[0]), '🎲 Glue is there to be found when the scene is at 📍 Pantry — rolled 1 of 2: it happens');
});

test('while there to be found: the writer hears TO FIND HERE, the helper sees it, its entry is available', () => {
    const b = pantry(), r = rollTurn(b, inPantry(b), 4, { rand: () => 0.1 });
    assertEqual(toFindLines(b, r.state), ['TO FIND HERE: Glue']);
    assert(helperSection(b, r.state).includes('"Glue" (not found, there to be found here'));
    assertEqual(filterByItems([{ title: 'Item · Glue' }], b, r.state).length, 1);
    const left = { ...r.state, places: { where: 'kitchen' } };
    assertEqual(toFindLines(b, left), [], 'left the pantry: not here');
    assert(helperSection(b, left).includes('"Glue" (not found, not here — cannot be taken now)'), 'outside the pantry: listed as not here (hiding it made the helper report another item)');
    assertEqual(filterByItems([{ title: 'Item · Glue' }], b, left).length, 0);
    assertEqual(toFindLines(b, { ...left, places: { where: 'pantry' } }), ['TO FIND HERE: Glue'], 'a good roll stays good: back in the pantry, still there');
});

test('a failed roll: no glue (closed for good) — the helper cannot take it, the writer is not told', () => {
    const b = pantry(), r = rollTurn(b, inPantry(b), 4, { rand: () => 0.9 });
    assertEqual(r.rolled.map(x => x.ok), [false]);
    assertEqual(toFindLines(b, r.state), []);
    const v = validateCollectionChanges([take('Glue', 'She grabs the glue from the shelf')], [], b, r.state, msgs('She grabs the glue from the shelf.'));
    assertEqual(v.rejected.map(x => x.reason), ['not there to be found']);
});

test('the dice decide it is there, the story decides it is taken — and then it is an ordinary kept item', () => {
    const b = pantry(), r = rollTurn(b, inPantry(b), 4, { rand: () => 0.1 });
    const v = validateCollectionChanges([take('Glue', 'She grabs the glue from the shelf')], [], b, r.state, msgs('She grabs the glue from the shelf.', 5));
    assertEqual(v.changes.length, 1);
    const kept = applyCollectionChanges(b, r.state, v.changes, 5);
    assertEqual(toFindLines(b, kept), [], 'taken: no longer "to find"');
    assertEqual(findables(b, kept), []);
    assertEqual(rollTurn(b, kept, 9, roll(1)).rolled.length, 0, 'taken: never rolls again');
});

test('a find line without odds: there whenever the condition holds; other items are not affected', () => {
    const b = pantry({});
    assert(!hasRollsOrTriggers(b), 'nothing to roll');
    assertEqual(toFindLines(b, inPantry(b)), ['TO FIND HERE: Glue']);
    assertEqual(validateCollectionChanges([take('Tape', 'pockets the tape')], [], b, inPantry(b, 'kitchen'), msgs('He pockets the tape.')).changes.length, 1, 'tape has no find line: as before');
});

test('"each new visit" on a find: no glue this time, maybe next time', () => {
    const b = pantry({ odds: 2, retry: 'visit' });
    const r1 = rollTurn(b, inPantry(b), 4, { rand: () => 0.9 });
    const away = rollTurn(b, { ...r1.state, places: { where: 'kitchen' } }, 6, { rand: () => 0.1 });
    const back = rollTurn(b, { ...away.state, places: { where: 'pantry' } }, 8, { rand: () => 0.1 });
    assertEqual(back.rolled.map(x => x.ok), [true]);
    assertEqual(toFindLines(b, back.state), ['TO FIND HERE: Glue']);
    assertEqual(Object.keys(back.state.rolls), [findKey(b.trackers[1], b.trackers[1].items[0], b.trackers[1].items[0].finds[0])]);
});

summary('rolls');
