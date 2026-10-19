/**
 * World layer — group chats and reply times (Miinthe, 2026-10-19).
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { newGroup, groupsOf, groupMsgs, groupMax, groupUnread, groupPrompt, parseGroup, groupConv } from '../src/world/groups-pure.js';
import { replyWait, waitOver, replyStatus, isNight, repliesDue, nextThread, othersConversations, convKey } from '../src/world/messages-pure.js';
import { emptyStore, addRecord } from '../src/world/world-pure.js';

test('a group: three people at least, by name; its messages stay out of the two-person logic', () => {
    assertEqual(newGroup({ id: 'g1', name: 'Kitchen', members: ['user', 'c:k'] }), null);
    const g = newGroup({ id: 'g1', name: '  Kitchen crew ', members: ['user', 'c:k', 'c:s', 'c:k'] });
    assertEqual(g.members, ['user', 'c:k', 'c:s']);
    assertEqual(g.name, 'Kitchen crew');
    let st = addRecord(emptyStore(), g, 1);
    st = addRecord(st, { kind: 'msg', id: 'm1', n: 1, group: 'g1', conv: groupConv('g1'), from: 'user', to: groupConv('g1'), text: 'hi', mine: true }, 1);
    st = addRecord(st, { kind: 'msg', id: 'm2', n: 2, group: 'g1', conv: groupConv('g1'), from: 'c:k', to: groupConv('g1'), text: 'hello dear' }, 1);
    assertEqual(groupsOf(st).length, 1);
    assertEqual(groupMsgs(st, 'g1').map(m => m.id), ['m1', 'm2']);
    assertEqual(groupUnread(st, 'user'), 1);
    assertEqual(groupUnread(st, 'c:x'), 0, 'not a member');
    assertEqual(repliesDue(st, null, 5).length, 0, 'never answered as a two-person text');
    assertEqual(nextThread(st, null, 50), null, 'never a thread between others');
    assertEqual(othersConversations(st, 'c:x', null, 5).length, 0, 'listed apart');
});

test('group answers: as many as the pace allows, known names once each', () => {
    assertEqual([groupMax('quiet'), groupMax('normal'), groupMax('lively')], [1, 2, 3]);
    const ppl = [{ key: 'c:k', name: 'Kettle' }, { key: 'c:s', name: 'Spoon' }, { key: 'main', name: 'Toaster' }];
    const out = parseGroup('{"replies":[{"by":"kettle","text":"a"},{"by":"Kettle","text":"again"},{"by":"Nobody","text":"x"},{"by":"Spoon","text":"b"},{"by":"Toaster","text":"c"}]}', ppl, 2);
    assertEqual(out.map(r => r.who.key), ['c:k', 'c:s']);
    assert(groupPrompt({ groupName: 'Kitchen', people: ppl, thread: [{ who: 'Miinthe', text: 'hi' }], max: 2 }).system.includes('at most 2'));
    assert(groupPrompt({ groupName: 'Kitchen', people: [ppl[0]], alone: true }).system.includes('or pass'));
});

test('reply times stack: chatty dial, busy in the scene, asleep at night; never longer than 12', () => {
    assertEqual(replyWait({ m: 3, lastI: 10, rand: () => 0 }), null, 'high: at once');
    assertEqual(replyWait({ m: 2, lastI: 10, rand: () => 0.9 }), null);
    assertEqual(replyWait({ m: 2, lastI: 10, rand: () => 0.1 }).after, 12);
    assertEqual(replyWait({ m: 1, lastI: 10, rand: () => 0.1 }).after, 14);
    const busy = replyWait({ m: 3, here: true, lastI: 10 });
    assert(busy.away && !waitOver(busy, { lastI: 11, here: true }) && waitOver(busy, { lastI: 11, here: false }) && waitOver(busy, { lastI: 14, here: true }));
    const night = { day: 3, part: 'Night' };
    assert(isNight('night') && isNight('Midnight') && !isNight('Evening'));
    const sleep = replyWait({ m: 3, clock: night, lastI: 10 });
    assert(sleep.wake && !waitOver(sleep, { lastI: 15, clock: night }) && waitOver(sleep, { lastI: 15, clock: { day: 4, part: 'Morning' } }) && waitOver(sleep, { lastI: 22, clock: night }));
    assertEqual([replyStatus({ clock: night }), replyStatus({ here: true }), replyStatus({ m: 1 }), replyStatus({})], ['asleep', 'busy (in the scene)', 'slow to reply', 'online']);
});

summary();
