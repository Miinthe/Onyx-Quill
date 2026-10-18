/**
 * LOCAL PATCH suite — the Cast, step 3: their own voice and the queue (2026-10-13, `12 cast and agendas design.md` §11b).
 * Failures to avoid: another NPC's plans or knowledge (or anyone's thoughts) in an NPC's prompt; "Kettle: Kettle:" left in
 * her message; the main writer seeing her message as its own (its next reply came back empty in the experiment); a queue
 * that loses "You", runs a "suggests" NPC by itself, or lets a "call only" NPC in on its own; people not in the scene in it.
 * Run: npm run test:cast-voice
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, normalizeState } from '../src/board-model-pure.js';
import { personNow, validateDirector } from '../src/cast-pure.js';
import {
    npcPrompt, storyLinesFor, stripName, writerSeesNpcs, normalizeQueue, newRound, moveItem, removeItem, addItem, setText, isMine, aiNpcs,
    queueText, npcMessagesOf, npcOfMessage, speaksOf, regenRound, SPEAKS_WORDS,
} from '../src/cast-voice-pure.js';

const board = (kettle = {}, gerry = {}) => normalizeBoard({ v: 2, trackers: [{ id: 'cast', kind: 'cast', name: 'Cast', people: [
    { id: 'kettle', name: 'Kettle', card: 'Kettle NPC test.png', plans: ['change the subject'], ...kettle },
    { id: 'gerry', name: 'Gerry', ...gerry },
    { id: 'spoon', name: 'Spoon', speaks: 'call' },
] }] });
const here = (b, ids) => { const st = freshState(b); for (const id of ids) st.cast.cast[id] = { here: true }; return st; };

test('a person\'s "when they speak" defaults to suggests themselves', () => {
    const b = board({ speaks: 'self' }, { speaks: 'nonsense' });
    assertEqual(b.trackers[0].people.map(speaksOf), ['self', 'suggest', 'call']);
});

test('✍️ "you write their lines" survives the board and never steps in or suggests themselves', () => {
    const b = board({ speaks: 'mine' });
    assertEqual(speaksOf(b.trackers[0].people[0]), 'mine');
    assertEqual(SPEAKS_WORDS.mine, '✍️ you write their lines');
});

test('🔇 muted: never steps into a new round, never offered — the board stays as it was', () => {
    const b = board({ speaks: 'self' }, { speaks: 'suggest' });
    const st = here(b, ['kettle', 'gerry']);
    st.cast.cast.kettle.muted = true; st.cast.cast.gerry.muted = true;
    const r = newRound(b, st, [{ cast: 'cast', person: 'kettle' }, { cast: 'cast', person: 'gerry' }]);
    assertEqual(r.queue.map(x => x.kind), ['you', 'main']);
    assertEqual(r.suggest, []);
});

test('a chat keeps 🔇 muted and what someone did while away when it is read back', () => {
    const b = board();
    const st = normalizeState({ v: 2, cast: { cast: { kettle: { muted: true, offscreen: [{ text: 'fixed the fuse', from: 3, to: 9 }, { nope: 1 }] } } } }, b);
    assertEqual(st.cast.cast.kettle, { muted: true, offscreen: [{ text: 'fixed the fuse', from: 3, to: 9 }] });
});

test('★ a favorite is kept on the board; nothing else is starred', () => {
    const b = board({ fav: true }, { fav: 'yes' });
    assertEqual(b.trackers[0].people.map(p => !!p.fav), [true, false, false]);
});

test('her prompt: her card, her plans and knowledge, the story — never another NPC\'s plans or knowledge, never thoughts', () => {
    const b = board();
    const st = here(b, ['kettle']);
    st.cast.cast.kettle.knows = [{ id: 'k', fact: 'the toaster taped the fuse', how: 'saw' }];
    st.cast.cast.kettle.thoughts = { text: 'SECRET THOUGHT' };
    const story = storyLinesFor(['IN THE SCENE: Kettle, Gerry', 'GERRY (acts on this, never says it outright): steal the jam.', 'GERRY knows: where the jam is (saw it). Anything else, Gerry doesn\'t know.', 'WORLD: Day 3 · Morning']);
    assertEqual(story, ['IN THE SCENE: Kettle, Gerry', 'WORLD: Day 3 · Morning']);
    const m = npcPrompt({ npc: { name: 'Kettle', description: '{{char}} is a copper kettle who calls {{user}} dear.', personality: 'fussy', mes_example: '<START>\n{{char}}: Oh, dear.' },
        userName: 'Miinthe', mainName: 'Toaster', now: personNow(st, b.trackers[0], b.trackers[0].people[0]), storyLines: story, lore: 'Kettle is old.', messages: [{ name: 'Miinthe', mes: 'Who broke it?' }] });
    const sys = m[0].content;
    assert(sys.includes('Kettle is a copper kettle who calls Miinthe dear.') && sys.includes('Personality: fussy') && sys.includes('Kettle: Oh, dear.'));
    assert(sys.includes('- change the subject') && sys.includes('- the toaster taped the fuse (saw it)') && sys.includes("Anything else, Kettle doesn't know"));
    assert(sys.includes('WORLD: Day 3') && sys.includes('Kettle is old.') && sys.includes('Never write for Miinthe or Toaster'));
    assert(!sys.includes('steal the jam') && !sys.includes('SECRET THOUGHT'));
    assertEqual(m[1].content, 'The story so far:\n\nMiinthe: Who broke it?\n\nWrite Kettle\'s message now.');
});

test('a goodbye: her prompt tells her to say so and go; the round keeps it', () => {
    const b = board();
    const m = npcPrompt({ npc: { name: 'Kettle' }, userName: 'Miinthe', mainName: 'Toaster', exit: { why: 'polishing to do' } });
    assert(m[0].content.includes('In this message Kettle leaves the scene (polishing to do): let them say so, in their own way, and go.'));
    assert(!npcPrompt({ npc: { name: 'Kettle' } })[0].content.includes('leaves the scene'));
    const q = normalizeQueue([{ id: 'k', kind: 'npc', cast: 'cast', person: 'kettle', exit: { why: 'bored' } }, { kind: 'main' }], b);
    assertEqual(q[0].exit, { why: 'bored' });
    assertEqual(addItem([], { kind: 'npc', cast: 'cast', person: 'kettle', exit: { why: null } })[0].exit, { why: null });
});

test('her "Kettle:" at the start goes (once, twice, in bold); the rest stays', () => {
    assertEqual(stripName('Kettle', 'Kettle: Kettle: *A whistle.* Oh, dear.'), '*A whistle.* Oh, dear.');
    assertEqual(stripName('Kettle', '**Kettle:** Oh.'), 'Oh.');
    assertEqual(stripName('Kettle', 'Oh. Kettle: is my name.'), 'Oh. Kettle: is my name.');
});

test('the main writer sees her message as someone else talking (user side, "Kettle: …"), and only hers', () => {
    const chat = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'The toaster hums.' },
        { role: 'assistant', content: 'Kettle: Kettle: *A sharp whistle.* Oh, dear.' },
        { role: 'user', content: 'Miinthe: hi' },
    ];
    const n = writerSeesNpcs(chat, npcMessagesOf([{ name: 'Toaster', mes: 'The toaster hums.' }, { name: 'Kettle', mes: '*A sharp whistle.* Oh, dear.', extra: { dle_npc: { cast: 'cast', person: 'kettle' } } }]));
    assertEqual(n, 1);
    assertEqual(chat.map(m => [m.role, m.content]), [['system', 'sys'], ['assistant', 'The toaster hums.'], ['user', 'Kettle: *A sharp whistle.* Oh, dear.'], ['user', 'Miinthe: hi']]);
    assertEqual(npcOfMessage({ extra: { dle_npc: { cast: 'c', person: 'p' } } }), { cast: 'c', person: 'p' });
    assertEqual(npcOfMessage({ extra: {} }), null);
});

test('a new round: You, then the AI half — "steps in" NPCs who want to, then the main character; "suggests" offered; "call only" never', () => {
    const b = board({ speaks: 'suggest' }, { speaks: 'self' });
    const st = here(b, ['kettle', 'gerry', 'spoon']);
    const r = newRound(b, st, [{ cast: 'cast', person: 'kettle', why: 'he asked her' }, { cast: 'cast', person: 'gerry' }, { cast: 'cast', person: 'spoon' }]);
    assertEqual(r.queue.map(x => [x.kind, x.person ?? null]), [['you', null], ['npc', 'gerry'], ['main', null]]);
    assertEqual(r.suggest, [{ cast: 'cast', person: 'kettle', why: 'he asked her' }]);
    assertEqual(queueText(b, r.queue), 'You → Gerry → Main character');
    assertEqual(newRound(b, st, []).queue.map(x => x.kind), ['you', 'main']);
    assertEqual(newRound(b, here(b, []), [{ cast: 'cast', person: 'gerry' }]).queue.map(x => x.kind), ['you', 'main']);   // not in the scene: not in it
});

test('your half first, the AI half after — ▲ ▼ never move an AI line above one of yours (Miinthe: "that\'s a disconnect")', () => {
    let q = [{ id: 'y', kind: 'you' }, { id: 'm', kind: 'main' }];
    q = addItem(q, { kind: 'npc', cast: 'cast', person: 'spoon' });            // the AI writes: before the main character
    q = addItem(q, { kind: 'npc', cast: 'cast', person: 'kettle', text: 'Oh, dear.' });   // you write: your half
    assertEqual(q.map(x => x.person ?? x.kind), ['you', 'kettle', 'spoon', 'main']);
    q = moveItem(q, q[1].id, -1);                                              // Kettle before you: fine, both yours
    assertEqual(q.map(x => x.person ?? x.kind), ['kettle', 'you', 'spoon', 'main']);
    assertEqual(moveItem(q, q[2].id, -1).map(x => x.person ?? x.kind), ['kettle', 'you', 'spoon', 'main']);   // Spoon (AI) can't go above you
    assertEqual(moveItem(q, q[3].id, -1).map(x => x.person ?? x.kind), ['kettle', 'you', 'main', 'spoon']);   // within the AI half: fine
    // writing as Spoon moves her to your half; letting the AI write again moves her back, before the main character
    const sp = q.find(x => x.person === 'spoon').id;
    q = setText(q, sp, 'Clink.');
    assertEqual([q.map(x => x.person ?? x.kind), isMine(q.find(x => x.id === sp))], [['kettle', 'you', 'spoon', 'main'], true]);
    q = setText(q, sp, '');
    assertEqual(q.map(x => x.person ?? x.kind), ['kettle', 'you', 'spoon', 'main']);
    assertEqual(aiNpcs(q).map(x => x.person), ['spoon']);
    // You and the main character can always be added again, once
    assertEqual(addItem(removeItem(q, q.find(x => x.kind === 'you').id), { kind: 'you' }).filter(x => x.kind === 'you').length, 1);
    assertEqual(addItem(q, { kind: 'you' }).filter(x => x.kind === 'you').length, 1);
    assertEqual(addItem(removeItem(q, q.find(x => x.kind === 'main').id), { kind: 'main' }).at(-1).kind, 'main');
    // a stored round is repaired: unknown people out, one You, one main, your half first
    const b = board();
    const r = normalizeQueue([{ kind: 'main' }, { kind: 'npc', cast: 'cast', person: 'nobody' }, { kind: 'you' }, { kind: 'you' }, { id: 'k', kind: 'npc', cast: 'cast', person: 'kettle', text: '  ' }, 'junk', { kind: 'main' }], b);
    assertEqual(r.map(x => [x.kind, x.person ?? null]), [['you', null], ['main', null], ['npc', 'kettle']]);
});

test('the director says who wants to speak after the reply — not someone who just left', () => {
    const b = board();
    const st = here(b, ['kettle', 'gerry']);
    const { wishes } = validateDirector([
        { person: 'Kettle', thoughts: 'x', plans: [], speak: true, speakWhy: 'he asked her straight out' },
        { person: 'Gerry', thoughts: 'y', plans: [], speak: true, left: 'Gerry crawls out of the window' },
        { person: 'Spoon', thoughts: 'z', plans: [], speak: true },
    ], b, st, [{ mes: 'Gerry crawls out of the window.' }]);
    assertEqual(wishes, [{ cast: 'cast', person: 'kettle', why: 'he asked her straight out' }]);
});

test('regenerate redoes the whole round after your last message, like a group chat — your own lines stay', () => {
    const npc = (person, byYou) => ({ is_user: false, mes: 'x', extra: { dle_npc: { cast: 'cast', person, ...(byYou ? { byYou: true } : {}) } } });
    const ai = { is_user: false, mes: 'reply', extra: {} }, you = { is_user: true, mes: 'hi' };
    assertEqual(regenRound([ai, you, ai, npc('kettle'), npc('spoon')]).speakers, [{ cast: 'cast', person: 'kettle' }, { cast: 'cast', person: 'spoon' }]);
    // the round's order, to play it again the same way — Kettle first, then the main character
    assertEqual(regenRound([you, npc('kettle'), ai]).seq, [{ kind: 'npc', cast: 'cast', person: 'kettle' }, { kind: 'main' }]);
    assertEqual(regenRound([you, ai]), null);                                  // no NPC in the round: SillyTavern's own regenerate
    assertEqual(regenRound([you, ai, npc('kettle', true), ai, npc('spoon')]).from, 3);   // a line you wrote as Kettle stays
    assertEqual(regenRound([you]), null);
});

summary();
