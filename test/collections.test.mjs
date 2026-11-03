/**
 * LOCAL PATCH suite — collections and the purse in play (2026-10-05, storyboard stage 3 round 2).
 * Failures to avoid: a clue uncovered without a quote; an item had that the purse can't pay
 * for (or paid twice); an item opening before its line holds; money below 0; a hidden clue
 * named to the writer; a delete or an Undo that leaves a change standing; a change Miinthe undid
 * coming back from the same line.
 * Run: npm run test:collections
 */
import { stepTurn } from '../src/turn-pure.js';   // engine on v2, step 7
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, holds, toEngineList, fromEngineList, condText, normalizeState } from '../src/board-model-pure.js';
import { setExternalConditions, unmetNeeds, conditionText } from '../src/conditions-pure.js';
import {
    helperSection, validateCollectionChanges, applyCollectionChanges, undoCollectionChange, rewindCollections,
    describeCollectionChange, collectionLines, filterByItems, writerLabelOf,
    addPending, dropPending, growItem, keptChange, findDraft, growFolderOf, describeFind, cleanFindName,
} from '../src/collections-pure.js';
import { toWindowChat, fromWindowChat } from '../src/board-window-pure.js';

const board = () => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'fuse', name: 'The Broken Fuse', steps: [{ id: 'calm', name: 'Calm' }, { id: 'rep', name: 'Repair', fork: { branches: [{ id: 'ok', name: 'Success' }, { id: 'fail', name: 'Fail' }] } }] },
    { id: 'clues', kind: 'collection', name: 'Clues', states: [{ id: 'hidden', label: 'hidden' }, { id: 'uncovered', label: 'uncovered' }, { id: 'lost', label: 'lost', strike: true }],
        items: [{ id: 'cord', name: 'Burnt cord', entries: ['Clue · Burnt cord'] }, { id: 'scorch', name: 'Scorch mark', needs: [{ tracker: 'fuse', at: 'rep', branch: 'fail' }] }, { id: 'alibi', name: "Kettle's alibi" }] },
    { id: 'stash', kind: 'collection', name: 'Kitchen stash', amounts: true, purse: [{ id: 'usd', unit: '$', start: 8 }],
        states: [{ id: 'none', label: 'not yet' }, { id: 'have', label: 'have' }, { id: 'used', label: 'used up' }, { id: 'lost', label: 'lost' }],
        items: [{ id: 'tape', name: 'Tape', entries: ['Item · Duct tape'], cost: { purse: 'usd', amount: 5 } }, { id: 'fuse2', name: 'Spare fuse', cost: { purse: 'usd', amount: 12 } }, { id: 'key', name: 'Rusty key' }] },
] });
const msgs = text => [{ mes: text, _i: 20 }];
const item = (collection, it, state, quote, extra = {}) => ({ collection, item: it, state, quote, reason: 'r', confidence: 'high', ...extra });

test('the helper is told every running collection, its states, items and money', () => {
    const s = helperSection(board(), freshState(board()));
    assert(s.includes('- Clues — states in order: "hidden", "uncovered", "lost"'));
    assert(s.includes('- Kitchen stash — states in order: "not yet", "have", "used up", "lost"; counts how many; money $8'));
    assert(s.includes('"Tape" (not yet, costs $5)'));
    const st = freshState(board()); st.runs = { clues: 'paused' };
    assert(!helperSection(board(), st).includes('Clues'), 'a paused collection is not watched');
});

test('a clue plainly found is uncovered; a quote not in the messages is not', () => {
    const b = board(), st = freshState(b), m = msgs('Behind the fridge lies a burnt cord, scorched black.');
    const ok = validateCollectionChanges([item('clues', 'burnt cord', 'Uncovered', 'a burnt cord, scorched black')], [], b, st, m);
    assertEqual(ok.changes.map(c => [c.item, c.to.state]), [['cord', 'uncovered']]);
    const bad = validateCollectionChanges([item('Clues', 'Burnt cord', 'uncovered', 'a cord that glows green')], [], b, st, m);
    assertEqual(bad.rejected[0].reason, 'quote not found in the messages');
});

test('unknown things are refused; a new thing is reported as found (collections that grow come later)', () => {
    const b = board(), st = freshState(b), m = msgs('She pockets a rusty spoon.');
    const r = validateCollectionChanges([item('Kitchen stash', 'Rusty spoon', 'have', 'pockets a rusty spoon'), item('Kitchen stash', 'Tape', 'shiny', 'pockets a rusty spoon'), item('Pockets', 'Tape', 'have', 'pockets a rusty spoon')], [], b, st, m);
    assertEqual(r.changes, []);
    assertEqual(r.rejected.map(x => x.reason), ['not on the list', '"shiny" is not one of its states', 'no running collection by that name']);
    assertEqual(r.rejected[0].found, { collection: 'Kitchen stash', item: 'Rusty spoon', quote: 'pockets a rusty spoon' });
});

test('an item waits for its line: the scorch mark only once the fuse ends in Fail', () => {
    const b = board(), st = freshState(b), m = msgs('A black scorch mark on the wall.');
    const r = validateCollectionChanges([item('Clues', 'Scorch mark', 'uncovered', 'A black scorch mark')], [], b, st, m);
    assertEqual([r.changes.length, r.rejected[0].reason, r.rejected[0].needs], [0, 'needs', ['The Broken Fuse ends in Fail']]);
    st.trackers.fuse = { at: 'rep', forks: { rep: 'fail' } };
    assertEqual(validateCollectionChanges([item('Clues', 'Scorch mark', 'uncovered', 'A black scorch mark')], [], b, st, m).changes.length, 1);
});

test('buying: the purse pays the cost; too little money → refused; two buys in one go are both counted', () => {
    const b = board(), st = freshState(b), m = msgs('She buys a roll of tape and a spare fuse at the market.');
    const one = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', 'buys a roll of tape')], [], b, st, m);
    assertEqual([one.changes[0].pay, one.changes[0].to], [{ purse: 'usd', amount: 5 }, { state: 'have', amount: 1 }]);
    const both = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', 'buys a roll of tape'), item('Kitchen stash', 'Spare fuse', 'have', 'a spare fuse at the market')], [], b, st, m);
    assertEqual(both.changes.length, 1, '$8 pays the tape, not also the $12 fuse');
    assertEqual(both.rejected[0].reason, 'cannot afford');
    const after = applyCollectionChanges(b, st, one.changes, 20);
    assertEqual(after.collections.stash.purse.usd, 3);
    assertEqual(describeCollectionChange(b, one.changes[0]), 'Kitchen stash: Tape → have (paid $5)');
});

test('money: gained and spent, never below 0', () => {
    const b = board(), st = freshState(b), m = msgs('He finds ten dollars under the mat. Later he spends twenty on cake.');
    const r = validateCollectionChanges([], [{ collection: 'Kitchen stash', change: 10, quote: 'finds ten dollars under the mat', reason: 'r', confidence: 'high' }], b, st, m);
    const s2 = applyCollectionChanges(b, st, r.changes, 20);
    assertEqual(s2.collections.stash.purse.usd, 18);
    assertEqual(describeCollectionChange(b, r.changes[0]), 'Kitchen stash: +$10 → $18');
    const r2 = validateCollectionChanges([], [{ collection: 'Kitchen stash', change: -20, quote: 'spends twenty on cake' }], b, st, m);
    assertEqual(r2.rejected[0].reason, 'more than there is');
});

test('amounts: "have" counts at least 1; a given amount is taken', () => {
    const b = board(), st = freshState(b), m = msgs('She grabs three rusty keys.');
    const r = validateCollectionChanges([item('Kitchen stash', 'Rusty key', 'have', 'grabs three rusty keys', { amount: 3 })], [], b, st, m);
    assertEqual(r.changes[0].to, { state: 'have', amount: 3 });
    const r1 = validateCollectionChanges([item('Kitchen stash', 'Rusty key', 'have', 'grabs three rusty keys')], [], b, st, m);
    assertEqual(r1.changes[0].to, { state: 'have', amount: 1 });
});

test('undo puts it back (purse too) and the same line never re-applies it', () => {
    const b = board(), st = freshState(b), m = msgs('She buys a roll of tape.');
    const ch = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', 'buys a roll of tape')], [], b, st, m).changes;
    const s2 = applyCollectionChanges(b, st, ch, 20);
    const u = undoCollectionChange(b, s2, ch[0].logId);
    assertEqual([u.state.collections.stash.items, u.state.collections.stash.purse.usd], [{}, 8]);
    const again = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', 'buys a roll of tape')], [], b, u.state, m);
    assertEqual(again.rejected[0].reason, 'undone before from this line');
    assert(undoCollectionChange(b, u.state, ch[0].logId).error, 'twice: nothing to undo');
});

test('a delete rolls later changes back, newest first; earlier ones stay', () => {
    const b = board();
    const at = (text, i) => [{ mes: text, _i: i }];
    let st = freshState(b);
    st = applyCollectionChanges(b, st, validateCollectionChanges([item('Clues', 'Burnt cord', 'uncovered', 'there is a burnt cord behind the fridge')], [], b, st, at('Look, there is a burnt cord behind the fridge.', 5)).changes, 5);
    st = applyCollectionChanges(b, st, validateCollectionChanges([item('Clues', 'Burnt cord', 'lost', 'the cord is gone from the drawer')], [], b, st, at('Oh no, the cord is gone from the drawer!', 9)).changes, 9);
    st = applyCollectionChanges(b, st, validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', 'she buys a roll of tape')], [], b, st, at('Then she buys a roll of tape.', 9)).changes, 9);
    assertEqual(st.log.length, 3);
    const r = rewindCollections(b, st, 6);
    assertEqual(r.undone.length, 2);
    assertEqual(r.state.collections.clues.items.cord, { state: 'uncovered' }, 'message 5 stays');
    assertEqual([r.state.collections.stash.items, r.state.collections.stash.purse.usd], [{}, 8]);
    assertEqual(r.state.log.length, 1);
    assertEqual(rewindCollections(b, r.state, 6).undone, [], 'nothing more');
});

test('a change older than the item\'s last change does not apply again', () => {
    const b = board();
    let st = freshState(b);
    st = applyCollectionChanges(b, st, validateCollectionChanges([item('Clues', 'Burnt cord', 'uncovered', 'there is a burnt cord behind the fridge')], [], b, st, [{ mes: 'Look, there is a burnt cord behind the fridge.', _i: 12 }]).changes, 12);
    const r = validateCollectionChanges([item('Clues', 'Burnt cord', 'lost', 'the cord is gone from the drawer')], [], b, st, [{ mes: 'Oh no, the cord is gone from the drawer!', _i: 10 }]);
    assertEqual(r.rejected[0].reason, 'older than its last change');
});

test('the writer: kept items with their content, money; hidden ones never named', () => {
    const b = board();
    let st = freshState(b);
    st.collections.clues.items.cord = { state: 'uncovered' };
    st.collections.clues.items.alibi = { state: 'lost' };
    st.collections.stash.items.tape = { state: 'have', amount: 2 };
    st.collections.stash.purse.usd = 3;
    const lines = collectionLines(b, st, { contentOf: t => (t === 'Item · Duct tape' ? 'A roll of silver duct tape — fixes almost anything.' : t === 'Clue · Burnt cord' ? 'Scorched black behind the fridge.' : '') });
    assertEqual(lines, [
        'CLUES: Burnt cord (uncovered) · Content: Scorched black behind the fridge.',
        "CLUES: Kettle's alibi (lost)",
        'ITEM: Tape ×2 · Content: A roll of silver duct tape — fixes almost anything.',
        'MONEY: $3',
    ]);
    assert(!lines.join(' ').includes('Scorch mark'), 'the hidden clue stays hidden');
    assertEqual(collectionLines(b, st, { forJudge: true, contentOf: () => 'x' })[0], 'CLUES: Burnt cord (uncovered)', 'the judge gets names only');
    st.runs = { clues: 'paused' };
    assert(!collectionLines(b, st).some(l => l.startsWith('CLUES')), 'paused: nothing');
    assertEqual(writerLabelOf({ name: 'Suspects', writerLabel: 'suspect' }), 'SUSPECT');
});

test('entries linked on an item exist only once it is past its first state', () => {
    const b = board(), st = freshState(b);
    const entries = [{ title: 'Clue · Burnt cord' }, { title: 'Item · Duct tape' }, { title: 'Other' }];
    assertEqual(filterByItems(entries, b, st).map(e => e.title), ['Other']);
    st.collections.clues.items.cord = { state: 'uncovered' };
    assertEqual(filterByItems(entries, b, st).map(e => e.title), ['Clue · Burnt cord', 'Other']);
    assertEqual(filterByItems(entries, b, st, e => e.title.startsWith('Item')).length, 3, 'pinned stays');
});

test('lines on collections hold from the chat state (3 clues uncovered, $5 in the purse)', () => {
    const b = board(), st = freshState(b);
    assert(!holds(b, st, { collection: 'clues', count: 2, state: 'uncovered' }));
    st.collections.clues.items = { cord: { state: 'uncovered' }, alibi: { state: 'uncovered' } };
    assert(holds(b, st, { collection: 'clues', count: 2, state: 'uncovered' }));
    assert(holds(b, st, { collection: 'stash', purse: 'usd', min: 5 }));
});

test('the engine: a tracker waits for a collection line, and starts once it holds', () => {
    const b = normalizeBoard({ v: 2, name: 'T', trackers: [
        { id: 'clues', kind: 'collection', name: 'Clues', states: [{ id: 'h', label: 'hidden' }, { id: 'u', label: 'uncovered' }], items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
        { id: 'stash', kind: 'collection', name: 'Stash', purse: [{ id: 'usd', unit: '$', start: 2 }], states: [{ id: 'n', label: 'not yet' }, { id: 'y', label: 'have' }], items: [] },
        { id: 'rev', name: 'Reveal', starts: [{ collection: 'clues', count: 2, state: 'u' }], steps: [{ id: 's1', name: 'Doubt' }, { id: 's2', name: 'Accuse', needs: [{ collection: 'stash', purse: 'usd', min: 5 }] }] },
    ] });
    const st = freshState(b);
    setExternalConditions(c => holds(b, st, c), c => condText(b, c));
    const list = toEngineList(b, st);
    assertEqual(list[0].starts, [{ ext: { collection: 'clues', count: 2, state: 'u' } }]);
    assertEqual(stepTurn(b, st, 3).events, [], 'no clues yet → waits');   // the turn on v2 (engine step 7)
    assertEqual(conditionText(list[0].starts[0], list), '2 of the Clues are uncovered');
    st.collections.clues.items = { a: { state: 'u' }, b: { state: 'u' } };
    assertEqual(stepTurn(b, st, 4).events.filter(e => e.kind === 'start').map(x => x.why), ['2 of the Clues are uncovered']);
    assertEqual(unmetNeeds(list[0], 1, list).length, 1, 'Accuse needs $5, there is $2');
    st.collections.stash.purse.usd = 5;
    assertEqual(unmetNeeds(list[0], 1, list).length, 0);
    setExternalConditions(() => false, () => '');
});

test('a purchase reported twice (item + money spent) is paid once', () => {
    const b = board(), st = freshState(b), m = msgs('At the market she buys a roll of duct tape with her coins.');
    const q = 'she buys a roll of duct tape with her coins';
    const r = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', q)], [{ collection: 'Kitchen stash', change: -5, quote: q, reason: 'r', confidence: 'medium' }], b, st, m);
    assertEqual([r.changes.length, r.rejected[0].reason], [1, 'already paid by the item']);
    assertEqual(applyCollectionChanges(b, st, r.changes, 20).collections.stash.purse.usd, 3);
    // a real second spend in the same message still counts, relative to what is left
    const r2 = validateCollectionChanges([item('Kitchen stash', 'Tape', 'have', q)], [{ collection: 'Kitchen stash', change: -2, quote: 'with her coins', reason: 'r', confidence: 'high' }], b, st, [{ mes: 'At the market she buys a roll of duct tape with her coins. She also tips the clerk with her coins.', _i: 20 }]);
    assertEqual(r2.changes.length, 2);
    assertEqual(applyCollectionChanges(b, st, r2.changes, 20).collections.stash.purse.usd, 1, '8 − 5 − 2');
});

test('cloud bug hunt 2026-10-04: an item\'s line reads where the engine\'s trackers stand now, not the last window save', () => {
    const b = board(), stored = freshState(b), m = msgs('A black scorch mark on the wall.');
    // the engine took Fail at the fork (trackers.js list); the stored v2 state still says Calm
    const engine = toEngineList(b, stored, []).map(t => (t.id === 'fuse' ? { ...t, index: 1, took: { Repair: 'Fail' }, ended: { step: 'Repair', branch: 'Fail', i: 20 } } : t));
    const now = fromEngineList(b, stored, engine);
    assertEqual(validateCollectionChanges([item('Clues', 'Scorch mark', 'uncovered', 'A black scorch mark')], [], b, stored, m).changes.length, 0, 'stale state: refused');
    assertEqual(validateCollectionChanges([item('Clues', 'Scorch mark', 'uncovered', 'A black scorch mark')], [], b, now, m).changes.length, 1, 'with the engine\'s positions (board-live.js live()): taken');
});

// ── collections that grow (2026-10-04) ──────────────────────────────────────
const growing = (ask = 'ask') => normalizeBoard({ v: 2, name: 'T', folders: ['The Kitchen/'], trackers: [
    { id: 'stash', kind: 'collection', name: 'Kitchen stash', amounts: true, grows: true, growAsk: ask, purse: [{ id: 'usd', unit: '$', start: 8 }],
        keep: { entries: ['Judge · Worth keeping'], kinds: { 'Judge · Worth keeping': 'judge' } },
        states: [{ id: 'none', label: 'not yet' }, { id: 'have', label: 'have' }, { id: 'used', label: 'used up' }],
        items: [{ id: 'tape', name: 'Tape', cost: { purse: 'usd', amount: 5 } }] },
    { id: 'clues', kind: 'collection', name: 'Clues', states: [{ id: 'hidden', label: 'hidden' }, { id: 'uncovered', label: 'uncovered' }], items: [{ id: 'cord', name: 'Burnt cord' }] },
] });
const keyMsg = [{ mes: 'She pockets the rusty key from under the mat.', _i: 30 }];
const newKey = (extra = {}) => item('Kitchen stash', 'Rusty Key', 'have', 'pockets the rusty key', { new: true, about: 'A small rusty key, found under the mat.', ...extra });

test('a growing collection tells the helper it takes new items, with Miinthe\'s "worth keeping" rule; others don\'t', () => {
    const s = helperSection(growing(), freshState(growing()), { judgeText: t => (t === 'Judge · Worth keeping' ? 'Keys and tools, never food.' : '') });
    assert(s.includes('This collection takes NEW items') && s.includes('Worth keeping: Keys and tools, never food.'));
    assertEqual(s.split('takes NEW items').length, 2, 'only the growing one');
    assert(helperSection(growing(), freshState(growing())).includes('Worth keeping: only what the story plainly keeps'), 'a plain default without a judge entry');
});

test('a new thing on a growing collection becomes a find (asks first by default); on a fixed list it is left alone', () => {
    const b = growing();
    const r = validateCollectionChanges([newKey()], [], b, freshState(b), keyMsg);
    assertEqual(r.changes.length, 1);
    const f = r.changes[0];
    assertEqual([f.kind, f.name, f.to.state, f.to.amount, f.ask, f.at], ['find', 'Rusty Key', 'have', 1, true, 30]);
    assertEqual(validateCollectionChanges([newKey()], [], growing('auto'), freshState(b), keyMsg).changes[0].ask, false, '"add on their own"');
    const fixed = validateCollectionChanges([item('Clues', 'Footprint', 'uncovered', 'pockets the rusty key', { new: true })], [], b, freshState(b), keyMsg);
    assertEqual(fixed.changes, []);
    assertEqual(fixed.rejected[0].reason, 'not on the list');
    assertEqual(validateCollectionChanges([newKey({ quote: 'never said' })], [], b, freshState(b), keyMsg).rejected[0].reason, 'quote not found in the messages');
    assertEqual(validateCollectionChanges([newKey({ state: 'not yet' })], [], b, freshState(b), keyMsg).changes[0].to.state, 'have', 'never the first state');
});

test('a waiting find is not asked twice; a name Miinthe said no to is never asked again in this chat', () => {
    const b = growing();
    const ch = validateCollectionChanges([newKey()], [], b, freshState(b), keyMsg).changes[0];
    const { state: st, id } = addPending(b, freshState(b), ch, 31);
    const p = st.collections.stash.pending[0];
    assertEqual([p.name, p.m, p.q, p.state, p.amount], ['Rusty Key', 30, 'pockets the rusty key', 'have', 1]);
    assert(p.summary.startsWith('A small rusty key, found under the mat. Select when Rusty Key comes up.') && p.body === 'A small rusty key, found under the mat.');
    assertEqual(validateCollectionChanges([newKey({ item: 'rusty key' })], [], b, st, keyMsg).rejected[0].reason, 'already asked');
    assert(helperSection(b, st).includes('Do not report again: "Rusty Key"'));
    const no = dropPending(st, 'stash', id, { refuse: true });
    assertEqual(no.state.collections.stash.pending, []);
    assertEqual(no.state.collections.stash.refused, ['Rusty Key']);
    assertEqual(validateCollectionChanges([newKey()], [], b, no.state, keyMsg).rejected[0].reason, 'not wanted');
    assertEqual(dropPending(st, 'stash', id).state.collections.stash.refused, undefined, 'Keep it: not remembered as refused');
});

test('keeping: the item joins the board with its entry; one already listed gets +1 instead of a copy', () => {
    const b = growing();
    const g = growItem(b, 'stash', 'Rusty Key', 'Rusty Key');
    const it = g.board.trackers[0].items.at(-1);
    assertEqual([g.dup, it.name, it.entries], [false, 'Rusty Key', ['Rusty Key']]);
    assertEqual(normalizeBoard(g.board, 'T').trackers[0].items.length, 2, 'the grown board stays valid');
    const ch = keptChange(g.board, freshState(g.board), 'stash', g.itemId, { state: 'have', amount: 1, q: 'pockets the rusty key', why: 'kept', conf: 'high' });
    const st = applyCollectionChanges(g.board, freshState(g.board), [ch], 31);
    assertEqual(st.collections.stash.items[g.itemId], { state: 'have', amount: 1 });
    assert(collectionLines(g.board, st).includes('ITEM: Rusty Key'), 'the writer now gets it');
    const again = growItem(g.board, 'stash', 'rusty key', null);
    assertEqual([again.dup, again.itemId, again.board.trackers[0].items.length], [true, g.itemId, 2]);
    const st2 = applyCollectionChanges(g.board, st, [keptChange(g.board, st, 'stash', g.itemId, { state: 'have', amount: 1, q: 'another key' })], 40);
    assertEqual(st2.collections.stash.items[g.itemId].amount, 2);
    const u = undoCollectionChange(g.board, st2, st2.log.at(-1).id);
    assertEqual(u.state.collections.stash.items[g.itemId].amount, 1, 'Undo takes the +1 back');
});

test('the drafted entry: its folder (own → collection → board → Items/), only the story\'s words', () => {
    const b = growing();
    assertEqual(growFolderOf(b, b.trackers[0]), 'The Kitchen/');
    assertEqual(growFolderOf({ folders: [] }, { growFolder: 'Loot/' }), 'Loot/');
    assertEqual(growFolderOf({}, {}), 'Items/');
    const d = findDraft(b, b.trackers[0], { name: '"Rusty Key."', about: '' });
    assertEqual([d.title, d.keys, d.body, d.summary], ['Rusty Key', ['Rusty Key'], '', 'Select when Rusty Key comes up.']);
    assertEqual(cleanFindName('  “the  glue”  '), 'the glue');
    assertEqual(describeFind(b, { col: 'stash', name: 'Rusty Key', to: { state: 'have', amount: 2 } }), 'Kitchen stash: new — Rusty Key (have ×2)');
});

test('a delete takes a waiting find from a message that is gone; the window keeps waiting finds and refusals', () => {
    const b = growing();
    const ch = validateCollectionChanges([newKey()], [], b, freshState(b), keyMsg).changes[0];
    let st = addPending(b, freshState(b), ch, 31).state;
    st = dropPending(addPending(b, st, { ...ch, name: 'Glue', at: 10 }, 10).state, 'stash', 'none').state;
    st.collections.stash.refused = ['Old shoe'];
    assertEqual(rewindCollections(b, st, 29).state.collections.stash.pending.map(p => p.name), ['Glue']);
    assertEqual(rewindCollections(b, st, 30).state.collections.stash.pending.length, 2);
    const back = fromWindowChat(b, toWindowChat(b, normalizeState(st, b)), st);
    assertEqual([back.collections.stash.pending.length, back.collections.stash.refused], [2, ['Old shoe']]);
});

summary('collections');
