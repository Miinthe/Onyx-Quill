/**
 * LOCAL PATCH suite — the board's built-in starter templates (Miinthe, 2026-11-02). Each one is written in the board window's
 * format and must come out of the real window → storage translator as a board the board check finds no error in.
 * Failures to avoid: a fork that points at a missing step; a collection that starts its items in the wrong state; a
 * meter without bands; anyone's own story names in a built-in template.
 * Run: npm run test:board-templates
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { STARTER_TEMPLATES } from '../src/board-templates-pure.js';
import { fromWindowBoard } from '../src/board-window-pure.js';
import { checkBoard, freshState } from '../src/board-model-pure.js';

const asBoard = (name, tpl) => fromWindowBoard({ folders: [], applied: [], trackers: JSON.parse(JSON.stringify(tpl.trackers)) }, name);

test('four starter templates, each a full board', () => {
    assertEqual(Object.keys(STARTER_TEMPLATES), ['Slow-burn romance', 'Mystery', 'Fantasy quest', 'Slice of life']);
    for (const [n, t] of Object.entries(STARTER_TEMPLATES)) assert(t.full === true && t.trackers.length >= 4, n);
});

test('each one becomes a stored board with no errors, and a chat can start on it', () => {
    for (const [n, tpl] of Object.entries(STARTER_TEMPLATES)) {
        const b = asBoard(n, tpl);
        assertEqual(b.trackers.length, tpl.trackers.length, `${n}: every tracker survives`);
        const errs = checkBoard(b).filter(x => x.sev === 'error');
        assertEqual(errs.map(e => e.text), [], `${n}: no errors`);
        const st = freshState(b);
        assert(st && Object.keys(st.trackers).length + Object.keys(st.collections).length + Object.keys(st.counters).length > 0, n);
    }
});

test('the forks lead where the draft says', () => {
    const rom = asBoard('r', STARTER_TEMPLATES['Slow-burn romance']).trackers.find(t => t.id === 'rel');
    const conf = rom.steps.find(s => s.name === 'Confession');
    assertEqual(conf.fork.branches.map(b => b.name), ['Says yes', 'Not yet']);
    assertEqual(rom.steps.find(s => s.id === conf.fork.branches[1].then.step).name, 'Something more', 'Not yet → back to Something more');
    const q = asBoard('q', STARTER_TEMPLATES['Fantasy quest']).trackers.find(t => t.id === 'quest');
    const trial = q.steps.find(s => s.name === 'The trial');
    assertEqual(q.steps.find(s => s.id === trial.fork.branches[1].then.step).name, 'The road', 'Failed → back to The road');
});

test('meters, collections, places and dates come out as drafted', () => {
    const r = asBoard('r', STARTER_TEMPLATES['Slow-burn romance']);
    const trust = r.trackers.find(t => t.id === 'trust');
    assertEqual([trust.meter.bands.map(b => b.name), trust.meter.drift, trust.meter.rest], [['Wary', 'Guarded', 'Neutral', 'Open', 'Devoted'], true, 50], 'Trust settles at Neutral');
    assertEqual(r.trackers.find(t => t.id === 'attraction').meter.drift, false, 'Attraction only moves through the story');
    assertEqual(r.trackers.find(t => t.id === 'moments').items.find(i => i.name === 'First kiss').oneWay, true);
    const q = asBoard('q', STARTER_TEMPLATES['Fantasy quest']);
    const pack = q.trackers.find(t => t.id === 'pack');
    assertEqual([pack.states[0].id, pack.amounts, pack.grows, pack.purse[0].start, pack.purse[0].unit], ['have', true, true, 10, 'gold'], 'the pack starts in hand, with 10 gold');
    assertEqual(freshState(q).collections.pack.purse.gold, 10);
    assertEqual(q.trackers.find(t => t.id === 'world').fields.map(f => f.type), ['day', 'cycle', 'choice']);
    const m = asBoard('m', STARTER_TEMPLATES['Mystery']);
    assertEqual(m.trackers.find(t => t.id === 'clues').states[0].id, 'hidden', 'clues start hidden');
    assertEqual(freshState(m).places.where, 'p1', 'the scene starts at the crime');
    const s = asBoard('s', STARTER_TEMPLATES['Slice of life']);
    assertEqual(s.trackers.find(t => t.id === 'calendar').dates.map(d => [d.name, d.due]), [['Moving in', 1], ['A birthday', 10], ['The summer festival', 20]]);
});

test('nothing personal in a built-in template', () => {
    const text = JSON.stringify(STARTER_TEMPLATES).toLowerCase();
    for (const w of ['miinthe', 'corvin', 'dragon', 'toaster', 'kettle', 'spoon', 'lucan', 'mero']) assert(!new RegExp(`\\b${w}\\b`).test(text), w);
});

summary('board-templates');
