/**
 * LOCAL PATCH suite — who gossips about whom (Miinthe, 2026-10-26: "Ottilie wouldn't gossip about Lucan … or Seraphine
 * never about Corvin"; "a cast member just never gossips (or posts) period"). Failures to avoid: "never" read back as
 * average; someone who never posts posting anyway; a rumor started or passed on by someone who never gossips, or about
 * someone they never gossip about; a "never gossips about" list lost on the way through the board.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normHabits, posters, discretion, GOSSIP_RULE, feedPrompt, parseFeed, parsePulse } from '../src/world/feed-pure.js';
import { parseRumor, mayGossip, rumorPrompt } from '../src/world/rumor-pure.js';
import { normWorld } from '../src/world/world-pure.js';
import { plannedPrompt } from '../src/world/planned-pure.js';

const PEOPLE = { 'c:eka': { quirks: '', g: 2, p: 1, hush: ['c:tar', 'user'] }, 'c:nin': { quirks: '', g: 3, p: 2, hush: ['main'] }, 'c:mei': { quirks: '', g: 0, p: 0 } };
const ppl = () => posters({ main: { name: 'Corvin' }, cast: [{ key: 'c:eka', name: 'Ottilie' }, { key: 'c:tar', name: 'Lucan' }, { key: 'c:nin', name: 'Seraphine' }, { key: 'c:mei', name: 'Mei' }], people: PEOPLE, userName: 'Miinthe' });

test('"never" (0) stays never for gossip and posts; an unset dial is average; messages have no never', () => {
    assertEqual(normHabits({ g: 0, p: 0, m: 0 }).g, 0);
    assertEqual(normHabits({ g: 0, p: 0, m: 0 }).p, 0);
    assertEqual(normHabits({ g: 0, p: 0, m: 0 }).m, 2);
    assertEqual(normHabits({}).g, 2);
    assertEqual(normHabits({ g: null }).g, 2);
});
test('"never gossips about" travels as names, the player by their name; discretion says it plainly', () => {
    const e = ppl().find(p => p.name === 'Ottilie');
    assertEqual(e.hush, ['Lucan', 'Miinthe']);
    assertEqual(discretion(e), 'Ottilie never gossips about Lucan, Miinthe.');
    assertEqual(discretion(ppl().find(p => p.name === 'Mei')), "Mei never gossips — never passes on rumors or talks about others' private business.");
    assertEqual(discretion(ppl().find(p => p.name === 'Corvin')), '');
});
test('the loyalty rule and each person\'s line reach the feed; someone who never posts is not offered', () => {
    const f = feedPrompt({ userName: 'Miinthe', people: ppl().filter(p => !p.muted) });
    assert(f.system.includes(GOSSIP_RULE) && f.user.includes('Ottilie never gossips about Lucan, Miinthe.'));
    assert(!/^- Mei /m.test(f.user), 'Mei never posts');
    const parsed = parseFeed(JSON.stringify({ posts: [{ by: 'Mei', text: 'hi' }, { by: 'Seraphine', text: 'hm' }], comments: [{ post: 0, by: 'Mei', text: 'x' }] }), ppl());
    assertEqual(parsed.posts.map(p => p.who.name), ['Seraphine']);
    assertEqual(parsed.comments.length, 0);
    assertEqual(parsePulse(JSON.stringify({ moves: [{ kind: 'post', by: 'Mei', text: 'x' }] }), ppl()).length, 0);
});
test('rumors: never started or passed on by someone who never gossips, or about someone they never gossip about', () => {
    const P = ppl();
    assert(!mayGossip(P.find(p => p.name === 'Mei'), 'anything'));
    assert(!mayGossip(P.find(p => p.name === 'Ottilie'), 'Word is Lucan lost a bet'));
    assert(mayGossip(P.find(p => p.name === 'Ottilie'), 'The harbor master drinks'));
    const r1 = parseRumor(JSON.stringify({ newRumor: { starter: 'Seraphine', text: 'Corvin has a secret', kind: 'madeup' }, spread: [] }), P, []);
    assertEqual(r1.newRumor, null, 'Seraphine never about Corvin');
    const r2 = parseRumor(JSON.stringify({ newRumor: { starter: 'Seraphine', text: 'The envoy brought too many trunks', kind: 'true' }, spread: [] }), P, []);
    assertEqual(r2.newRumor?.starter?.name, 'Seraphine');
    const r3 = parseRumor(JSON.stringify({ newRumor: null, spread: [{ rumor: 4, by: 'Ottilie', to: ['Seraphine'] }, { rumor: 5, by: 'Ottilie', to: ['Seraphine'] }, { rumor: 5, by: 'Mei', to: ['Seraphine'] }] }), P, [4, 5], [], [], { 4: 'Lucan lost a bet', 5: 'The kitchen ran out of rice' });
    assertEqual(r3.spread.map(s => `${s.by.name}#${s.rumor}`), ['Ottilie#5']);
    assert(rumorPrompt({ userName: 'Miinthe', people: P }).system.includes(GOSSIP_RULE));
});
test('the board keeps "never gossips about" (one way) and the never dials', () => {
    const w = normWorld({ on: true, people: { 'c:eka': { quirks: '', hush: ['c:tar', 'c:eka', ''], g: 0 } } });
    assertEqual(w.people['c:eka'].hush, ['c:tar']);
    assertEqual(w.people['c:eka'].g, 0);
});
test('texts carry the rule and the line; a rumor note does not', () => {
    const p = plannedPrompt({ name: 'Ottilie', toName: 'Sasha', note: 'x', discretion: 'Ottilie never gossips about Lucan.' });
    assert(p.system.includes(GOSSIP_RULE) && p.system.includes('never gossips about Lucan'));
    assert(!plannedPrompt({ name: 'X', toName: 'feed', note: 'x', kind: 'rumor' }).system.includes(GOSSIP_RULE));
});
summary('world-discretion');
