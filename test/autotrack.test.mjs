/**
 * LOCAL PATCH suite — story trackers that follow the story (2026-10-03).
 *
 * A tracker that moves when it should not is the failure here: the story state
 * jumps, the writer and the judge are told something untrue, and nobody asked for
 * it. Covered: the word-for-word quote check (ported from Merged World Tracker,
 * which shipped it untested), every rule a proposed move must pass, the
 * forward-only direction, Undo memory, and reading the helper's answer.
 *
 * Run: npm run test:autotrack
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { findQuoteMatch, normalizeForMatch } from '../src/quote-match-pure.js';
import {
    validateChanges, parseHelperAnswer, describeMove, rememberUndo, buildAutoTrackUser, directionOf,
} from '../src/autotrack-pure.js';
import { newTracker, moveTo } from '../src/trackers-pure.js';

const STEPS = ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married'];
const MSGS = [
    { name: 'Kettle', is_user: false, mes: 'The kettle hums on the counter, *steam curling*.' },
    { name: 'User', is_user: true, mes: '"Hi! I\'m your new neighbour," I say, holding out a plate of toast.' },
];
const rel = (over = {}) => ({ ...newTracker('Relationship', STEPS), ...over });

// ── quote check ────────────────────────────────────────────────────────────

test('quote: exact, and across case, punctuation and emphasis', () => {
    assertEqual(findQuoteMatch("I'm your new neighbour", MSGS), 1, 'exact');
    assertEqual(findQuoteMatch('IM YOUR NEW NEIGHBOUR', MSGS), 1, 'case + apostrophe');
    assertEqual(findQuoteMatch('steam curling', MSGS), -1, 'two words: too short to trust');
    assertEqual(findQuoteMatch('kettle hums on the counter steam curling', MSGS), 0, 'emphasis stripped');
});

test('quote: split by a dialogue tag still matches by word pairs', () => {
    const m = [{ mes: '"We were never friends," she said quietly, "not really, not once."' }];
    assertEqual(findQuoteMatch('we were never friends not really not once', m), 0, 'interposed tag');
});

test('quote: a paraphrase or an invented line is refused', () => {
    assertEqual(findQuoteMatch('I just moved in next door to you', MSGS), -1, 'paraphrase');
    assertEqual(findQuoteMatch('we are getting married tomorrow', MSGS), -1, 'invented');
    assertEqual(findQuoteMatch('', MSGS), -1, 'empty');
});

test('quote: think blocks and HTML are not story', () => {
    const m = [{ mes: '<think>they are now neighbours for sure</think>The kettle says nothing.' }];
    assertEqual(findQuoteMatch('they are now neighbours for sure', m), -1, 'think block ignored');
    assertEqual(normalizeForMatch('  *Hello*,  World! '), 'hello world', 'normalised');
});

// ── rules for a proposed move ──────────────────────────────────────────────

test('a plainly stated change with a real quote is applied', () => {
    const r = validateChanges([{ tracker: 'relationship', step: 'neighbours', quote: "I'm your new neighbour" }], [rel()], MSGS);
    assertEqual(r.moves.length, 1, 'one move');
    assertEqual(r.moves[0].toIndex, 1, 'to Neighbours (case-insensitive names)');
    assertEqual(r.moves[0].name, 'Relationship', 'canonical name');
});

test('no real quote, no move', () => {
    const r = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: 'I live next door now' }], [rel()], MSGS);
    assertEqual(r.moves.length, 0, 'refused');
    assertEqual(r.rejected[0].reason, 'quote not found in the messages', 'reason');
});

test('unknown tracker or step is refused, not guessed', () => {
    const r = validateChanges([
        { tracker: 'Mood', step: 'Happy', quote: "I'm your new neighbour" },
        { tracker: 'Relationship', step: 'Best Friends', quote: "I'm your new neighbour" },
    ], [rel()], MSGS);
    assertEqual(r.moves.length, 0, 'nothing applied');
    assertEqual(r.rejected.map(x => x.reason).join(' | '), 'unknown tracker | "Best Friends" is not one of its steps', 'reasons');
});

test('forward only: a backward move is dropped; both directions allows it', () => {
    const at = { ...moveTo(rel(), 3, 1), skip: true };                 // Sweethearts; skipping allowed — this test is about direction
    const back = [{ tracker: 'Relationship', step: 'Neighbours', quote: "I'm your new neighbour" }];
    assertEqual(validateChanges(back, [{ ...at, direction: 'forward' }], MSGS).rejected[0].reason, 'forward only', 'dropped');
    assertEqual(validateChanges(back, [at], MSGS).moves[0].toIndex, 1, 'both: moves back');
    assertEqual(directionOf({}), 'both', 'default is both');
});

test('no skipping by default: "we\'re married" at Friends is refused and reported', () => {
    const m = [{ mes: "Guess what, we're married now and nobody can tell us otherwise." }];
    const atFriends = moveTo(rel(), 2, 0);
    const r = validateChanges([{ tracker: 'Relationship', step: 'Married', quote: "we're married now and nobody can tell us" }], [atFriends], m);
    assertEqual(r.moves.length, 0, 'not moved');
    assertEqual(r.rejected[0].reason, 'skips steps', 'reason');
    assertEqual(r.rejected[0].skipped.between.join(','), 'Sweethearts', 'names the skipped step');
    assertEqual(r.rejected[0].skipped.from, 'Friends', 'stays at Friends');
});

test('one step is fine; skipping backwards is refused too; skip allowed per tracker', () => {
    const m = [{ mes: "Guess what, we're married now and nobody can tell us otherwise." }];
    const atSweet = moveTo(rel(), 3, 0);
    assertEqual(validateChanges([{ tracker: 'Relationship', step: 'Married', quote: "we're married now and nobody can tell us" }], [atSweet], m).moves[0].toIndex, 4, 'Sweethearts → Married');
    const f = [{ mes: 'We are not friends anymore, we are strangers again.' }];
    assertEqual(validateChanges([{ tracker: 'Relationship', step: 'Strangers', quote: 'we are strangers again' }], [moveTo(rel(), 2, 0)], f).rejected[0].reason, 'skips steps', 'two back refused');
    const skipper = { ...moveTo(rel(), 2, 0), skip: true };
    assertEqual(validateChanges([{ tracker: 'Relationship', step: 'Married', quote: "we're married now and nobody can tell us" }], [skipper], m).moves[0].toIndex, 4, 'allowed when skip is on');
});

test('asides: set, clear, and unchanged when left out', () => {
    const m = [{ mes: 'The kettle declares a feud over the last slice of bread.' }];
    const set = validateChanges([{ tracker: 'Relationship', aside: 'Feud', quote: 'declares a feud over the last slice' }], [rel()], m).moves[0];
    assertEqual(set.toAside, 'Feud', 'set'); assertEqual(set.toIndex, set.fromIndex, 'step unchanged');
    const clear = validateChanges([{ tracker: 'Relationship', aside: '', quote: 'declares a feud over the last slice' }], [rel({ aside: 'Feud' })], m).moves[0];
    assertEqual(clear.toAside, null, 'cleared');
    const none = validateChanges([{ tracker: 'Relationship', step: 'Strangers', quote: 'declares a feud over the last slice' }], [rel({ aside: 'Feud' })], m);
    assertEqual(none.rejected[0].reason, 'no change', 'same step, aside left out: nothing to do');
});

test('one change per tracker: the one quoted from the NEWEST message wins', () => {
    const msgs = [
        { mes: 'I mean it. We are not friends anymore. From now on we are strangers again.' },
        { mes: 'The kettle goes cold.' },
        { mes: 'I changed my mind. Lets make up and be good neighbors again' },
    ];
    // Miinthe's real case (2026-10-03): the helper re-reported the old fight next to the new line.
    const atFriends = { ...moveTo(rel(), 2, 1), skip: true };   // this test is about which line wins, not skipping
    const r = validateChanges([
        { tracker: 'Relationship', step: 'Strangers', quote: 'We are not friends anymore. From now on we are strangers again.' },
        { tracker: 'Relationship', step: 'Neighbours', quote: 'Lets make up and be good neighbors again' },
    ], [atFriends], msgs);
    assertEqual(r.moves.length, 1, 'one move');
    assertEqual(r.moves[0].toIndex, 1, 'the newest line wins: Neighbours, not Strangers');
    // and in the other order the old line still loses
    const r2 = validateChanges([
        { tracker: 'Relationship', step: 'Neighbours', quote: 'Lets make up and be good neighbors again' },
        { tracker: 'Relationship', step: 'Strangers', quote: 'We are not friends anymore. From now on we are strangers again.' },
    ], [atFriends], msgs);
    assertEqual(r2.moves[0].toIndex, 1, 'order does not matter');
});

test('reason and confidence travel with the move (native DeepLore style)', () => {
    const r = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: "I'm your new neighbour", reason: 'Moving in next door plainly makes them neighbours.', confidence: 'HIGH' }], [rel()], MSGS);
    assertEqual(r.moves[0].reason, 'Moving in next door plainly makes them neighbours.', 'reason');
    assertEqual(r.moves[0].confidence, 'high', 'confidence normalised');
    const r2 = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: "I'm your new neighbour", confidence: 'certain' }], [rel()], MSGS);
    assertEqual(r2.moves[0].confidence, null, 'unknown confidence dropped');
});

test('a line older than the tracker\'s last move cannot move it again', () => {
    const msgs = [
        { mes: 'I kiss the toaster on its crumb tray. From now on we are sweethearts.', _i: 10 },
        { mes: 'The kettle hums.', _i: 11 },
        { mes: 'Another quiet afternoon in the kitchen.', _i: 12 },
    ];
    const handBack = moveTo(moveTo(rel(), 3, 10), 2, 11);          // moved to Sweethearts at 10, by hand back to Friends at 11
    const r = validateChanges([{ tracker: 'Relationship', step: 'Sweethearts', quote: 'From now on we are sweethearts.' }], [handBack], msgs);
    assertEqual(r.moves.length, 0, 'not re-applied');
    assertEqual(r.rejected[0].reason, 'older than its last move', 'reason');
    const fresh = [...msgs, { mes: 'We are sweethearts again, truly.', _i: 13 }];
    assertEqual(validateChanges([{ tracker: 'Relationship', step: 'Sweethearts', quote: 'We are sweethearts again, truly.' }], [handBack], fresh).moves.length, 1, 'a newer line still works');
});

test('undo is remembered: the same line does not re-apply the same move', () => {
    const move = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: "I'm your new neighbour" }], [rel()], MSGS).moves[0];
    const t = rel({ undone: rememberUndo([], move) });
    const again = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: "i'm your NEW neighbour!" }], [t], MSGS);
    assertEqual(again.rejected[0].reason, 'undone before from this line', 'not re-applied');
    assertEqual(rememberUndo(Array(25).fill({ quote: 'x', toIndex: 0 }), move).length, 20, 'memory capped');
});

// ── reading the helper ─────────────────────────────────────────────────────

test('helper answer: JSON, fenced JSON, JSON in prose, junk', () => {
    assertEqual(parseHelperAnswer('{"changes":[{"tracker":"R","quote":"x"}]}').length, 1, 'plain');
    assertEqual(parseHelperAnswer('```json\n{"changes":[]}\n```').length, 0, 'fenced empty');
    assertEqual(parseHelperAnswer('Sure! {"changes":[{"tracker":"R","quote":"x"}]} Hope that helps').length, 1, 'in prose');
    assertEqual(parseHelperAnswer('no idea').length, 0, 'junk = no changes');
    assertEqual(parseHelperAnswer(null).length, 0, 'null');
});

test('prompt lists each tracker with its direction, steps and current step', () => {
    const u = buildAutoTrackUser([moveTo(rel({ direction: 'forward' }), 2, 0), newTracker('The Broken Fuse', ['Calm', 'Sparks'])], MSGS);
    assert(u.includes('Relationship (forward only): current step "Friends"'), 'relationship line');
    assert(u.includes('The Broken Fuse (can move both ways): current step "Calm"'), 'fuse line');
    assert(u.includes("User: \"Hi! I'm your new neighbour,\""), 'messages included');
});

test('notice text', () => {
    const t = rel();
    assertEqual(describeMove(t, { name: 'Relationship', fromIndex: 0, toIndex: 1, fromAside: null, toAside: null }), 'Relationship: Strangers → Neighbours', 'move');
    assertEqual(describeMove(t, { name: 'Relationship', fromIndex: 0, toIndex: 0, fromAside: null, toAside: 'Feud' }), 'Relationship: detour: Feud', 'aside');
});

await summary();
