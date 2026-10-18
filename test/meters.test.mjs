/**
 * LOCAL PATCH suite — meters and flags in play (2026-10-12, `14 meters and flags design.md`).
 * Failures to avoid: the model picking the size (inflation); one dramatic line swinging a meter across the
 * whole range; a meter passing its limits; a band entered while its lines say no; the writer seeing the number;
 * band entries leaking outside their band; Undo / delete leaving the meter moved; drift without a pause or past
 * the resting value; a one-way flag going back by itself.
 * Run: npm run test:meters
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, holds, condText, checkBoard, lines, isMeter } from '../src/board-model-pure.js';
import {
    metersHelperSection, validateMeterChanges, applyMeterChanges, describeMeterChange, meterLines, trendOf, driftChanges, crossesBand, landing,
} from '../src/meters-pure.js';
import { undoCollectionChange, rewindCollections, validateCollectionChanges } from '../src/collections-pure.js';
import { filterByBoardLinks, guidanceLines, judgeTitles } from '../src/board-links-pure.js';
import { momentsOf } from '../src/mero-glow-pure.js';
import { autoTrackSystemPrompt, autoTrackSchema, parseHelperAnswerAll } from '../src/autotrack-pure.js';
import { toWindowBoard, fromWindowBoard, timelineEvents } from '../src/board-window-pure.js';

const TRUST = { id: 'trust', kind: 'counter', name: 'Trust', start: 30, min: 0, max: 100,
    keep: { entries: ['Judge · What counts for Trust'], kinds: { 'Judge · What counts for Trust': 'judge' } },
    meter: { who: 'Kettle → you', bands: [
        { id: 'wary', name: 'Wary', from: 0 },
        { id: 'neutral', name: 'Neutral', from: 21 },
        { id: 'trusting', name: 'Trusting', from: 51, entries: ['Trust · Trusting', 'Trust · How Kettle trusts'], kinds: { 'Trust · How Kettle trusts': 'guidance' } },
        { id: 'devoted', name: 'Devoted', from: 81, needs: [{ tracker: 'rel', step: 'married' }] },
    ], sizes: { slight: 2, clear: 5, big: 10 }, cap: 10 } };
const board = (trust = {}, more = []) => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'rel', kind: 'steps', name: 'Relationship', steps: [{ id: 'friends', name: 'Friends' }, { id: 'married', name: 'Married' }] },
    { ...TRUST, ...trust, meter: { ...TRUST.meter, ...(trust.meter || {}) } },
    ...more,
] });
const at = (b, v, extra = {}) => { const st = freshState(b); st.counters.trust = v; Object.assign(st, extra); return st; };
const msgs = (text, i = 20) => [{ mes: text, _i: i }];
const m = (change, size, quote, extra = {}) => ({ tracker: 'Trust', change, size, quote, reason: 'r', confidence: 'high', ...extra });

test('a counter with a meter keeps its bands (sorted), sizes, cap, drift off by default; a plain counter stays plain', () => {
    const b = board();
    const t = b.trackers.find(x => x.id === 'trust');
    assert(isMeter(t));
    assertEqual(t.meter.bands.map(x => x.name), ['Wary', 'Neutral', 'Trusting', 'Devoted']);
    assertEqual(t.meter.sizes, { slight: 2, clear: 5, big: 10 });
    assertEqual([t.meter.cap, t.meter.drift, t.max], [10, false, 100]);
    assertEqual(t.meter.bands[0].needs, []);
    const plain = normalizeBoard({ v: 2, trackers: [{ id: 'debt', kind: 'counter', name: 'Debt', start: 0 }] }).trackers[0];
    assert(!isMeter(plain));
});

test('lines on a band: "once Trust reaches Trusting" holds from the band\'s start; Check knows a missing band', () => {
    const b = board();
    const c = { counter: 'trust', band: 'trusting' };
    assert(!holds(b, at(b, 50), c));
    assert(holds(b, at(b, 51), c));
    assertEqual(condText(b, c), 'Trust reaches Trusting');
    const bad = board({}, [{ id: 'x', kind: 'steps', name: 'X', starts: [{ counter: 'trust', band: 'gone' }], steps: [{ name: 'A' }] }]);
    assert(checkBoard(bad).some(p => p.sev === 'error' && p.text.includes('a band')));
    assert(lines(b).some(l => l.key === 'm|trust|devoted|0' && l.text === 'Trust can only reach Devoted once Relationship reaches Married'));
});

test('the helper is told the band and its neighbours, never the number, and what counts', () => {
    const b = board(), st = at(b, 44);
    const s = metersHelperSection(b, st, { judgeText: t => (t === 'Judge · What counts for Trust' ? 'A broken promise is a big loss. Politeness counts for nothing.' : '') });
    assert(s.includes('- Trust (Kettle → you): now "Neutral" (below: "Wary", above: "Trusting")'));
    assert(s.includes('What counts: A broken promise is a big loss.'));
    assert(!/\b44\b/.test(s));
    assert(autoTrackSystemPrompt({ meters: true }).includes('"meters": [...]'));
    assert(autoTrackSchema({ meters: true }).value.properties.meters);
    assertEqual(parseHelperAnswerAll('{"changes":[],"meters":[{"tracker":"Trust"}]}').meters.length, 1);
});

test('sizes become the meter\'s points; the quote must be real; one change per meter per turn', () => {
    const b = board(), st = at(b, 44), mm = msgs('"I never told anyone, but the spoon drawer sticks because I broke it."');
    const r = validateMeterChanges([m('gain', 'clear', 'the spoon drawer sticks because I broke it'), m('gain', 'big', 'the spoon drawer sticks')], b, st, mm);
    assertEqual(r.changes.map(c => [c.from, c.to, c.points]), [[44, 49, 5]]);
    assertEqual(r.rejected.map(x => x.reason), ['one change per meter per turn']);
    const r2 = validateMeterChanges([m('gain', 'big', 'she hugs him tightly'), m('gain', 'huge', 'the spoon drawer'), m('up', 'big', 'the spoon drawer')], b, st, mm);
    assertEqual(r2.rejected.map(x => x.reason), ['quote not found in the messages', 'size must be slight, clear or big', 'change must be gain or loss']);
});

test('the cap holds even if a size is set bigger; min and max hold', () => {
    const b = board({ meter: { sizes: { slight: 2, clear: 5, big: 30 }, cap: 12 } });
    assertEqual(validateMeterChanges([m('loss', 'big', 'You promised you would')], b, at(b, 44), msgs('You promised you would keep it shut.')).changes[0].to, 32);
    const b2 = board();
    assertEqual(validateMeterChanges([m('loss', 'big', 'You promised me twice')], b2, at(b2, 4), msgs('You promised me twice.')).changes[0].to, 0);
    const r = validateMeterChanges([m('loss', 'slight', 'You promised me twice')], b2, at(b2, 0), msgs('You promised me twice.'));
    assertEqual(r.rejected.map(x => x.reason), ['already at its limit']);
});

test('a band whose lines don\'t hold is not entered: the meter stops just below it, and says why', () => {
    const b = board(), st = at(b, 76);
    st.trackers.rel = { at: 'friends' };
    const r = validateMeterChanges([m('gain', 'big', 'he takes the blame for her')], b, st, msgs('Without a word he takes the blame for her.'));
    assertEqual(r.changes[0].to, 80);
    assertEqual(r.changes[0].held, { band: 'Devoted', why: 'Relationship reaches Married' });
    assert(describeMeterChange(b, r.changes[0]).includes('held below Devoted: only once Relationship reaches Married'));
    const st2 = at(b, 80); st2.trackers.rel = { at: 'friends' };
    assertEqual(validateMeterChanges([m('gain', 'big', 'he takes the blame')], b, st2, msgs('he takes the blame for her')).rejected[0].reason, 'held below a closed band');
    const st3 = at(b, 76); st3.trackers.rel = { at: 'married' };
    assertEqual(validateMeterChanges([m('gain', 'big', 'he takes the blame')], b, st3, msgs('he takes the blame for her')).changes[0].to, 86);
    assertEqual(landing(b, st3, b.trackers[1], 90, -20).to, 70);   // going down never asks
});

test('applied, logged, told as a band; Undo and a delete put it back; the same line is not re-applied', () => {
    const b = board(), st = at(b, 48), mm = msgs('the spoon drawer sticks because I broke it', 30);
    const { changes } = validateMeterChanges([m('gain', 'clear', 'the spoon drawer sticks because I broke it')], b, st, mm);
    const next = applyMeterChanges(b, st, changes, 30, { who: 'auto' });
    assertEqual(next.counters.trust, 53);
    const e = next.log.at(-1);
    assertEqual([e.kind, e.from, e.to, e.bandFrom, e.bandTo, e.size, e.dir], ['meter', 48, 53, 'neutral', 'trusting', 'clear', 'gain']);
    assert(crossesBand(e));
    assertEqual(meterLines(b, next, 31), ['TRUST (Kettle → you): Trusting, rising']);
    assertEqual(meterLines(b, next, 45), ['TRUST (Kettle → you): Trusting, steady']);
    assert(describeMeterChange(b, changes[0]).startsWith('Trust: Neutral → Trusting, +5 → 53'));
    const u = undoCollectionChange(b, next, e.id);
    assertEqual(u.state.counters.trust, 48);
    assertEqual(validateMeterChanges([m('gain', 'clear', 'the spoon drawer sticks because I broke it')], b, u.state, mm).rejected[0].reason, 'undone before from this line');
    const r = rewindCollections(b, next, 29);
    assertEqual(r.state.counters.trust, 48);
    assertEqual(r.undone.length, 1);
    assertEqual(validateMeterChanges([m('gain', 'slight', 'the spoon drawer')], b, next, msgs('the spoon drawer sticks', 29)).rejected[0].reason, 'older than its last change');
});

test('a paused meter is not watched or told', () => {
    const b = board(), st = at(b, 44, { runs: { trust: 'paused' } });
    assertEqual(metersHelperSection(b, st), '');
    assertEqual(meterLines(b, st), []);
    assertEqual(validateMeterChanges([m('gain', 'slight', 'drawer')], b, st, msgs('drawer sticks')).rejected[0].reason, 'no running meter by that name');
});

test('drift: only when on, only after `every` quiet messages, one slight step, never past the resting value', () => {
    const b = board({ meter: { drift: true, rest: 30, every: 5 } }), st = at(b, 44);
    st.log = [{ id: 'a', i: 10, kind: 'meter', key: 'meter:trust', col: 'trust', from: 40, to: 44 }];
    assertEqual(driftChanges(b, st, 14).length, 0);
    const d = driftChanges(b, st, 15);
    assertEqual(d.map(c => [c.from, c.to, c.who]), [[44, 42, 'drift']]);
    const near = at(b, 31); near.log = [];
    assertEqual(driftChanges(b, near, 50)[0].to, 30);
    const off = board(), st2 = at(off, 44);
    assertEqual(driftChanges(off, st2, 99).length, 0);
});

test('entries on a band exist only while the meter is in it; guidance comes as GUIDANCE; judge never to the writer', () => {
    const b = board(), entries = [{ title: 'Trust · Trusting' }, { title: 'Trust · How Kettle trusts' }, { title: 'Judge · What counts for Trust' }, { title: 'Other' }];
    assertEqual(filterByBoardLinks(entries, b, at(b, 44)).map(e => e.title), ['Other']);
    assertEqual(filterByBoardLinks(entries, b, at(b, 60)).map(e => e.title), ['Trust · Trusting', 'Other']);
    assertEqual(guidanceLines(b, at(b, 60), () => 'Kettle leaves the door open.'), ['GUIDANCE (Trust: Trusting): Kettle leaves the door open.']);
    assertEqual(guidanceLines(b, at(b, 44), () => 'x'), []);
    assert(judgeTitles(b).has('judge · what counts for trust'));
});

test('a band change is a big moment for Mero; a move inside a band is not', () => {
    const b = board();
    assertEqual(momentsOf(b, { id: 'x', i: 5, kind: 'meter', col: 'trust', from: 48, to: 53, bandFrom: 'neutral', bandTo: 'trusting' }).map(x => x.text), ['Trust: Neutral → Trusting']);
    assertEqual(momentsOf(b, { id: 'y', i: 5, kind: 'meter', col: 'trust', from: 40, to: 44, bandFrom: 'neutral', bandTo: 'neutral' }), []);
});

test('the window keeps a meter, its band lines and entries through a round trip; the timeline shows meter changes', () => {
    const b = board();
    const back = fromWindowBoard(toWindowBoard(b), 'T');
    const t = back.trackers.find(x => x.id === 'trust');
    assertEqual(t.meter.bands.map(x => [x.id, x.from, x.needs.length]), [['wary', 0, 0], ['neutral', 21, 0], ['trusting', 51, 0], ['devoted', 81, 1]]);
    assertEqual(t.meter.bands[2].kinds, { 'Trust · How Kettle trusts': 'guidance' });
    assertEqual(t.keep.entries, ['Judge · What counts for Trust']);
    const st = at(b, 53); st.log = [{ id: 'a', i: 7, kind: 'meter', key: 'meter:trust', col: 'trust', from: 48, to: 53, bandFrom: 'neutral', bandTo: 'trusting', who: 'auto', quote: 'q' }];
    const ev = timelineEvents(b, [], st).filter(x => x.t === 'trust');
    assertEqual(ev.map(x => [x.m, x.meter, x.band]), [[7, 53, 'Trusting']]);
});

test('flags: a collection with the Flags preset; a one-way flag never goes back by itself, a switchable one does', () => {
    const b = normalizeBoard({ v: 2, trackers: [{ id: 'facts', kind: 'collection', preset: 'flags', name: 'Facts',
        states: [{ id: 'no', label: 'no' }, { id: 'yes', label: 'yes' }],
        items: [{ id: 'knows', name: 'Kettle knows about the fuse', oneWay: true }, { id: 'door', name: 'Cellar door unlocked' }] }] });
    const col = b.trackers[0];
    assertEqual([col.preset, col.items[0].oneWay, col.items[1].oneWay], ['flags', true, undefined]);
    const st = freshState(b);
    st.collections.facts.items = { knows: { state: 'yes' }, door: { state: 'yes' } };
    const r = validateCollectionChanges([
        { collection: 'Facts', item: 'Kettle knows about the fuse', state: 'no', quote: 'he forgets all about it', reason: 'r', confidence: 'high' },
        { collection: 'Facts', item: 'Cellar door unlocked', state: 'no', quote: 'she locks the cellar door', reason: 'r', confidence: 'high' },
    ], [], b, st, msgs('Then he forgets all about it, and she locks the cellar door.'));
    assertEqual(r.rejected.map(x => x.reason), ['one-way']);
    assertEqual(r.changes.map(c => [c.item, c.to.state]), [['door', 'no']]);
});

summary();
