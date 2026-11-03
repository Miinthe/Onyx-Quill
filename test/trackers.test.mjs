/**
 * LOCAL PATCH suite — story trackers (2026-10-03).
 *
 * The rules that fail silently if they regress: a tracker that tells the wrong step,
 * a delete or branch leaving it further along than the story, a detour (aside) lost
 * or not rolled back, New Run carrying the old run's position into a fresh story.
 * Trackers TELL (writer and judge); they never filter — nothing here touches gating.
 *
 * Run: npm run test:trackers
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import {
    parseStepsText, parseTrackerSpec, asList, findIndex, newTracker, moveTo, withSteps,
    currentStep, describe, resetForNewRun, stateLines, writerBlock, record, entryAt, pruneAfter,
    storyStepAllows, filterByStoryStep,
} from '../src/trackers-pure.js';

const STEPS = ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married'];

test('steps: one per line, commas and | too; at least two; no duplicates', () => {
    assertEqual(parseStepsText('Strangers\n\n Neighbours \nFriends, Sweethearts | Married').steps.join(','), STEPS.join(','), 'parsed');
    assert(/only one step was read: "Strangers Neighbours"/.test(parseStepsText('Strangers Neighbours').error), 'says what it read');
    assert(/appears twice/.test(parseStepsText('A\nB\na').error), 'duplicate');
    assertEqual(parseStepsText('Consort Candidate\nFated Mate').steps[0], 'Consort Candidate', 'multi-word steps kept');
});

test('command form: Name = steps; name required', () => {
    const r = parseTrackerSpec('Relationship = Strangers, Friends');
    assert(r.ok && r.name === 'Relationship' && r.steps.length === 2, 'parsed');
    assertEqual(parseTrackerSpec('no equals').error, 'usage', 'usage');
    assert(!parseTrackerSpec(' = A, B').ok, 'name required');
});

test('a new tracker starts at step 1, no aside', () => {
    const t = newTracker('Relationship', STEPS);
    assertEqual(currentStep(t), 'Strangers', 'step 1');
    assertEqual(t.aside, null, 'no aside');
    assertEqual(stateLines([t]), 'Relationship: Strangers', 'line');
});

test('moves clamp; journalled one entry per message', () => {
    let t = newTracker('R', STEPS);
    t = moveTo(t, 99, 5);
    assertEqual(t.index, 4, 'clamped high');
    t = moveTo(t, 2, 5);                       // same message: replaces
    t = moveTo(t, -3, 9);
    assertEqual(t.index, 0, 'clamped low');
    assertEqual(JSON.stringify(t.journal.map(e => [e.i, e.index])), '[[0,0],[5,2],[9,0]]', 'journal');
});

test('aside: shown beside the step; without one, plain', () => {
    // setting / clearing a detour is the v2 movers' (engine step 7 — test/engine-characterization.test.mjs)
    const t = { ...moveTo(newTracker('Relationship', STEPS), 2, 4), aside: 'Nuisance' };
    assertEqual(describe(t), 'Friends — currently: Nuisance', 'describe');
    assertEqual(stateLines([t]), 'Relationship: Friends — currently: Nuisance', 'line');
    assertEqual(describe({ ...t, aside: null }), 'Friends', 'plain again');
});

test('moveTo itself keeps the aside (the movers end a detour on another step — engine test)', () => {
    let t = { ...newTracker('R', STEPS), aside: 'Nuisance' };
    t = moveTo(t, 1, 3);
    assertEqual(describe(t), 'Neighbours — currently: Nuisance', 'kept');
});

function played() {
    // Strangers from the start, Neighbours at 10, Friends at 20, Nuisance aside at 25, Sweethearts at 30.
    let t = newTracker('Relationship', STEPS);
    t = moveTo(t, 1, 10);
    t = moveTo(t, 2, 20);
    t = { ...t, aside: 'Nuisance', journal: record(t.journal, 25, t.index, 'Nuisance') };   // a detour set at 25 (as the old setAside journalled it)
    t = moveTo({ ...t, aside: null }, 3, 30);                                                  // on to Sweethearts, the detour over
    return t;
}

test('pruneAfter drops the future; entryAt finds the latest at or before', () => {
    const j = played().journal;
    assertEqual(entryAt(j, 24).index, 2, 'latest before');
    assertEqual(pruneAfter(j, 21).length, 3, 'future gone');
});

test('editing steps keeps the position when the current step survives', () => {
    const t = moveTo(newTracker('R', STEPS), 2, 4);
    assertEqual(currentStep(withSteps(t, ['Strangers', 'Friends', 'Married'])), 'Friends', 'kept');
    assertEqual(withSteps(t, ['A', 'B']).index, 0, 'reset when gone');
});

test('New Run: steps kept, every tracker at step 1, aside cleared, fresh journal', () => {
    const [r] = resetForNewRun([{ ...played(), aside: 'Nuisance' }]);
    assertEqual(r.index, 0, 'step 1');
    assertEqual(r.aside, null, 'no aside');
    assertEqual(r.steps.join(','), STEPS.join(','), 'steps');
    assertEqual(r.journal.length, 1, 'fresh');
});

test('writer block: fact only, empty without trackers', () => {
    const t = moveTo(newTracker('Relationship', STEPS), 2, 1);
    const fuse = newTracker('The Broken Fuse', ['Calm', 'Sparks', 'Repair']);
    assertEqual(writerBlock([t, fuse]), '[Where the story currently stands]\nRelationship: Friends\nThe Broken Fuse: Calm\n[End of story state]', 'block');
    assertEqual(writerBlock([]), '', 'empty clears the prompt');
    assert(!/Sweethearts/.test(writerBlock([t])), 'never names the next step');
});

test('stored data is tolerated when damaged', () => {
    assertEqual(asList(null).length, 0, 'null');
    assertEqual(asList([{ name: 'x' }, { name: 'ok', steps: ['a', 'b'], index: 0 }]).length, 1, 'bad rows skipped');
    assertEqual(findIndex(asList([{ name: 'Relationship', steps: ['a', 'b'] }]), 'relationship'), 0, 'case-insensitive');
    assertEqual(record(undefined, 3, 1).length, 1, 'record from nothing');
});

// ── entries linked to a tracker step (2026-10-03) ──────────────────────────
test('step-linked entries: only the current step exists', () => {
    const rel = moveTo(newTracker('Relationship', ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married']), 2, 0);
    const e = (title, storyStep) => ({ title, storyStep });
    const vault = [
        e('Rung 3 · Friends', { tracker: 'Relationship', steps: ['Friends'] }),
        e('Rung 5 · Married', { tracker: 'Relationship', steps: ['Married'] }),
        e('Together', { tracker: 'relationship', steps: ['Sweethearts', 'Friends'] }),
        e('The Kitchen', null),
        e('Fuse note', { tracker: 'The Broken Fuse', steps: ['Sparks'] }),
        e('Typo', { tracker: 'Relationship', steps: ['Freinds'] }),
    ];
    const kept = filterByStoryStep(vault, [rel]).map(x => x.title);
    assertEqual(kept.join(' | '), 'Rung 3 · Friends | Together | The Kitchen | Fuse note', 'Married + typo gone; unlinked and other-tracker kept');
    assertEqual(filterByStoryStep(vault, [rel], x => x.title === 'Rung 5 · Married').length, 5, 'a pinned entry stays');
    assertEqual(filterByStoryStep(vault, []).length, 6, 'no trackers: nothing filtered');
    assert(storyStepAllows(vault[1], [moveTo(rel, 4, 1)]), 'at Married the Married entry is there');
});

await summary();
