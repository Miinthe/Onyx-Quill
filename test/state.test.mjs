/**
 * LOCAL PATCH suite — state and dates in play (2026-10-05, storyboard stage 3 round 4).
 * Failures to avoid: time running backwards; a night → morning that doesn't add a day (or adds
 * two); a day jump past a due date that nobody notices; a date the story didn't plainly set; a
 * calendar that doesn't take new dates growing anyway; a chat's own date leaking to the board;
 * a delete or Undo that leaves the clock moved.
 * Run: npm run test:state
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, freshState, normalizeState, holds } from '../src/board-model-pure.js';
import {
    stateHelperSection, validateStateChanges, applyStateChanges, describeStateChange, stateLines, datesOf, nowLine,
} from '../src/state-pure.js';
import { undoCollectionChange, rewindCollections } from '../src/collections-pure.js';

const board = (extra = {}) => normalizeBoard({ v: 2, name: 'T', trackers: [
    { id: 'world', kind: 'state', name: 'World', datesGrow: true, datesAsk: 'auto', ...extra,
        fields: [{ id: 'tod', type: 'cycle', name: 'Time of day', values: ['Morning', 'Noon', 'Evening', 'Night'], addsDay: true }, { id: 'day', type: 'day', name: 'Day', start: 1 }, { id: 'weather', type: 'choice', name: 'Weather', values: ['Sunny', 'Raining'] }],
        dates: [{ id: 'bday', name: "Kettle's birthday", due: 6, by: 'you' }] },
] });
const at = (st, day, tod) => { st.states.world = { day, vals: tod ? { tod } : {} }; return st; };
const msgs = (text, i = 20) => [{ mes: text, _i: i }];
const ch = (field, value, quote) => ({ tracker: 'World', field, value, quote, reason: 'r', confidence: 'high' });

test('the helper is told the time, the fields, the calendar', () => {
    const b = board(), st = at(freshState(b), 3, 'Noon');
    const s = stateHelperSection(b, st);
    assert(s.includes('- World: Day 3 · Noon · Sunny.'));
    assert(s.includes('"Time of day" (goes round: "Morning", "Noon", "Evening", "Night"; now "Noon")'));
    assert(s.includes('Calendar: "Kettle\'s birthday" on Day 6'));
    assert(s.includes('New appointments with a day may be added'));
});

test('a plain change of weather / time of day is taken; a made-up quote and an unknown value are not', () => {
    const b = board(), st = at(freshState(b), 3, 'Noon'), m = msgs('Rain starts drumming on the window as evening falls.');
    const r = validateStateChanges([ch('Weather', 'raining', 'Rain starts drumming on the window'), ch('Time of day', 'Evening', 'as evening falls'), ch('Weather', 'Snowing', 'Rain starts drumming'), ch('Time of day', 'Night', 'the moon is out tonight')], [], b, st, m);
    assertEqual(r.changes.map(c => [c.field, c.to]), [['weather', 'Raining'], ['tod', 'Evening']]);
    assertEqual(r.rejected.map(x => x.reason), ['"Snowing" is not one of its values', 'quote not found in the messages']);
});

test('night → morning is the next day; with an explicit day change in the same answer, only once', () => {
    const b = board(), st = at(freshState(b), 3, 'Night'), m = msgs('The next morning, the toaster wakes before the kettle.');
    const r = validateStateChanges([ch('Time of day', 'Morning', 'The next morning, the toaster wakes')], [], b, st, m);
    assertEqual([r.changes[0].dayFrom, r.changes[0].dayTo], [3, 4]);
    const both = validateStateChanges([ch('Time of day', 'Morning', 'The next morning, the toaster wakes'), ch('Day', '+1', 'The next morning')], [], b, st, m);
    const s2 = applyStateChanges(b, st, both.changes, 20);
    assertEqual([s2.states.world.day, s2.states.world.vals.tod], [4, 'Morning'], 'one day, not two');
});

test('time never goes back; "+N" and a day number both work', () => {
    const b = board(), st = at(freshState(b), 3), m = msgs('Two days later, they meet again. Back on day one, she remembers.');
    assertEqual(validateStateChanges([ch('Day', '+2', 'Two days later, they meet again')], [], b, st, m).changes[0].dayTo, 5);
    assertEqual(validateStateChanges([ch('Day', 5, 'Two days later, they meet again')], [], b, st, m).changes[0].dayTo, 5);
    assertEqual(validateStateChanges([ch('Day', 1, 'Back on day one, she remembers')], [], b, st, m).rejected[0].reason, 'time does not go back');
});

test('a jump past a due date is recorded as the story says, and the skipped date is named', () => {
    const b = board(), st = at(freshState(b), 3), m = msgs('A whole week later, the kitchen is quiet.');
    const r = validateStateChanges([ch('Day', '+7', 'A whole week later')], [], b, st, m);
    assertEqual([r.changes[0].dayTo, r.changes[0].skipped], [10, ["Kettle's birthday"]]);
    assertEqual(describeStateChange(b, r.changes[0]), "World: Day 3 → Day 10 — skipped past Kettle's birthday");
});

test('the story adds a date (in this chat only); "ask me first" is left for the caller; no calendar growth → refused', () => {
    const b = board(), st = at(freshState(b), 3), m = msgs("In two days there's a huge party at the harbor. Wanna go?");
    const d = { tracker: 'World', name: 'Party at the harbor', in_days: 2, quote: "In two days there's a huge party at the harbor", reason: 'r', confidence: 'high' };
    const r = validateStateChanges([], [d], b, st, m);
    assertEqual(r.changes[0].date.due, 5);
    const s2 = applyStateChanges(b, st, r.changes, 20);
    assertEqual(s2.states.world.dates.map(x => [x.name, x.due, x.by]), [['Party at the harbor', 5, 'ai']]);
    assertEqual(b.trackers[0].dates.length, 1, 'the board keeps only its own date');
    assertEqual(datesOf(b.trackers[0], s2).map(x => x.name), ['Party at the harbor', "Kettle's birthday"]);
    assertEqual(normalizeState(s2, b).states.world.dates.length, 1, 'kept through normalizeState');
    assertEqual(validateStateChanges([], [d], b, s2, m).rejected[0].reason, 'already on the calendar');
    const ask = validateStateChanges([], [d], board({ datesAsk: 'ask' }), st, m);
    assert(ask.changes[0].ask);
    assertEqual(applyStateChanges(b, st, ask.changes, 20).states.world.dates, undefined, 'ask: not added by itself');
    assertEqual(validateStateChanges([], [d], board({ datesGrow: false }), st, m).rejected[0].reason, 'this calendar takes no new dates');
});

test('Undo and a delete put the clock and the calendar back', () => {
    const b = board(); let st = at(freshState(b), 3, 'Night');
    const r = validateStateChanges([ch('Time of day', 'Morning', 'The next morning, the toaster wakes')], [{ tracker: 'World', name: 'Market day', in_days: 1, quote: 'tomorrow is market day' }], b, st, msgs('The next morning, the toaster wakes. Tomorrow is market day.', 9));
    st = applyStateChanges(b, st, r.changes, 9);
    assertEqual([st.states.world.day, st.states.world.dates.length], [4, 1]);
    const u = undoCollectionChange(b, st, r.changes[0].logId).state;
    assertEqual([u.states.world.day, u.states.world.vals.tod], [3, 'Night'], 'Undo');
    const back = rewindCollections(b, st, 8).state;
    assertEqual([back.states.world.day, back.states.world.vals.tod, back.states.world.dates], [3, 'Night', undefined], 'delete before message 9');
});

test('writer and judge: one line now, and what\'s coming up', () => {
    const b = board(); let st = at(freshState(b), 5, 'Evening');
    st.states.world.vals.weather = 'Raining';
    st.states.world.dates = [{ id: 'p', name: 'Party at the harbor', due: 5, by: 'ai' }];
    assertEqual(stateLines(b, st), ['WORLD: Day 5 · Evening · Raining', "COMING UP — don't skip past: Party at the harbor (today), Kettle's birthday (in 1 day)"]);
    assertEqual(nowLine(b.trackers[0], at(freshState(b), 1)), 'Day 1 · Morning · Sunny');
    st.runs = { world: 'paused' };
    assertEqual(stateLines(b, st), []);
});

test('lines on state: "once it is raining", "from Day 5", "once the birthday is due"', () => {
    const b = board(), st = at(freshState(b), 5);
    assert(!holds(b, st, { world: 'world', field: 'weather', is: 'Raining' }));
    st.states.world.vals.weather = 'Raining';
    assert(holds(b, st, { world: 'world', field: 'weather', is: 'Raining' }));
    assert(holds(b, st, { world: 'world', field: 'day', min: 5 }));
    assert(!holds(b, st, { world: 'world', due: 'bday' }));
    st.states.world.day = 6;
    assert(holds(b, st, { world: 'world', due: 'bday' }));
});

test('cloud bug hunt 2026-10-04: the day also reads "Day 4" and "day +2"', () => {
    const b = board(), st = freshState(b), m = [{ mes: 'Two days later, the kettle is still sulking.', _i: 9 }];
    const day = v => validateStateChanges([{ tracker: 'World', field: 'Day', value: v, quote: 'Two days later', reason: 'r', confidence: 'high' }], [], b, st, m).changes[0]?.dayTo;
    const now = st.states.world?.day ?? 1;
    assertEqual(day('Day 4'), 4);
    assertEqual(day('day +2'), now + 2);
    assertEqual(day('+ 2'), now + 2);
    assertEqual(day('Sunday'), undefined, 'not a day');
});

summary('state');
