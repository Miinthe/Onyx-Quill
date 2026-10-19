/**
 * LOCAL PATCH suite — what the writer gets from entries linked on the board (2026-10-04).
 * Failures to avoid: a ⚖ judge entry reaching the writer; a step's entry available at every step
 * (the old behaviour); a guidance entry sent twice (as lore and as guidance); a paused / waiting /
 * abandoned tracker's entries leaking; a detour's entry without the detour; the helper not told
 * what counts as the next step.
 * Run: npm run test:board-links
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, setRun } from '../src/board-model-pure.js';
import { filterByBoardLinks, boardLinkPins, guidanceLines, stepJudgeSection, judgeTitles, stepLinks, steerLines } from '../src/board-links-pure.js';

const board = () => normalizeBoard({ v: 2, name: 'B', trackers: [
    { id: 'rel', name: 'Relationship', steps: [
        { id: 'str', name: 'Strangers', entries: ['Rel · Strangers'] },
        { id: 'fr', name: 'Friends', entries: ['Rel · Friends', 'How friends act', 'Judge · Friends'], kinds: { 'How friends act': 'guidance', 'Judge · Friends': 'judge' }, pins: { 'Rel · Friends': true },
            detours: [{ id: 'nui', name: 'Nuisance', entries: ['Rel · Nuisance'] }] },
        { id: 'mar', name: 'Married', entries: ['Rel · Married', 'Judge · Married'], kinds: { 'Judge · Married': 'judge' },
            fork: { branches: [{ id: 'happy', name: 'Happy', entries: ['Judge · Happy'], kinds: { 'Judge · Happy': 'judge' } }, { id: 'sad', name: 'Sad' }] } },
    ] },
    { id: 'clues', kind: 'collection', name: 'Clues', grows: true, keep: { entries: ['Judge · Worth keeping'], kinds: { 'Judge · Worth keeping': 'judge' } },
        states: [{ id: 'h', label: 'hidden' }, { id: 'u', label: 'uncovered' }], items: [] },
] });
const E = titles => titles.map(title => ({ title }));
const ALL = E(['Rel · Strangers', 'Rel · Friends', 'How friends act', 'Judge · Friends', 'Rel · Nuisance', 'Rel · Married', 'Judge · Married', 'Judge · Worth keeping', 'Unlinked lore']);
const at = (b, step, extra = {}) => { const st = freshState(b); st.trackers.rel = { at: step, ...extra }; return st; };
const titles = list => list.map(e => e.title);

test('a step\'s context entry exists only while the story is at that step; unlinked lore always', () => {
    const b = board();
    assertEqual(titles(filterByBoardLinks(ALL, b, at(b, 'str'))), ['Rel · Strangers', 'Unlinked lore']);
    assertEqual(titles(filterByBoardLinks(ALL, b, at(b, 'fr'))), ['Rel · Friends', 'Unlinked lore']);
});

test('judge entries never reach the writer — from steps, branches, a collection\'s rules; guidance not as lore', () => {
    const b = board();
    assertEqual([...judgeTitles(b)].sort(), ['judge · friends', 'judge · happy', 'judge · married', 'judge · worth keeping']);
    const out = titles(filterByBoardLinks(ALL, b, at(b, 'mar')));
    assertEqual(out, ['Rel · Married', 'Unlinked lore']);
    assert(!titles(filterByBoardLinks(ALL, b, at(b, 'fr'))).includes('How friends act'), 'guidance comes as GUIDANCE, not as lore');
    assert(titles(filterByBoardLinks(ALL, b, at(b, 'fr'), e => e.title === 'Judge · Friends')).includes('Judge · Friends'), 'pinned in the chat by Miinthe: hers to decide');
});

test('a detour\'s entry only with that detour set; a paused, waiting or abandoned tracker\'s entries are hidden', () => {
    const b = board();
    assert(!titles(filterByBoardLinks(ALL, b, at(b, 'fr'))).includes('Rel · Nuisance'));
    assert(titles(filterByBoardLinks(ALL, b, at(b, 'fr', { aside: 'nui' }))).includes('Rel · Nuisance'));
    assertEqual(titles(filterByBoardLinks(ALL, b, at(b, 'fr', { run: 'paused' }))), ['Unlinked lore']);
    assertEqual(titles(filterByBoardLinks(ALL, b, setRun(b, at(b, 'fr'), b.trackers[0], 'abandoned'))), ['Unlinked lore']);
});

test('📌 pins: a pinned context entry is always given while there; guidance becomes GUIDANCE lines', () => {
    const b = board();
    assertEqual(boardLinkPins(b, at(b, 'fr')), ['Rel · Friends']);
    assertEqual(boardLinkPins(b, at(b, 'str')), []);
    const g = guidanceLines(b, at(b, 'fr'), t => (t === 'How friends act' ? 'They tease each other.\n\nThey share food.' : ''));
    assertEqual(g, ['GUIDANCE (Relationship: Friends): They tease each other. They share food.']);
    assertEqual(guidanceLines(b, at(b, 'str'), () => 'x'), []);
    assertEqual(guidanceLines(b, at(b, 'fr'), () => 'a '.repeat(600))[0].length < 900, true, 'long guidance is cut');
});

test('the helper gets the next step\'s judge rules, a waiting fork\'s ways, and the detours here', () => {
    const b = board();
    const txt = t => ({ 'Judge · Married': 'Only once they say "I do".', 'Judge · Happy': 'Both are content.' })[t] || '';
    const s = stepJudgeSection(b, at(b, 'fr'), txt);
    assert(s.includes('- Relationship → Married: Only once they say "I do".'));
    assert(s.includes('- Relationship at Friends: possible detours (aside) — "Nuisance"'));
    const f = stepJudgeSection(b, at(b, 'mar'), txt);
    assert(f.includes('way "Happy" after Married: Both are content.') && !f.includes('→'));
    assertEqual(stepJudgeSection(b, at(b, 'fr', { run: 'paused' }), txt), '', 'a paused tracker: nothing');
    assertEqual(stepJudgeSection(b, at(b, 'str'), txt), '', 'nothing to say: empty');
});

test('a detour\'s own judge entries reach the helper, and long judge text survives to 2200 characters', () => {
    const b = board();
    const fr = b.trackers[0].steps.find(s => s.id === 'fr');
    const d = fr.detours.find(x => x.name === 'Nuisance');
    d.entries = [...(d.entries || []), 'Judge · Nuisance']; d.kinds = { ...(d.kinds || {}), 'Judge · Nuisance': 'judge' };
    const long = 'w '.repeat(1300);
    const txt = t => ({ 'Judge · Nuisance': 'Only when he treats her as costly friction.', 'Judge · Married': long })[t] || '';
    const s = stepJudgeSection(b, at(b, 'fr'), txt);
    assert(s.includes('- Relationship, aside "Nuisance" (set or clear it): Only when he treats her as costly friction.'), 'detour judge text is given');
    assert(s.includes('possible detours (aside) — "Nuisance"'), 'the detour list stays');
    const line = s.split('\n').find(l => l.startsWith('- Relationship → Married'));
    assert(line.length > 2000 && line.length < 2300, 'judge text kept to about 2200 characters');
});

test('stepLinks lists steps, detours and branches with their kind', () => {
    assertEqual(stepLinks(board()).map(l => `${l.title}:${l.kind}${l.pin ? ':pin' : ''}`), ['Rel · Strangers:context', 'Rel · Friends:context:pin', 'How friends act:guidance', 'Judge · Friends:judge', 'Rel · Nuisance:context', 'Rel · Married:context', 'Judge · Married:judge', 'Judge · Happy:judge']);
});


test('steering: with the board switch on, the writer hears the next step gently; off, at a fork or at the end, nothing', () => {
    const b = board();
    assertEqual(steerLines(b, at(b, 'fr')), [], 'off by default');
    const on = { ...b, steer: true };
    const s = steerLines(on, at(on, 'fr'));
    assertEqual(s.length, 1); assert(s[0].startsWith('HEADING TOWARD (Relationship): Married'), s[0]);
    assert(/don't rush it/i.test(s[0]), 'tells it not to rush');
    assertEqual(steerLines(on, at(on, 'mar')), [], 'waiting at an open fork: no way is named');
    assertEqual(steerLines(on, at(on, 'fr', { run: 'paused' })), [], 'a paused tracker: nothing');
});

summary('board-links');
