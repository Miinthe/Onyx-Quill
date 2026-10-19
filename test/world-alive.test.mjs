/**
 * World layer — how alive suite (src/world/alive-pure.js, stage 2, 2026-10-19).
 * Failures to avoid: the world ticking while paused or twice for one message; "every X" counting messages instead of
 * exchanges; "catch up when opened" firing right after the last tick; a new story day missed; a made-up name posting;
 * the same person writing twice in one tick; the board losing the mix on save.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normAlive, normFirst, lastTick, tickReason, tickPrompt, parseTick, parseMoment, MOMENT_RULES } from '../src/world/alive-pure.js';
import { normWorld } from '../src/world/world-pure.js';
import { emptyStore, addRecord } from '../src/world/world-pure.js';

test('the mix: Miinthe\'s defaults; X is hers', () => {
    assertEqual(normAlive(undefined), { open: true, big: true, time: true, every: false, everyN: 10, quiet: false, pulse: true, pace: 'normal', movesMin: 0, movesMax: 4, realReplies: true });
    assertEqual([normAlive({ pace: 'lively' }).movesMin, normAlive({ pace: 'lively' }).movesMax], [1, 6]);
    assertEqual([normAlive({ pace: 'quiet' }).movesMin, normAlive({ pace: 'quiet' }).movesMax], [0, 2]);
    assertEqual([normAlive({ pace: 'own', movesMin: 3, movesMax: 2 }).movesMin, normAlive({ pace: 'own', movesMin: 3, movesMax: 2 }).movesMax], [3, 3]);
    assertEqual(normAlive({ pulse: false }).pulse, false);
    assertEqual(normAlive({ every: true, everyN: '3' }).everyN, 3);
    assertEqual(normAlive({ everyN: 0 }).everyN, 10);
    assertEqual(normFirst({ main: false }), { cast: true, main: false });
    const w = normWorld({ on: true, alive: { quiet: true }, paused: true, first: { cast: false } });
    assertEqual([w.alive.quiet, w.paused, w.first.cast], [true, true, false]);
});

test('last tick', () => {
    let s = emptyStore();
    assertEqual(lastTick(s), { i: -1, day: null, busy: -1 });
    s = addRecord(s, { kind: 'tick', day: 2, auto: true }, 10);
    assertEqual(lastTick(s), { i: 10, day: 2, busy: 10 });
    s = addRecord(s, { kind: 'tick', reason: 'open', day: 2, auto: true }, 14);
    assertEqual(lastTick(s), { i: 14, day: 2, busy: 10 });
    // a look at the panel doesn't start the quiet stretch over
    assertEqual(tickReason({ alive: { quiet: true, open: false }, trigger: 'moment', moment: 'quiet', nowI: 16, last: lastTick(s) }), 'quiet');
});

test('when the world ticks', () => {
    const a = normAlive({});
    const last = { i: 10, day: 2 };
    assertEqual(tickReason({ alive: a, trigger: 'reply', nowI: 11, day: 3, last }), 'time');
    assertEqual(tickReason({ alive: a, trigger: 'moment', moment: 'big', nowI: 12, day: 2, last }), 'big');
    assertEqual(tickReason({ alive: a, trigger: 'moment', moment: 'big', nowI: 11, day: 2, last }), null);
    assertEqual(tickReason({ alive: a, trigger: 'moment', moment: 'quiet', nowI: 30, day: 2, last }), null);
    assertEqual(tickReason({ alive: { quiet: true }, trigger: 'moment', moment: 'quiet', nowI: 16, day: 2, last }), 'quiet');
    assertEqual(tickReason({ alive: a, trigger: 'open', nowI: 13, day: 2, last }), null);
    assertEqual(tickReason({ alive: a, trigger: 'open', nowI: 14, day: 2, last }), 'open');
    assertEqual(tickReason({ alive: { every: true, everyN: 3 }, trigger: 'reply', nowI: 15, day: 2, last }), null);
    assertEqual(tickReason({ alive: { every: true, everyN: 3 }, trigger: 'reply', nowI: 16, day: 2, last }), 'every');
    assertEqual(tickReason({ alive: a, paused: true, trigger: 'reply', nowI: 20, day: 5, last }), null);
    assertEqual(tickReason({ alive: a, trigger: 'reply', nowI: 10, day: 9, last }), null);
    assertEqual(tickReason({ alive: { time: false }, trigger: 'reply', nowI: 11, day: 3, last }), null);
});

test('the world\'s prompt and its answer', () => {
    const p = tickPrompt({ userName: 'Miinthe', reason: 'big', look: 'phone', people: [{ name: 'Spoon', here: false, plans: ['go to the beach with Miinthe on Wednesday'], knows: ['the fuse was taped'], last: [{ who: 'Miinthe', text: 'beach?' }] }, { name: 'Kettle', here: true }] });
    assert(p.system.includes('something big just happened'), 'the reason');
    assert(p.user.includes('Spoon (away)') && p.user.includes('Kettle (in the scene now)'), 'away / here');
    assert(p.user.includes('go to the beach'), 'plans');
    assert(tickPrompt({ userName: 'Miinthe', reason: 'big', people: [], event: 'Miinthe: the shelf crashes down' }).user.includes('WHAT JUST HAPPENED'), 'a big moment travels');
    assertEqual(parseTick('{"messages":[{"from":"spoon","text":"wednesday still on?","why":"the plan"},{"from":"Ghost","text":"boo"},{"from":"Spoon","text":"again"}]}', ['Spoon', 'Kettle']), [{ from: 'Spoon', text: 'wednesday still on?', why: 'the plan' }]);
    assertEqual(parseTick('{"messages":[]}', ['Spoon']), []);
    assertEqual(parseTick('nonsense', ['Spoon']), []);
});

test('the story helper\'s moment', () => {
    assert(MOMENT_RULES.includes('"big"'), 'rule');
    assertEqual(parseMoment('{"changes":[],"moment":"big"}'), 'big');
    assertEqual(parseMoment('{"changes":[]}'), null);
    assertEqual(parseMoment('{"moment":"loud"}'), null);
});

summary();
