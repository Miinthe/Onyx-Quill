/**
 * LOCAL PATCH suite — characters and runs own their folders (2026-10-04).
 * Failures to avoid: a chat set up the old way (its own folders) suddenly losing DeepLore; a run's
 * folders leaking into another run; a character switched off still getting lore; a chat's own switch
 * not winning; folders repeated; a run letter written "C" not matching "c".
 * Run: npm run test:characters
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { asStore, runOf, chatFolders, isOn, setFolders, addFolders, removeFolders, setCharOn, describe } from '../src/characters-pure.js';

const Z = 'corvin.png';
const store = () => setFolders(setFolders(asStore({}), Z, 'Corvin', ['Characters/Corvin', 'Regions/Ostmark', 'Places']), Z, 'Corvin', ['Runs/C; Corvin; A Fox as a Pet'], 'C');

test('a chat reads the character\'s base folders, its run\'s, and its own — no repeats', () => {
    const s = store();
    assertEqual(chatFolders(s, Z, 'c', []), ['Characters/Corvin', 'Regions/Ostmark', 'Places', 'Runs/C; Corvin; A Fox as a Pet']);
    assertEqual(chatFolders(s, Z, 'a', ['Places', 'Extra']), ['Characters/Corvin', 'Regions/Ostmark', 'Places', 'Extra'], 'run A has no folders of its own; the chat adds one');
});

test('the run letter comes from the chat\'s instance field, any case, array or text', () => {
    assertEqual(runOf({ instance: ['C'] }), 'c');
    assertEqual(runOf({ instance: 'b' }), 'b');
    assertEqual(runOf({}), '');
    assertEqual(chatFolders(store(), Z, 'C', []).length, 4);
});

test('on/off: the chat\'s switch wins, then the character\'s, then "no folders = off"', () => {
    const s = store();
    assertEqual(isOn({ store: s, key: Z, run: 'c' }), { on: true, why: 'reads Corvin\'s folders' });
    assertEqual(isOn({ store: s, key: Z, run: 'c', chatSwitch: 'off' }).on, false);
    const off = setCharOn(s, Z, 'Corvin', false);
    assertEqual(isOn({ store: off, key: Z, run: 'c' }), { on: false, why: 'switched off for Corvin' });
    assertEqual(isOn({ store: off, key: Z, run: 'c', chatSwitch: 'on' }).on, true, 'the chat switched on overrides the character');
    assertEqual(isOn({ store: setCharOn(off, Z, 'Corvin', true), key: Z, run: 'c' }).on, true, 'back on');
});

test('a character with no folders anywhere is off — but a chat set up the old way (its own folders) keeps working', () => {
    assertEqual(isOn({ store: asStore({}), key: 'kettle.png', name: 'Kettle' }), { on: false, why: 'Kettle has no folders yet' });
    assertEqual(isOn({ store: asStore({}), key: 'kettle.png', name: 'Kettle', own: ['The Kitchen'] }), { on: true, why: 'reads this chat\'s folders' });
});

test('a chat without a character (a group chat) stays on unless switched off', () => {
    assertEqual(isOn({ store: asStore({}) }).on, true);
    assertEqual(isOn({ store: asStore({}), chatSwitch: 'off' }).on, false);
});

test('adding and removing folders, for the base and for a run; an emptied run disappears', () => {
    let s = addFolders(store(), Z, 'Corvin', ['Places', 'Regions/Windmere']);
    assertEqual(s.chars[Z].folders, ['Characters/Corvin', 'Regions/Ostmark', 'Places', 'Regions/Windmere']);
    s = removeFolders(s, Z, 'Corvin', ['Regions/Windmere']);
    assertEqual(s.chars[Z].folders.length, 3);
    s = removeFolders(s, Z, 'Corvin', ['Runs/C; Corvin; A Fox as a Pet'], 'c');
    assertEqual(s.chars[Z].runs, {});
});

test('the store survives damage; describe says it plainly', () => {
    assertEqual(asStore({ chars: { x: null, y: { name: 'Y', folders: ['a', 'a', ' '], runs: { B: { folders: ['r'] }, '': { folders: ['z'] } } } } }), { v: 1, chars: { y: { name: 'Y', folders: ['a'], runs: { b: { folders: ['r'] } } } } });
    assertEqual(describe({ store: store(), key: Z, run: 'c' }), 'Corvin · run c — DeepLore on (reads Corvin\'s folders), 4 folders');
    assertEqual(describe({ store: asStore({}), key: 'k.png', name: 'Kettle' }), 'Kettle — DeepLore off (Kettle has no folders yet)');
});

summary('characters');
