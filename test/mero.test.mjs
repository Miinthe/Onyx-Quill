/**
 * LOCAL PATCH suite — Mero ☆, the co-writer: talks, notes, the [Author's notes] block, [OOC: …] (2026-10-05).
 * Failures to avoid: a note reaching the writer that Miinthe didn't keep or switched off; a ⚡ flash note lasting
 * past its reply (or lost on a swipe); a sticky note counting swipes; a note "just for our talks" reaching the
 * writer; an [OOC] bracket reaching the writer; Mero's note markup showing up in her answer.
 * Run: npm run test:mero
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { askedForNote, asStore, normNote, inForce, hasRunOut, notesHere, authorNotesBlock, splitOoc, buildMeroPrompt, parseMeroAnswer, fallbackTitle, repliesAfter, scopeKey } from '../src/mero-pure.js';
import { boardSummary, namedTrackers, trackerDetails, mapHash, mapPrompt, parseMapAbouts, mapText, nowLine } from '../src/mero-board-pure.js';
import { asLore, newReplies, dueToLook, parseLook, applyChange, undoChange, beforeAfter, splitFile, isNotCanon } from '../src/mero-lore-pure.js';
import { asGlow, momentsOf, recentMoments, quietThreads, glowNow, momentOpener } from '../src/mero-glow-pure.js';
import { buildBoardMeroPrompt, parseBoardMero, readJson, boardText, meroBoardBlock } from '../src/board-mero-pure.js';

// chat: 0 user, 1 ai, 2 user, 3 ai, 4 user  → the next reply is index 5
const isAi = k => k % 2 === 1;
const note = (o = {}) => normNote({ kind: 'dont', text: 'Kettle never apologises first.', last: 'pinned', scope: 'chat', made: { i: 4 }, ...o });

test('replies are counted by new AI messages; a swipe is the same message', () => {
    assertEqual(repliesAfter(4, 5, isAi), 0);
    assertEqual(repliesAfter(2, 7, isAi), 2);
});

test('⚡ flash: in force for the next reply and its swipes, then never again', () => {
    const n = note({ last: 'flash' });
    assert(inForce(n, { replyIndex: 5, isAi }), 'the next reply');
    assert(inForce(n, { replyIndex: 5, lastIndex: 5, isAi }), 'a swipe of that reply (the message being swiped is 5)');
    assert(!inForce(n, { replyIndex: 7, isAi }), 'the reply after');
    assert(hasRunOut(n, { lastIndex: 5, isAi }) && !hasRunOut(n, { lastIndex: 4, isAi }));
});

test('📌 sticky: until N new replies; 📍 pinned: always; off, ended or "just for our talks": never', () => {
    const n = note({ last: 'sticky', until: { replies: 2 } });
    assert(inForce(n, { replyIndex: 5, isAi }) && inForce(n, { replyIndex: 7, isAi }) && !inForce(n, { replyIndex: 9, isAi }));
    assert(inForce(note(), { replyIndex: 99, isAi }));
    assert(!inForce(note({ on: false }), { replyIndex: 5, isAi }));
    assert(!inForce(note({ ended: true }), { replyIndex: 5, isAi }));
    assert(!inForce(note({ story: false }), { replyIndex: 5, isAi }), 'just for our talks never reaches the writer');
});

test('a chat note is undone when the chat is cut back before it was made; other rungs are not', () => {
    assert(!inForce(note({ made: { i: 8 } }), { replyIndex: 5, lastIndex: 4, isAi }));
    assert(inForce(note({ made: { i: 8 }, scope: 'char' }), { replyIndex: 5, lastIndex: 4, isAi }));
});

test('the ladder: notes from this chat, the run, the character and the board all apply', () => {
    const store = asStore({ notes: { char: { 'k.png': [note({ scope: 'char', text: 'Char note' })] }, run: { 'k.png|b': [note({ scope: 'run', text: 'Run note' })], 'k.png|a': [note({ text: 'Other run' })] }, board: { 'Toaster & Kettle': [note({ text: 'Board note' })] } } });
    const all = notesHere(store, [note({ text: 'Chat note' })], { charKey: 'k.png', run: 'b', board: 'Toaster & Kettle' });
    assertEqual(all.map(n => `${n.scope}:${n.text}`), ['chat:Chat note', 'run:Run note', 'char:Char note', 'board:Board note']);
    assertEqual(scopeKey('run', { charKey: 'k.png' }), '', 'no run, no run notes');
});

test('[Author\'s notes]: in force only, 🚫 first, ideas last and marked as possible threads', () => {
    const b = authorNotesBlock([note({ kind: 'idea', text: 'The party could go wrong.' }), note({ kind: 'steer', text: 'More slow burn.' }), note(), note({ on: false, text: 'Off' })], { replyIndex: 5, isAi });
    assertEqual(b.split('\n'), ['[Author\'s notes — follow these]', '🚫 DON\'T: Kettle never apologises first.', '🧭 STEER: More slow burn.', '💡 POSSIBLE THREAD (never force it): The party could go wrong.', '[End of author\'s notes]']);
    assertEqual(authorNotesBlock([note({ on: false })], { replyIndex: 5, isAi }), '');
});

test('[OOC: …]: hidden from the writer, kept for Mero; a message of only OOC is for Mero alone', () => {
    assertEqual(splitOoc('She slams the cupboard shut. [OOC: please don\'t make him cry] "Fine."'), { clean: 'She slams the cupboard shut. "Fine."', said: ['please don\'t make him cry'], onlyOoc: false });
    assertEqual(splitOoc('[OOC: just a question]').onlyOoc, true);
    assertEqual(splitOoc('No brackets here.').said, []);
});

test('Mero\'s answer: note cards and the title are taken out of the text she says', () => {
    const r = parseMeroAnswer('Girl, three apologies in six replies.\n\n[[NOTE kind=dont last=pinned scope=char]] Kettle never apologises first. [[/NOTE]]\n[[TITLE]] He apologises too fast [[/TITLE]]');
    assertEqual(r.text, 'Girl, three apologies in six replies.');
    assertEqual(r.cards, [{ kind: 'dont', last: 'pinned', scope: 'char', text: 'Kettle never apologises first.' }]);
    assertEqual(r.title, 'He apologises too fast');
    assertEqual(parseMeroAnswer('Just yapping.').cards, []);
    assertEqual(fallbackTitle('I keep wondering why the fridge never talks at parties'), 'I keep wondering why the fridge');
});

test('Mero\'s prompt: who she is, reading the room, what she knows; the talk as messages', () => {
    const p = buildMeroPrompt({ settings: { persona: 'Warm and nerdy.' }, talk: { tag: 'fb', msgs: [{ who: 'author', t: 'He apologises too much.' }, { who: 'mero', t: 'Agreed.' }] }, character: 'Kettle', board: ['Relationship: Friends'], replies: [{ i: 4, name: 'Kettle', text: 'Sorry!' }], talkNotes: [{ text: 'Miinthe loves quiet sulking.' }], firstAnswer: true });
    assert(p.system.includes('Mero ☆') && p.system.includes('Warm and nerdy.') && p.system.includes('Read the room') && p.system.includes('Feedback on a reply') && p.system.includes('[[KIND]]') && p.system.includes('Relationship: Friends') && p.system.includes('#4 Kettle: Sorry!') && p.system.includes('Miinthe loves quiet sulking.') && p.system.includes('[[TITLE]]'));
    assertEqual(p.messages, [{ role: 'user', content: 'He apologises too much.' }, { role: 'assistant', content: 'Agreed.' }]);
});

test('📚 a vault review: the whole vault goes along, never into the story chat; the talk remembers it is one', () => {
    const v = buildMeroPrompt({ talk: { msgs: [{ who: 'author', t: 'Look it over?' }] }, entries: [{ title: 'Last', content: 'x' }], vault: [{ title: 'Kettle', content: 'Steams when upset.' }, { title: 'Spoon', content: 'Stirs trouble.' }] }).system;
    assert(v.includes("The author's whole lore vault (2 entries)") && v.includes('### Kettle\nSteams when upset.') && v.includes('Never rewrite their entries') && !v.includes('Lore the writer was given'));
    assert(!buildMeroPrompt({ talk: { msgs: [] } }).system.includes('whole lore vault'));
    assertEqual(asStore({ chars: { 'k.png': { talks: [{ title: 'R', review: true, msgs: [] }] } } }).chars['k.png'].talks[0].review, true);
});

test('the store survives damage', () => {
    const s = asStore({ chars: { 'k.png': { talks: [{ title: 'T', msgs: [{ who: 'author', t: 'x' }, { who: 'bad', t: 'y' }, null] }, null] } }, notes: { char: { 'k.png': [{ text: '' }, { text: 'ok', kind: 'weird' }] } }, settings: { chatty: 'loud', initiative: 9 } });
    assertEqual(s.chars['k.png'].talks.length, 1);
    assertEqual(s.chars['k.png'].talks[0].msgs.length, 1);
    const t2 = asStore({ chars: { k: { talks: [{ msgs: [{ who: 'mero', t: 'x', cards: [{ kind: 'dont', text: 'Rule', state: 'kept', noteId: 'n1' }, { text: '' }] }] }] } } }).chars.k.talks[0];
    assertEqual(t2.msgs[0].cards, [{ kind: 'dont', last: 'pinned', scope: 'chat', text: 'Rule', state: 'kept', noteId: 'n1' }], 'cards stay with the message');
    assertEqual(s.notes.char['k.png'].map(n => n.kind), ['steer']);
    assertEqual([s.settings.chatty, s.settings.initiative], ['chatty', 4]);
});

// ── ☆ entry ideas (mero-lore-pure.js) — failures to avoid: a change written over text that moved; frontmatter
// touched; a hard-wrapped paragraph in her vault; Undo eating her own later edit; asking again about a "not canon" line.
const FILE = '---\ntags: [lorebook]\nkeys: [apple]\n---\n# Apple\n\nApples are red and green.\n\nThey grow in Windmere.\n';

test('Mero looks as her job says: off duty and freelancer never on their own, part-timer every 5 replies, full-timer after each', () => {
    assert(!dueToLook('off', 50) && !dueToLook('freelance', 50));
    assert(!dueToLook('part', 4) && dueToLook('part', 5));
    assert(dueToLook('full', 1) && !dueToLook('full', 0));
    assertEqual(newReplies(3, 8, isAi), [5, 7]);
    assertEqual(newReplies(-1, 4, isAi), [1, 3]);
});

test('ideas: only known entries, a quote and a real change; not canon and ones already waiting are left out; one line', () => {
    const ans = JSON.stringify({ changes: [
        { entry: 'apple', msg: 3, quote: 'She bit into the yellow apple.', add: 'Apples can also\nbe yellow.', why: 'new colour' },
        { entry: 'Pear', msg: 3, quote: 'x', add: 'y' },
        { entry: 'Apple', msg: 3, quote: '', add: 'no quote' },
        { entry: 'Apple', msg: 3, quote: 'q', add: '' },
        { entry: 'Apple', msg: 3, quote: 'It grows in Ostmark too', find: 'They grow in Windmere.', replace: 'They grow in Windmere and Ostmark.' },
    ] });
    const out = parseLook('Sure!\n```json\n' + ans + '\n```', { titles: ['Apple'] });
    assertEqual(out.length, 2);
    assertEqual(out[0].title, 'Apple');
    assertEqual(out[0].change, { add: 'Apples can also be yellow.' });
    assert(out[1].change.find === 'They grow in Windmere.');
    const nc = asLore({ notCanon: [{ title: 'Apple', q: 'she bit into the YELLOW apple' }] });
    assert(isNotCanon(nc, 'apple', 'She bit into the yellow apple.'));
    assertEqual(parseLook(ans, { titles: ['Apple'], lore: nc }).length, 1);
    assertEqual(parseLook(ans, { titles: ['Apple'], waiting: [{ entry: { title: 'Apple' }, q: 'other', change: { add: 'Apples can also be yellow.' } }] }).length, 1);
    assertEqual(parseLook('no json here', { titles: ['Apple'] }).length, 0);
});

test('add: a new paragraph at the end; the frontmatter stays byte for byte; Undo puts it back exactly', () => {
    const ch = { add: 'Apples can also be yellow.' };
    const a = applyChange(FILE, ch).content;
    assertEqual(splitFile(a).head, splitFile(FILE).head);
    assert(a.endsWith('They grow in Windmere.\n\nApples can also be yellow.\n'), a);
    assertEqual(undoChange(a, ch).content, FILE);
    const ba = beforeAfter(FILE, ch);
    assertEqual(ba.after, 'Apples can also be yellow.');
    assert(ba.pre.endsWith('They grow in Windmere.'));
});

test('rewrite: only an exact passage that is there once; Undo only while the entry reads as Mero left it', () => {
    const ch = { find: 'They grow in Windmere.', replace: 'They grow in Windmere and Ostmark.' };
    const a = applyChange(FILE, ch).content;
    assert(a.includes('They grow in Windmere and Ostmark.') && !a.includes('They grow in Windmere.\n'));
    assertEqual(undoChange(a, ch).content, FILE);
    assert(applyChange(FILE, { find: 'They grow in Frostholm.', replace: 'x' }).error, 'a passage that is not there');
    assert(applyChange('a b a b', { find: 'a', replace: 'c' }).error, 'a passage that is there twice');
    assert(undoChange(a.replace('and Ostmark', 'and Raikoh'), ch).error, 'Miinthe edited it since — no undo over her edit');
    assert(undoChange(FILE + 'More text.\n', { add: 'Apples can also be yellow.' }).error, 'added text no longer last');
    const ba = beforeAfter(FILE, ch);
    assertEqual([ba.before, ba.after], ['They grow in Windmere.', 'They grow in Windmere and Ostmark.']);
});

test('a file without frontmatter, and the "$" in a replacement, are written as given', () => {
    assertEqual(applyChange('Just text.', { add: 'More.' }).content, 'Just text.\n\nMore.\n');
    assertEqual(applyChange('Costs 5 coin.', { find: '5 coin', replace: '$& and $1' }).content, 'Costs $& and $1.');
});

test('settings: job part-timer and sign-off on by default; the old "entry changes" setting carried over', () => {
    const d = asStore(null).settings;
    assertEqual([d.job, d.signoff], ['part', true]);
    assertEqual([asStore({ settings: { entryChanges: 'auto' } }).settings.signoff, asStore({ settings: { entryChanges: 'auto' } }).settings.job], [false, 'part']);
    assertEqual(asStore({ settings: { entryChanges: 'off' } }).settings.job, 'off');
    assertEqual(asStore({ settings: { job: 'boss', signoff: 'no' } }).settings.job, 'part');
    assertEqual(asStore({ settings: { job: 'full', signoff: false, entryChanges: 'off' } }).settings.job, 'full', 'the new setting wins');
});

test('how chatty: three parts; a preset fills them; any other mix is custom; an old store keeps its level', () => {
    const d = asStore(null).settings;
    assertEqual([d.chatty, d.talk, d.bringUp, d.glow], ['chatty', 'some', false, 'big']);
    const v = asStore({ settings: { chatty: 'very' } }).settings;
    assertEqual([v.chatty, v.talk, v.bringUp, v.glow], ['very', 'lots', true, 'quiet']);
    const c = asStore({ settings: { talk: 'little', bringUp: false, glow: 'big' } }).settings;
    assertEqual(c.chatty, 'custom');
    assertEqual(asStore({ settings: { talk: 'little', bringUp: false, glow: 'off' } }).settings.chatty, 'quiet');
    assertEqual(asStore({ settings: { talk: 'yapper', bringUp: true, glow: 'quiet' } }).settings.chatty, 'very', 'the first build\'s names carried over');
});

// ── ✨ the glow (mero-glow-pure.js) — failures to avoid: a glow at Quiet; a back-move or a detour counted as big; a
// moment glowing again after Miinthe looked; a moment surviving the delete of its message; a paused thread called quiet.
const BOARD = { trackers: [
    { id: 'rel', kind: 'steps', name: 'Relationship', icon: '💞', starts: [], steps: [{ id: 's1', name: 'Strangers' }, { id: 's2', name: 'Friends', fork: { branches: [{ id: 'b1', name: 'Sweethearts' }, { id: 'b2', name: 'Rivals' }] } }, { id: 's3', name: 'Married' }] },
    { id: 'fuse', kind: 'steps', name: 'The Broken Fuse', starts: [{ x: 1 }], steps: [{ id: 'f1', name: 'Calm' }, { id: 'f2', name: 'Sparks' }] },
    { id: 'col', kind: 'collection', name: 'Stash' },
] };
const step = (id, i, col, from, to, extra = {}) => ({ id, i, kind: 'step', col, from, to, ...extra });

test('big moments: a step forward, a branch, a start, an ending — not a back-move or a detour', () => {
    assertEqual(momentsOf(BOARD, step('a', 10, 'rel', { at: 's1' }, { at: 's2' }, { quote: 'friends now' })).map(m => m.text), ['Relationship → Friends']);
    assertEqual(momentsOf(BOARD, step('b', 11, 'rel', { at: 's2' }, { at: 's1' })).length, 0);
    assertEqual(momentsOf(BOARD, step('c', 12, 'rel', { at: 's2' }, { at: 's2', aside: 'd1' })).length, 0);
    assertEqual(momentsOf(BOARD, step('d', 13, 'rel', { at: 's2', forks: {} }, { at: 's2', forks: { s2: 'b1' } })).map(m => m.text), ['Relationship took “Sweethearts” after Friends']);
    assertEqual(momentsOf(BOARD, step('e', 14, 'fuse', { at: null, waitAt: null }, { at: 'f1', started: true })).map(m => m.text), ['The Broken Fuse began']);
    assertEqual(momentsOf(BOARD, step('f', 15, 'rel', { at: 's3' }, { at: 's3', ended: { step: 's3' } })).map(m => m.text), ['Relationship ended']);
    assertEqual(momentsOf(BOARD, { kind: 'place', col: 'rel' }).length, 0);
});

test('the glow: off; on for a moment not seen yet; out once seen; a set-aside moment is gone; old ones too', () => {
    const st = { trackers: { rel: { at: 's2' } }, log: [step('a', 40, 'rel', { at: 's1' }, { at: 's2' })] };
    assertEqual(glowNow('off', BOARD, st, 45).glows, false);
    const g = glowNow('big', BOARD, st, 45);
    assert(g.glows && g.moments.length === 1);
    assertEqual(glowNow('big', BOARD, st, 45, asGlow({ seen: [g.moments[0].key] })).glows, false);
    assertEqual(glowNow('big', BOARD, st, 45, asGlow({ seen: [g.moments[0].key] })).moments.length, 1, 'still listed after looking');
    assertEqual(glowNow('big', BOARD, st, 45, asGlow({ done: [g.moments[0].key] })).moments.length, 0);
    assertEqual(recentMoments(BOARD, st, 40 + 30).length, 0, 'thirty messages later it is no longer "now"');
    assertEqual(recentMoments(BOARD, { log: [] }, 45).length, 0, 'its message deleted: the log entry went with it');
});

test('gone quiet (glow "big moments + quiet threads" only): a running thread with no move for 25 messages; not paused, ended or waiting', () => {
    const st = { trackers: { rel: { at: 's2' }, fuse: {} }, log: [step('a', 10, 'rel', { at: 's1' }, { at: 's2' })] };
    assertEqual(quietThreads(BOARD, st, 34).length, 0);
    const q = quietThreads(BOARD, st, 35);
    assertEqual(q.map(m => m.text), ['Relationship hasn\'t moved in 25 messages (still at Friends)']);
    assertEqual(glowNow('big', BOARD, st, 60).moments.length, 0, '"big moments" alone never says "gone quiet"');
    assertEqual(glowNow('quiet', BOARD, st, 60).moments.length, 1);
    assertEqual(quietThreads(BOARD, { ...st, trackers: { rel: { at: 's2', run: 'paused' } } }, 60).length, 0);
    assertEqual(quietThreads(BOARD, st, 60, asGlow({ done: [q[0].key] })).length, 0);
    const moved = { ...st, log: [...st.log, step('b', 50, 'rel', { at: 's2' }, { at: 's3' })] };
    assertEqual(quietThreads(BOARD, moved, 80, asGlow({ done: [q[0].key] })).length, 1, 'quiet again after a later move: asks again');
});

test('never a wall of cards: the newest 3, one per text', () => {
    const log = [10, 12, 14, 16, 18].map((i, k) => step('m' + k, i, 'rel', { at: k % 2 ? 's2' : 's1' }, { at: k % 2 ? 's3' : 's2' }));
    const g = glowNow('big', BOARD, { trackers: {}, log }, 20);
    assertEqual(g.moments.map(m => m.text), ['Relationship → Friends', 'Relationship → Married']);
    assertEqual(g.moments[0].i, 18, 'the newest of the repeats');
});

test('Mero opens the talk: the moments and their quotes, as her cue (never Miinthe\'s message)', () => {
    const t = momentOpener([{ text: 'Relationship → Friends', i: 40, quote: 'friends now' }]);
    assert(t.includes('Relationship → Friends') && t.includes('#40') && t.includes('“friends now”') && t.includes('you open this talk'));
});

test('Mero\'s prompt: how she talks; big moments lately; "brings things up" tells her to bring them up herself', () => {
    const a = buildMeroPrompt({ settings: { talk: 'some' }, talk: { msgs: [] }, moments: ['Relationship → Friends (#40)'] }).system;
    assert(a.includes('## Big moments lately\n- Relationship → Friends (#40)') && a.includes('natural length') && !a.includes('Bring things up yourself'));
    const b = buildMeroPrompt({ settings: { talk: 'little', bringUp: true }, talk: { msgs: [] }, moments: ['x'] }).system;
    assert(b.includes('bring them up yourself') && b.includes('Bring things up yourself') && b.includes('Say little'));
    assert(!buildMeroPrompt({ settings: {}, talk: { msgs: [] } }).system.includes('Big moments'));
});

// ── ☆ Mero on the board (overhaul 2026-10-17, src/board-mero-pure.js) ──
const BRIEF = { name: 'Toaster & Kettle', folders: ['Ladder/'], wiring: ['Secret starts when Relationship reaches Friends'],
    trackers: [{ id: 'rel', name: 'Relationship', kind: 'steps', steps: [{ name: 'Strangers', entries: ['Rung 1'] }, { name: 'Friends', entries: [] }] }, { id: 'inv', name: 'Inventory', kind: 'collection', items: ['Key'] }] };

test('board Mero: the board as she reads it (ids, steps with their entries, connections)', () => {
    const t = boardText(BRIEF);
    assert(t.includes('tracker id "rel"') && t.includes('0. Strangers [entries: Rung 1]') && t.includes('1. Friends [no entry]') && t.includes('Inventory (collection): Key') && t.includes('Secret starts when'));
    assert(boardText({}).includes('(no trackers yet)'));
});

test('board Mero: each job asks for JSON; her persona and the character ride along', () => {
    for (const task of ['tiles', 'draft', 'field', 'talk']) {
        const p = buildBoardMeroPrompt(task, { brief: BRIEF, list: 'steps', field: 'keys', words: 'slow burn' }, { persona: 'Warm and nerdy.', character: 'Kettle' });
        assert(p.system.includes('JSON only') && p.system.includes('Warm and nerdy.') && p.system.includes('with Kettle'), task);
    }
    assert(buildBoardMeroPrompt('draft', {}).system.includes('ONE line'), 'a draft keeps one paragraph on one line');
    assert(buildBoardMeroPrompt('talk', { brief: BRIEF, quick: 'gaps' }).user.includes('Find gaps'));
    assert(buildBoardMeroPrompt('talk', { brief: BRIEF, message: 'hi', talk: [{ who: 'you', t: 'earlier' }, { who: 'me', t: 'reply' }] }).user.includes('The author: earlier\nMero: reply'));
});

test('board Mero: tiles — new names only, cleaned, at most 8', () => {
    assertEqual(parseBoardMero('tiles', '```json\n{"tiles":["Rivals","  Allies ","Rivals","Friends"]}\n```', { have: ['friends'] }), { ok: true, tiles: ['Rivals', 'Allies'] });
    assertEqual(parseBoardMero('tiles', '{"tiles":[]}').ok, false);
    assertEqual(parseBoardMero('tiles', 'no json here').ok, false);
});

test('board Mero: a draft — one paragraph per line, a known kind, keys as a list', () => {
    const r = parseBoardMero('draft', 'Sure! {"title":"Harbor market","kind":"Location","keys":["market","docks","market"],"summary":"When the docks come up","text":"Every third day\nby the docks.\n\nFish and gossip."}');
    assertEqual(r, { ok: true, title: 'Harbor market', type: 'location', keys: ['market', 'docks'], summary: 'When the docks come up', body: 'Every third day by the docks.\n\nFish and gossip.' });
    assertEqual(parseBoardMero('draft', '{"title":"X","kind":"weird"}').type, '');
    assertEqual(parseBoardMero('draft', '{}').ok, false);
});

test('board Mero: Suggest fills one field', () => {
    assertEqual(parseBoardMero('field', '{"keys":["fuse","box"]}', { field: 'keys' }), { ok: true, keys: ['fuse', 'box'] });
    assertEqual(parseBoardMero('field', '{"summary":"When the fuse box\ncomes up"}', { field: 'summary' }), { ok: true, summary: 'When the fuse box comes up' });
    assertEqual(parseBoardMero('field', '{"summary":""}', { field: 'summary' }).ok, false);
});

test('board Mero: talk — suggestions only for what is on the board', () => {
    const r = parseBoardMero('talk', JSON.stringify({ text: 'Two things.', suggestions: [
        { kind: 'step', tracker: 'rel', name: 'Sweethearts', why: 'it stops early' },
        { kind: 'step', tracker: 'rel', name: 'friends' },               // already there
        { kind: 'step', tracker: 'nope', name: 'X' },                   // no such tracker
        { kind: 'step', tracker: 'inv', name: 'X' },                    // a collection has no steps
        { kind: 'entry', tracker: 'rel', step: 1, title: 'Rung 2 · Friends', why: 'no entry' },
        { kind: 'entry', tracker: 'rel', step: 7, title: 'Nope' },      // no such step
        { kind: 'tracker', name: 'Jealousy', icon: '💢', steps: ['Calm', 'Spark'], why: 'a subplot' },
        { kind: 'tracker', name: 'Relationship', steps: ['a', 'b'] },   // already a tracker
        { kind: 'tracker', name: 'One', steps: ['only'] },              // too few steps
        { kind: 'conn', tracker: 'rel' },                               // not a kind she offers
    ] }), { brief: BRIEF });
    assert(r.ok && r.text === 'Two things.');
    assertEqual(r.suggestions.map(x => `${x.kind}:${x.name || x.title}`), ['step:Sweethearts', 'entry:Rung 2 · Friends', 'tracker:Jealousy']);
    assertEqual(r.suggestions[1].i, 1);
    assertEqual(parseBoardMero('talk', 'Just words, no JSON.', { brief: BRIEF }), { ok: true, text: 'Just words, no JSON.', suggestions: [], asks: [] });
    assertEqual(parseBoardMero('talk', '', { brief: BRIEF }).ok, false);
    assertEqual(readJson('[1,2]'), null);
});

test('board Mero: she can not help while off duty or without an AI', () => {
    assert(meroBoardBlock({ job: 'off', connected: true }).includes('off duty'));
    assert(meroBoardBlock({ job: 'part', connected: false }).includes('AI & connections'));
    assertEqual(meroBoardBlock({ job: 'freelance', connected: true }), '');
});

test('Mero never keeps a made-up side for the author (a model finishing the pasted script wrote it)', () => {
    const r = parseMeroAnswer('Mero: I like where your mind is going!\n\nThe author: That sounds fun. How are you, Mero?\nMero: Great.');
    assertEqual(r.text, 'I like where your mind is going!');
    assertEqual(parseMeroAnswer('Mero: Love it.\nSam: And then?', { you: 'Sam', me: 'Mero' }).text, 'Love it.', 'the chosen names');
    assertEqual(parseMeroAnswer('Try it like this:\nLumine: "Hello there."', { you: 'Sam' }).text, 'Try it like this:\nLumine: "Hello there."', 'a quoted story line stays');
    assertEqual(parseMeroAnswer('Miinthe is a fine name for a heroine.').text, 'Miinthe is a fine name for a heroine.');
});

test('Mero\'s ground rules come last, after the story replies, and say she is not the writer', () => {
    const { system } = buildMeroPrompt({ talk: { tag: 'yap', msgs: [] }, replies: [{ i: 1, name: 'Corvin', text: 'He watched the fox.' }] });
    assert(system.indexOf('Ground rules') > system.indexOf('He watched the fox.'), 'rules after the replies');
    assert(system.includes('NOT the writer') && system.includes('Never write the author\'s side'), 'the rules');
});

test('Mero uses the names from her settings — and no name at all when none is set', () => {
    const talk = { tag: 'yap', msgs: [{ who: 'author', t: 'Miinthe here, hi!' }] };
    const plain = buildMeroPrompt({ talk, replies: [{ i: 1, name: 'Corvin', text: 'He watched the fox.' }] });
    assert(!plain.system.includes('Miinthe'), 'no name in her instructions by default');
    assert(plain.system.includes('Never call the author by a name'), 'told to use no name');
    assertEqual(plain.messages[0].content, 'Miinthe here, hi!', 'what the author wrote is never changed');
    const set = buildMeroPrompt({ talk, settings: { callMe: 'Sam', meroName: 'Mira' } }).system;
    assert(set.startsWith('You are Mero ☆, Sam\'s co-writer') && set.includes('Call the author "Sam".'), 'her chosen name for the author; Mero stays Mero (an old meroName is ignored)');
    assertEqual(asStore({ settings: { callMe: '  Miinthe  ', meroName: '' } }).settings.callMe, 'Miinthe');
});

const DB = { trackers: [
    { id: 'rel', kind: 'steps', name: 'Relationship', steps: [{ id: 'a', name: 'Foreign Envoy' }, { id: 'b', name: 'Known Envoy' }] },
    { id: 'ete', kind: 'steps', name: 'A Stolen Eternity', steps: [
        { id: 's1', name: 'The Stolen Bond', entries: ['Bond', 'Core'], kinds: {} },
        { id: 's2', name: 'The Return Offered', entries: ['Return', 'Core', 'Judge x'], kinds: { 'Judge x': 'judge' } }] },
    { id: 'where', kind: 'places', name: 'Where' },
] };
const DS = { trackers: { rel: { at: 'a' }, ete: { at: null } } };

test('Mero\'s board summary: names and where each stands, never the details', () => {
    assertEqual(boardSummary(DB, DS), ['Relationship: Foreign Envoy ← now → Known Envoy', 'A Stolen Eternity: The Stolen Bond → The Return Offered (not started)']);
});
test('a message that names a tracker, a step or a telling word looks that tracker up — nothing else', () => {
    assertEqual(namedTrackers('aging and eternity is the last interlude, look it up', DB), ['ete']);
    assertEqual(namedTrackers('what about the Known Envoy step?', DB), ['rel']);
    assertEqual(namedTrackers('hi! how are you', DB), []);
});
test('looked-up details: each step with its own entry (not the shared one, not the judge note)', () => {
    const d = trackerDetails(DB, 'ete', DS, t => ({ Bond: 'He took the bond.', Return: 'He offers it back.', Core: 'SHARED' }[t] || ''));
    assert(d.includes('- The Stolen Bond: He took the bond.') && d.includes('- The Return Offered: He offers it back.') && !d.includes('SHARED'), d);
});
test('without lookups she is told she sees names only; with them, to look it up; planning ends in the 💡 Pitch button', () => {
    const plan = buildMeroPrompt({ talk: { tag: 'plan', msgs: [{ who: 'author', t: 'x' }] }, boardMap: ['Relationship: Foreign Envoy ← now'] }).system;
    assert(plan.includes('never pretend you looked it up') && plan.includes('Relationship: Foreign Envoy ← now') && !plan.includes('search_lore'));
    assert(plan.includes('writing partner') && !plan.includes('[[PITCH') && plan.includes('💡 Pitch button'), 'planning: a partner; pitches through the button, never markup');
    const look = buildMeroPrompt({ talk: { tag: 'plan', msgs: [{ who: 'author', t: 'x' }] }, lookups: true }).system;
    assert(look.includes('search_lore') && look.includes('look it up first') && !look.includes('never pretend you looked it up'));
    assert(buildMeroPrompt({ talk: { msgs: [{ who: 'author', t: 'make it a pitch' }] }, pitchAsked: true }).system.includes('just asked for a pitch'));
    assert(!buildMeroPrompt({ talk: { tagMine: true, msgs: [] } }).system.includes('[[KIND]]'), 'a tag she picked is never re-sorted');
    assert(buildMeroPrompt({ talk: { tag: 'yap', msgs: [] } }).system.includes('Offer a note ONLY when'));
});

test('notes only when asked: "make that a note", "wrap up" or "note" in her message', () => {
    for (const t of ['make that a note', 'Wrap up: anything agreed?', 'can you note that?', 'note card please']) assert(askedForNote(t), t);
    for (const t of ['I like a dinner, Rén Lú arranges it', 'Notable idea!', 'what about Ottilie?']) assert(!askedForNote(t), t);
});

test('Mero\'s stored summary: written from the board, read back, names only when the answer is unreadable', () => {
    const p = mapPrompt(DB, t => ({ Bond: 'He took the bond.' }[t] || ''));
    assert(p.user.includes('## A Stolen Eternity (id: ete)') && p.user.includes('The Stolen Bond: He took the bond.') && /JSON only/.test(p.system));
    const ab = parseMapAbouts('```json\n{"trackers":[{"id":"ete","about":"An old bond taken and offered back."}]}\n```');
    assertEqual(ab, { ete: 'An old bond taken and offered back.' });
    assertEqual(parseMapAbouts('sorry, no'), {});
    assertEqual(mapText(DB, ab), 'Relationship\n  Steps: Foreign Envoy → Known Envoy\nA Stolen Eternity — An old bond taken and offered back.\n  Steps: The Stolen Bond → The Return Offered');
    assertEqual(nowLine(DB, DS), 'Where each stands in this chat — Relationship: Foreign Envoy · A Stolen Eternity: not started');
});
test('the summary is only written again when the trackers really changed', () => {
    const h = mapHash(DB);
    assertEqual(mapHash(JSON.parse(JSON.stringify(DB))), h);
    const moved = JSON.parse(JSON.stringify(DB)); moved.trackers[0].steps.push({ id: 'c', name: 'Liked Envoy' });
    assert(mapHash(moved) !== h);
    const noted = JSON.parse(JSON.stringify(DB)); noted.trackers[0].note = 'just a note'; assertEqual(mapHash(noted), h, 'a note alone changes nothing');
});

test('Chattiness: Custom picked on purpose stays Custom (its parts show), a preset sets its parts, a changed part makes it Custom', () => {
    assertEqual(asStore({ settings: { chatty: 'custom', talk: 'some', bringUp: false, glow: 'big' } }).settings.chatty, 'custom', 'parts like Chatty, still Custom');
    assertEqual(asStore({ settings: { chatty: 'chatty', talk: 'lots', bringUp: false, glow: 'big' } }).settings.chatty, 'custom', 'a part changed');
    assertEqual(asStore({ settings: { chatty: 'very', talk: 'lots', bringUp: true, glow: 'quiet' } }).settings.chatty, 'very');
    assertEqual(asStore({ settings: { chatty: 'chatty' } }).settings.chatty, 'chatty', 'an older store with only the preset');
});

test('writing guides: Mero reads those in this chat\'s folders, capped; the writer never gets them', async () => {
    const { guidesIn, guidesText, GUIDE_MAX } = await import('../src/mero-pure.js');
    const idx = [
        { title: 'House style', guide: true, content: 'Present tense. No head-hopping.' },                         // outside any folder: everywhere
        { title: 'Dragon voice', guide: true, folderPath: 'Dragon/Guides', content: 'Formal, archaic.' },
        { title: 'Other story voice', guide: true, folderPath: 'Other', content: 'Slang.' },
        { title: 'Lore, not a guide', folderPath: 'Dragon', content: 'x' },
    ];
    assertEqual(guidesIn(idx, ['Dragon']).map(g => g.title), ['House style', 'Dragon voice']);
    assertEqual(guidesIn(idx, null).map(g => g.title), ['House style', 'Dragon voice', 'Other story voice'], 'no folder filter: all guides');
    const big = Array.from({ length: 9 }, (_, k) => ({ title: 'G' + k, content: 'w '.repeat(1000) }));
    assert(guidesText(big).length <= GUIDE_MAX, 'capped');
    const sys = buildMeroPrompt({ talk: { tag: 'plan', msgs: [] }, guides: guidesIn(idx, ['Dragon']) }).system;
    assert(sys.includes('Notes the author wrote for you only') && sys.includes('Present tense') && sys.includes('Formal, archaic') && !sys.includes('Slang'));
    assert(!buildMeroPrompt({ talk: { tag: 'plan', msgs: [] } }).system.includes('writing guides'), 'no guides: no section');
});

summary('mero');
