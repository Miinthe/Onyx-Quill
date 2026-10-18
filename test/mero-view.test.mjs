/**
 * Overhaul suite — Mero ☆'s tab in the side panel (src/panel/mero-view-pure.js).
 * Failures to avoid: Mero's box stopping halfway down the panel; the tab's dot missing while she waits for an answer
 * (or staying when nothing is open); her rail on the inner edge when the panel sits on the left; Check the lore or
 * Wrap up vanishing from the talk's ⋯; the Custom chattiness settings out of reach.
 * Run: npm run test:mero-view
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { fitHeight, tabDot, railSide, talkLine, talkMenu, showCustom, pitchLine, gapCards } from '../src/panel/mero-view-pure.js';

test('the box fills what the scroller has left below it, never less than the minimum', () => {
    assertEqual(fitHeight({ scrollerHeight: 900, top: 0, padBottom: 0 }), 900);
    assertEqual(fitHeight({ scrollerHeight: 900, top: 12, padBottom: 8 }), 880);
    assertEqual(fitHeight({ scrollerHeight: 400, top: 200, min: 300 }), 300);
    assertEqual(fitHeight({ scrollerHeight: 900, top: -50 }), 900);   // a stale negative offset never makes it taller
    assertEqual(fitHeight({ scrollerHeight: NaN }), 300);
});

test('the tab dot: shown while something waits, amber while the reply waits, gone when all is answered', () => {
    assertEqual(tabDot({ waiting: 0 }).show, false);
    const a = tabDot({ waiting: 2 });
    assertEqual([a.show, a.hold], [true, false]);
    assertEqual(a.title, 'Mero has 2 things for you');
    assertEqual(tabDot({ waiting: 1 }).title, 'Mero has 1 thing for you');
    const h = tabDot({ waiting: 1, hold: true });
    assertEqual([h.show, h.hold], [true, true]);
});

test('the rail follows the panel side, and stays right in her own window', () => {
    assertEqual(railSide('left'), 'left');
    assertEqual(railSide('right'), 'right');
    assertEqual(railSide(undefined), 'right');
    assertEqual(railSide('left', true), 'right');
});

test('the line under the title', () => {
    assertEqual(talkLine({ character: 'Kettle', connection: 'DeepSeek', state: 'open' }), 'Talks about Kettle · co-writer: DeepSeek · ● open');
    assertEqual(talkLine({ state: 'archived' }), 'co-writer: not set · archived');
});

test('the talk ⋯ keeps Check the lore and Wrap up, then resolve / archive / delete', () => {
    const m = talkMenu({ state: 'open' });
    assertEqual(m.filter(x => x !== 'sep').map(x => x.id), ['look', 'wrap', 'resolve', 'archive', 'delete']);
    assertEqual(m.find(x => x.id === 'resolve').label, 'Resolve for now');
    assertEqual(talkMenu({ state: 'resolved' }).find(x => x.id === 'resolve').label, 'Reopen');
    assertEqual(talkMenu({ state: 'archived' }).find(x => x.id === 'archive').label, 'Unarchive');
    assertEqual(talkMenu({ job: 'off' })[0].disabled, true);
    assertEqual(talkMenu({ looking: true })[0].label, 'Mero is looking…');
    assertEqual(talkMenu({ hasTalk: false }).map(x => x.id), ['look', 'wrap']);
    assertEqual(talkMenu({ hasTalk: false })[1].disabled, true);
});

test('Custom chattiness opens by hand or when it is set', () => {
    assertEqual(showCustom('chatty'), false);
    assertEqual(showCustom('custom'), true);
    assertEqual(showCustom('quiet', true), true);
});

test('the folded pitch menu line', () => {
    assertEqual(pitchLine({}), '⚡ one-shot · 👁 3 · SFW');
    assertEqual(pitchLine({ shape: 'multi', vis: 'hide', str: 'turn', tone: 'nsfw', focus: 'Kettle' }), '🪜 multistep · 🙈 hidden · 🔀 turn · NSFW · focus: Kettle');
});

test('lore gaps in Requests: open ones newest first, hidden and dismissed left out, written ones under Answered', () => {
    const gaps = [
        { id: 'a', type: 'flag', subtype: 'gap', query: 'Harbor market', reason: 'Came up, no entry.', frequency: 3, timestamp: 1, status: 'pending' },
        { id: 'b', type: 'flag', subtype: 'update', entryTitle: 'Apple', query: 'yellow apples', urgency: 'high', timestamp: 5, status: 'pending' },
        { id: 'c', type: 'flag', query: 'Hidden one', timestamp: 9, status: 'pending' },
        { id: 'd', type: 'flag', query: 'Gone for good', timestamp: 9, status: 'pending' },
        { id: 'e', type: 'flag', query: 'Old one', timestamp: 2, status: 'written' },
        { id: 'f', type: 'search', query: 'a search, not a gap', timestamp: 3 },
        { id: 'g', type: 'flag', query: '   ', timestamp: 3 },
    ];
    const r = gapCards(gaps, { hidden: ['c'], dismissed: ['d'] });
    assertEqual(r.open.map(x => x.id), ['b', 'a']);
    assertEqual(r.done.map(x => x.id), ['e']);
    assertEqual(r.open[0].title, 'Update “Apple”?');
    assertEqual(r.open[0].update, true);
    assertEqual(r.open[0].meta, 'yellow apples · urgent');
    assertEqual(r.open[1].title, 'Write “Harbor market”?');
    assertEqual(r.open[1].meta, 'came up 3 times');
    assertEqual(r.open[1].entry, null);
    assertEqual(gapCards(null), { open: [], done: [] });
});

summary();
