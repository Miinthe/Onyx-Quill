/**
 * Overhaul — the side panel's Cast tab: its words and moves (src/panel/cast-view-pure.js).
 * Failures to avoid: a drag that puts an AI line above one of yours, or loses / duplicates an item; a correction to what
 * someone knows that touches anyone else; a hidden person's plans or off-screen life showing in their one-line summary.
 * Run: npm run test:cast-view
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { halvesOf, moveWithin, dropIndex, roundSummary, peopleSummary, queueSub, suggestionText, personSub, fixKnown } from '../src/panel/cast-view-pure.js';

const you = { id: 'y', kind: 'you' }, main = { id: 'm', kind: 'main' };
const mineK = { id: 'k', kind: 'npc', cast: 'c', person: 'kettle', text: 'Hello.' };
const mineS = { id: 's', kind: 'npc', cast: 'c', person: 'spoon', text: 'Bye.' };
const aiF = { id: 'f', kind: 'npc', cast: 'c', person: 'fridge' };
const aiT = { id: 't', kind: 'npc', cast: 'c', person: 'toaster', why: 'wants to talk' };
const ids = q => q.map(x => x.id).join(',');

test('halves: yours first, then the AI', () => {
    const h = halvesOf([aiF, you, main, mineK]);
    assertEqual(ids(h.mine), 'y,k');
    assertEqual(ids(h.ai), 'f,m');
    assertEqual(ids(halvesOf(null).mine), '');
});

test('drag: moves inside its own half only', () => {
    const q = [you, mineK, mineS, aiF, aiT, main];
    assertEqual(ids(moveWithin(q, 's', 0)), 's,y,k,f,t,m', 'to the top of your half');
    assertEqual(ids(moveWithin(q, 'y', 2)), 'k,s,y,f,t,m', 'to the end of your half');
    assertEqual(ids(moveWithin(q, 'm', 0)), 'y,k,s,m,f,t', 'the main character first in the AI half');
    assertEqual(ids(moveWithin(q, 'f', 99)), 'y,k,s,t,m,f', 'past the end stays in the half');
    assertEqual(ids(moveWithin(q, 'f', -3)), 'y,k,s,f,t,m', 'before the start stays in the half');
    assertEqual(ids(moveWithin(q, 'nope', 0)), 'y,k,s,f,t,m', 'unknown id: nothing moves');
    assertEqual(moveWithin(q, 't', 0).length, q.length, 'nothing lost or doubled');
    assertEqual(ids(q), 'y,k,s,f,t,m', 'the round passed in is not changed');
});

test('drop place from the pointer', () => {
    assertEqual(dropIndex([10, 30, 50], 5), 0);
    assertEqual(dropIndex([10, 30, 50], 31), 2);
    assertEqual(dropIndex([10, 30, 50], 99), 3);
    assertEqual(dropIndex([], 20), 0);
});

test('the round in words', () => {
    assertEqual(roundSummary(['You', 'Kettle', 'Spoon']), 'You, then Kettle, then Spoon');
    assertEqual(roundSummary([]), 'Nobody yet');
    assertEqual(roundSummary(['Kettle', 'Spoon'], { running: true, speaking: 'Kettle' }), 'Kettle is writing… then Spoon');
    assertEqual(roundSummary(['Kettle'], { running: true, speaking: 'Kettle' }), 'Kettle is writing…');
    assertEqual(roundSummary(['Kettle', 'Spoon'], { running: true, speaking: 'Kettle', stopping: true }), 'Kettle is writing… then it stops');
    assertEqual(roundSummary(['Spoon'], { running: true }), 'Playing… then Spoon');
});

test('people in words', () => {
    assertEqual(peopleSummary([{ name: 'Kettle', here: true }, { name: 'Spoon', here: true }, { name: 'Old Fridge', here: false }]), 'Kettle, Spoon here · Old Fridge away');
    assertEqual(peopleSummary([{ name: 'Old Fridge', here: false }]), 'Old Fridge away');
    assertEqual(peopleSummary([]), 'Nobody yet');
});

test('second lines in the round', () => {
    assertEqual(queueSub(you), 'your message from the chat box');
    assertEqual(queueSub(main), 'the main character replies');
    assertEqual(queueSub(mineK), 'you write: “Hello.”');
    assertEqual(queueSub(aiF), 'the AI writes');
    assertEqual(queueSub(aiT), 'the AI writes: wants to talk');
    assertEqual(queueSub({ ...aiF, exit: { why: 'still sulking' } }), 'says goodbye and leaves: still sulking');
    assert(queueSub({ ...mineK, text: 'word '.repeat(40) }).length < 80, 'a long line you wrote is cut short');
});

test('join / leave suggestions', () => {
    assertEqual(suggestionText('Old Fridge', { why: 'the cellar door rattles' }), 'Old Fridge wants to join: the cellar door rattles');
    assertEqual(suggestionText('Spoon', { leave: true }), 'Spoon wants to leave');
});

test('a person’s one line: hidden people stay hidden', () => {
    const here = { here: true, plans: [{ text: 'a' }, { text: 'b' }], knows: [{ fact: 'x' }] };
    assertEqual(personSub(here, []), 'here · 2 plans · knows 1');
    assertEqual(personSub(here, [], { veiled: true }), 'here · hidden');
    assertEqual(personSub({ here: true, plans: [], knows: [] }, [], { veiled: true }), 'here');
    const away = { here: false, plans: [{ text: 'wait until dark' }], knows: [] };
    assertEqual(personSub(away, [{ text: 'hummed in the cellar all night' }]), 'away · 📜 hummed in the cellar all night');
    assertEqual(personSub(away, [{ text: 'hummed in the cellar all night' }], { veiled: true }), 'away · 📜 while away');
    assertEqual(personSub(away, [], { speaking: true }), 'away · 1 plan · ✍️ speaking…');
});

test('fixing what someone knows touches only that fact', () => {
    const st = { cast: { c: { kettle: { here: true, knows: [{ id: 'k1', fact: 'Spoon nearly left', how: 'saw' }, { id: 'k2', fact: 'the fuse is gone', how: 'told' }] }, spoon: { knows: [{ id: 'k1', fact: 'other', how: 'saw' }] } } } };
    const a = fixKnown(st, 'c', 'kettle', 'k1', { fact: '  Spoon almost left ' });
    assertEqual(a.cast.c.kettle.knows[0], { id: 'k1', fact: 'Spoon almost left', how: 'saw' });
    assertEqual(a.cast.c.kettle.knows[1], st.cast.c.kettle.knows[1]);
    assertEqual(a.cast.c.spoon, st.cast.c.spoon, 'someone else untouched');
    assertEqual(st.cast.c.kettle.knows[0].fact, 'Spoon nearly left', 'the state passed in is not changed');
    assertEqual(fixKnown(st, 'c', 'kettle', 'k2', { how: 'heard' }).cast.c.kettle.knows[1].how, 'heard');
    assertEqual(ids(fixKnown(st, 'c', 'kettle', 'k1', null).cast.c.kettle.knows), 'k2', 'forget');
    assertEqual(ids(fixKnown(st, 'c', 'kettle', 'k1', { fact: '   ' }).cast.c.kettle.knows), 'k2', 'emptied: forgotten');
    assertEqual(fixKnown(st, 'c', 'kettle', 'nope', null), null);
    assertEqual(fixKnown(st, 'c', 'nobody', 'k1', null), null);
    assertEqual(fixKnown({}, 'c', 'kettle', 'k1', null), null);
});

summary();
