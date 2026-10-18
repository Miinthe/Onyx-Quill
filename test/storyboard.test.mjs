/**
 * LOCAL PATCH suite — storyboards, the foundation (2026-10-03).
 * A board owns the trackers' definitions; each chat keeps only its place. The
 * failure to avoid: a chat silently losing or jumping its place when the board
 * changes. Run: npm run test:storyboard
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { mergeBoard, makeBoard, withIds, defsDiffer, freeBoardName, asStore, newTrackerId, noteRename, resolveBoardName } from '../src/storyboard-pure.js';
import { newTracker, moveTo, record, recordRefusal, pruneAfter } from '../src/trackers-pure.js';

const REL = ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Married'];
const chatPlace = () => withIds([moveTo(newTracker('Relationship', REL), 2, 5), newTracker('The Broken Fuse', ['Calm', 'Sparks', 'Repair'])]);

test('a board made from a chat keeps definitions only, with stable ids', () => {
    const b = makeBoard('Toaster & Kettle', chatPlace());
    assertEqual(b.trackers.map(t => t.id).join(','), 'relationship,the-broken-fuse', 'ids');
    assert(!('index' in b.trackers[0]) && !('journal' in b.trackers[0]), 'no place on the board');
    assertEqual(newTrackerId('Relationship', ['relationship']), 'relationship-2', 'unique id');
});

test('merge: the chat keeps its place; a tracker new to the chat starts at step 1', () => {
    const place = chatPlace();
    const b = makeBoard('B', place);
    b.trackers.push({ id: 'mystery', name: 'Mystery', steps: ['Crime', 'Clues'], direction: 'forward', skip: false });
    const { list, lost } = mergeBoard(b, place, newTracker);
    assertEqual(list[0].index, 2, 'Relationship still at Friends');
    assertEqual(list[0].journal.length, 2, 'history kept');
    assertEqual(list[2].index, 0, 'new tracker at step 1');
    assertEqual(lost.length, 0, 'nothing lost');
});

test('merge: renamed tracker keeps its place (by id); reordered steps follow the step by name', () => {
    const place = chatPlace();
    const b = makeBoard('B', place);
    b.trackers[0] = { ...b.trackers[0], name: 'Romance', steps: ['Strangers', 'Friends', 'Neighbours', 'Sweethearts', 'Married'] };
    const { list } = mergeBoard(b, place, newTracker);
    assertEqual(list[0].name, 'Romance', 'renamed');
    assertEqual(list[0].steps[list[0].index], 'Friends', 'still at Friends after the reorder');
});

test('merge: a step removed from the board is reported, never moved silently', () => {
    const place = chatPlace();
    const b = makeBoard('B', place);
    b.trackers[0] = { ...b.trackers[0], steps: ['Strangers', 'Neighbours', 'Sweethearts', 'Married'] };
    const { list, lost } = mergeBoard(b, place, newTracker);
    assertEqual(lost.length, 1, 'reported');
    assertEqual(lost[0].step, 'Friends', 'names the step');
    assertEqual(list[0].index, 0, 'at step 1 until moved');
});

test('merge: a tracker removed from the board leaves the chat view', () => {
    const place = chatPlace();
    const b = makeBoard('B', place);
    b.trackers = b.trackers.slice(0, 1);
    assertEqual(mergeBoard(b, place, newTracker).list.length, 1, 'only the board\'s trackers');
});

test('defsDiffer: only definitions count, not the place', () => {
    const place = chatPlace();
    const b = makeBoard('B', place);
    assert(!defsDiffer(b, place.map(t => moveTo(t, 3, 9))), 'moving is not a board change');
    assert(defsDiffer(b, place.map((t, i) => (i ? t : { ...t, skip: true }))), 'skip is a board change');
});

test('store and names', () => {
    const s = asStore({ boards: { 'A': {} } });
    assertEqual(freeBoardName(s, 'A'), 'A (2)', 'free name');
    assertEqual(Object.keys(asStore(null).boards).length, 0, 'damaged store tolerated');
});

test('history: who, when, quote, reason, confidence; refusals pruned like the journal', () => {
    const j = record([], 7, 3, null, { who: 'auto', quote: 'a kiss', reason: 'a kiss plainly makes them sweethearts', confidence: 'high' });
    assertEqual(j[0].reason, 'a kiss plainly makes them sweethearts', 'reason kept');
    let t = recordRefusal(newTracker('R', REL), 9, { why: 'Married skips Sweethearts — stayed at Friends' });
    t = recordRefusal(t, 12, { why: 'x' });
    assertEqual(t.refused.filter(r => r.i <= 10).length, 1, 'prunable by message');
    assertEqual(pruneAfter(j, 6).length, 0, 'journal pruned');
});

await test('cloud bug hunt 2026-10-04: a renamed board is followed by chats still holding the old name', () => {
    const s = asStore({ boards: { 'Toaster & Kettle': { name: 'Toaster & Kettle', trackers: [] } } });
    s.boards['T&K'] = s.boards['Toaster & Kettle']; delete s.boards['Toaster & Kettle'];
    noteRename(s, 'Toaster & Kettle', 'T&K');
    assertEqual(resolveBoardName(s, 'Toaster & Kettle'), 'T&K');
    s.boards['Kitchen'] = s.boards['T&K']; delete s.boards['T&K'];
    noteRename(s, 'T&K', 'Kitchen');
    assertEqual(resolveBoardName(s, 'Toaster & Kettle'), 'Kitchen', 'two renames in a row');
    assertEqual(resolveBoardName(s, 'T&K'), 'Kitchen');
    assertEqual(resolveBoardName(s, 'Kitchen'), 'Kitchen');
    assertEqual(resolveBoardName(s, 'Never existed'), null);
    assertEqual(asStore(JSON.parse(JSON.stringify(s))).renamed, { 'Toaster & Kettle': 'Kitchen', 'T&K': 'Kitchen' }, 'kept when the store is read again');
    s.renamed.loop = 'loop2'; s.renamed.loop2 = 'loop';
    assertEqual(resolveBoardName(s, 'loop'), null, 'a damaged loop ends');
});

summary();
