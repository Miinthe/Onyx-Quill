/**
 * LOCAL PATCH suite — Mero's lookups, ↻ swipes, the talk sorting itself, 💡 pitches from a talk (Miinthe, 2026-11-02).
 * Failures to avoid: a lookup that finds the wrong entry or nothing for an obvious name; a tool reply read wrong (calls
 * lost, so she answers blind); swipes outliving Miinthe's next message; a kept note card lost on a swipe; a tag she picked
 * being re-sorted; a pitch from the talk inventing new events; a plan losing its order; "don't make it a pitch" read
 * as a request.
 * Run: npm run test:mero-tools
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { TOOL_DEFS, WEB_DEFS, WEB_TOOLS, webResults, webSnippets, pageText, argsOf, toolLabel, searchLore, findLore, searchChat, runTool, readReply, normSteps, MAX_LOOKUPS, passingError } from '../src/mero-tools-pure.js';
import { groundRules, asStore, normTalk, versionsOf, showVersion, addVersion, dropSwipes, parseMeroAnswer, askedForPitch } from '../src/mero-pure.js';
import { talkPitchPrompt, parseTalkPitches, editedPitch, normPitch } from '../src/pitches-pure.js';
import { normAsk, normAsks, takeAsks, askAnswerText, answerAsks, ASK_FORMAT, withAsked } from '../src/ask-pure.js';
import { parseBoardMero, buildBoardMeroPrompt } from '../src/board-mero-pure.js';

const LORE = [
    { title: 'Interlude — Aging and Eternity', keys: ['eternity', 'aging'], content: 'The last interlude: Corvin watches a mortal age while he does not.' },
    { title: 'Ottilie', keys: ['Ottilie'], content: 'Lucan\'s aide. Counts exits in every room.' },
    { title: 'Rén Lú', keys: ['Ren Lu'], content: 'Court advisor; stands half a step behind the emperor.' },
    { title: 'Writing guide', keys: [], content: 'eternity eternity', guide: true },
];
const CHAT = [
    { i: 0, name: 'Corvin', text: 'The hall falls quiet as the delegation enters.' },
    { i: 1, name: 'Miinthe', text: 'Lucan grins at the throne.' },
    { i: 2, name: 'Corvin', text: 'Rén Lú leans in: "The Vanguard will want rooms in the city."' },
];
const BOARD = { name: 'Dragon', trackers: [{ id: 'il', kind: 'steps', name: 'Interludes', steps: [{ id: 's1', name: 'First Snow', entries: [] }, { id: 's2', name: 'Aging and Eternity', entries: ['Interlude — Aging and Eternity'] }] }] };
const STATE = { trackers: { il: { at: 's1' } } };
const DATA = { entries: LORE, chat: CHAT, board: BOARD, state: STATE, entryText: t => LORE.find(e => e.title === t)?.content || '', castNames: ['Ottilie'], castText: n => (/otti/i.test(n) ? 'Ottilie — in the scene\nWants: to find the exits' : '') };

// ── the lookups ──

test('six look-only tools, in the format SillyTavern passes on', () => {
    assertEqual(TOOL_DEFS.map(t => t.function.name), ['search_lore', 'read_lore', 'open_tracker', 'search_chat', 'read_messages', 'check_cast']);
    assert(TOOL_DEFS.every(t => t.type === 'function' && t.function.parameters.type === 'object'));
});

test('lore search: the obvious entry first, guides never', () => {
    assertEqual(searchLore(LORE, 'eternity')[0].title, 'Interlude — Aging and Eternity');
    assert(!searchLore(LORE, 'eternity').some(e => e.guide), 'guides are not story lore');
    assertEqual(searchLore(LORE, 'exits')[0].title, 'Ottilie', 'found by its text');
    assertEqual(searchLore(LORE, '').length, 0);
    assertEqual(findLore(LORE, 'ottilie').title, 'Ottilie', 'case does not matter');
    assertEqual(findLore(LORE, 'aging and eternity').title, 'Interlude — Aging and Eternity', 'part of a title');
    assertEqual(findLore(LORE, 'nobody at all'), null);
});

test('chat search: every word, newest hits, a short look around the hit', () => {
    const h = searchChat(CHAT, 'Vanguard rooms');
    assertEqual(h.map(m => m.i), [2]);
    assert(h[0].text.includes('Vanguard'));
    assertEqual(searchChat(CHAT, 'volcano').length, 0);
});

test('each tool answers Mero and gives Miinthe a few words', () => {
    let r = runTool('search_lore', { query: 'eternity' }, DATA);
    assert(r.text.includes('Interlude — Aging and Eternity') && /found/.test(r.got));
    r = runTool('read_lore', { title: 'Interlude — Aging and Eternity' }, DATA);
    assert(r.text.includes('watches a mortal age') && r.got === 'read');
    r = runTool('read_lore', { title: 'Ember Court' }, DATA);
    assert(/No entry/.test(r.text) && r.got === 'not found', 'never pretends');
    r = runTool('open_tracker', { name: 'interludes' }, DATA);
    assert(r.text.includes('First Snow [NOW]') && r.text.includes('Aging and Eternity [to come]') && r.text.includes('watches a mortal age'), r.text);
    r = runTool('open_tracker', { name: 'Ladder' }, DATA);
    assert(r.text.includes('The trackers with steps: Interludes'), 'names what exists');
    assert(/has no trackers with steps — only: Cast \(cast\)/.test(runTool('open_tracker', { name: 'fuse' }, { board: { name: 'Toaster', trackers: [{ id: 'c', kind: 'cast', name: 'Cast' }] } }).text), 'a board without step trackers is still a board');
    assertEqual(runTool('open_tracker', { name: 'fuse' }, {}).text, 'There is no storyboard in this chat.');
    // trackers without steps open too: what the writer is told about them (Miinthe, 2026-11-03)
    const B2 = { board: { name: 'Toaster', trackers: [{ id: 'w', kind: 'place', name: 'Where' }, { id: 'c', kind: 'cast', name: 'Cast' }] }, boardLines: ['Where: Kitchen', 'Cast in the scene: Kettle, Spoon', 'Weather: rain'] };
    r = runTool('open_tracker', { name: 'Where' }, B2);
    assertEqual(r.text.split('\n').slice(0, 2), ['Where (place) — where the story stands now:', 'Where: Kitchen'], 'its own line first');
    assert(/PLACE: Kitchen/.test(runTool('open_tracker', { name: 'Where' }, { ...B2, boardLines: ['[Where the story currently stands]', 'PLACE: Kitchen', '[End of story state]'] }).text), 'lines labeled by kind still come');
    assert(/Kettle, Spoon/.test(runTool('open_tracker', { name: 'cast' }, B2).text), 'any capitals');
    assert(/Nothing about it in this chat yet/.test(runTool('open_tracker', { name: 'Where' }, { ...B2, boardLines: [] }).text), 'nothing yet');
    r = runTool('read_messages', { from: 1, to: 50 }, DATA);
    assertEqual(r.text.split('\n\n').length, 2, 'clamped to the chat');
    assert(/There is no message/.test(runTool('read_messages', { from: 9 }, DATA).text));
    r = runTool('search_chat', { query: 'throne' }, DATA);
    assert(r.text.startsWith('#1 Miinthe'));
    r = runTool('check_cast', { name: 'Ottilie' }, DATA);
    assert(r.text.includes('Wants: to find the exits'));
    assert(/No one called/.test(runTool('check_cast', { name: 'Nobody' }, DATA).text));
    assert(/no tool called/.test(runTool('delete_everything', {}, DATA).text));
});

test('labels: one plain line per lookup', () => {
    assertEqual(toolLabel('search_lore', { query: 'aging' }), '🔎 Searched the lore: “aging”');
    assertEqual(toolLabel('read_messages', { from: 40, to: 44 }), '📜 Read messages #40–#44');
    assertEqual(toolLabel('read_messages', { from: 7 }), '📜 Read message #7');
    assertEqual(argsOf('{"query":"x"}'), { query: 'x' });
    assertEqual(argsOf('not json'), {});
    assertEqual(argsOf({ a: 1 }), { a: 1 });
});

test('a tool reply is read in both shapes; a plain answer has no calls', () => {
    const oa = readReply({ choices: [{ message: { content: '', reasoning_content: 'hm', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_lore', arguments: '{"query":"aging"}' } }] } }] });
    assertEqual(oa.calls, [{ id: 'c1', name: 'search_lore', args: '{"query":"aging"}' }]);
    assertEqual(oa.reasoning, 'hm');
    const cl = readReply({ content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'read_lore', input: { title: 'X' } }] });
    assertEqual([cl.text, cl.calls[0].name, cl.calls[0].args], ['Let me look.', 'read_lore', '{"title":"X"}']);
    const plain = readReply({ choices: [{ message: { content: 'Hi!' } }] });
    assertEqual([plain.text, plain.calls.length], ['Hi!', 0]);
});

test('what a reply keeps of its lookups: label + a few words, never the whole entry', () => {
    const s = normSteps([{ label: '📖 Read: X', got: 'read', text: 'a whole entry' }, { label: '' }, null]);
    assertEqual(s, [{ label: '📖 Read: X', got: 'read' }]);
    assertEqual(normSteps(Array.from({ length: 20 }, (_, k) => ({ label: `l${k}` }))).length, MAX_LOOKUPS);
    const t = normTalk({ msgs: [{ who: 'mero', t: 'x', steps: [{ label: '🔎 Searched the lore: “a”', got: '2 found' }] }] });
    assertEqual(t.msgs[0].steps.length, 1, 'kept with the message');
    assertEqual(normTalk({ msgs: [{ who: 'mero', t: 'x', nolook: true }] }).msgs[0].nolook, true, 'her AI could not look things up: the header says so');
    const m = addVersion({ who: 'mero', t: 'a', nolook: true }, { t: 'b', steps: [{ label: '🔎 y' }] });
    assertEqual([m.nolook, showVersion(m, 0).nolook], [undefined, true], 'per version');
});

// ── ↻ swipes ──

test('↻ redo keeps the old answer as a swipe; ◀ ▶ moves between them; a kept card stays with its version', () => {
    const m = { who: 'mero', t: 'First answer.', cards: [{ kind: 'dont', text: 'Rule', last: 'pinned', scope: 'chat' }] };
    addVersion(m, { t: 'Second answer.', steps: [{ label: '🔎 x' }] });
    assertEqual([m.t, m.swi, m.sw.length, !!m.cards, m.steps.length], ['Second answer.', 1, 2, false, 1]);
    showVersion(m, 0);
    assertEqual([m.t, m.cards.length, !!m.steps], ['First answer.', 1, false]);
    m.cards[0].state = 'kept';   // she kept the card on the first one
    showVersion(m, 1); showVersion(m, 0);
    assertEqual(m.cards[0].state, 'kept', 'the keep survives swiping away and back');
    assertEqual(versionsOf(m).list.length, 2);
    addVersion(m, { t: 'Third.' });
    assertEqual([m.sw.length, m.swi, m.t], [3, 2, 'Third.']);
});

test('the swipes go as soon as Miinthe writes again — and are stored only while they last', () => {
    const msgs = [{ who: 'author', t: 'q' }, addVersion({ who: 'mero', t: 'a' }, { t: 'b' })];
    assertEqual(normTalk({ msgs }).msgs[1].sw.length, 2, 'until then they survive a reload');
    dropSwipes(msgs);
    assertEqual([msgs[1].t, msgs[1].sw, msgs[1].swi], ['b', undefined, undefined], 'the shown one stays');
    assertEqual(normTalk({ msgs: [{ who: 'mero', t: 'x', sw: [{ t: 'x' }] }] }).msgs[0].sw, undefined, 'one version is no swipe');
});

// ── the talk sorts itself ──

test('[[KIND]] sorts the talk and never shows; old [[PITCH]] markup never shows either', () => {
    const a = parseMeroAnswer('Let\'s plan it.\n[[PITCH kind=twist]] A volcano. [[/PITCH]]\n[[KIND]]plan[[/KIND]]');
    assertEqual([a.text, a.kind], ['Let\'s plan it.', 'plan']);
    assertEqual(parseMeroAnswer('Hi! [[KIND]]party[[/KIND]]').kind, null, 'only the three kinds');
    assertEqual(normTalk({ tag: 'plan', tagMine: true, msgs: [] }).tagMine, true, 'her pick is remembered');
});

test('asking for a pitch: the ways she says it — and not when she says no', () => {
    for (const t of ['okay but why are you not suggesting an actual pitch, you are just yapping', 'make that a pitch', 'can you turn this into a pitch?', 'pitch it', 'give me pitches', 'write it up as a pitch'])
        assert(askedForPitch(t), t);
    for (const t of ['don\'t make it a pitch yet', 'the pitch was good', 'I liked the pitch menu', 'okay can we plan this out before I continue the story?'])
        assert(!askedForPitch(t), t);
});

// ── 💡 pitch from a talk ──

const TALK = { title: 'Volcano', msgs: [
    { who: 'author', t: 'I want the old volcano near the village to erupt.' },
    { who: 'mero', t: 'Ooh. Warning signs first? Tremors, the well going warm?' },
    { who: 'author', t: 'Yes — tremors, then ash, then the evacuation. No deaths though.' },
    { who: 'mero', t: 'So far: tremors → ash → evacuation, nobody dies.' },
] };

test('the write-up prompt: the talk, what they worked out, nothing new, her last word counts', () => {
    const { system, user } = talkPitchPrompt(TALK, { character: 'Kettle', castNames: ['Kettle'], donts: ['No deaths'], board: ['Relationship: Friends'] });
    assert(system.includes('WORKED OUT TOGETHER') && system.includes('Add nothing new') && system.includes('their last word counts'));
    assert(user.includes('erupt') && user.includes('Mero: So far') && user.includes('No deaths') && user.includes('Kettle'));
    const again = talkPitchPrompt(TALK, { already: ['The volcano erupts (plan: tremors → ash → evacuation)'] });
    assert(again.user.includes('Already made from this talk') && again.user.includes('tremors → ash') && again.system.includes('never write one of them again'), 'a second press never repeats the first cards');
});

test('the answer: a plan keeps its beats in order; a pitch with what is still open; from the talk', () => {
    const ans = '```json\n{"items": [{"type": "plan", "kind": "twist", "strength": "bomb", "from": "the volcano talk", "goal": "The village survives the eruption.", "beats": ["Tremors shake the village", "Ash falls", "Everyone is evacuated"], "open": ""}, {"type": "pitch", "kind": "acts", "who": "kettle", "text": "Kettle refuses to leave her shop.", "open": "whether she gives in"}]}\n```';
    const { list } = parseTalkPitches(ans, ['Kettle'], 'Volcano');
    assertEqual(list.length, 2);
    assertEqual(list[0].plan.beats.map(b => b.text), ['Tremors shake the village', 'Ash falls', 'Everyone is evacuated']);
    assertEqual([list[0].src, list[0].text], ['talk', 'The village survives the eruption.']);
    assertEqual([list[1].who, list[1].text, list[1].open], ['Kettle', 'Kettle refuses to leave her shop.', 'whether she gives in'], 'what is open stays apart — never in what the writer gets');
    assertEqual(normPitch({ ...list[1], st: 'kept' }).open, 'whether she gives in');
    assertEqual(list[0].open, undefined, 'an empty "open" is nothing');
    assert(normPitch({ ...list[0], st: 'kept' }).plan, 'stored as a real plan');
    const none = parseTalkPitches('{"items": [], "why": "we haven\'t picked when it happens"}');
    assertEqual([none.list.length, none.why], [0, 'we haven\'t picked when it happens']);
    assertEqual(parseTalkPitches('sorry').list.length, 0);
});

test('✏ edit: a pitch gets new words; a plan new beats (kept ones keep their floor), never fewer than two', () => {
    assertEqual(editedPitch({ text: 'old' }, { text: '  new words ' }), { text: 'new words' });
    assertEqual(editedPitch({ text: 'old' }, { text: '' }), null);
    const p = { text: 'Goal', plan: { goal: 'Goal', beats: [{ id: 'b1', text: 'A', floor: 5 }, { id: 'b2', text: 'B', floor: 2 }] } };
    const e = editedPitch(p, { goal: 'New goal', beats: ['A', 'C', 'D'] });
    assertEqual([e.text, e.plan.beats.map(b => b.text), e.plan.beats[0].floor, e.plan.beats[0].id], ['New goal', ['A', 'C', 'D'], 5, 'b1']);
    assertEqual(editedPitch(p, { beats: ['only one'] }), null);
});

// ── ❓ question cards ──

test('a card needs a question and two different answers; picks stay within the answers', () => {
    assertEqual(normAsk({ q: 'Who?', options: ['Kettle'] }), null);
    assertEqual(normAsk({ q: '', options: ['a', 'b'] }), null);
    const a = normAsk({ q: 'Who knocks the cubes off?', pick: 'one', options: ['Toaster', 'Spoon', 'toaster'], picked: [1, 0, 9] });
    assertEqual([a.opts, a.many, a.picked], [['Toaster', 'Spoon'], false, [1]], 'duplicates out; "one" keeps one pick');
    assertEqual(normAsk({ q: 'Which?', pick: 'many', options: ['a', 'b', 'c'], picked: [0, 2] }).picked, [0, 2]);
    assertEqual(normAsks(Array.from({ length: 6 }, (_, k) => ({ q: `Q${k}?`, options: ['a', 'b'] }))).length, 3);
});

test('cards come out of a talk answer and never show as text', () => {
    const r = takeAsks('Love it!\n[[ASK many]] Who joins the blame?\n- Kettle\n- Spoon\n- Toaster\n[[/ASK]]');
    assertEqual(r.text, 'Love it!');
    assertEqual([r.asks[0].q, r.asks[0].many, r.asks[0].opts], ['Who joins the blame?', true, ['Kettle', 'Spoon', 'Toaster']]);
    assertEqual(takeAsks('[[ASK one]] Q?\n1. yes\n2) no\n[[/ASK]]').asks[0].opts, ['yes', 'no'], 'numbered answers too');
    assert(ASK_FORMAT.includes('[[ASK one]]'));
});

test('her answers become her message; unanswered cards are left out; skipping marks them', () => {
    const asks = [{ q: 'Who?', opts: ['Kettle', 'Spoon'] }, { q: 'Where?', opts: ['fridge', 'sink'], many: true }, { q: 'When?', opts: ['now', 'later'] }];
    const done = answerAsks(asks, [{ picked: [1] }, { picked: [0, 1], own: 'and the bin' }, {}]);
    assertEqual(askAnswerText(done), 'Who? → Spoon\nWhere? → fridge; sink; and the bin');
    assert(done.every(a => a.done === 'answered'));
    assert(answerAsks(asks, [], { skipped: true }).every(a => a.done === 'skipped'));
    const t = normTalk({ msgs: [{ who: 'mero', t: 'x', asks: done, pcheck: true }] });
    assertEqual([t.msgs[0].asks[1].own, t.msgs[0].pcheck], ['and the bin', true], 'kept with the message');
});

test('Mero in a talk is taught the cards; her answer carries them', () => {
    const a = parseMeroAnswer('Hmm.\n[[ASK one]] Should it happen tonight?\n- tonight\n- tomorrow\n[[/ASK]]\n[[KIND]]plan[[/KIND]]');
    assertEqual([a.text, a.asks.length, a.kind], ['Hmm.', 1, 'plan']);
});

test('💡 Pitch asks first when something important is open — never with cards already written', () => {
    const first = talkPitchPrompt(TALK, {}).system;
    assert(first.includes('FIRST fill "open"') && first.includes('ALWAYS open') && first.includes('my guess'), 'the first press lists what is open — her own unanswered questions and guesses included');
    assert(!talkPitchPrompt(TALK, {}, { ask: false }).system.includes('FIRST fill'), 'after her answers (or Skip) it writes');
    const q = parseTalkPitches('{"open": [{"q": "Who knocks the cubes off?", "pick": "one", "options": ["Toaster", "Spoon"]}], "items": []}');
    assertEqual([q.list.length, q.asks.length, q.asks[0].opts[1]], [0, 1, 'Spoon']);
    assertEqual(parseTalkPitches('{"items": [{"type": "pitch", "text": "x happens"}], "open": [{"q": "Q?", "options": ["a", "b"]}]}').asks.length, 1, 'open points are kept even when cards came along — on a first press they win');
    const sys = talkPitchPrompt(TALK, {}).system;
    assert(sys.includes('ONLY where they said yes') && sys.includes('never an instruction'), 'her unanswered ideas are open; the goal is a story sentence');
    assert(!talkPitchPrompt(TALK, {}, { ask: false }).system.includes('{"open": [question'), 'the write-up asks for cards only');
    assertEqual(parseTalkPitches('{"items": [{"type": "pitch", "text": "the cubes vanish."}]}').list[0].text, 'The cubes vanish.');
});

test('the board\'s Mero asks with the same cards', () => {
    assert(buildBoardMeroPrompt('talk', { brief: { trackers: [] }, message: 'help' }).system.includes('"asks"'));
    const r = parseBoardMero('talk', '{"text": "", "suggestions": [], "asks": [{"q": "Which tracker?", "pick": "one", "options": ["Relationship", "Fuse"]}]}', { brief: { trackers: [] } });
    assertEqual([r.ok, r.asks.length, r.text], [true, 1, 'A quick question first:']);
    assertEqual(parseBoardMero('talk', 'plain words', {}).asks, []);
});

test('"Anything to add?" goes along with the answers', () => {
    const done = answerAsks([{ q: 'Who?', opts: ['Kettle', 'Spoon'] }], [{ picked: [0] }]);
    assertEqual([askAnswerText(done), 'and it happens at night'].filter(Boolean).join('\n\n'), 'Who? → Kettle\n\nand it happens at night');
});

test('a passing hiccup keeps lookups on; a refusal of tools switches them off', () => {
    for (const e of [new Error('Request timed out (120s)'), new Error('Too Many Requests'), { message: 'x', status: 503 }, new Error('Failed to fetch'), new Error('Bad gateway'), new Error('Service is too busy. We advise users to temporarily switch to alternative LLM API service providers.')]) assert(passingError(e), String(e.message));
    for (const e of [new Error('Bad Request'), { message: 'x', status: 400 }, new Error('Jinja template error: tools not supported')]) assert(!passingError(e), String(e.message));
});

test('a lookup line names each entry once', () => {
    const twice = [{ title: 'Kettle', keys: ['kettle'], content: 'a kettle' }, { title: 'Kettle', keys: ['kettle'], content: 'the kettle again' }];
    const r = runTool('search_lore', { query: 'kettle' }, { entries: twice });
    assertEqual(r.got.split('·').length, 1);
});

test('Mero\'s question cards stay visible to her later answers and to Pitch', () => {
    assertEqual(withAsked({ t: 'A quick question first:', asks: [{ q: 'Who finds it?' }, { q: 'At night?' }] }), 'A quick question first:\n[asked: Who finds it? · At night?]');
    assertEqual(withAsked({ t: 'plain' }), 'plain');
    const talk = { title: 'x', msgs: [{ who: 'author', t: 'plan it' }, { who: 'mero', t: 'One thing:', asks: [{ q: 'Who finds the sugar?', opts: ['a', 'b'] }] }] };
    const first = talkPitchPrompt(talk, {}, { ask: true });
    assert(first.user.includes('[asked: Who finds the sugar?]'));
    assertEqual((first.system.match(/Answer with JSON only/g) || []).length, 1);
    assert(first.system.includes('{"open": [question, …], "items": ['));
    const later = talkPitchPrompt(talk, {}, { ask: false });
    assert(!later.system.includes('"open": [question'));
});

test('🌐 the web: results, pages, labels, and only with the switch and lookups (Miinthe, 2026-11-03)', () => {
    assertEqual([...WEB_TOOLS].sort(), ['read_page', 'search_web']);
    assert(!TOOL_DEFS.some(d => WEB_TOOLS.has(d.function.name)), 'the web is never in the lore tools on its own');
    assert(WEB_DEFS[0].function.description.includes('always win'), 'her story wins over the web');
    const r = webResults({ answer: 'Corvin is the Earth Sovereign.', results: [{ title: 'Corvin | Starfall Saga Wiki', url: 'https://starfall-saga.fandom.com/wiki/Corvin', content: 'Corvin is a playable Earth character.' }, { title: 'x', url: 'https://www.fanlab.example/a', content: 'y' }] }, 'Corvin');
    assert(r.text.includes('may be wrong') && r.text.includes('https://starfall-saga.fandom.com/wiki/Corvin'));
    assertEqual(r.got, '2 results: starfall-saga.fandom.com · fanlab.example');
    assertEqual(webResults({ results: [] }, 'nothing').got, 'nothing found');
    assertEqual(webResults(null, 'q').got, 'nothing found');
    const html = '<html><head><title>Corvin &amp; Ostmark</title><style>.a{}</style></head><body><nav>Menu Home</nav><main><h1>Corvin</h1><p>He is &quot;Stone Lord&quot;&nbsp;in disguise.</p><script>alert(1)</script><ul><li>Earth</li><li>Spear &#8212; 5&#x2605;</li></ul></main><footer>© fandom</footer></body></html>';
    const pg = pageText(html);
    assertEqual(pg.title, 'Corvin & Ostmark');
    assertEqual(pg.text, 'Corvin\nHe is "Stone Lord" in disguise.\nEarth\nSpear — 5★');
    const noMain = pageText('<body><nav>Menu</nav><div>Real text</div><footer>foot</footer></body>');
    assertEqual(noMain.text, 'Real text');
    assert(pageText('<p>' + 'word '.repeat(3000) + '</p>', 200).text.endsWith('[… the rest of the page is cut]'));
    assertEqual(webSnippets('Corvin is the Earth Sovereign.\n\nHis birthday is December 31.', 'q').got, '2 snippets', 'any search service, through the Web Search extension');
    assert(webSnippets('', 'q').text.includes('no search service is set up'));
    assert(!WEB_DEFS.some(d => /tavily/i.test(d.function.description)), 'no service named');
    assertEqual(toolLabel('search_web', { query: 'Corvin birthday' }), '🌐 Searched the web: “Corvin birthday”');
    assertEqual(toolLabel('read_page', { url: 'https://www.example.com/a/b' }), '🌐 Read a page: example.com');
    assert(groundRules(true, true).includes('search_web') && !groundRules(true, false).includes('search_web') && !groundRules(false, true).includes('search_web'));
    assertEqual(asStore(null).settings.web, true, 'on unless she switches it off');
    assertEqual(asStore({ settings: { web: false } }).settings.web, false);
});

summary('mero-tools');
