/**
 * World layer suite (src/world/world-pure.js, stage 0, 2026-10-19).
 * Failures to avoid: the world showing on a board that never switched it on; a switched-off section staying on the
 * rail; the panel opening on the same side as DeepLore's side panel; a swipe keeping what the replaced reply caused;
 * a delete leaving records from the deleted messages; a broken stored world throwing; a saved board losing its
 * world settings (normalizeBoard keeps only the fields it lists).
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { isMuted, neverTalk, togglePin, normWorld, worldOf, worldPaused, railSections, sectionTitle, openingSection, panelSide, emptyStore, normStore, addRecord, rewindFrom, pruneTo } from '../src/world/world-pure.js';
import { normalizeBoard, BOARD_VERSION } from '../src/board-model-pure.js';
import { toWindowBoard, fromWindowBoard } from '../src/board-window-pure.js';

const base = w => ({ on: w.on, look: w.look, sections: w.sections });

test('world settings: off unless switched on, all sections on, phone look', () => {
    assertEqual(base(normWorld(undefined)), { on: false, look: 'phone', sections: { feed: true, news: true, msgs: true } });
    assertEqual(base(normWorld({ on: true, look: 'letters', sections: { news: false } })), { on: true, look: 'letters', sections: { feed: true, news: false, msgs: true } });
    assertEqual(normWorld({ on: 'yes', look: 'carrier pigeon' }).on, false);
    assertEqual(normWorld({ look: 'carrier pigeon' }).look, 'phone');
});

test('worldOf: the pause is per chat; a chat that never set its own follows the old board flag', () => {
    assertEqual(worldPaused(false, undefined), false);
    assertEqual(worldPaused(true, undefined), true);   // paused before the change: stays paused
    assertEqual(worldPaused(true, false), false);      // woken in this chat
    assertEqual(worldPaused(false, true), true);       // paused in this chat only
    assertEqual(worldOf({ world: { on: true } }, true).paused, true);
    assertEqual(worldOf({ world: { on: true, paused: true } }).paused, true);
    assertEqual(worldOf({ world: { on: true, paused: true } }, false).paused, false);
    assertEqual(worldOf({ world: { on: false } }, false), null);
});
test('worldOf: null for a board without the world layer', () => {
    assertEqual(worldOf(null), null);
    assertEqual(worldOf({ world: { on: false } }), null);
    assertEqual(worldOf({ world: { on: true } }).look, 'phone');
});

test('rail: People always there, switched-off sections gone', () => {
    assertEqual(railSections({ on: true }), ['feed', 'news', 'msgs', 'people']);
    assertEqual(railSections({ on: true, sections: { news: false, feed: false } }), ['msgs', 'people']);
    assertEqual(railSections({ on: true, sections: { feed: false, news: false, msgs: false } }), ['people']);
});

test('titles follow the look', () => {
    assertEqual(sectionTitle('feed'), 'Chatter');
    assertEqual(sectionTitle('feed', 'letters'), 'Talk of the town');
    assertEqual(sectionTitle('msgs', 'letters'), 'Letters');
    assertEqual(sectionTitle('news', 'letters'), 'The Gazette');
    assertEqual(sectionTitle('nonsense'), 'Chatter');
});

test('opens on Chatter, or Messages while one is waiting', () => {
    assertEqual(openingSection({ on: true }), 'feed');
    assertEqual(openingSection({ on: true }, { unread: 2 }), 'msgs');
    assertEqual(openingSection({ on: true, sections: { msgs: false } }, { unread: 2 }), 'feed');
    assertEqual(openingSection({ on: true, sections: { feed: false } }), 'news');
});

test('panel side: always opposite DeepLore\'s side panel', () => {
    assertEqual(panelSide('right'), 'left');
    assertEqual(panelSide('left'), 'right');
    assertEqual(panelSide(undefined), 'left');
});

test('store: records are tagged with their message; broken ones dropped', () => {
    let s = emptyStore();
    s = addRecord(s, { kind: 'msg', text: 'a' }, 3);
    s = addRecord(s, { kind: 'msg', text: 'b' }, 5);
    s = addRecord(s, { kind: 'msg' }, -1);
    s = addRecord(s, 'nonsense', 6);
    assertEqual(s.records.map(r => [r.kind, r.i]), [['msg', 3], ['msg', 5]]);
    assertEqual(normStore({ records: [{ kind: 'x', i: 1 }, { i: 2 }, { kind: 'y', i: 'z' }, null] }).records.length, 1);
    assertEqual(normStore('garbage'), emptyStore());
});

test('store: a swipe at message 5 replaces what message 5 caused; a delete keeps only what remains', () => {
    let s = emptyStore();
    [2, 4, 5, 5, 7].forEach((i, n) => { s = addRecord(s, { kind: 'post', n }, i); });
    assertEqual(rewindFrom(s, 5).records.map(r => r.i), [2, 4]);
    assertEqual(pruneTo(s, 5).records.map(r => r.i), [2, 4, 5, 5]);
    assertEqual(pruneTo(s, -1).records, []);
});

test('a saved board keeps its world settings (normalizeBoard)', () => {
    const b = normalizeBoard({ v: BOARD_VERSION, name: 'Toaster & Kettle', trackers: [], world: { on: true, look: 'letters', sections: { news: false } } });
    assertEqual(base(b.world), { on: true, look: 'letters', sections: { feed: true, news: false, msgs: true } });
    assertEqual(b.world.alive.everyN, 10);
    const off = normalizeBoard({ v: BOARD_VERSION, name: 'Plain', trackers: [] });
    assertEqual('world' in off, false);
});

test('the board window keeps the world settings both ways', () => {
    const b = normalizeBoard({ v: BOARD_VERSION, name: 'T', trackers: [], world: { on: true, look: 'letters' } });
    assertEqual(fromWindowBoard(toWindowBoard(b), 'T').world, b.world);
});

test('quirks are kept per person; empty ones dropped', () => {
    const w = normWorld({ people: { 'c1:s': { quirks: 'lots of emoji' }, 'c1:k': { quirks: '  ' }, bad: 'x' } });
    assertEqual(w.people, { 'c1:s': { quirks: 'lots of emoji' } });
});

test('muting is kept per person, with or without quirks', () => {
    const w = normWorld({ people: { 'c1:s': { muted: true, quirks: '' }, 'c1:k': { quirks: 'x', muted: 'yes' } } });
    assertEqual(w.people, { 'c1:s': { quirks: '', muted: true }, 'c1:k': { quirks: 'x' } });
    assertEqual([isMuted(w, 'c1:s'), isMuted(w, 'c1:k')], [true, false]);
});

test('never talk to each other: kept on the board, either list counts, both ways', () => {
    const w = { people: { 'c:k': { never: ['c:s', 'c:k', 7] }, 'c:x': { never: [] } } };
    assertEqual(normWorld(w).people['c:k'].never, ['c:s']);
    assertEqual(normWorld(w).people['c:x'], undefined);
    assert(neverTalk(w, 'c:k', 'c:s') && neverTalk(w, 'c:s', 'c:k'));
    assert(!neverTalk(w, 'c:k', 'main') && !neverTalk(w, 'c:k', 'c:k'));
});

test('pinned conversations: kept on the store, toggled', () => {
    let st = togglePin(emptyStore(), 'c:k');
    assertEqual(st.pins, ['c:k']);
    st = togglePin(addRecord(st, { kind: 'tick' }, 3), 'g:g1');
    assertEqual(normStore(st).pins, ['c:k', 'g:g1'], 'survives adding records');
    assertEqual(normStore(togglePin(st, 'c:k')).pins, ['g:g1']);
    assertEqual(normStore(togglePin(togglePin(emptyStore(), 'x'), 'x')).pins, undefined);
});

summary();
