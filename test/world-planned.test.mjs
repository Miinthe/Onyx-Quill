/**
 * World layer — planned messages suite (src/world/planned-pure.js, stage 3, 2026-10-19).
 * Failures to avoid: a planned message firing twice in a chat; one firing before its moment; one the story skipped past
 * never arriving; a missed chance being rolled again on every check; a plan without a sender going out; a broken plan
 * throwing; the board losing its plans on save.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normPlan, normPlans, duePlans, firedOf, plannedPrompt, whenText } from '../src/world/planned-pure.js';
import { emptyStore, addRecord, normWorld } from '../src/world/world-pure.js';
import { normalizeBoard, BOARD_VERSION } from '../src/board-model-pure.js';

const BOARD = normalizeBoard({ v: BOARD_VERSION, name: 'T', trackers: [
    { id: 'tm', kind: 'state', name: 'Time', fields: [{ id: 'd', type: 'day', name: 'Day', start: 1 }] },
    { id: 'fu', kind: 'steps', name: 'Fuse plot', steps: [{ id: 's1', name: 'Calm' }, { id: 's2', name: 'Caught' }] },
    { id: 'c1', kind: 'cast', name: 'Cast', people: [{ id: 'k', name: 'Kettle' }] },
] });
const plan = (id, cond, extra = {}) => ({ id, from: 'c1:k', to: 'user', cond, words: 'note', text: 'apologize', ...extra });

test('plans are repaired; unusable ones dropped', () => {
    assertEqual(normPlan({ from: 'x' }), null);
    assertEqual(normPlan(plan('a', { world: 'tm', field: 'd', min: 3 })).cond, { world: 'tm', field: 'd', min: 3 });
    assertEqual(normPlan(plan('a', null)).cond, null);
    assertEqual(normPlan({ id: 'b', words: 'mine', odds: 3 }).words, 'mine');
    assertEqual(normPlans([plan('a', {}), 'x', null]).length, 1);
    assertEqual(normWorld({ planned: [plan('a', {}), { no: 'id' }] }).planned.length, 1);
});

test('due: on its day or later (late is fine), once per chat', () => {
    const plans = [plan('p3', { world: 'tm', field: 'd', min: 3 })];
    assertEqual(duePlans(BOARD, { states: { tm: { day: 2, vals: {} } } }, plans, emptyStore()).length, 0);
    assertEqual(duePlans(BOARD, { states: { tm: { day: 3, vals: {} } } }, plans, emptyStore()).map(x => x.plan.id), ['p3']);
    assertEqual(duePlans(BOARD, { states: { tm: { day: 5, vals: {} } } }, plans, emptyStore()).length, 1);
    const fired = addRecord(emptyStore(), { kind: 'fired', plan: 'p3', auto: true }, 4);
    assertEqual(duePlans(BOARD, { states: { tm: { day: 5, vals: {} } } }, plans, fired).length, 0);
    assertEqual(firedOf(fired).has('p3'), true);
});

test('due: a tracker step, someone in the scene; no sender → never', () => {
    const st = { trackers: { fu: { step: 's2' } }, cast: { c1: { k: { here: true } } } };
    const due = duePlans(BOARD, st, [plan('a', { cast: 'c1', person: 'k' }), plan('b', { cast: 'c1', person: 'k' }, { from: '' })], emptyStore());
    assertEqual(due.map(x => x.plan.id), ['a']);
});

test('two conditions: both must hold; a second one picked but not set never fires', () => {
    const st = { states: { tm: { day: 3, vals: {} } }, cast: { c1: { k: { here: false } } } };
    const both = plan('b', { world: 'tm', field: 'd', min: 3 }, { cond2: { cast: 'c1', person: 'k' } });
    assertEqual(duePlans(BOARD, st, [both], emptyStore()).length, 0);
    assertEqual(duePlans(BOARD, { ...st, cast: { c1: { k: { here: true } } } }, [both], emptyStore()).length, 1);
    assertEqual(duePlans(BOARD, st, [plan('c', { world: 'tm', field: 'd', min: 3 }, { cond2: null })], emptyStore()).length, 0);
    assertEqual('cond2' in normPlan(plan('d', null)), false);
});

test('a chance: rolled once', () => {
    const st = { states: { tm: { day: 3, vals: {} } } };
    const plans = [plan('p', { world: 'tm', field: 'd', min: 1 }, { odds: 3 })];
    assertEqual(duePlans(BOARD, st, plans, emptyStore(), () => 0.9)[0].hit, false);
    assertEqual(duePlans(BOARD, st, plans, emptyStore(), () => 0.1)[0].hit, true);
});

test('prompt and words for the board', () => {
    const p = plannedPrompt({ name: 'Kettle', toName: 'Miinthe', note: 'apologize for the smell, admit nothing', look: 'letters', now: { knows: [{ fact: 'the fuse was taped' }] } });
    assert(p.system.includes("don't copy it") && p.system.includes('letter') && p.system.includes('the fuse was taped'), 'prompt');
    assertEqual(whenText(BOARD, { world: 'tm', field: 'd', min: 3 }), 'on Day 3 or later');
    assertEqual(whenText(BOARD, { tracker: 'fu', step: 's2' }), 'when Fuse plot reaches Caught');
    assertEqual(whenText(BOARD, { cast: 'c1', person: 'k' }), 'when Kettle is in the scene');
    assertEqual(whenText(BOARD, null), 'not set yet');
});

test('a saved board keeps its plans', () => {
    const b = normalizeBoard({ v: BOARD_VERSION, name: 'T', trackers: [], world: { on: true, planned: [plan('a', { world: 'tm', field: 'd', min: 3 })] } });
    assertEqual(b.world.planned[0].id, 'a');
});

test('muted: a planned message to {{user}} waits; to someone else it goes', () => {
    const st = { states: { tm: { day: 3, vals: {} } } };
    const plans = [plan('toYou', { world: 'tm', field: 'd', min: 1 }), plan('toSpoon', { world: 'tm', field: 'd', min: 1 }, { to: 'c1:s' })];
    assertEqual(duePlans(BOARD, st, plans, emptyStore(), Math.random, k => k === 'c1:k').map(x => x.plan.id), ['toSpoon']);
    assertEqual(duePlans(BOARD, st, plans, emptyStore()).length, 2);
});

test('planned posts and news', () => {
    assertEqual(normPlan({ id: 'n', kind: 'news', from: 'v:gz' }).kind, 'news');
    assertEqual(normPlan({ id: 'n', kind: 'tweet' }).kind, 'msg');
    const st = { states: { tm: { day: 3, vals: {} } } };
    assertEqual(duePlans(BOARD, st, [plan('n', { world: 'tm', field: 'd', min: 1 }, { kind: 'news', to: '' })], emptyStore(), Math.random, k => k === 'c1:k').length, 0);
    assert(plannedPrompt({ name: 'The Gazette', note: 'the fuse was taped', kind: 'news' }).system.includes('headline'), 'news: a headline');
});

summary();
