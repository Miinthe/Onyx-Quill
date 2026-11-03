/**
 * World layer — Messages suite (src/world/messages-pure.js, stage 1, 2026-10-19).
 * Failures to avoid: a letter arriving before the story moves on; an unread count that counts letters still on
 * their way or one's own messages; a conversation list missing someone you haven't written to yet; a swipe past the
 * versions there are; a model answering in plain text losing the reply; everyday small talk filling the knowledge list;
 * the reply prompt telling the character things they can't know.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { emptyStore, addRecord } from '../src/world/world-pure.js';
import {
    quirkRule, splitParts, aiStreak, nextThread, isPass, THREAD_GAP, pacing, extractPrompt, parseExtract, meetupChange, mainPlans, mainPlanLine, leakFacts, leakChanges, withHeaders, USER, MAIN, othersConversations, convThread, mainFacts, mainLearned, mainKnowsLine, convKey, partnerIn, peopleOf, personByKey, storyClock, stampNow, stampText, arrivalFor, arrived, threadOf, unreadFor,
    conversationsFor, newMessage, updateMessage, removeMessage, markRead, swipeTo, repliesDue, replyPrompt, parseReply, learnedChanges,
} from '../src/world/messages-pure.js';

const BOARD = {
    v: 2, name: 'T&K', trackers: [
        { id: 'c1', kind: 'cast', name: 'Cast', people: [{ id: 'k', name: 'Kettle', card: 'kettle.png' }, { id: 's', name: 'Spoon', card: 'spoon.png' }] },
        { id: 'tm', kind: 'state', name: 'Time', fields: [{ id: 'd', type: 'day', name: 'Day', start: 1 }, { id: 'pt', type: 'cycle', name: 'Time of day', values: ['morning', 'evening'] }] },
    ],
};
const ST = { states: { tm: { day: 2, vals: { pt: 'evening' } } } };
const K = 'c1:k', S = 'c1:s';
let id = 0; const nid = () => 'm' + (++id);

test('people and keys', () => {
    assertEqual(peopleOf(BOARD, ST).map(x => x.key), [K, S]);
    assertEqual(peopleOf({ ...BOARD, world: { ...(BOARD.world || {}), people: { [K]: { out: true } } } }, ST).map(x => x.key), [S], 'someone taken out of the world is not in it');
    assertEqual(personByKey(BOARD, S).p.name, 'Spoon');
    assertEqual(personByKey(BOARD, 'c1:gone'), null);
    assertEqual(convKey(K, USER), convKey(USER, K));
    assertEqual(partnerIn(convKey(USER, K), USER), K);
});

test('story clock: day and part from the state tracker; message number without one', () => {
    const c = storyClock(BOARD, ST);
    assertEqual(c, { day: 2, part: 'evening' });
    assertEqual(stampText(stampNow(c, 40)), 'Day 2 · evening');
    assertEqual(storyClock({ trackers: [] }, {}), null);
    assertEqual(stampText(stampNow(null, 40)), 'after message #40');
});

test('letters arrive when the story moves on', () => {
    const c = storyClock(BOARD, ST);
    const m = { arrives: arrivalFor(c, 40) };
    assertEqual(arrived(m, c, 40), false);
    assertEqual(arrived(m, { day: 3 }, 40), true);
    const m2 = { arrives: arrivalFor(null, 40) };
    assertEqual(arrived(m2, null, 40), false);
    assertEqual(arrived(m2, null, 41), true);
    assertEqual(arrived({}, null, 0), true);
});

test('sending, the thread, unread, the list', () => {
    const c = storyClock(BOARD, ST);
    let s = emptyStore();
    s = addRecord(s, newMessage({ store: s, from: USER, to: K, text: 'Did you smell smoke?', clock: c, i: 40, id: nid() }), 40);
    s = addRecord(s, newMessage({ store: s, from: K, to: USER, text: 'Smoke? No, dear.', clock: c, i: 40, id: nid() }), 40);
    assertEqual(threadOf(s, USER, K, c, 40).map(m => m.from), [USER, K]);
    assertEqual(unreadFor(s, USER, c, 40), 1);
    const list = conversationsFor(s, BOARD, ST, USER, c, 40);
    assertEqual(list.map(x => x.key), [K, S]);
    assertEqual(list[0].unread, 1);
    s = markRead(s, USER, K, c, 40, 'now');
    assertEqual(unreadFor(s, USER, c, 40), 0);
    // writing as Spoon: Spoon's list has {{user}} and Kettle
    assertEqual(conversationsFor(s, BOARD, ST, S, c, 40).map(x => x.key).sort(), [K, USER].sort());
});

test('a letter on its way is not unread and not in the other side\'s list yet', () => {
    const c = storyClock(BOARD, ST);
    let s = emptyStore();
    s = addRecord(s, newMessage({ store: s, from: K, to: USER, text: 'A letter', clock: c, i: 40, look: 'letters', id: nid() }), 40);
    assertEqual(unreadFor(s, USER, c, 40), 0);
    assertEqual(conversationsFor(s, BOARD, ST, USER, c, 40)[0].last, null);
    assertEqual(unreadFor(s, USER, { day: 3, part: '' }, 40), 1);
});

test('replies due: a letter that arrived and nobody answered', () => {
    const c = storyClock(BOARD, ST);
    let s = emptyStore();
    s = addRecord(s, newMessage({ store: s, from: USER, to: K, text: 'Meet me.', clock: c, i: 40, look: 'letters', id: 'L1' }), 40);
    assertEqual(repliesDue(s, c, 40).length, 0);
    assertEqual(repliesDue(s, { day: 3 }, 40).map(m => m.id), ['L1']);
    s = addRecord(s, newMessage({ store: s, from: K, to: USER, text: 'Yes.', clock: { day: 3 }, i: 41, look: 'letters', id: 'L2' }), 41);
    assertEqual(repliesDue(s, { day: 3 }, 41).length, 0);
});

test('edit, delete, swipe', () => {
    let s = emptyStore();
    s = addRecord(s, { kind: 'msg', id: 'x', n: 1, conv: convKey(USER, K), from: K, to: USER, alts: ['a', 'b'], s: 0 }, 1);
    s = updateMessage(s, 'x', { s: 1 });
    assertEqual(s.records[0].s, 1);
    assertEqual(swipeTo(s.records[0], 1), null);
    assertEqual(swipeTo(s.records[0], -1), { s: 0 });
    assertEqual(swipeTo({ s: 0 }, -1), { s: 0 });
    assertEqual(removeMessage(s, 'x').records.length, 0);
});

test('reply prompt: their knowledge only, the look decides the form', () => {
    const p = replyPrompt({ name: 'Kettle', card: 'A fussy kettle.', now: { wants: 'forgiveness', plans: [{ text: 'hide the cord' }], knows: [{ fact: 'the fuse was taped' }] }, fromName: 'Miinthe', look: 'letters', thread: [{ who: 'Miinthe', text: 'Meet me', stamp: 'Day 2' }], story: [{ name: 'Miinthe', mes: 'hello' }], when: 'Day 2 · evening' });
    assert(p.system.includes('the fuse was taped'), 'knowledge listed');
    assert(p.system.includes("doesn't know"), 'nothing more than they know');
    assert(p.system.includes('letter'), 'letters look');
    assert(p.user.includes('Miinthe (Day 2): Meet me'), 'thread with stamps');
    assert(!replyPrompt({ name: 'K', fromName: 'R', look: 'phone' }).system.includes('No "Dear'), 'texting has no letter rules');
    assert(!replyPrompt({ name: 'K', fromName: 'R', story: [] }).user.includes('MAIN STORY'), 'no main story for someone away');
});

test('reading the answer: JSON, JSON in prose, plain text, name prefix', () => {
    assertEqual(parseReply('{"reply":"Hi dear","learned":[{"fact":"Miinthe found a scorch mark","kind":"clue"}]}', 'Kettle').learned.length, 1);
    assertEqual(parseReply('Sure! {"reply":"Kettle: Hello","learned":[]}', 'Kettle').reply, 'Hello');
    assertEqual(parseReply('Just a plain answer', 'Kettle'), { reply: 'Just a plain answer', learned: [], plan: null });
    assertEqual(parseReply('{"broken', 'Kettle'), null);
    assertEqual(parseReply('', 'Kettle'), null);
});

test('what they learned becomes Cast knowledge — no small talk, at most two', () => {
    const cast = BOARD.trackers[0], p = cast.people[0];
    const ch = learnedChanges(cast, p, [{ fact: 'a', kind: 'clue' }, { fact: 'b', kind: 'everyday' }, { fact: 'c', kind: 'secret' }, { fact: 'd', kind: 'plan' }], 'Miinthe', x => x + '1');
    assertEqual(ch.map(c => c.add.fact), ['a', 'c']);
    assertEqual(ch[0].add.how, 'told');
    assertEqual(ch[0].field, 'knows');
});

test('the main character: in the list, and what they learn reaches the writer', () => {
    const c = storyClock(BOARD, ST);
    let s = emptyStore();
    assertEqual(conversationsFor(s, BOARD, ST, USER, c, 40, { name: 'Toaster', card: 't.png' }).map(x => x.key), [MAIN, K, S]);
    for (const r of mainLearned([{ fact: 'Miinthe found a scorch mark', kind: 'clue' }, { fact: 'hi', kind: 'everyday' }], 'Miinthe', 'm1', x => x + '9')) s = addRecord(s, r, 40);
    assertEqual(mainFacts(s).map(r => r.fact), ['Miinthe found a scorch mark']);
    assertEqual(mainKnowsLine(s, 'Toaster', 'Miinthe'), 'TOASTER knows from messages with Miinthe and others (off-screen; use it when it fits): Miinthe found a scorch mark');
    assertEqual(mainKnowsLine(emptyStore(), 'Toaster', 'Miinthe'), '');
});

test('between others: conversations I am not in, newest first; peeking marks nothing read', () => {
    const c = storyClock(BOARD, ST);
    let s = emptyStore();
    s = addRecord(s, newMessage({ store: s, from: K, to: S, text: 'not a word', clock: c, i: 40, id: 'a' }), 40);
    s = addRecord(s, newMessage({ store: s, from: USER, to: K, text: 'hi', clock: c, i: 40, id: 'b' }), 40);
    s = addRecord(s, newMessage({ store: s, from: S, to: MAIN, text: 'psst', clock: c, i: 41, id: 'c' }), 41);
    assertEqual(othersConversations(s, USER, c, 41).map(x => x.conv), [convKey(S, MAIN), convKey(K, S)]);
    assertEqual(othersConversations(s, K, c, 41).map(x => x.conv), [convKey(S, MAIN)]);
    assertEqual(convThread(s, convKey(K, S), c, 41).map(m => m.id), ['a']);
    assertEqual(convThread(s, convKey(K, S), c, 41)[0].read, undefined);
});

test('meet-ups: a plan of theirs, newest kept, no duplicates; the answer carries it', () => {
    const cast = BOARD.trackers[0], p = cast.people[1];
    const ch = meetupChange(cast, p, { plans: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, 'go to the beach with Miinthe next Wednesday', x => x + '1');
    assertEqual(ch.to.map(x => x.text), ['y', 'z', 'go to the beach with Miinthe next Wednesday']);
    assertEqual(ch.field, 'plans');
    assertEqual(meetupChange(cast, p, { plans: [{ text: 'Go to the beach' }] }, 'go to the beach', String), null);
    assertEqual(parseReply('{"reply":"deal!","learned":[],"plan":"go to the beach with Miinthe next Wednesday"}', 'Spoon').plan, 'go to the beach with Miinthe next Wednesday');
    assertEqual(parseReply('{"reply":"maybe","plan":null}', 'Spoon').plan, null);
    const ex = extractPrompt({ reader: 'Spoon', writer: 'Miinthe', message: 'beach Wednesday?', reply: 'Fine. Nine.' });
    assert(ex.system.includes('even grudgingly') && ex.user.includes('SPOON ANSWERED'), 'the second call asks for the plan');
    assertEqual(parseExtract('{"learned":[{"fact":"Miinthe wants a beach trip","kind":"plan"}],"plan":"go to the beach with Miinthe Wednesday at nine"}').plan, 'go to the beach with Miinthe Wednesday at nine');
    assertEqual(parseExtract('{"reply":"x","learnedAllowed":true}'), { learned: [], plan: null });
    assertEqual(parseExtract('garbage'), { learned: [], plan: null });
    const s = addRecord(emptyStore(), { kind: 'mplan', text: 'beach with Miinthe on Wednesday' }, 3);
    assertEqual(mainPlans(s).length, 1);
    assert(mainPlanLine(s).includes('not before'), 'the writer waits for it');
});

test('leaks: one overheard fact per message', () => {
    const nm = k => ({ user: 'Miinthe', [K]: 'Kettle', [S]: 'Spoon' })[k];
    const f = leakFacts([{ from: K, to: S, text: 'Not a word about the fuse.' }], nm);
    assertEqual(f, ['Kettle wrote to Spoon: "Not a word about the fuse."']);
    const ch = leakChanges(BOARD.trackers[0], BOARD.trackers[0].people[0], f, x => x + '2');
    assertEqual([ch[0].add.how, ch[0].add.via], ['heard', 'leak']);
});

test('stamp headers only where the time changes', () => {
    const t = [{ stamp: { day: 1 } }, { stamp: { day: 1 } }, { stamp: { day: 2, part: 'evening' } }, { stamp: { msg: 44 } }, { stamp: { msg: 44 } }];
    assertEqual(withHeaders(t).map(x => x.header), ['Day 1', null, 'Day 2 · evening', 'after message #44', null]);
});

test('pacing: read after a moment, typing about as long as the text takes', () => {
    assertEqual(pacing('hi', () => 0), { readMs: 1500, typingMs: 2500 });
    assertEqual(pacing('x'.repeat(90), () => 1).readMs, 4500);
    assertEqual(pacing('x'.repeat(90), () => 0).typingMs, 10000);
    assertEqual(pacing('x'.repeat(5000), () => 0).typingMs, 12000);
});

test('AI-to-AI threads: one waiting answer, oldest first; the gap; a tired thread rests; passing', () => {
    let s = emptyStore();
    s = addRecord(s, { kind: 'msg', id: 'a', n: 1, conv: convKey(K, MAIN), from: K, to: MAIN, text: 'tea?', auto: true }, 10);
    s = addRecord(s, { kind: 'msg', id: 'b', n: 2, conv: convKey(USER, S), from: USER, to: S, text: 'hi' }, 10);
    assertEqual(nextThread(s, null, 12)?.id, 'a');
    const ticked = addRecord(s, { kind: 'thread', auto: true }, 12);
    assertEqual(nextThread(ticked, null, 12 + THREAD_GAP - 1), null);
    assertEqual(nextThread(ticked, null, 12 + THREAD_GAP)?.id, 'a');
    let t = emptyStore();
    for (let k = 1; k <= 4; k++) t = addRecord(t, { kind: 'msg', id: 'm' + k, n: k, conv: convKey(K, S), from: k % 2 ? K : S, to: k % 2 ? S : K, text: 'x', auto: true }, 10);
    assertEqual(aiStreak(t, convKey(K, S)), 4);
    assertEqual(nextThread(t, null, 20), null);
    t = addRecord(t, { kind: 'msg', id: 'm5', n: 5, conv: convKey(K, S), from: S, to: K, text: 'written by Miinthe as Spoon' }, 11);
    assertEqual(nextThread(t, null, 20)?.id, 'm5');
    assertEqual([isPass('(no reply)'), isPass('No reply.'), isPass('no, reply later')], [true, true, false]);
    assert(replyPrompt({ name: 'K', fromName: 'S', mayPass: true }).system.includes('(no reply)'), 'may pass');
});

test('quirks: in the prompt; several messages in a row split into bubbles', () => {
    assert(replyPrompt({ name: 'Spoon', fromName: 'Miinthe', quirks: 'sends several short texts in a row, lots of emoji' }).system.includes('lots of emoji'), 'quirks told');
    assert(quirkRule('Spoon', 'x').includes('---') && !quirkRule('Spoon', 'x', true).includes('---'), 'letters are one letter');
    assertEqual(quirkRule('Spoon', '  '), '');
    assertEqual(splitParts('ok\n---\nfine\n\n---\nWEDNESDAY'), ['ok', 'fine', 'WEDNESDAY']);
    assertEqual(splitParts('just one'), ['just one']);
    assertEqual(splitParts('a\n---\n---\nb'), ['a', 'b']);
    assertEqual(splitParts(''), []);
});

summary();
