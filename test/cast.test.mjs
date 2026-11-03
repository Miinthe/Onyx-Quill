/**
 * LOCAL PATCH suite — the Cast (2026-10-13, `12 cast and agendas design.md`, build step 1).
 * Failures to avoid: an NPC knowing what they never saw (knowledge without a quote, or while away); someone "entering"
 * because they were talked about; thoughts or wants reaching the writer; plans piling up past three or an old plan
 * dragged back; Undo / delete leaving someone in the scene or a fact known; the window's save losing the cast's chat
 * state; a hidden NPC's secrets in a notice; people not in the scene being told to the writer or updated.
 * Run: npm run test:cast
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, normalizeState, freshState, holds, condText, checkBoard } from '../src/board-model-pure.js';
import {
    leftBehind, personNow, presentPeople, castHelperSection, validateCastChanges, applyCastChanges, handChange, directorUser, parseDirector,
    validateDirector, splitPeopleEvents, castLines, appearAtPlaces, awayCandidates, arrivalLines, validateComes, parseDirectorAll, appearsOf, oddsOf, exitFrom, backFrom, leftAt, offscreenChanges, offscreenLines, offscreenUser, parseOffscreen, MIN_AWAY, castJudgeLines, castPins, presentNames, describeCastChange, MAX_PLANS,
} from '../src/cast-pure.js';
import { undoCollectionChange, rewindCollections } from '../src/collections-pure.js';
import { autoTrackSystemPrompt, autoTrackSchema, parseHelperAnswerAll } from '../src/autotrack-pure.js';
import { toWindowBoard, fromWindowBoard, toWindowChat, fromWindowChat, timelineEvents } from '../src/board-window-pure.js';

const board = (people = {}, cast = {}) => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'rel', kind: 'steps', name: 'Relationship', steps: [{ id: 'friends', name: 'Friends' }, { id: 'married', name: 'Married' }],
        starts: [], },
    { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'cellar', name: 'Cellar' }] },
    { id: 'cast', kind: 'cast', name: 'Cast', ...cast, people: [
        { id: 'kettle', name: 'Kettle', card: 'Kettle NPC test.png', entries: ['Kettle', 'Judge · Kettle'], kinds: { 'Judge · Kettle': 'judge' },
            hangouts: [{ place: 'where', at: 'kitchen' }], wants: 'to be forgiven without admitting the fuse', plans: ['change the subject if he asks about the fuse'], ...(people.kettle || {}) },
        { id: 'gerry', name: 'Gerry the Caterpillar', entries: ['Gerry'], ...(people.gerry || {}) },
    ] },
] });
const arr0 = v => (Array.isArray(v) ? v.at(-1) || {} : {});
const msgs = (text, i = 20) => [{ name: 'Miinthe', mes: text, _i: i }];
const withHere = (b, ids, extra = {}) => { const st = freshState(b); for (const id of ids) st.cast.cast[id] = { here: true, ...(extra[id] || {}) }; return st; };

test('a cast keeps its people: card, entries, hangouts, wants, at most three starting plans, hidden', () => {
    const b = board({ kettle: { plans: ['a', 'b', 'c', 'd'], hidden: true } });
    const c = b.trackers.find(t => t.kind === 'cast');
    assertEqual(c.people.map(p => p.id), ['kettle', 'gerry']);
    const k = c.people[0];
    assertEqual([k.card, k.entries.length, k.hangouts[0].at, k.plans.length, k.hidden, c.pinHere, c.setsPresent, c.director], ['Kettle NPC test.png', 2, 'kitchen', 3, true, true, false, true]);
    assertEqual(freshState(b).cast, { cast: {} });
});

test('a person as the chat has them: away, the board\'s wants and plans until the story changes them', () => {
    const b = board();
    const c = b.trackers[2], st = freshState(b);
    const now = personNow(st, c, c.people[0]);
    assertEqual([now.here, now.wants, now.plans.map(p => p.text), now.thoughts, now.knows], [false, 'to be forgiven without admitting the fuse', ['change the subject if he asks about the fuse'], null, []]);
    assertEqual(presentPeople(b, st), []);
});

test('normalizeState keeps each person\'s chat state and drops people who left the board', () => {
    const b = board();
    const st = normalizeState({ v: 2, cast: { cast: { kettle: { here: true, plans: [{ id: 'p1', text: 'hide the cord' }], knows: [{ id: 'k1', fact: 'the toaster fixed it', how: 'saw' }], thoughts: { text: 'Good.', i: 3 }, junk: 1 }, gone: { here: true } } } }, b);
    assertEqual(Object.keys(st.cast.cast), ['kettle']);
    assertEqual(st.cast.cast.kettle, { here: true, plans: [{ id: 'p1', text: 'hide the cord' }], thoughts: { text: 'Good.', i: 3 }, knows: [{ id: 'k1', fact: 'the toaster fixed it', how: 'saw' }] });
});

test('a line can wait for someone in the scene; Check catches a person who is gone', () => {
    const b = normalizeBoard({ v: 2, trackers: [...board().trackers, { id: 'plot', kind: 'steps', name: 'Plot', starts: [{ cast: 'cast', person: 'kettle' }], steps: [{ id: 'a', name: 'A' }] }] });
    const c = b.trackers.find(t => t.id === 'plot').starts[0];
    assertEqual(condText(b, c), 'Kettle is in the scene');
    assertEqual(holds(b, freshState(b), c), false);
    assertEqual(holds(b, withHere(b, ['kettle']), c), true);
    const b2 = normalizeBoard({ v: 2, trackers: [...board().trackers, { id: 'plot', kind: 'steps', name: 'Plot', starts: [{ cast: 'cast', person: 'nobody' }], steps: [{ id: 'a', name: 'A' }] }] });
    assert(checkBoard(b2).some(x => x.sev === 'error' && /a person/.test(x.text)));
});

test('the helper is told who is here, where they hang out, and what the people here already know', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { knows: [{ id: 'k', fact: 'the lights flickered', how: 'saw' }] } });
    const s = castHelperSection(b, st, { placeName: h => (h.at === 'kitchen' ? 'Kitchen' : null) });
    assert(s.includes('- Kettle: IN THE SCENE; often found at Kitchen'));
    assert(s.includes('Already knows: the lights flickered'));
    assert(s.includes('- Gerry the Caterpillar: not in the scene'));
    assertEqual(castHelperSection(normalizeBoard({ v: 2, trackers: [{ id: 'c', kind: 'cast', name: 'Cast', people: [] }] }), {}), '');
    assert(autoTrackSystemPrompt({ cast: true }).includes('- PEOPLE:'));
    assert(autoTrackSystemPrompt({ cast: true }).includes('"people": [...]'));
    assert(autoTrackSchema({ cast: true }).value.properties.people);
    const ans = parseHelperAnswerAll('{"changes":[],"people":[{"person":"Kettle","event":"arrives","quote":"q"},{"person":"Kettle","event":"learns","fact":"f","how":"saw","quote":"q2"}]}');   // a "learns" event is still read
    const sp = splitPeopleEvents(ans.people, ans.cast, ans.learns);
    assertEqual([sp.presence.map(x => [x.person, x.here]), sp.learns.map(x => [x.fact, x.how])], [[['Kettle', true]], [['f', 'saw']]]);
    assertEqual(parseHelperAnswerAll('{"changes":[],"cast":[{"person":"Kettle","here":true}],"learns":[]}').cast.length, 1);
    // names a model invented live (2026-10-13), and a nested form
    const a = parseHelperAnswerAll('{"changes":[],"cast_learns":[{"person":"Kettle","fact":"x"}],"cast_presence":[{"person":"Kettle","here":true}]}');
    assertEqual([a.cast.length, a.learns.length], [1, 1]);
    const n = parseHelperAnswerAll('{"changes":[],"cast":{"presence":[{"person":"Kettle","here":false}],"learns":[{"person":"Kettle","fact":"y"}]}}');
    assertEqual([n.cast.length, n.learns.length, n.cast[0].here], [1, 1, false]);
});

test('coming in and leaving needs a quote; the newest line wins; no change is no change', () => {
    const b = board();
    const st = freshState(b);
    const r = validateCastChanges([
        { person: 'Kettle', here: true, quote: 'Kettle rattles in from the stove', reason: 'arrives', confidence: 'high' },
        { person: 'Gerry', here: true, quote: 'Gerry was mentioned once', reason: 'r', confidence: 'low' },
        { person: 'Nobody', here: true, quote: 'x', reason: 'r', confidence: 'low' },
    ], [], b, st, msgs('Kettle rattles in from the stove.'));
    assertEqual(r.changes.map(c => [c.person, c.field, c.from, c.to]), [['kettle', 'here', false, true]]);
    assertEqual(r.rejected.map(x => x.reason), ['quote not found in the messages', 'no such person in the cast']);
    // "Gerry" finds Gerry the Caterpillar by the first word
    const r2 = validateCastChanges([{ person: 'gerry', here: true, quote: 'Gerry crawls onto the table', reason: 'r', confidence: 'high' }], [], b, st, msgs('Gerry crawls onto the table.'));
    assertEqual(r2.changes.map(c => c.person), ['gerry']);
    const r3 = validateCastChanges([{ person: 'Kettle', here: false, quote: 'She stays out in the garden', reason: 'r', confidence: 'high' }], [], b, st, msgs('She stays out in the garden.'));
    assertEqual(r3.rejected.map(x => x.reason), ['no change']);
});

test('knowledge is earned: only someone in the scene (or coming in now) learns, with a quote, nothing twice, three a turn', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { knows: [{ id: 'k0', fact: 'the lights flickered', how: 'saw' }] } });
    const text = 'Kettle watches the toaster tape the fuse. Gerry is in the garden. The lights flickered.';
    const r = validateCastChanges([], [
        { person: 'Kettle', fact: 'The toaster fixed the fuse with tape', how: 'saw', quote: 'Kettle watches the toaster tape the fuse', reason: 'r', confidence: 'high' },
        { person: 'Gerry', fact: 'The fuse is fixed', how: 'heard', quote: 'Gerry is in the garden', reason: 'r', confidence: 'low' },
        { person: 'Kettle', fact: 'the lights flickered', how: 'saw', quote: 'The lights flickered', reason: 'r', confidence: 'high' },
        { person: 'Kettle', fact: 'Something else', how: 'saw', quote: 'not in the text', reason: 'r', confidence: 'high' },
    ], b, st, msgs(text));
    assertEqual(r.changes.map(c => [c.person, c.add.fact, c.add.how]), [['kettle', 'The toaster fixed the fuse with tape', 'saw']]);
    assertEqual(r.rejected.map(x => x.reason), ['not in the scene — they could not have learned it', 'already known', 'quote not found in the messages']);
    // Gerry coming in this very turn may learn in it
    const r2 = validateCastChanges([{ person: 'Gerry', here: true, quote: 'Gerry crawls in', reason: 'r', confidence: 'high' }],
        [{ person: 'Gerry', fact: 'Kettle is hiding something', how: 'saw', quote: 'Kettle hides the cord', reason: 'r', confidence: 'medium' }], b, st, msgs('Gerry crawls in. Kettle hides the cord.'));
    assertEqual(r2.changes.map(c => c.field), ['here', 'knows']);
    const many = ['the first long fact', 'the second long fact', 'the third long fact', 'the fourth long fact'].map(f => ({ person: 'Kettle', fact: f, how: 'saw', quote: f, reason: 'r', confidence: 'high' }));
    const r3 = validateCastChanges([], many, b, st, msgs('the first long fact, the second long fact, the third long fact, the fourth long fact'));
    assertEqual([r3.changes.length, r3.rejected.at(-1).reason], [3, 'at most 3 new facts per turn']);
});

test('applied changes are logged by message; Undo and a delete put everything back; an undone line stays undone', () => {
    const b = board();
    let st = freshState(b);
    const { changes } = validateCastChanges([{ person: 'Kettle', here: true, quote: 'Kettle rattles in', reason: 'r', confidence: 'high' }],
        [{ person: 'Kettle', fact: 'the fuse is taped', how: 'saw', quote: 'the fuse is taped', reason: 'r', confidence: 'high' }], b, st, msgs('Kettle rattles in; the fuse is taped.'));
    st = applyCastChanges(b, st, changes, 20);
    const c = b.trackers[2];
    assertEqual([personNow(st, c, c.people[0]).here, personNow(st, c, c.people[0]).knows.map(k => [k.fact, k.i])], [true, [['the fuse is taped', 20]]]);
    assertEqual(st.log.map(e => [e.kind, e.field, e.i]), [['cast', 'here', 20], ['cast', 'knows', 20]]);
    // Undo the knowledge only: she stays in the scene
    const u = undoCollectionChange(b, st, changes[1].logId);
    assertEqual([personNow(u.state, c, c.people[0]).here, personNow(u.state, c, c.people[0]).knows], [true, []]);
    const again = validateCastChanges([], [{ person: 'Kettle', fact: 'the fuse is taped', how: 'saw', quote: 'the fuse is taped', reason: 'r', confidence: 'high' }], b, u.state, msgs('the fuse is taped', 21));
    assertEqual(again.rejected.map(x => x.reason), ['undone before from this line']);
    // a delete back to message 19 rolls both back
    const r = rewindCollections(b, st, 19);
    assertEqual([personNow(r.state, c, c.people[0]).here, personNow(r.state, c, c.people[0]).knows, r.undone.length], [false, [], 2]);
    // a line older than her last change can't move her again
    const old = validateCastChanges([{ person: 'Kettle', here: false, quote: 'Kettle left earlier', reason: 'r', confidence: 'high' }], [], b, st, msgs('Kettle left earlier', 18));
    assertEqual(old.rejected.map(x => x.reason), ['older than their last change']);
});

test('by hand: in or out of the scene, wants, plans and a fact — each with Undo', () => {
    const b = board(), c = b.trackers[2];
    let st = handChange(b, freshState(b), 'cast', 'kettle', 'here', true, 5);
    st = handChange(b, st, 'cast', 'kettle', 'wants', 'to keep her shine', 6);
    st = handChange(b, st, 'cast', 'kettle', 'plans', [{ id: 'p1', text: 'polish before the party' }], 6);
    st = handChange(b, st, 'cast', 'kettle', 'knows', { fact: 'the party is on Day 4', how: 'told' }, 7);
    const now = personNow(st, c, c.people[0]);
    assertEqual([now.here, now.wants, now.plans.map(p => p.text), now.knows.map(k => k.fact)], [true, 'to keep her shine', ['polish before the party'], ['the party is on Day 4']]);
    assertEqual(st.log.map(e => e.who), ['hand', 'hand', 'hand', 'hand']);
    const plansUndo = undoCollectionChange(b, st, st.log[2].id).state;
    assertEqual(personNow(plansUndo, c, c.people[0]).plans.map(p => p.text), ['change the subject if he asks about the fuse']);   // back to the board's
    const wantsUndo = undoCollectionChange(b, st, st.log[1].id).state;
    assertEqual(personNow(wantsUndo, c, c.people[0]).wants, 'to be forgiven without admitting the fuse');
});

test('the director is told only about the people in the scene: card, wants, plans with ids, knowledge, last thought', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { knows: [{ id: 'k', fact: 'the toaster fixed it', how: 'saw' }], thoughts: { text: 'He hasn\'t noticed.', i: 3 } } });
    const u = directorUser(b, st, [{ name: 'Miinthe', mes: 'Who broke the fuse?' }], { cardText: () => 'A fussy copper kettle.', boardLines: ['DAY 3 · Evening'], placeName: () => 'Kitchen' });
    assert(u.includes('## Kettle') && u.includes('Who they are: A fussy copper kettle.') && u.includes('Often found at: Kitchen'));
    assert(u.includes('Plans: [b0] change the subject if he asks about the fuse'));
    assert(u.includes('Knows: the toaster fixed it (saw it)'));
    assert(u.includes("Last thought: He hasn't noticed."));
    assert(u.includes('Not in the scene (leave them out): Gerry the Caterpillar'));
    assert(u.includes('DAY 3 · Evening') && u.includes('Miinthe: Who broke the fuse?'));
    assert(!u.includes('## Gerry'));
    assertEqual(directorUser(board({ kettle: { appears: 'places' } }), freshState(b), []), '');   // nobody here, nobody who could come looking
    assertEqual(parseDirector('```json\n{"people":[{"person":"Kettle"}]}\n```').length, 1);
    assertEqual(parseDirector('nonsense'), []);
});

test('🔇 muted, or a cast with the director off: never thought for, never sent out — even when someone else brings the director in (bug hunt 2026-11-03)', () => {
    const b = board();
    const st = withHere(b, ['kettle', 'gerry'], { gerry: { muted: true } });
    const u = directorUser(b, st, [{ name: 'Miinthe', mes: 'Hello, both of you.' }]);
    assert(u.includes('## Kettle') && !u.includes('## Gerry'), 'only Kettle is directed');
    assert(u.includes('Also in the scene, but not yours to direct (leave them out): Gerry the Caterpillar'));
    const r = validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [] }, { person: 'Gerry', thoughts: 'quiet thoughts', plans: [{ id: null, text: 'nap', status: 'new' }], leave: true, speak: true }], b, st);
    assertEqual(r.changes.map(c => c.person), ['kettle']);
    assertEqual([r.leaves, r.wishes], [[], []]);
    const off = board({}, { director: false });
    assertEqual(directorUser(off, withHere(off, ['kettle']), [{ name: 'Miinthe', mes: 'Hi.' }]), '', 'director off for the cast: nothing to ask');
    assertEqual(validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [] }], off, withHere(off, ['kettle'])).changes, []);
});

test('walking out: the director says who wants to leave — never someone who only gets called in', () => {
    const b = board({ gerry: { speaks: 'call' } });
    const st = withHere(b, ['kettle', 'gerry']);
    const r = validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [], leave: true, leaveWhy: 'polishing to do' }, { person: 'Gerry', thoughts: 'y', plans: [], leave: true }], b, st);
    assertEqual(r.leaves, [{ cast: 'cast', person: 'kettle', why: 'polishing to do' }]);
    assertEqual(validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [], leave: false }], b, st).leaves, []);
});

test('the director\'s answer: a thought, plans kept / reworded / finished / new (at most three), wants only when given', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { plans: [{ id: 'p1', text: 'change the subject' }, { id: 'p2', text: 'hide the cord' }] } });
    const { changes, rejected } = validateDirector([
        { person: 'Kettle', thoughts: 'He is getting close.', why: 'he asked about the fuse', wants: null, plans: [
            { id: 'p1', text: 'change the subject — offer tea', status: 'keep' },
            { id: 'p2', text: 'hide the cord', status: 'done' },
            { id: null, text: 'blame a power surge', status: 'new' },
            { id: null, text: 'cry', status: 'new' },
            { id: null, text: 'move out', status: 'new' },
        ] },
        { person: 'Gerry', thoughts: 'hm', plans: [] },
    ], b, st);
    assertEqual(rejected.map(x => x.reason), ['not in the scene']);
    const th = changes.find(c => c.field === 'thoughts'), pl = changes.find(c => c.field === 'plans');
    assertEqual(th.to.text, 'He is getting close.');
    assertEqual(pl.to.map(p => p.text), ['change the subject — offer tea', 'blame a power surge', 'cry']);
    assert(pl.to.length <= MAX_PLANS);
    assertEqual(pl.to[0].id, 'p1');
    assertEqual([pl.added, pl.ended], [['blame a power surge', 'cry'], [{ text: 'hide the cord', status: 'done' }]]);
    assert(!changes.some(c => c.field === 'wants'));
    // a plan it didn't mention stays; the same answer twice changes nothing but the thought
    const st2 = applyCastChanges(b, st, changes, 21);
    const again = validateDirector([{ person: 'Kettle', thoughts: 'Still close.', plans: [{ id: pl.to[1].id, text: 'blame a power surge', status: 'keep' }] }], b, st2);
    assertEqual(again.changes.map(c => c.field), ['thoughts']);
    const w = validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [], wants: 'to tell the truth at last' }], b, st2);
    assertEqual(w.changes.find(c => c.field === 'wants').to, 'to tell the truth at last');
});

test('the director reports what someone in the scene learned — with a word-for-word quote, nothing known twice', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { knows: [{ id: 'k0', fact: 'the lights flickered', how: 'saw' }] } });
    const ms = msgs('While Kettle watches from the windowsill, the toaster tapes the cracked fuse shut. The lights flickered.');
    const { changes, rejected } = validateDirector([{ person: 'Kettle', thoughts: 'Oh dear.', plans: [], learned: [
        { fact: 'the toaster taped the fuse shut', how: 'saw', quote: 'the toaster tapes the cracked fuse shut' },
        { fact: 'the lights flickered', how: 'saw', quote: 'The lights flickered' },
        { fact: 'Miinthe broke it', how: 'heard', quote: 'Miinthe confessed to breaking it' },
        { fact: 'the toaster watched the windowsill', how: 'saw', kind: 'everyday', quote: 'While Kettle watches from the windowsill' },
    ] }], b, st, ms);
    assertEqual(changes.filter(c => c.field === 'knows').map(c => [c.add.fact, c.add.how, c.who]), [['the toaster taped the fuse shut', 'saw', 'director']]);
    assertEqual(rejected.map(x => x.reason), ['everyday — not worth knowing', 'already known', 'quote not found in the messages']);
    // a plain exit the helper missed: the director's "left" takes them out, with its quote
    const out = validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [], left: 'Kettle rolls out into the garden' }], b, st, msgs('Then Kettle rolls out into the garden.'));
    assertEqual(out.changes.filter(c => c.field === 'here').map(c => [c.from, c.to, c.who]), [[true, false, 'director']]);
    assertEqual(validateDirector([{ person: 'Kettle', thoughts: 'x', plans: [], left: 'she was never here' }], b, st, ms).changes.filter(c => c.field === 'here'), []);
    // the helper's events still read a "learns" event if one comes (older form)
    assertEqual(splitPeopleEvents([{ person: 'Kettle', event: 'learns', fact: 'f', how: 'saw', quote: 'q' }]).learns.length, 1);
});

test('the writer gets who is here, their plans and what they know — never thoughts or wants; the judge only who is here', () => {
    const b = board();
    const st = withHere(b, ['kettle'], { kettle: { plans: [{ id: 'p1', text: 'change the subject.' }, { id: 'p2', text: 'hide the cord before the party' }], thoughts: { text: 'SECRET THOUGHT' }, wants: 'SECRET WANT',
        knows: [{ id: 'k', fact: 'the toaster fixed the fuse', how: 'saw' }] } });
    const w = castLines(b, st);
    assertEqual(w, ['IN THE SCENE: Kettle',
        'KETTLE (acts on this, never says it outright): change the subject; hide the cord before the party.',
        "KETTLE knows: the toaster fixed the fuse (saw it). Anything else, Kettle doesn't know.",
        "Kettle's lines come in Kettle's own messages — never write them; what Kettle does may be mentioned in passing."]);
    assert(!w.join(' ').includes('SECRET'));
    assertEqual(castJudgeLines(b, st), ['IN THE SCENE: Kettle']);
    assertEqual(castLines(b, freshState(b)), []);
    // her entries are pinned while she is here (not the judge one); off on the cast → not pinned
    assertEqual(castPins(b, st), ['Kettle']);
    assertEqual(castPins(board({}, { pinHere: false }), st), []);
});

test('"Characters present": only for a cast that sets it', () => {
    assertEqual(presentNames(board(), withHere(board(), ['kettle'])), null);
    const b = board({}, { setsPresent: true });
    assertEqual(presentNames(b, withHere(b, ['kettle'])), ['Kettle']);
    assertEqual(presentNames(b, freshState(b)), []);
});

test('notices: a hidden person\'s knowledge and plans stay hidden; presence shows', () => {
    const b = board({ kettle: { hidden: true } });
    assertEqual(describeCastChange(b, { col: 'cast', person: 'kettle', field: 'knows', add: { fact: 'the secret', how: 'saw' } }), 'Kettle learned something (hidden)');
    assertEqual(describeCastChange(b, { col: 'cast', person: 'kettle', field: 'plans', added: ['blackmail him'] }), "Kettle's plans changed (hidden)");
    assertEqual(describeCastChange(b, { col: 'cast', person: 'kettle', field: 'here', to: true }), 'Kettle comes into the scene');
    const open = board();
    assertEqual(describeCastChange(open, { col: 'cast', person: 'kettle', field: 'plans', added: ['offer tea'], ended: [{ text: 'hide the cord', status: 'done' }] }), 'Kettle — new plan: offer tea · done: hide the cord');
    assertEqual(describeCastChange(open, { col: 'cast', person: 'kettle', field: 'knows', add: { fact: 'the fuse is taped', how: 'told' } }), 'Kettle now knows: the fuse is taped (was told)');
});

test('the board window keeps the cast: people with ids both ways, and the chat\'s cast state through a save', () => {
    const b = board();
    const w = toWindowBoard(b);
    const back = fromWindowBoard(w, 'T');
    assertEqual(back.trackers[2].people.map(p => [p.id, p.name, p.card || null, p.plans.length]), [['kettle', 'Kettle', 'Kettle NPC test.png', 1], ['gerry', 'Gerry the Caterpillar', null, 0]]);
    // a new person from the window gets an id
    w.trackers[2].people.push({ name: 'Spoon' });
    assertEqual(fromWindowBoard(w, 'T').trackers[2].people.at(-1).id, 'spoon');
    const st = withHere(b, ['kettle'], { kettle: { knows: [{ id: 'k', fact: 'x', how: 'saw' }] } });
    const bag = toWindowChat(b, st);
    assertEqual(bag.cast.kettle.here, true);
    const st2 = fromWindowChat(b, bag, st);
    assertEqual([st2.cast.cast.kettle.here, st2.cast.cast.kettle.knows.length], [true, 1]);
    // a bag without the cast keeps the stored cast state
    const st3 = fromWindowChat(b, { ...bag, cast: undefined }, st);
    assertEqual(st3.cast.cast.kettle.here, true);
});

test('the Timeline shows cast changes (not thoughts)', () => {
    const b = board();
    let st = handChange(b, freshState(b), 'cast', 'kettle', 'here', true, 5);
    st = applyCastChanges(b, st, [{ kind: 'cast', col: 'cast', person: 'kettle', field: 'thoughts', to: { text: 'hm' } }], 6);
    st = applyCastChanges(b, st, [{ kind: 'cast', col: 'cast', person: 'kettle', field: 'plans', who: 'director', to: [{ id: 'b0', text: 'reworded' }] }], 7);   // only reworded: not on the Timeline
    const ev = timelineEvents(b, [], st).filter(e => e.person);
    assertEqual(ev.map(e => [e.m, e.person, e.ctext]), [[5, 'Kettle', 'Kettle comes into the scene']]);
});

test('appearing at their places: a roll once per visit, 1 in N; a hit brings them in; a delete rolls it back', () => {
    const b = board({ kettle: { odds: 2 } });
    const k = b.trackers[2].people[0];
    assertEqual([appearsOf(k), oddsOf(k), appearsOf(b.trackers[2].people[1]), oddsOf(b.trackers[2].people[1])], ['plans', 2, 'plans', 3]);
    let st = freshState(b);   // the scene at the Kitchen, Kettle's place
    const miss = appearAtPlaces(b, st, () => 0.9);
    assertEqual(miss.map(c => [c.person, c.field]), [['kettle', 'rolled']]);
    st = applyCastChanges(b, st, miss, 4);
    assertEqual(appearAtPlaces(b, st, () => 0), []);   // already rolled for this visit
    // the scene moves away and back: a new visit, a new roll — this time a hit
    st.log.push({ id: 'pl1', i: 5, kind: 'place', col: 'where', from: 'kitchen', to: 'cellar' }, { id: 'pl2', i: 6, kind: 'place', col: 'where', from: 'cellar', to: 'kitchen' });
    const hit = appearAtPlaces(b, st, () => 0.1);
    assertEqual(hit.map(c => [c.field, c.to === true ? 'here' : 'roll']), [['rolled', 'roll'], ['here', 'here']]);
    assertEqual(hit[1].reason, 'turns up at Kitchen (1 in 2)');
    st = applyCastChanges(b, st, hit, 7);
    const c = b.trackers[2];
    assertEqual(personNow(st, c, k).here, true);
    assertEqual(arrivalLines(b, st, 7), ['JUST ARRIVED: Kettle — bring them into the scene now (they are often found here).']);
    assertEqual(arrivalLines(b, st, 8), []);   // one reply only
    assertEqual(describeCastChange(b, st.log.at(-1)), 'Kettle turns up at Kitchen (1 in 2)');
    // a delete back to 6 rolls back the roll and the arrival — the visit rolls again
    const r = rewindCollections(b, st, 6).state;
    assertEqual([personNow(r, c, k).here, appearAtPlaces(b, r, () => 0.9).length], [false, 1]);
    // off, or not at their place, or already here: no roll
    assertEqual(appearAtPlaces(board({ kettle: { appears: 'off' } }), freshState(board({ kettle: { appears: 'off' } })), () => 0), []);
    const away = freshState(b); away.places.where = 'cellar';
    assertEqual(appearAtPlaces(b, away, () => 0), []);
    assertEqual(appearAtPlaces(b, withHere(b, ['kettle']), () => 0), []);
});

test('coming looking: the director may send an away person with a plan — only "Appears: + plans", one a turn', () => {
    const b = board({ kettle: { plans: ['confront him about the fuse'] }, gerry: { plans: ['find the jam'], appears: 'places' } });
    const st = freshState(b);
    assertEqual(awayCandidates(b, st).map(x => x.p.id), ['kettle']);
    // someone who only just left can't come looking in the same turn
    const left = handChange(b, handChange(b, st, 'cast', 'kettle', 'here', true, 2), 'cast', 'kettle', 'here', false, 8);
    assertEqual([awayCandidates(b, left, 9).length, awayCandidates(b, left, 8 + MIN_AWAY).length], [0, 1]);
    const u = directorUser(b, st, [{ name: 'Miinthe', mes: 'I sit alone.' }]);
    assert(u.includes('AWAY (not in the scene') && u.includes('- Kettle: wants to be forgiven without admitting the fuse; plans: confront him about the fuse'));
    const ans = parseDirectorAll('{"people":[],"away":[{"person":"Gerry","comes":true},{"person":"Kettle","comes":true,"why":"she wants to confront him"}]}');
    const ch = validateComes(ans.away, b, st);
    assertEqual(ch.map(c => [c.person, c.field, c.to, c.arrive]), [['kettle', 'here', true, 'plan']]);
    const st2 = applyCastChanges(b, st, ch, 9);
    assertEqual(arrivalLines(b, st2, 9), ['JUST ARRIVED: Kettle — bring them into the scene now (they came looking for a reason of their own).']);
    assertEqual(describeCastChange(b, st2.log.at(-1)), 'Kettle comes looking for you — she wants to confront him');
    assertEqual(validateComes([{ person: 'Kettle', comes: false }], b, st), []);
    assertEqual(parseDirectorAll('nonsense'), { people: [], away: [] });
});

test('knowledge only from what was said while they were there', () => {
    const b = board();
    let st = handChange(b, freshState(b), 'cast', 'kettle', 'here', true, 10);   // back at 10
    const ms = [{ name: 'Miinthe', mes: 'The toaster tapes the fuse while nobody is looking.', _i: 8 }, { name: 'Miinthe', mes: 'Miinthe tells Kettle the cord is in the flour tin.', _i: 10 }];
    const r = validateCastChanges([], [
        { person: 'Kettle', fact: 'the toaster taped the fuse', how: 'saw', quote: 'The toaster tapes the fuse while nobody is looking', reason: 'r', confidence: 'high' },
        { person: 'Kettle', fact: 'the cord is in the flour tin', how: 'told', quote: 'Miinthe tells Kettle the cord is in the flour tin', reason: 'r', confidence: 'high' },
    ], b, st, ms);
    assertEqual(r.changes.map(x => x.add.fact), ['the cord is in the flour tin']);
    assertEqual(r.rejected.map(x => x.reason), ['before they came into the scene']);
});

test('the off-screen log: back after a while away → owed an entry; written once; its facts need no quote; the writer gets it once', () => {
    const b = board(), c = b.trackers[2], k = c.people[0];
    let st = handChange(b, freshState(b), 'cast', 'kettle', 'here', true, 2);
    assertEqual(backFrom(st, c, k), null);                          // first time here: nothing to tell
    st = handChange(b, st, 'cast', 'kettle', 'here', false, 3);
    assertEqual(leftAt(st, c, k), 3);
    st = handChange(b, st, 'cast', 'kettle', 'here', true, 3 + MIN_AWAY - 1);
    assertEqual(backFrom(st, c, k), null);                          // too short a time away
    st = handChange(b, st, 'cast', 'kettle', 'here', false, 7);
    st = handChange(b, st, 'cast', 'kettle', 'here', true, 14);
    assertEqual(backFrom(st, c, k), { left: 7, back: 14 });
    const changes = offscreenChanges(st, c, k, { did: 'searched the kitchen drawers; found the burnt cord; hid it in the flour tin', learned: [
        { fact: 'the burnt cord is in the flour tin', how: 'found', kind: 'secret' }, { fact: 'the drawers were tidy', how: 'saw', kind: 'everyday' }] }, 7, 14);
    assertEqual(changes.filter(x => x.field !== 'thoughts').map(x => [x.field, x.field === 'knows' ? x.add.fact : arr0(x.to).text]), [['offscreen', 'searched the kitchen drawers; found the burnt cord; hid it in the flour tin'], ['knows', 'the burnt cord is in the flour tin']]);
    st = applyCastChanges(b, st, changes, 14);
    assertEqual(backFrom(st, c, k), null);                          // written: not owed any more
    assertEqual(personNow(st, c, k).knows.map(x => [x.fact, x.offscreen]), [['the burnt cord is in the flour tin', true]]);
    assertEqual(offscreenLines(b, st, 14), ['KETTLE, while away: searched the kitchen drawers; found the burnt cord; hid it in the flour tin. (The story may show traces of it.)']);
    assertEqual(offscreenLines(b, st, 15), []);
    assertEqual(describeCastChange(b, st.log.find(e => e.field === 'offscreen')), 'Kettle, while away: searched the kitchen drawers; found the burnt cord; hid it in the flour tin');
    assertEqual(describeCastChange(board({ kettle: { hidden: true } }), st.log.find(e => e.field === 'offscreen')), 'Kettle was busy while away (hidden)');
    // a delete back to 13 takes it back: owed again
    const r = rewindCollections(b, st, 13).state;
    assertEqual([personNow(r, c, k).knows, personNow(r, c, k).here], [[], false]);
    // someone a plan sends looking comes with what they did before
    const b2 = board({ kettle: { plans: ['confront him today'] } });
    const comes = validateComes([{ person: 'Kettle', comes: true, why: 'it is time', did: 'polished herself for an hour, rehearsing what to say' }], b2, freshState(b2));
    assertEqual(comes.map(x => x.field), ['here', 'offscreen']);
    // asked by Miinthe: the prompt and the answer
    const u = offscreenUser(st, c, k, [{ name: 'Miinthe', mes: 'hello' }], { cardText: () => 'a kettle' });
    assert(u.startsWith('## Kettle') && u.includes('Earlier off-screen: searched the kitchen drawers'));
    assertEqual(parseOffscreen('{"did":"napped","learned":[]}'), { did: 'napped', learned: [] });
    assertEqual(parseOffscreen('nope'), null);
    assertEqual(offscreenChanges(st, c, k, { did: '' }), []);
});

test('walking out in their own message: a yes needs the words that show it, from that message', () => {
    const msg = 'Spoon clinks once, turns her back, and rattles out through the garden door.';
    assertEqual(exitFrom('{"leaves": true, "quote": "rattles out through the garden door"}', msg), 'rattles out through the garden door');
    assertEqual(exitFrom('{"leaves": true, "quote": "she storms off to Ostmark"}', msg), null);
    assertEqual(exitFrom('{"leaves": false, "quote": null}', msg), null);
    assertEqual(exitFrom('garbage', msg), null);
    // and the next message holding them back
    const next = 'The toaster rolls after her and gently tugs her handle. "Stay. Please." Spoon stops at the door.';
    assertEqual(exitFrom('{"back": true, "quote": "gently tugs her handle"}', next, 'back'), 'gently tugs her handle');
    assertEqual(exitFrom('{"back": false}', next, 'back'), null);
});


test('people stay behind when the scene moves without them, unless named or the group goes together', () => {
    const b = board(); const st = withHere(b, ['kettle']);
    const mv = [{ quote: 'I walk down to the cellar.', to: 'cellar' }];
    const msg = t => [{ mes: t, is_user: true, _i: 5 }];
    const r = leftBehind(b, st, mv, msg('I walk down to the cellar.'), [], () => 'Cellar');
    assertEqual(r.length, 1, 'Kettle stays behind'); assertEqual(r[0].here, false); assertEqual(r[0].quote, 'I walk down to the cellar.');
    assert(r[0].reason.includes('Cellar'), 'reason names the place');
    assertEqual(leftBehind(b, st, mv, msg('I take Kettle down to the cellar.')).length, 0, 'named: comes along');
    assertEqual(leftBehind(b, st, mv, msg('We all go down to the cellar together.')).length, 0, 'the group goes together');
    assertEqual(leftBehind(b, st, [], msg('I walk down to the cellar.')).length, 0, 'no place move: nobody leaves');
    assertEqual(leftBehind(b, st, mv, msg('I walk down to the cellar.'), [{ person: 'Kettle', here: true }]).length, 0, 'already reported by the helper');
});

summary();
