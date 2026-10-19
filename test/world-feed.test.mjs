/**
 * World layer — the feed suite (src/world/feed-pure.js, stage 4, 2026-10-19).
 * Failures to avoid: a muted person posting; made-up names posting or liking; a likes line that names nobody and says
 * "0 people"; the News filter showing chatter; a world story told out of order or past its end; a starting mix inventing
 * dials for people who aren't in the story; the board losing its voices on save.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normHabits, normVoice, normVoices, voiceKey, posters, postsOf, newPost, updatePost, toggleLike, addComment, likesLine, feedView, normStory, runningStories, feedPrompt, parseFeed, reactPrompt, parseReact, mixPrompt, parseMix, storyPrompt, parseStory, newsPrompt, parseNews, photosIn, mentionsIn, richText, tagQuery, tagMatches, commentCount, addPostVersion, showPostVersion, editPost, removePost, editComment, removeComment, storyToTell, tellsStory, relevantOld, pulsePrompt, parsePulse } from '../src/world/feed-pure.js';
import { emptyStore, addRecord, normWorld } from '../src/world/world-pure.js';
import { normalizeBoard, BOARD_VERSION } from '../src/board-model-pure.js';

const PEOPLE = posters({ main: { name: 'Toaster', about: 'a toaster' }, cast: [{ key: 'c1:k', name: 'Kettle', about: 'fussy' }, { key: 'c1:s', name: 'Spoon', about: 'sulky' }],
    voices: [{ id: 'gz', name: 'The Pantry Gazette', kind: 'voice', p: 3 }, { id: 'cw', name: 'CrumbWatcher', kind: 'regular', quirks: 'ALL CAPS' }],
    people: { 'c1:s': { muted: true, g: 3, p: 1, interests: ['the people she knows'] } } });

test('habits and voices', () => {
    assertEqual(normHabits({ g: 5, m: 'x', p: 1, interests: ['a', '', 'b', 'c', 'd'] }), { g: 2, m: 2, p: 1, interests: ['a', 'b', 'c'] });
    assertEqual(normVoice({ id: 'x' }), null);
    assertEqual(normVoice({ id: 'x', name: 'Bob', kind: 'regular' }).kind, 'regular');
    assertEqual(normVoices([{ id: 'a', name: 'A' }, null, { id: 'b' }]).length, 1);
    assertEqual(voiceKey({ id: 'gz' }), 'v:gz');
    assertEqual(PEOPLE.map(p => [p.key, p.kind]), [['main', 'main'], ['c1:k', 'cast'], ['c1:s', 'cast'], ['v:gz', 'voice'], ['v:cw', 'regular']]);
    assertEqual(PEOPLE.find(p => p.key === 'c1:s').muted, true);
    const w = normWorld({ voices: [{ id: 'gz', name: 'Gazette' }], people: { 'c1:k': { g: 1, p: 3, interests: ['memes'] } } });
    assertEqual([w.voices.length, w.people['c1:k'].p, w.people['c1:k'].interests[0]], [1, 3, 'memes']);
    const b = normalizeBoard({ v: BOARD_VERSION, name: 'T', trackers: [], world: { on: true, voices: [{ id: 'gz', name: 'Gazette', kind: 'voice' }] } });
    assertEqual(b.world.voices[0].name, 'Gazette');
});

test('posts, likes, comments, the likes line, filters', () => {
    let s = emptyStore();
    s = addRecord(s, newPost({ store: s, by: 'v:gz', text: 'Sugar up again.', news: true, title: 'Prices', id: 'p1', crowd: 12 }), 3);
    s = addRecord(s, newPost({ store: s, by: 'c1:k', text: 'shine day ✨', id: 'p2' }), 4);
    s = addRecord(s, newPost({ store: s, by: 'user', text: 'hello town', id: 'p3' }), 4);
    s = updatePost(s, 'p2', p => toggleLike(p, 'user'));
    s = updatePost(s, 'p2', p => addComment(p, { id: 'c1', by: 'v:cw', text: 'SHINE IS A LIE' }));
    const p2 = postsOf(s).find(p => p.id === 'p2');
    assertEqual(p2.likes, ['user']);
    assertEqual(p2.comments[0].text, 'SHINE IS A LIE');
    assertEqual(toggleLike(p2, 'user').likes, []);
    const nm = k => ({ user: 'Miinthe', 'c1:s': 'Spoon' })[k];
    assertEqual(likesLine({ likes: ['user', 'c1:s'], crowd: 23 }, nm), 'Miinthe, Spoon and 23 others like this');
    assertEqual(likesLine({ likes: ['user'], crowd: 0 }, nm), 'Miinthe likes this');
    assertEqual(likesLine({ likes: [], crowd: 1 }, nm, true), '1 person nods along');
    assertEqual(likesLine({ likes: [], crowd: 0 }, nm), '');
    const kind = k => (k === 'user' ? 'user' : k.startsWith('v:') ? 'voice' : 'cast');
    assertEqual(feedView(s).map(p => p.id), ['p3', 'p2', 'p1']);
    assertEqual(feedView(s, 'news').map(p => p.id), ['p1']);
    assertEqual(feedView(s, 'cast', kind).map(p => p.id), ['p3', 'p2']);
});

test('world stories: told in order, done at the end', () => {
    assertEqual(normStory({ id: 'x', title: 'Sheep', phases: ['a', 'b', 'c'], at: 9 }).done, true);
    let s = addRecord(emptyStore(), { kind: 'wstory', id: 'sh', title: 'Stolen sheep', phases: ['missing', 'suspect', 'trial'], at: 1 }, 2);
    s = addRecord(s, { kind: 'wstory', id: 'dog', title: 'Dog home', phases: ['found'], at: 1 }, 2);
    assertEqual(runningStories(s).map(x => [x.id, x.phases[x.at]]), [['sh', 'suspect']]);
});

test('the feed\'s prompt and answer: dials, quirks, stories; muted and made-up names never post', () => {
    const p = feedPrompt({ userName: 'Miinthe', people: PEOPLE, stories: runningStories(addRecord(emptyStore(), { kind: 'wstory', id: 'sh', title: 'Stolen sheep', phases: ['missing', 'suspect'], at: 1 }, 2)), recent: [{ n: 4, by: 'Kettle', text: 'shine day' }] });
    assert(p.user.includes('posts: high') && p.user.includes('ALL CAPS') && p.user.includes('next: suspect') && p.user.includes('#4 Kettle'), 'what the world is told');
    assert(p.system.includes('mostly NOT about Miinthe'), 'not about the player');
    const a = parseFeed('{"posts":[{"by":"crumbwatcher","text":"THE SHEEP ARE A COVER-UP","likes":["Kettle","Nobody"],"crowd":9,"story":"sh"},{"by":"Spoon","text":"muted me"},{"by":"Ghost","text":"boo"}],"comments":[{"post":4,"by":"Kettle","text":"oh dear"}],"stories":[{"id":"sh","told":true}],"newStory":{"title":"Lost cat","phases":["gone","seen","home"]}}', PEOPLE);
    assertEqual(a.posts.map(x => [x.who.key, x.likes, x.crowd, x.story]), [['v:cw', ['c1:k'], 9, 'sh']]);
    assertEqual(a.comments.map(c => [c.post, c.who.key]), [[4, 'c1:k']]);
    assertEqual(a.told, ['sh']);
    assertEqual(a.newStory.phases.length, 3);
    assertEqual(parseFeed('nope', PEOPLE), { posts: [], comments: [], told: [], newStory: null });
});

test('reactions to {{user}}\'s post; a starting mix', () => {
    const r = reactPrompt({ authorName: 'Miinthe', post: { byName: 'Miinthe', text: 'who stole the sugar?', comments: [] }, people: PEOPLE });
    assert(r.user.includes('who stole the sugar') && r.system.includes('crowd'), 'react prompt');
    assertEqual(parseReact('{"comments":[{"by":"Kettle","text":"not me dear"},{"by":"Spoon","text":"x"}],"likes":["CrumbWatcher"],"crowd":4}', PEOPLE).comments.map(c => c.who.key), ['c1:k']);
    const m = mixPrompt({ storyName: 'Toaster & Kettle', people: [{ name: 'Kettle', about: 'fussy' }], existing: ['The Pantry Gazette'] });
    assert(m.user.includes("don't repeat") && m.system.includes('era'), 'mix prompt');
    const mx = parseMix('{"voices":[{"name":"Breadbox Bakery","kind":"voice","bio":"sells bread","p":3},{"name":"Auntie Colander","kind":"regular","g":3}],"people":[{"name":"Kettle","g":1,"p":3,"interests":["memes"]},{"name":"Nobody","g":3}]}', [{ name: 'Kettle', key: 'c1:k' }]);
    assertEqual(mx.voices.map(v => [v.name, v.kind]), [['Breadbox Bakery', 'voice'], ['Auntie Colander', 'regular']]);
    assertEqual(mx.people, [{ key: 'c1:k', g: 1, m: 2, p: 3, interests: ['memes'] }]);
});

test('a world story she starts: planned into phases', () => {
    assert(storyPrompt({ seed: 'twenty sheep stolen overnight' }).system.includes('already resolved'), 'judges the seed');
    assertEqual(parseStory('{"title":"Sheep gone","phases":["missing","suspect","trial"]}', 'sheep').phases.length, 3);
    assertEqual(parseStory('{"title":"x","phases":[]}', 's'), null);
});

test('one news item: from an idea or a surprise; a voice writes it; muted never', () => {
    assert(newsPrompt({ idea: 'the sugar thief caught', people: PEOPLE }).user.includes('THE IDEA'), 'the idea');
    assert(newsPrompt({ people: PEOPLE }).system.includes('not a repeat'), 'a surprise');
    const writers = newsPrompt({ people: PEOPLE }).user.split('THE PEOPLE OF THE STORY')[0];
    assert(writers.includes('The Pantry Gazette') && !writers.includes('- Kettle'), 'voices write it');
    assert(newsPrompt({ people: PEOPLE }).user.includes('THE PEOPLE OF THE STORY') && newsPrompt({ people: PEOPLE }).system.includes('passers-by'), 'the story\'s people may be quoted, by the rule');
    assertEqual(parseNews('{"by":"The Pantry Gazette","title":"T","text":"x","quoted":["Kettle","Nobody"]}', PEOPLE).quoted.length, PEOPLE.filter(p => p.name === 'Kettle' && (p.kind === 'cast' || p.kind === 'main')).length);
    assertEqual(parseNews('{"by":"The Pantry Gazette","title":"Thief Caught","text":"A raccoon."}', PEOPLE).who.key, 'v:gz');
    assertEqual(parseNews('{"by":"Nobody","title":"x","text":"y"}', PEOPLE).who.key, 'v:gz');
    assertEqual(parseNews('{"by":"Spoon","title":"x","text":"y"}', PEOPLE).who.key, 'v:gz', 'news named after a person (here muted) is the newspaper\'s');
    assertEqual(parseNews('{"by":"Spoon","title":"x","text":"y"}', PEOPLE.filter(p => p.kind !== 'voice')), null, 'no voice, and Spoon is muted: nothing');
    assertEqual(parseNews('{"by":"The Pantry Gazette","title":"Thief Caught","text":"**THIEF CAUGHT**\\n\\nA raccoon."}', PEOPLE).text, 'A raccoon.');
});

test('fake photos and @-tags', () => {
    assertEqual(photosIn('look!\n[photo: Spoon glaring from the sink] and [attached picture: a dented kettle]'), ['Spoon glaring from the sink', 'a dented kettle']);
    assertEqual(mentionsIn('@Kettle and @auntie colander, see this', [{ key: 'k', name: 'Kettle' }, { key: 'a', name: 'Auntie Colander' }, { key: 'au', name: 'Auntie' }]).sort(), ['a', 'au', 'k'].filter(x => x !== 'au').concat('au').sort());
    const h = richText('hi @Kettle <b>\n[photo: the jar]', [{ name: 'Kettle' }]);
    assert(h.includes('<span class="wd-at">@Kettle</span>') && h.includes('&lt;b&gt;') && h.includes('class="photo"') && h.includes('<br>'), 'rich text');
    assertEqual(tagQuery('hello @ket'), { q: 'ket', from: 6 });
    assertEqual(tagQuery('hello @'), { q: '', from: 6 });
    assertEqual(tagQuery('mail me@home'), null);
    assertEqual(tagMatches('col', [{ name: 'Auntie Colander' }, { name: 'Kettle' }]).map(p => p.name), ['Auntie Colander']);
});

test('a post: write again adds a version, ‹ › flips, edit changes the shown one, delete removes it', () => {
    let st = addRecord(emptyStore(), newPost({ store: emptyStore(), by: 'k', text: 'first', title: 'Old', news: true, id: 'p1' }), 3);
    st = updatePost(st, 'p1', p => addPostVersion(p, { title: 'New', text: 'second' }));
    let p = postsOf(st)[0];
    assertEqual([p.alts.length, p.s, p.title, p.text], [2, 1, 'New', 'second']);
    st = updatePost(st, 'p1', x => showPostVersion(x, -1)); p = postsOf(st)[0];
    assertEqual([p.s, p.title, p.text], [0, 'Old', 'first']);
    st = updatePost(st, 'p1', x => showPostVersion(x, -1)); assertEqual(postsOf(st)[0].s, 0, 'stops at the first');
    st = updatePost(st, 'p1', x => editPost(x, { title: 'Old!', text: 'first\n\nedited' })); p = postsOf(st)[0];
    assertEqual([p.text, p.alts[0].text, p.alts[1].text, p.title], ['first\n\nedited', 'first\n\nedited', 'second', 'Old!']);
    st = updatePost(st, 'p1', x => showPostVersion(x, 1)); assertEqual(postsOf(st)[0].text, 'second');
    assertEqual(postsOf(removePost(st, 'p1')).length, 0);
});
test('a post written once: edit keeps it without versions; comments edit and delete', () => {
    let st = addRecord(emptyStore(), newPost({ store: emptyStore(), by: 'k', text: 'hi', id: 'p1' }), 3);
    st = updatePost(st, 'p1', x => editPost(x, { title: null, text: 'hello' }));
    assertEqual([postsOf(st)[0].text, postsOf(st)[0].alts], ['hello', undefined]);
    st = updatePost(st, 'p1', x => addComment(x, { id: 'c1', by: 's', text: 'a' }));
    st = updatePost(st, 'p1', x => addComment(x, { id: 'c2', by: 's', text: 'b' }));
    st = updatePost(st, 'p1', x => editComment(x, 'c1', 'A'));
    st = updatePost(st, 'p1', x => removeComment(x, 'c2'));
    assertEqual(postsOf(st)[0].comments.map(c => c.text), ['A']);
});

test('news comes from a voice: a headline from a Cast person goes to the newspaper (or stays a plain post)', () => {
    const ppl = [{ key: 'c:k', name: 'Kettle', kind: 'cast' }, { key: 'news', name: 'Local News', kind: 'voice' }];
    const a = parseFeed(JSON.stringify({ posts: [{ by: 'Kettle', title: 'Sheep stolen!', text: 'Twenty sheep…' }, { by: 'Kettle', text: 'my tea' }] }), ppl);
    assertEqual(a.posts.map(p => [p.who.key, p.title]), [['news', 'Sheep stolen!'], ['c:k', '']]);
    const b = parseFeed(JSON.stringify({ posts: [{ by: 'Kettle', title: 'Sheep stolen!', text: 'x' }] }), [ppl[0]]);
    assertEqual(b.posts.map(p => [p.who.key, p.title]), [['c:k', '']], 'no voice at all: a plain post');
    assertEqual(parseNews(JSON.stringify({ by: 'Kettle', title: 'T', text: 'x' }), ppl).who.key, 'news');
});

test('comments vary: none, one, a few, a pile-on — and up to four are kept', () => {
    assertEqual([0, 0.2, 0.5, 0.8, 0.95].map(r => commentCount(() => r)), [0, 1, 2, 3, 4]);
    const ppl = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }];
    const r = parseReact(JSON.stringify({ comments: ['A', 'B', 'C', 'A', 'B'].map(by => ({ by, text: 'hi' })) }), ppl);
    assertEqual(r.comments.length, 4);
    assert(reactPrompt({ authorName: 'Miinthe', post: { text: 'x', byName: 'K' }, people: ppl, count: 1 }).system.includes('one person comments'));
});

test('world stories take turns; a post the AI forgot to tag still tells its story', () => {
    const a = normStory({ id: 'a', title: 'Spelling Bee Champ', phases: ['Maya wins the regional bee', 'trophy dropped'], at: 1, toldAt: 10 });
    const b = normStory({ id: 'b', title: 'The Great Sugar Cube Mystery', phases: ['Twelve cubes vanish', 'found'], at: 0 });
    assertEqual(storyToTell([a, b]).id, 'b', 'never told first');
    assertEqual(storyToTell([a, { ...b, toldAt: 12 }]).id, 'a', 'then the one told longest ago');
    assertEqual(storyToTell([]), null);
    assert(tellsStory({ text: 'Whoever took twelve sugar cubes from the pantry…' }, b));
    assert(!tellsStory({ text: 'Lovely weather on the counter.' }, b));
});

test('small moves after a reply: old posts that fit, at most 4 moves, one text between people who know each other', () => {
    let st = emptyStore();
    st = addRecord(st, newPost({ store: st, by: 'c:k', text: 'Someone took twelve sugar cubes from the pantry', id: 'o1' }), 1);
    st = addRecord(st, newPost({ store: st, by: 'c:k', text: 'Lovely weather today', id: 'o2' }), 2);
    assertEqual(relevantOld(st, 'Spoon counts the sugar cubes in the pantry again').map(p => p.id), ['o1']);
    assertEqual(relevantOld(st, 'Spoon counts the sugar cubes', { skip: [1] }), []);
    const ppl = [{ key: 'c:k', name: 'Kettle' }, { key: 'c:s', name: 'Spoon' }, { key: 'v:p', name: 'Gazette', kind: 'voice' }];
    const tx = [{ key: 'c:k', name: 'Kettle' }, { key: 'c:s', name: 'Spoon' }];
    const mv = parsePulse(JSON.stringify({ moves: [
        { kind: 'comment', by: 'Spoon', post: 1, text: '@Kettle you would say that' },
        { kind: 'text', by: 'Kettle', to: 'Spoon', text: 'We need to talk, dear.' },
        { kind: 'text', by: 'Spoon', to: 'Kettle', text: 'second text' },
        { kind: 'text', by: 'Gazette', to: 'Spoon', text: 'a voice never texts' },
        { kind: 'post', by: 'Nobody', text: 'unknown' },
        { kind: 'post', by: 'Gazette', text: 'Sale on kettles' },
        { kind: 'post', by: 'Kettle', text: 'one' }, { kind: 'post', by: 'Kettle', text: 'two' },
    ] }), ppl, tx);
    assertEqual(mv.map(m => m.kind), ['comment', 'text', 'post', 'post']);
    assertEqual(parsePulse(JSON.stringify({ moves: [{ kind: 'post', by: 'Kettle', text: 'a' }, { kind: 'post', by: 'Kettle', text: 'b' }, { kind: 'post', by: 'Kettle', text: 'c' }] }), ppl, tx, 2).length, 2, 'a quiet world: at most 2');
    assert(pulsePrompt({ userName: 'Miinthe', people: ppl, min: 1, max: 6 }).system.includes('1 to 6'));
    assert(pulsePrompt({ userName: 'Miinthe', people: ppl, texters: tx, recent: [{ n: 1, by: 'Kettle', text: 'x', comments: [{ by: 'Spoon', text: 'no' }] }] }).user.includes('↳ Spoon: no'));
    assert(!pulsePrompt({ userName: 'Miinthe', people: ppl, texters: tx, msgs: false }).system.includes('private text'), 'no texting with Messages off');
});

summary();
