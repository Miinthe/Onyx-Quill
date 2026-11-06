/**
 * LOCAL PATCH suite — places in play (2026-10-05, storyboard stage 3 round 3).
 * Failures to avoid: the scene "moving" because a place was only mentioned (the quote check
 * catches made-up lines; the prompt says "plainly there"); a place that isn't on the list;
 * the location filter set by a paused tracker; an "only here" entry leaking elsewhere; the
 * writer told about a place that isn't here as if it were; a delete leaving a move standing.
 * Run: npm run test:places
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, holds } from '../src/board-model-pure.js';
import {
    placesHelperSection, validatePlaceChanges, applyPlaceChanges, describePlaceChange, locationValue,
    pinnedHere, filterByPlace, placeLines, placeLabel, placeFromUserMessage,
} from '../src/places-pure.js';
import { undoCollectionChange, rewindCollections } from '../src/collections-pure.js';

const board = () => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'where', kind: 'place', name: 'Where', keep: { entries: ['Judge · Where the scene is'], kinds: { 'Judge · Where the scene is': 'judge' } },
        places: [
            { id: 'kitchen', name: 'Kitchen', entries: ['Place · Kitchen'] },
            { id: 'counter', name: 'Counter', parent: 'kitchen', entries: ['Place · Counter', 'Crumb monster'], roles: { 'Crumb monster': 'only' }, related: ['pantry'] },
            { id: 'pantry', name: 'Pantry', parent: 'kitchen', entries: ['Place · Pantry'] },
            { id: 'garden', name: 'Garden', entries: ['Place · Garden', 'Gerry the Caterpillar'], roles: { 'Gerry the Caterpillar': 'often' } },
            { id: 'cellar', name: 'Cellar', entries: [] },
        ] },
] });
const msgs = (text, i = 20) => [{ mes: text, _i: i }];
const move = (place, quote, extra = {}) => ({ tracker: 'Where', place, quote, reason: 'r', confidence: 'high', ...extra });

test('the helper is told where the scene is, the places (with what they sit in) and its judge rules', () => {
    const b = board(), st = freshState(b);
    const s = placesHelperSection(b, st, { judgeText: t => (t === 'Judge · Where the scene is' ? 'Only where the scene actually is — talking about a place does not move us.' : '') });
    assert(s.includes('- Where: the scene is at "Kitchen". Places: "Kitchen", "Counter" (inside Kitchen), "Pantry" (inside Kitchen), "Garden", "Cellar"'));
    assert(s.includes('How to judge it: Only where the scene actually is'));
    st.runs = { where: 'paused' };
    assertEqual(placesHelperSection(b, st), '', 'paused: not watched');
});

test('a plain move is taken; a made-up quote, an unknown place and "no change" are not', () => {
    const b = board(), st = freshState(b), m = msgs('They step out into the garden for some air.');
    const ok = validatePlaceChanges([move('garden', 'They step out into the garden')], b, st, m);
    assertEqual(ok.changes.map(c => [c.from, c.to]), [['kitchen', 'garden']]);
    const r = validatePlaceChanges([move('Garden', 'they fly to the moon'), move('Moon', 'They step out into the garden'), move('Kitchen', 'They step out into the garden')], b, st, m);
    assertEqual(r.rejected.map(x => x.reason), ['quote not found in the messages', 'not one of its places', 'no change']);
    assertEqual(r.rejected[1].unknown.place, 'Moon');
});

test('one place tracker: the helper may leave out its name', () => {
    const b = board(), st = freshState(b);
    assertEqual(validatePlaceChanges([{ place: 'Cellar', quote: 'down the stairs into the cellar' }], b, st, msgs('She goes down the stairs into the cellar.')).changes.length, 1);
});

test('apply → here moves, logged; Undo and a delete put it back', () => {
    const b = board(), st = freshState(b);
    const ch = validatePlaceChanges([move('Counter', 'sets the toaster on the counter')], b, st, msgs('She sets the toaster on the counter and plugs it in.', 7)).changes;
    const s2 = applyPlaceChanges(b, st, ch, 7);
    assertEqual(s2.places.where, 'counter');
    assertEqual(describePlaceChange(b, ch[0]), 'Where: the scene is now at Counter (in Kitchen)');
    assertEqual(undoCollectionChange(b, s2, ch[0].logId).state.places.where, 'kitchen', 'Undo');
    assertEqual(rewindCollections(b, s2, 6).state.places.where, 'kitchen', 'a delete before message 7');
    assertEqual(rewindCollections(b, s2, 7).state.places.where, 'counter', 'message 7 kept');
    const again = validatePlaceChanges([move('Counter', 'sets the toaster on the counter')], b, undoCollectionChange(b, s2, ch[0].logId).state, msgs('She sets the toaster on the counter and plugs it in.', 7));
    assertEqual(again.rejected[0].reason, 'undone before from this line');
});

test('The location filter follows here (unless paused or switched off)', () => {
    const b = board(), st = freshState(b);
    assertEqual(locationValue(b, st), 'Kitchen', 'the place\'s name, as entries write it — not its id');
    st.places.where = 'counter';
    assertEqual(locationValue(b, st), ['Counter', 'Kitchen'], 'a place inside another brings that one\'s name too');
    assertEqual(locationValue(b, { ...st, runs: { where: 'paused' } }), null);
    const off = normalizeBoard({ ...b, trackers: [{ ...b.trackers[0], setsLocation: false }] });
    assertEqual(locationValue(off, st), null);
});

test('the place\'s own entries are pinned while here; "often" is not pinned', () => {
    const b = board(), st = freshState(b);
    st.places.where = 'counter';
    assertEqual(pinnedHere(b, st), ['Place · Counter']);
    st.places.where = 'garden';
    assertEqual(pinnedHere(b, st), ['Place · Garden']);
});

test('"only here" entries exist only while the scene is there (or inside it)', () => {
    const b = board(), st = freshState(b);
    const entries = [{ title: 'Crumb monster' }, { title: 'Gerry the Caterpillar' }, { title: 'Other' }];
    assertEqual(filterByPlace(entries, b, st).map(e => e.title), ['Gerry the Caterpillar', 'Other'], 'at Kitchen: the crumb monster is not here');
    st.places.where = 'counter';
    assertEqual(filterByPlace(entries, b, st).length, 3);
    assertEqual(filterByPlace(entries, b, { ...st, places: { where: 'garden' } }, e => e.title === 'Crumb monster').length, 3, 'pinned stays');
});

test('writer and judge: here (in what), often found here, nearby, every other place — not here', () => {
    const b = board(), st = freshState(b);
    st.places.where = 'counter';
    assertEqual(placeLines(b, st), ['PLACE: Counter (in Kitchen)', 'NEARBY, NOT HERE: Pantry', 'KNOWN PLACES, NOT HERE: Garden, Cellar']);
    st.places.where = 'garden';
    assertEqual(placeLines(b, st), ['PLACE: Garden', 'OFTEN FOUND HERE: Gerry the Caterpillar', 'KNOWN PLACES, NOT HERE: Kitchen, Counter, Pantry, Cellar']);
    assertEqual(placeLabel(b.trackers[0], 'pantry'), 'Pantry (in Kitchen)');
});

test('lines on places: "once the scene is in the Kitchen" holds at the Counter too', () => {
    const b = board(), st = freshState(b);
    st.places.where = 'counter';
    assert(holds(b, st, { place: 'where', at: 'kitchen' }));
    assert(!holds(b, st, { place: 'where', at: 'garden' }));
});

test('cloud bug hunt 2026-10-04: with the scene in the Kitchen, its spots are not "not here"', () => {
    const b = board(), st = freshState(b);
    st.places.where = 'kitchen';
    assertEqual(placeLines(b, st), ['PLACE: Kitchen', 'KNOWN PLACES, NOT HERE: Garden, Cellar'], 'Counter and Pantry sit in the kitchen');
});


test('safety net: her own message moves the scene when the helper said nothing — not talk, plans or hearsay', () => {
    const b = normalizeBoard({ v: 2, name: 'D', trackers: [{ id: 'where', kind: 'place', name: 'Where', places: [
        { id: 'throne-hall', name: 'Throne Hall' }, { id: 'garden', name: 'Palace Garden' }, { id: 'kitchens', name: 'Kitchens' }, { id: 'teahouse', name: 'Lantern Teahouse' }] }] });
    const st = freshState(b);   // here: Throne Hall
    const u = t => [{ mes: 'Some reply.', is_user: false, _i: 3 }, { mes: t, is_user: true, _i: 4 }];
    const g = placeFromUserMessage(b, st, u('*Later, Ottilie and I walk together to the palace garden.*'));
    assertEqual(g.length, 1); assertEqual(g[0].place, 'Palace Garden'); assertEqual(g[0].tracker, 'Where');
    assert(g[0].quote.includes('walk together to the palace garden'), g[0].quote);
    assertEqual(placeFromUserMessage(b, st, u('That evening I head down to the kitchens alone.'))[0].place, 'Kitchens');
    assertEqual(placeFromUserMessage(b, st, u("I'm told the Lantern Teahouse serves the best tea. Perhaps one day you'll let me go to the Lantern Teahouse.")).length, 0, 'hearsay and a wish');
    assertEqual(placeFromUserMessage(b, st, u('Tomorrow I will walk to the kitchens.')).length, 0, 'a plan');
    assertEqual(placeFromUserMessage(b, st, u('I walk to the throne hall.')).length, 0, 'already here');
    assertEqual(placeFromUserMessage(b, st, u('I walk into the kitchens.'), [{ tracker: 'Where', place: 'Kitchens' }]).length, 0, 'the helper already reported it');
});

summary('places');
