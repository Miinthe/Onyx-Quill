/**
 * LOCAL PATCH suite — the board window's Timeline from the chat's real history (2026-10-04).
 * Failures to avoid: the helper's quote / reason / confidence lost; a waiting tracker drawn as
 * started at #0; a refused move drawn at the wrong step; lanes (places, items, money, day, weather,
 * dates) missing; chapters, rolls or fired triggers lost when the window saves.
 * Run: npm run test:timeline
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, fromEngineList } from '../src/board-model-pure.js';
import { timelineEvents, toWindowChat, fromWindowChat } from '../src/board-window-pure.js';
import { completeStepLog } from '../src/convert-pure.js';

const board = () => normalizeBoard({ v: 2, name: 'B', trackers: [
    { id: 'rel', name: 'Relationship', steps: [{ id: 's', name: 'Strangers' }, { id: 'n', name: 'Neighbours' }, { id: 'f', name: 'Friends' }, { id: 'm', name: 'Married' }] },
    { id: 'fuse', name: 'The Broken Fuse', starts: [{ tracker: 'rel', step: 'f' }], steps: [{ id: 'c', name: 'Calm' }, { id: 'sp', name: 'Sparks' }] },
    { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'garden', name: 'Garden' }] },
    { id: 'stash', kind: 'collection', name: 'Stash', purse: [{ id: 'usd', unit: '$', start: 8 }], states: [{ id: 'no', label: 'not yet' }, { id: 'have', label: 'have' }], items: [{ id: 'tape', name: 'Tape' }] },
    { id: 'world', kind: 'state', name: 'World', fields: [{ id: 'day', type: 'day', name: 'Day' }, { id: 'weather', type: 'choice', name: 'Weather', values: ['Sunny', 'Raining'] }] },
] });
const list = () => [
    { id: 'rel', name: 'Relationship', steps: ['Strangers', 'Neighbours', 'Friends', 'Married'], index: 2, journal: [
        { i: 0, index: 0, aside: null },
        { i: 3, index: 1, aside: null, who: 'auto', quote: "I'm your new neighbour", reason: 'Moved in next door.', confidence: 'high' },
        { i: 5, index: 1, aside: 'Nuisance', who: 'auto', quote: 'so loud', reason: 'Being a nuisance.' },
        { i: 7, index: 2, aside: null, who: 'hand' },
        { i: 8, index: 3, aside: null, who: 'trigger', reason: 'because the fuse sparked' },
    ], refused: [{ i: 6, toIndex: 3, why: 'Married skips Friends — stayed at Neighbours', quote: "we're married" }, { i: 6, why: 'old record' }] },
    { id: 'fuse', name: 'The Broken Fuse', steps: ['Calm', 'Sparks'], index: 0, started: true, startedAt: { i: 7, why: 'Relationship reaches Friends' }, journal: [{ i: 0, index: 0, aside: null }] },
];
const st = () => ({ ...freshState(board()), log: [
    { i: 2, kind: 'place', col: 'where', from: 'kitchen', to: 'garden', quote: 'out to the garden', who: 'auto', confidence: 'high' },
    { i: 4, kind: 'item', col: 'stash', item: 'tape', from: { state: 'no' }, to: { state: 'have' }, quote: 'pockets the tape', who: 'you' },
    { i: 4, kind: 'money', col: 'stash', purse: 'usd', from: 8, to: 3, who: 'auto' },
    { i: 9, kind: 'state', col: 'world', field: 'weather', from: 'Sunny', to: 'Raining', dayFrom: 1, dayTo: 2, who: 'auto', quote: 'next morning, rain' },
    { i: 9, kind: 'date', col: 'world', date: 'party', who: 'auto' },
    { i: 9, kind: 'roll', col: 'rel', line: 'x', who: 'roll' },
] });

// engine on v2, step 7: the timeline reads the v2 log — made here from the history above by the real conversion
// (step 6, convert-pure.js), so these are also the events an old chat shows once converted
const v2 = lst => ({ ...completeStepLog(board(), fromEngineList(board(), st(), lst), lst).state, stepsRebuilt: 1 });

test('step trackers: start, the helper\'s moves with quote / reason / confidence, by hand, a trigger', () => {
    const ev = timelineEvents(board(), list(), v2(list())).filter(e => e.t === 'rel');
    assertEqual(ev.map(e => `${e.m}:${e.who}:${e.to}`), ['0:start:0', '3:auto:1', '5:auto:1', '6:refused:3', '6:refused:1', '7:hand:2', '8:start:3']);
    const m = ev.find(e => e.m === 3);
    assertEqual([m.q, m.why, m.conf], ["I'm your new neighbour", 'Moved in next door.', 'high']);
    assertEqual(ev.find(e => e.m === 7).why, 'Moved by hand.');
});

test('a tracker with start lines: no start at #0 — it starts when its lines held', () => {
    const ev = timelineEvents(board(), list(), v2(list())).filter(e => e.t === 'fuse');
    assertEqual(ev, [{ m: 7, t: 'fuse', to: 0, who: 'start', why: 'Started: Relationship reaches Friends.' }]);
});

test('lanes: places, items, money, day + weather, new dates; rolls are not drawn', () => {
    const ev = timelineEvents(board(), list(), v2(list())).filter(e => e.t !== 'rel' && e.t !== 'fuse');
    assertEqual(ev.map(e => JSON.stringify([e.m, e.t, e.place ?? e.item ?? e.field ?? e.date, e.state ?? e.val ?? null, e.who])), [
        '[2,"where","garden",null,"auto"]', '[4,"stash","Tape","have","hand"]', '[4,"stash","Money","$3","auto"]',
        '[9,"world","day",2,"auto"]', '[9,"world","weather","Raining","auto"]', '[9,"world","party",null,"auto"]']);
});

test('pause and abandon show in the timeline with what happened', () => {
    const l = list();   // abandoned at 10 (as the movers journal it: back to the start, switched off)
    l[0] = { ...l[0], index: 0, run: 'abandoned', journal: [...l[0].journal, { i: 10, index: 0, aside: null, who: 'hand', why: 'abandon', run: 'abandoned' }] };
    const ev = timelineEvents(board(), l, v2(l)).filter(e => e.t === 'rel').at(-1);
    assertEqual([ev.m, ev.to, ev.who, ev.why], [10, 0, 'hand', 'Abandoned in this story — back to the start, switched off.']);
});

test('a window save keeps chapters, rolls, fired and denied triggers (rolls were lost before — 2026-10-04)', () => {
    const b = board();
    const s = { ...freshState(b), rolls: { 'start|fuse|x': { ok: true } }, fired: { k: 3 }, denied: ['d'], chapters: [{ name: 'The fuse arc', from: 6, to: 13, c: 1 }] };
    const bag = toWindowChat(b, s);
    assertEqual(bag.__chapters, [{ name: 'The fuse arc', from: 6, to: 13, c: 1 }]);
    bag.__chapters.push({ name: 'Later', from: 14, to: 20, c: 2 });
    const back = fromWindowChat(b, bag, s);
    assertEqual([back.chapters.length, back.rolls, back.fired, back.denied], [2, { 'start|fuse|x': { ok: true } }, { k: 3 }, ['d']]);
    assert(!('__chapters' in back), 'the bag key does not leak into the state');
});

summary('timeline');
