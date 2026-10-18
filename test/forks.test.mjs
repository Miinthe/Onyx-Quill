/**
 * LOCAL PATCH suite — forks in play (2026-10-05, storyboard stage 3 round 1).
 * Failures to avoid: a tracker walking past an undecided fork; a branch that doesn't do
 * what its "afterwards" says; a roll that ignores the weights; a line waiting for a branch
 * that never (or always) holds; a delete that leaves a branch standing; the helper's branch
 * accepted when the tracker isn't at that fork; open branches told to the writer; branch
 * entries showing before their branch.
 * Run: npm run test:forks
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import {
    forkAtStep, pendingFork, forkInTheWay, branchHolds, branchText,
    unbranchAfter, filterByBranch, describeTake, thenKind,
} from '../src/forks-pure.js';
import { newTracker, moveTo, stateLines } from '../src/trackers-pure.js';
import { unmetNeeds, conditionText } from '../src/conditions-pure.js';
import { validateChanges, buildAutoTrackUser } from '../src/autotrack-pure.js';
import { defOf, mergeBoard } from '../src/storyboard-pure.js';
import { normalizeBoard, freshState, toEngineList, fromEngineList } from '../src/board-model-pure.js';

const rel = () => ({ ...newTracker('Relationship', ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married']), id: 'rel',
    forks: { Friends: { by: 'story', branches: [{ name: 'Confesses' }, { name: 'Chickens out', then: { kind: 'back', step: 'Neighbours' } }] } } });
const fuse = () => ({ ...newTracker('The Broken Fuse', ['Calm', 'Sparks', 'Repair']), id: 'fuse',
    forks: { Repair: { by: 'roll', branches: [{ name: 'Success', entries: ['Fuse · Fixed for good'] }, { name: 'Fail', weight: 2, then: { kind: 'next', tracker: 'secret' } }] } } });
const secret = () => ({ ...newTracker("Kettle's Secret", ['Hidden', 'Revealed']), id: 'secret', starts: [{ tracker: 'fuse', at: 'Repair', branch: 'Fail' }] });
const at = (t, k) => moveTo(t, k, 1);
// a branch already taken (engine step 7: taking it is the v2 engine's — test/engine-characterization.test.mjs)
const took = (t, k, step, branch, more = {}) => ({ ...at(t, k), took: { ...(t.took || {}), [step]: branch }, branchLog: [{ step, branch, i: 5 }], ...more });
const fixed = () => took(fuse(), 2, 'Repair', 'Success', { ended: { step: 'Repair', branch: 'Success', i: 5 } });

test('a tracker on a step with a fork waits there', () => {
    const t = at(rel(), 2);
    assertEqual(pendingFork(t).step, 'Friends');
    assertEqual(pendingFork(at(rel(), 1)), null, 'no fork on Neighbours');
    assertEqual(forkInTheWay(at(rel(), 1), 1, 3), 'Friends', 'a jump over Friends passes the fork');
    assertEqual(forkInTheWay(at(rel(), 1), 1, 2), null, 'arriving on Friends is fine');
    assertEqual(forkAtStep(rel(), 'friends').by, 'story', 'step names case-insensitive');
});

test('lines waiting for a branch: how they read, and needs', () => {
    const list = [at(fuse(), 2), secret()];
    assertEqual(conditionText(secret().starts[0], list), 'The Broken Fuse ends in Fail');
    assertEqual(branchText({ tracker: 'rel', at: 'Friends', branch: 'Confesses' }, [rel()]), 'Relationship takes “Confesses” after Friends');
    const r2 = { ...at(rel(), 3), needs: [{ step: 'Married', tracker: 'fuse', at: 'Repair', branch: 'Success' }] };
    assertEqual(unmetNeeds(r2, 4, [r2, at(fuse(), 2)]).length, 1, 'Married needs the repair to succeed');
    assertEqual(unmetNeeds(r2, 4, [r2, fixed()]).length, 0);
});

test('the helper: told about a story fork, its branch accepted, a move past it refused', () => {
    const msgs = [{ mes: 'I have to tell you something. I love you.', _i: 10 }];
    const t = at(rel(), 2);
    assert(buildAutoTrackUser([t], msgs).includes('WAITS AT A FORK after "Friends" — the story goes one of these ways: "Confesses", "Chickens out"'));
    assert(!buildAutoTrackUser([at(fuse(), 2)], msgs).includes('WAITS AT A FORK'), 'a roll fork is not asked about');
    const ok = validateChanges([{ tracker: 'Relationship', step: null, branch: 'confesses', quote: 'I love you', reason: 'a confession', confidence: 'high' }], [t], msgs);
    assertEqual(ok.moves.map(m => [m.branch, m.step]), [['Confesses', 'Friends']]);
    const past = validateChanges([{ tracker: 'Relationship', step: 'Sweethearts', quote: 'I love you' }], [t], msgs);
    assertEqual([past.moves.length, past.rejected[0].reason], [0, 'waits at a fork']);
    const wrong = validateChanges([{ tracker: 'Relationship', branch: 'Elopes', quote: 'I love you' }], [t], msgs);
    assertEqual(wrong.moves.length, 0);
    const notThere = validateChanges([{ tracker: 'Relationship', branch: 'Confesses', quote: 'I love you' }], [at(rel(), 1)], msgs);
    assertEqual(notThere.rejected[0].reason, 'not waiting at a fork');
    const undone = validateChanges([{ tracker: 'Relationship', branch: 'Confesses', quote: 'I love you' }], [{ ...t, undone: [{ quote: 'I love you', branch: 'Confesses' }] }], msgs);
    assertEqual(undone.rejected[0].reason, 'undone before from this line');
    const back = validateChanges([{ tracker: 'Relationship', step: 'Neighbours', quote: 'I love you' }], [t], msgs);
    assertEqual(back.moves.length, 1, 'moving back from a fork is fine');
});

test('the writer hears the branches taken, never the open ones', () => {
    assertEqual(stateLines([at(rel(), 2)]), 'Relationship: Friends');
    assertEqual(stateLines([took(rel(), 3, 'Friends', 'Confesses')]), 'Relationship: Sweethearts (after Friends: Confesses)');
    assertEqual(stateLines([fixed()]), 'The Broken Fuse: Repair (ended — Success)');
});

test('branch entries exist only once their branch is taken', () => {
    const entries = [{ title: 'Fuse · Fixed for good' }, { title: 'Something else' }];
    assertEqual(filterByBranch(entries, [at(fuse(), 2)]).map(e => e.title), ['Something else']);
    const done = [fixed()];
    assertEqual(filterByBranch(entries, done).length, 2);
    assertEqual(filterByBranch(entries, [at(fuse(), 2)], e => e.title.startsWith('Fuse')).length, 2, 'pinned stays');
    assertEqual(filterByBranch(entries, done, () => false, () => false).length, 1, 'a paused tracker hides it');
});

test('board: forks are definitions (defOf / mergeBoard), took is the chat\'s', () => {
    const def = defOf(rel());
    assertEqual(Object.keys(def.forks), ['Friends']);
    const chatCopy = { ...took(rel(), 3, 'Friends', 'Confesses'), forks: { Old: {} } };
    const { list } = mergeBoard({ trackers: [def] }, [chatCopy], newTracker);
    assertEqual(Object.keys(list[0].forks), ['Friends'], "the board's forks win");
    assertEqual(list[0].took, { Friends: 'Confesses' }, "the chat's choice stays");
});

test('v2 board ⇄ engine list: forks, choices and branch lines survive', () => {
    const b = normalizeBoard({ v: 2, name: 'T', trackers: [
        { id: 'rel', name: 'Relationship', steps: [{ id: 'fr', name: 'Friends', fork: { branches: [{ id: 'conf', name: 'Confesses' }, { id: 'out', name: 'Chickens out', then: { kind: 'back', step: 'fr' } }] } }, { id: 'sw', name: 'Sweethearts' }] },
        { id: 'fuse', name: 'Fuse', steps: [{ id: 'a', name: 'Calm' }, { id: 'rep', name: 'Repair', fork: { by: 'roll', branches: [{ id: 'ok', name: 'Success', entries: ['Fixed'] }, { id: 'no', name: 'Fail', weight: 2, then: { kind: 'next', tracker: 'sec' } }] } }] },
        { id: 'sec', name: 'Secret', starts: [{ tracker: 'fuse', at: 'rep', branch: 'no' }], steps: [{ id: 'h', name: 'Hidden', needs: [{ tracker: 'rel', at: 'fr', branch: 'conf' }] }, { id: 'r', name: 'Revealed' }] },
    ] });
    const st = freshState(b); st.trackers.rel = { at: 'sw', forks: { fr: 'conf' } };
    const list = toEngineList(b, st);
    assertEqual(list[0].forks.Friends.branches[1].then, { kind: 'back', step: 'Friends' });
    assertEqual(list[1].forks.Repair, { by: 'roll', branches: [{ name: 'Success', entries: ['Fixed'] }, { name: 'Fail', weight: 2, then: { kind: 'next', tracker: 'sec' } }] });
    assertEqual(list[0].took, { Friends: 'Confesses' });
    assertEqual(list[2].starts, [{ tracker: 'fuse', at: 'Repair', branch: 'Fail' }]);
    assertEqual(list[2].needs, [{ step: 'Hidden', tracker: 'rel', at: 'Friends', branch: 'Confesses' }]);
    const back = fromEngineList(b, freshState(b), [{ ...list[0], took: { Friends: 'Chickens out' } }]);
    assertEqual(back.trackers.rel.forks, { fr: 'out' });
});

summary('forks');
