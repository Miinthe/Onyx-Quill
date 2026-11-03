/**
 * Overhaul — the side panel's Filters tab (src/panel/filters-pure.js).
 * Failures to avoid: a set value hidden with the unused fields; the "leaves out N" counts drifting from today's rule;
 * removing the last chat folder leaving [] instead of null; a group chat offering character switches.
 * Run: npm run test:filters-view
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { setCommandFor, valuesOf, leftOutByField, fieldRows, fieldsSummary, withoutValue, withoutFolder, folderLeaf, leftOutByFolders, cardModel } from '../src/panel/filters-pure.js';

const on = { enabled: true };
const DEFS = [
    { name: 'era', label: 'Era', multi: true, gating: on, values: [], contextKey: 'era' },
    { name: 'character', label: 'Character', multi: false, gating: on, values: [], contextKey: 'character' },
    { name: 'instance', label: 'Instance', multi: true, gating: on, values: [], contextKey: 'instance' },
    { name: 'mood', label: 'Mood', multi: false, gating: on, values: ['calm', 'tense'], contextKey: 'mood' },
    { name: 'off', label: 'Off', multi: false, gating: { enabled: false }, values: [], contextKey: 'off' },
];
const ENTRIES = [
    { folderPath: 'Kitchen', customFields: { character: 'Kettle', instance: ['a'] } },
    { folderPath: 'Kitchen/Run A', customFields: { character: 'Spoon', instance: ['b'] } },
    { folderPath: 'Places', customFields: { mood: 'calm' } },
    { folderPath: '', customFields: {} },
];

test('commands and values', () => {
    assertEqual(setCommandFor('era'), '/oq-set-era', 'built-in');
    assertEqual(setCommandFor('character'), '/oq-set-field character', 'custom');
    assertEqual(valuesOf(DEFS[0], { era: ['past', ''] }), ['past'], 'list');
    assertEqual(valuesOf(DEFS[1], { character: 'Kettle' }), ['Kettle'], 'single');
    assertEqual(valuesOf(DEFS[1], { character: '' }), [], 'empty');
    assertEqual(valuesOf(DEFS[1], null), [], 'no context');
});

test('leaves out: same rule as today', () => {
    assertEqual(leftOutByField(DEFS[1], { character: 'kettle' }, ENTRIES), 1, 'Spoon left out, case-insensitive; entries without the field stay');
    assertEqual(leftOutByField(DEFS[2], { instance: ['a', 'b'] }, ENTRIES), 0, 'any overlap keeps it');
    assertEqual(leftOutByField(DEFS[2], {}, ENTRIES), 0, 'nothing set');
});

test('field rows: unused hidden unless set or asked', () => {
    const r = fieldRows(DEFS, ENTRIES, { era: ['past'] }, false);
    assertEqual(r.rows.map(x => x.name), ['era', 'character', 'instance', 'mood'], 'era shown because it is set; disabled field never');
    assertEqual(r.hidden, 0, 'nothing hidden');
    const r2 = fieldRows(DEFS, ENTRIES, {}, false);
    assertEqual(r2.rows.map(x => x.name), ['character', 'instance', 'mood'], 'unused era hidden');
    assertEqual(r2.hidden, 1, 'one hidden');
    assertEqual(fieldRows(DEFS, ENTRIES, {}, true).rows.length, 4, 'show all');
    assertEqual(r.rows.find(x => x.name === 'mood').choices, ['calm', 'tense'], 'fixed single field gets a dropdown');
    assertEqual(r.rows.find(x => x.name === 'era').choices, null, 'list field: today’s window');
    assertEqual(r.set, 1, 'count set');
});

test('summary', () => {
    const r = fieldRows(DEFS, ENTRIES, { character: 'Kettle', instance: ['a'] }, false).rows;
    assertEqual(fieldsSummary(r), 'Character: Kettle · Instance: a', 'set ones only');
    assertEqual(fieldsSummary([]), 'nothing set', 'none');
});

test('removing', () => {
    assertEqual(withoutValue(DEFS[0], ['a', 'b'], 'a'), ['b'], 'list');
    assertEqual(withoutValue(DEFS[1], 'Kettle', 'Kettle'), null, 'single clears');
    assertEqual(withoutFolder(['A', 'B'], 'A'), ['B'], 'one left');
    assertEqual(withoutFolder(['A'], 'A'), null, 'none left = null, as today');
});

test('folders', () => {
    assertEqual(folderLeaf('Characters/Kettle/'), 'Kettle', 'leaf');
    assertEqual(folderLeaf('Kitchen'), 'Kitchen', 'top');
    assertEqual(leftOutByFolders(ENTRIES, ['Kitchen']), 1, 'Places out, subfolder in, root entry in');
    assertEqual(leftOutByFolders(ENTRIES, []), 0, 'no folders, nothing left out');
});

test('card', () => {
    const st = { character: { key: 'k.png', name: 'Kettle' }, run: 'a', own: ['Extra'], chatSwitch: null, on: true, why: "reads Kettle's folders",
        setup: { folders: ['Characters/Kettle'], runs: { a: { folders: ['Kitchen/Run A'] } } }, folders: ['Characters/Kettle', 'Kitchen/Run A', 'Extra'] };
    const m = cardModel(st);
    assertEqual(m.rows.map(r => [r.key, r.label, r.folders]), [['base', 'Base folders', ['Characters/Kettle']], ['run', 'Run A adds', ['Kitchen/Run A']], ['own', 'This chat adds', ['Extra']]], 'three lines');
    assertEqual(m.chatSwitch, 'follow', 'unset = follow');
    assertEqual(m.switchOptions.map(o => o[1]), ['like Kettle', 'always on', 'off'], 'mock-up words');
    assertEqual(m.charOn, true, 'character on');
    assertEqual(cardModel({ ...st, run: '', setup: { folders: [], runs: {}, on: false } }).rows.map(r => r.key), ['base', 'own'], 'no run line without a run');
    assertEqual(cardModel({ ...st, setup: { on: false } }).charOn, false, 'character off');
    const g = cardModel({ character: null, own: [], chatSwitch: 'off', on: false });
    assertEqual([g.group, g.title, g.rows.map(r => r.key), g.switchOptions, g.chatSwitch], [true, 'Group chat', ['own'], null, 'off'], 'group chat');
});

summary();
