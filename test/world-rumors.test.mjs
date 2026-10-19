/**
 * World layer — the rumors suite (src/world/rumor-pure.js, stage 5, 2026-10-19).
 * Failures to avoid: a made-up name starting or hearing a rumor; a spread of a rumor that doesn't exist; someone "telling"
 * a rumor to themselves; a tracker moved that isn't switched on, or to a step it doesn't have; the account's name lost
 * with Letters; Mero's summary naming the hidden poster.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { RUMOR, noticers, rumorName, normRumor, rumorsOf, runningRumors, worldNewsLine, withHeard, withDrift, heardFact, rumorChanges, rumorPrompt, parseRumor, tipPrompt, parseTip, namesTipper, worldDigest, KIND_WORDS } from '../src/world/rumor-pure.js';
import { emptyStore, addRecord, normWorld } from '../src/world/world-pure.js';
import { newPost, feedView } from '../src/world/feed-pure.js';

const ppl = [{ key: 'c:k', name: 'Kettle', g: 1 }, { key: 'c:s', name: 'Spoon', g: 3 }, { key: 'main', name: 'Toaster', g: 2 }];

test('the account: its name per board, an unsigned note with Letters, a default', () => {
    assertEqual(rumorName({ rumorName: 'Pantry Whispers' }, 'phone'), 'Pantry Whispers');
    assertEqual(rumorName({ rumorName: 'Pantry Whispers' }, 'letters'), 'An unsigned note');
    assertEqual(rumorName({}, 'phone'), 'Whispers');
    assertEqual(normWorld({ on: true, rumorName: '  Pantry Whispers ' }).rumorName, 'Pantry Whispers');
});

test('a rumor post: repaired, filtered, heard and drift added without doubles', () => {
    let st = emptyStore();
    st = addRecord(st, { ...newPost({ store: st, by: RUMOR, text: 'The fuse was TAPED.', id: 'p1' }), rumor: { kind: 'true', truth: 'Toaster taped it', who: 'c:k', heard: ['c:s', 'c:s'] } }, 3);
    st = addRecord(st, newPost({ store: st, by: 'c:k', text: 'Nice weather', id: 'p2' }), 3);
    assertEqual(rumorsOf(st).map(p => p.id), ['p1']);
    assertEqual(feedView(st, 'rumor').map(p => p.id), ['p1']);
    assertEqual(normRumor(rumorsOf(st)[0].rumor).heard, ['c:s']);
    const p = rumorsOf(st)[0];
    assertEqual(withHeard(p, ['c:s', 'main']).rumor.heard, ['c:s', 'main']);
    assertEqual(withDrift(p, 'c:s', 'The fuse was taped by Kettle').rumor.drift.length, 1);
    assertEqual(normRumor({ kind: 'nonsense' }).kind, '');
    assertEqual(KIND_WORDS[normRumor({ kind: 'madeup' }).kind], 'Made up');
    assertEqual(runningRumors(st).length, 1);
});

test('what a listener keeps: a heard fact, as Cast knowledge', () => {
    assert(heardFact('The fuse was TAPED.', 'Spoon').startsWith('Heard a rumor from Spoon'));
    const ch = rumorChanges({ id: 'c' }, { id: 'k' }, ['f'], p => p + '1');
    assertEqual([ch[0].field, ch[0].add.how, ch[0].add.via, ch[0].who], ['knows', 'heard', 'rumor', 'world']);
});

test('the rumor call: the scene only when someone was in it; trackers only when switched on', () => {
    const p = rumorPrompt({ userName: 'Miinthe', accountName: 'Whispers', people: [{ name: 'Spoon', g: 3, here: true, interests: ['grudges'] }], scene: [{ name: 'Toaster', mes: 'tapes the fuse' }], rumors: [] });
    assert(p.user.includes('tapes the fuse') && p.user.includes('(in the scene)'));
    assert(!p.system.includes('TRACKERS'));
    const q = rumorPrompt({ userName: 'Miinthe', accountName: 'Whispers', people: [], trackers: [{ name: 'Trust', steps: ['low', 'high'], now: 'low' }] });
    assert(q.system.includes('TRACKERS') && q.user.includes('Trust'));
});

test('reading the rumor call: unknown names, rumors, self-tells and trackers dropped', () => {
    const tr = [{ name: 'Trust', steps: ['low', 'high'], now: 'low' }];
    const r = parseRumor(JSON.stringify({
        newRumor: { starter: 'Spoon', account: true, text: 'Kettle at 3am…', kind: 'madeup', truth: 'nobody saw', heard: ['Kettle', 'Ghost'] },
        spread: [{ rumor: 1, by: 'Spoon', to: ['Kettle', 'Spoon'], retold: 'Kettle at 2am' }, { rumor: 9, by: 'Spoon', to: ['Kettle'] }, { rumor: 1, by: 'Ghost', to: ['Kettle'] }, { rumor: 1, by: 'Kettle', to: ['Kettle'] }],
        moves: [{ tracker: 'Trust', to: 'high' }, { tracker: 'Nope', to: 'x' }],
    }), ppl, [1], tr);
    assertEqual([r.newRumor.starter.key, r.newRumor.account, r.newRumor.kind, r.newRumor.heard.map(x => x.key)], ['c:s', true, 'madeup', ['c:k']]);
    assertEqual(r.spread.map(s => [s.rumor, s.by.key, s.to.map(x => x.key), s.retold]), [[1, 'c:s', ['c:k'], 'Kettle at 2am']]);
    assertEqual(r.moves, [{ tracker: 'Trust', to: 'high', why: '' }]);
    assertEqual(parseRumor(JSON.stringify({ moves: [{ tracker: 'Trust', to: 'low' }] }), ppl, [], tr).moves, [], 'already there: no move');
    assertEqual(parseRumor(JSON.stringify({ newRumor: { starter: 'Ghost', text: 'x' } }), ppl).newRumor, null);
    assertEqual(parseRumor('nonsense', ppl), { newRumor: null, spread: [], moves: [] });
});

test('a posted rumor: readers notice it — the account (or poster) may be who passed it on', () => {
    const r = parseRumor(JSON.stringify({ spread: [{ rumor: 2, by: 'Whispers', to: ['Spoon'] }] }), ppl, [2], [], [{ key: RUMOR, name: 'Whispers' }]);
    assertEqual(r.spread.map(s => [s.by.key, s.to.map(x => x.key)]), [[RUMOR, ['c:s']]]);
    assertEqual(parseRumor(JSON.stringify({ spread: [{ rumor: 2, by: 'Whispers', to: ['Spoon'] }] }), ppl, [2]).spread, [], 'without the account listed: dropped');
});

test('noticing a posted rumor: gossip dial and interests; not twice; never the poster or the muted', () => {
    const post = { by: 'rumor', text: 'Kettle polishing at the fuse box!', rumor: { heard: ['c:k'] } };
    const people = [{ key: 'c:k', name: 'Kettle', g: 3 }, { key: 'c:s', name: 'Spoon', g: 1, interests: ['fuse box drama'] }, { key: 'main', name: 'Toaster', g: 1 }, { key: 'v:m', name: 'Mug', g: 3, muted: true }];
    assertEqual(noticers(post, people, () => 0.3).map(p => p.key), ['c:s'], 'low gossip, but it touches what Spoon cares about');
    assertEqual(noticers(post, people, () => 0.05).map(p => p.key), ['c:s', 'main']);
    assertEqual(noticers(post, people, () => 0.99), []);
    assertEqual(noticers(post, people, () => 0, 1).length, 1, 'at most max');
});

test('a tip: the tipper is never named in the post; what others know is mixed in', () => {
    const p = tipPrompt({ accountName: 'Whispers', tipperName: 'Miinthe', tip: 'Kettle sparked', others: [{ name: 'Spoon', knows: ['saw tape'] }] });
    assert(p.system.includes('never name who tipped you') && p.user.includes('saw tape'));
    assert(namesTipper('Heard Miinthe saw it', 'Miinthe') && !namesTipper('Heard Miinthea saw it', 'Miinthe') && !namesTipper('a little bird', 'Miinthe'));
    assert(tipPrompt({ accountName: 'W', tipperName: 'Miinthe', tip: 'ask Spoon', talk: ['Miinthe: Kettle at the fuse box'] }).user.includes('Kettle at the fuse box'), 'a follow-up is read with the tip before it');
    // checking with a witness first: offered only with names; a held post comes back with "ask" and no text
    assert(!tipPrompt({ accountName: 'W', tipperName: 'Miinthe', tip: 'x' }).system.includes('"ask"'));
    assert(tipPrompt({ accountName: 'W', tipperName: 'Miinthe', tip: 'x', canAsk: ['Spoon'] }).system.includes('one of: Spoon'));
    assertEqual(parseTip('{"text":"","kind":"true","truth":"t","ask":"Spoon"}'), { text: '', kind: 'true', truth: 't', ask: 'Spoon' });
    assertEqual(parseTip('{"text":"","kind":"true","truth":"t","ask":null}'), null);
    assertEqual(parseTip('{"text":"Sparks fly!","kind":"twisted","truth":"t"}'), { text: 'Sparks fly!', kind: 'twisted', truth: 't' });
    assertEqual(parseTip('{"kind":"true"}'), null);
});

test("Mero's summary: rumors with who heard them, the feed, messages — the hidden poster stays hidden", () => {
    let st = emptyStore();
    st = addRecord(st, { ...newPost({ store: st, by: RUMOR, text: 'Taped!', id: 'p1' }), rumor: { kind: 'true', truth: 'yes', who: 'c:k', heard: ['c:s'] } }, 3);
    st = addRecord(st, newPost({ store: st, by: 'c:k', text: 'Tea time', id: 'p2' }), 3);
    st = addRecord(st, { kind: 'msg', id: 'm1', n: 1, from: 'c:s', to: 'user', text: 'hi' }, 3);
    const names = { 'c:k': 'Kettle', 'c:s': 'Spoon', user: 'Miinthe', [RUMOR]: 'Whispers' };
    const d = worldDigest(st, k => names[k] || '?');
    assert(d.includes('"Taped!"') && d.includes('heard by Spoon') && d.includes('Kettle: Tea time') && d.includes('Spoon → Miinthe: hi'));
    assert(!/Kettle posted|by Kettle/.test(d.split('Latest')[0]), 'who posted the rumor is not in the summary');
    assertEqual(worldDigest(emptyStore(), x => x), '');
});

test("the writer's world line: public news and world stories only, recent only", () => {
    let st = emptyStore();
    st = addRecord(st, { ...newPost({ store: st, by: 'v:paper', text: 'Farmers are furious.', title: 'Twenty sheep stolen overnight', news: true, id: 'n1' }) }, 30);
    st = addRecord(st, { ...newPost({ store: st, by: 'v:paper', text: 'Old.', title: 'Bridge reopened', news: true, id: 'n0' }) }, 2);
    st = addRecord(st, { ...newPost({ store: st, by: RUMOR, text: 'Secret!', title: 'x', news: true, id: 'r1' }), rumor: { kind: 'true' } }, 30);
    st = addRecord(st, newPost({ store: st, by: 'c:k', text: 'my cat', id: 'p1' }), 30);
    st = addRecord(st, { kind: 'wstory', id: 's1', title: 'The sheep', phases: ['stolen', 'the farmer blames the circus', 'found'], at: 2 }, 20);
    const line = worldNewsLine(st, 50);
    assert(line.includes('Twenty sheep stolen overnight') && line.includes('The sheep: the farmer blames the circus'));
    assert(!line.includes('Bridge reopened'), 'old news dropped');
    assert(!line.includes('Secret') && !line.includes('my cat'), 'rumors and chatter stay out');
    assertEqual(worldNewsLine(emptyStore(), 10), '');
    // the rumors the main character heard come in a line of their own
    const st2 = addRecord(st, { ...newPost({ store: st, by: RUMOR, text: 'Kettle at the fuse box', id: 'r2' }), rumor: { kind: 'true', heard: ['main'] } }, 40);
    const both = worldNewsLine(st2, 50, { heardBy: 'main', name: 'Toaster' });
    assert(both.includes('rumors Toaster has heard') && both.includes('Kettle at the fuse box') && !both.includes('Secret'), 'only what he heard');
});

summary();
