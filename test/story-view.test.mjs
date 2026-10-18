/**
 * Overhaul — the side panel's Story tab: its plain rules (src/panel/story-pure.js).
 * Failures to avoid: a card that says the wrong step or count, a waiting tracker shown as on step 1, notes that lose
 * today's Undo / fork branches / detour, the Changes fold reading "Undo" as a change, an edit that saves one step.
 * Run: npm run test:story-view
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { standing, isQuiet, cardNotes, directionLabel, boardSummary, plain, changeRow, changesSummary, groupLabel, checkEdit } from '../src/panel/story-pure.js';

const T = (o = {}) => ({ name: 'Relationship', steps: ['Strangers', 'Rivals', 'Friends', 'Sweethearts', 'Married'], index: 2, state: 'running', ...o });

test('standing: step, count, pips, ends', () => {
    const s = standing(T());
    assertEqual([s.index, s.step, s.count, s.cur], [2, 3, 5, 'Friends'], 'third of five');
    assertEqual(s.pips, [true, true, true, false, false], 'three pips filled');
    assertEqual([s.first, s.last], [false, false], 'neither end');
    assertEqual([standing(T({ index: 0 })).first, standing(T({ index: 4 })).last], [true, true], 'ends found');
    assertEqual(standing(T({ index: 99 })).index, 4, 'clamped high');
    assertEqual(standing(T({ index: -3 })).index, 0, 'clamped low');
    const w = standing(T({ state: 'waiting', index: 0 }));
    assertEqual([w.step, w.cur, w.pips.filter(Boolean).length], [0, 'Waiting', 0], 'waiting shows no step');
    assertEqual(standing({}).count, 0, 'no steps: no crash');
});

test('isQuiet: only running trackers are bright', () => {
    assert(!isQuiet(T()), 'running');
    assert(isQuiet(T({ state: 'waiting' })), 'waiting');
    assert(isQuiet(T({ state: 'paused' })), 'paused');
    assert(isQuiet(T({ state: undefined, run: 'abandoned' })), 'abandoned (old list)');
    assert(isQuiet(T({ ended: { branch: 'Breakup', step: 'Friends' } })), 'ended');
});

test('cardNotes: what today showed, one line each', () => {
    const kinds = t => cardNotes(t).map(n => n.kind);
    assertEqual(cardNotes(T()), [], 'nothing to say');
    const a = cardNotes(T({ lastAuto: { quote: 'I think we’re friends now', message: 30 } }));
    assertEqual([a[0].kind, a[0].undo], ['auto', 'auto'], 'automatic move keeps Undo');
    assert(a[0].text.includes('friends now') && a[0].text.includes('#30'), 'quote and message');
    assertEqual(kinds(T({ aside: 'Nuisance' })), ['aside'], 'detour');
    assert(cardNotes(T({ aside: 'Nuisance' }))[0].text.includes('Nuisance'), 'detour named');
    const p = cardNotes(T({ run: 'paused', state: 'paused', lastRun: { action: 'pause' } }));
    assertEqual([p[0].kind, p[0].undo], ['run', 'run'], 'paused by you, with Undo');
    assertEqual(cardNotes(T({ run: 'paused', state: 'paused' }))[0].undo, undefined, 'no Undo without a last pause');
    assertEqual(cardNotes(T({ lastRun: { action: 'reactivate' } }))[0].undo, 'run', 'reactivate keeps its Undo');
    assertEqual(cardNotes(T({ lastRun: { action: 'continue' } }))[0].undo, 'run', 'continue keeps its Undo');
    const w = cardNotes(T({ state: 'waiting', starts: [{ tracker: 'X', step: 'Sweethearts' }] }), { cond: c => `X reaches ${c.step}` });
    assertEqual(w[0].text, 'Starts when X reaches Sweethearts.', 'waiting says why');
    assertEqual(cardNotes(T({ state: 'paused', pausedWhy: 'another holds the floor' }))[0].text, 'Paused: another holds the floor.', 'paused by a block');
    const f = cardNotes(T(), { fork: { step: 'Friends', fork: { by: 'story', branches: [{ name: 'Love' }, { name: 'Rivals again' }] } } });
    assertEqual([f[0].kind, f[0].branches], ['fork', ['Love', 'Rivals again']], 'fork branches to pick');
    assertEqual(kinds(T({ took: { Friends: 'Love' } })), ['took'], 'decided forks as a quiet line');
    assertEqual(kinds(T({ ended: { branch: 'Breakup', step: 'Friends' } })), ['ended'], 'ended');
    assertEqual(cardNotes(null), [], 'no tracker: no crash');
});

test('labels and summaries', () => {
    assertEqual([directionLabel('forward'), directionLabel('both'), directionLabel()], ['Forward only', 'Both ways', 'Both ways'], 'direction');
    assertEqual(boardSummary(['Day 3', null, '📍 Kitchen']), 'Day 3 · 📍 Kitchen', 'board summary');
    assertEqual(boardSummary([]), 'no places, time or collections', 'empty board');
    assertEqual([groupLabel(34), groupLabel(-1), groupLabel(undefined)], ['Message #34', 'Earlier', 'Earlier'], 'group labels');
});

test('changes: a notice as a row, without its Undo', () => {
    assertEqual(plain('a &amp; b<br><i>“quote”</i>'), ['a & b', '“quote”'], 'plain lines');
    const r = changeRow({ title: 'Story tracker', html: 'Relationship moved to Friends<br>“I think we’re friends now”<br><u>Undo</u>' });
    assertEqual(r, { title: 'Relationship moved to Friends', sub: '“I think we’re friends now”' }, 'title + quote, Undo gone');
    assertEqual(changeRow({ title: 'Storyboard', html: 'Kitchen: Tape kept. <u>Undo</u>' }), { title: 'Kitchen: Tape kept.', sub: 'Storyboard' }, 'inline Undo gone, source as sub');
    assertEqual(changeRow({ title: 'X', html: '' }).title, 'X', 'empty html falls back to the title');
    const g = [{ i: 34, items: [{ html: 'A' }, { html: 'B moved' }] }, { i: 30, items: [{ html: 'C' }] }];
    assertEqual(changesSummary(g), { count: 3, summary: 'B moved' }, 'count all, newest last of newest message');
    assertEqual(changesSummary([]), { count: 0, summary: 'nothing yet in this chat' }, 'empty');
});

test('checkEdit: the same rules as today’s form', () => {
    assertEqual(checkEdit({ name: ' Bond ', steps: ['A', ' B ', ''] }), { ok: true, name: 'Bond', steps: ['A', 'B'] }, 'trimmed');
    assert(checkEdit({ name: '', steps: ['A', 'B'] }).error, 'needs a name');
    assert(checkEdit({ name: 'Bond', steps: ['A'] }).error, 'needs two steps');
    assert(checkEdit({ name: 'Bond', steps: ['A', 'a'] }).error, 'no step twice');
    assert(checkEdit({ name: 'secret', steps: ['A', 'B'], others: ['Secret', 'Bond'], was: 'Bond' }).error, 'name taken by another');
    assert(checkEdit({ name: 'Bond', steps: ['A', 'B'], others: ['Bond'], was: 'Bond' }).ok, 'keeping its own name is fine');
});

await summary();
