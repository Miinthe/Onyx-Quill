/**
 * Overhaul — the side panel's Lore tab rules (src/panel/lore-pure.js).
 * Failures to avoid: how-sure bars claiming "sure" for an AI pick it was unsure about; a Left out entry shown under two
 * reasons, or a sent entry shown as left out; her pins/blocks stored in a shape today's code cannot read, or a pin
 * not lifting a block; an empty folder missing from "Browse any folder"; "This chat's folders" counted as a filter.
 * Run: npm run test:lore-view
 */
import { assertEqual, test, summary } from './helpers.mjs';
import * as P from '../src/panel/lore-pure.js';

test('how sure: the AI’s own confidence wins; a key, a pin or "always" is sure', () => {
    assertEqual(P.howSure({ matchedBy: 'kettle' }).level, 3);
    assertEqual(P.howSure({ matchedBy: 'Constant (always)' }).word, 'sure');
    assertEqual(P.howSure({ matchedBy: 'pinned' }).level, 3);
    assertEqual(P.howSure({ matchedBy: 'garden → AI: may go outside' }, { confidence: 'medium' }).word, 'likely');
    assertEqual(P.howSure({ matchedBy: 'AI: lights' }, { confidence: 'low' }).word, 'unsure');
    assertEqual(P.howSure({ matchedBy: 'AI: lights' }, { confidence: 0.9 }).level, 3);
    assertEqual(P.howSure({ matchedBy: 'AI: lights' }, {}).level, 2);
    assertEqual(P.howSure({ matchedBy: 'AI: lights' }).level, 0);
    assertEqual(P.howSure({}).level, 0);
});

test('why: short for the row, long for "Why:" — the AI’s own reason carried over', () => {
    assertEqual(P.whyOf({ matchedBy: 'kettle' }).short, 'matched “kettle”');
    const w = P.whyOf({ matchedBy: 'garden → AI' }, { reason: 'the scene may move outside.' });
    assertEqual(w.short, 'key › AI');
    assertEqual(w.long, 'The key “garden” matched, and the AI kept it. The scene may move outside.');
    assertEqual(P.whyOf({ matchedBy: 'AI: x' }).short, 'AI pick');
    assertEqual(P.whyOf({ matchedBy: 'pinned' }).long, 'You pinned it for this chat.');
    assertEqual(P.whyOf({}).short, '');
});

test('row icon and her Origin label', () => {
    assertEqual(P.leadFor({ guide: true }), '🧭');
    assertEqual(P.leadFor({ tags: ['lorebook', 'Character'] }), '🎭');
    assertEqual(P.leadFor({ customFields: { type: 'location' } }), '📍');
    assertEqual(P.leadFor({}), '📄');
    assertEqual(P.originOf({ customFields: { character: ['Kettle'], instance: 'Run A' } }), 'Kettle · Run A');
    assertEqual(P.originOf({ customFields: { character: '' } }), '');
});

test('funnel: matched › picked › sent with #N; keywords-only has no "picked"', () => {
    const t = { keywordMatched: [1, 2, 3], aiSelected: [1, 2], injected: [1] };
    assertEqual(P.funnelOf(t, 1, { added: [1, 2], removed: [] }, 34), { matched: 3, picked: 2, sent: 1, msg: 34, added: 2, removed: 0 });
    assertEqual(P.funnelOf({ ...t, mode: 'keywords-only' }, 1).picked, null);
    assertEqual(P.funnelOf(null, 4), null);
    assertEqual(P.funnelOf({}, 4).sent, 4);
});

test('Left out: one reason per entry, pipeline order, nothing that was sent, blocks first', () => {
    const categorized = [
        { stage: 'budget_cut', label: 'Over budget', entries: [{ title: 'Harbor', vaultSource: '', reason: 'Over budget (520 tok)' }, { title: 'Sink', vaultSource: '', reason: 'Over budget' }] },
        { stage: 'ai_rejected', label: 'AI Rejected', entries: [{ title: 'Kettle', vaultSource: '', reason: 'AI did not select' }, { title: 'Fridge', vaultSource: '', reason: 'AI did not select' }] },
        { stage: 'new_stage', label: 'Something new', entries: [{ title: 'Odd', vaultSource: '', reason: 'odd' }] },
    ];
    const g = P.outGroups({ categorized, folderRemoved: [{ title: 'Garden shed', vaultSource: '' }], blocks: ['Sink'], injectedKeys: new Set([P.pbKey('Kettle', '')]) });
    assertEqual(g.map(x => x.stage), ['blocked', 'folder', 'ai_rejected', 'budget_cut', 'new_stage']);
    assertEqual(g[0].entries.map(e => e.title), ['Sink']);
    assertEqual(g[2].entries.map(e => e.title), ['Fridge']);
    assertEqual(g[3].entries.map(e => e.title), ['Harbor']);
    assertEqual(g[3].entries[0].reason, 'Over budget: it needs 520 tokens.');
    assertEqual(g[4].label, 'Something new');
    assertEqual(P.outGroups({}), []);
});

test('timers: cooldowns always, stale ones only with decay on and past the threshold', () => {
    const cd = new Map([['v:Harbor party', 2], ['Kettle', 1]]);
    const dc = new Map([['v:Old', 7], ['v:New', 2]]);
    assertEqual(P.timerRows(cd, dc).map(r => `${r.name}: ${r.text}`), ['Harbor party: rests for 2 more replies', 'Kettle: rests for 1 more reply']);
    assertEqual(P.timerRows(new Map(), dc, { decayEnabled: true, threshold: 5 }).map(r => r.text), ['not sent for 7 replies']);
});

test('related: its links first, then entries sharing a key, at most five, never itself', () => {
    const idx = [{ title: 'A', keys: ['kettle'] }, { title: 'B', keys: ['Kettle', 'x'] }, { title: 'C', keys: ['y'] }, { title: 'D', keys: ['kettle'] }];
    assertEqual(P.relatedTitles({ title: 'A', keys: ['kettle'], resolvedLinks: ['C', 'A'] }, idx), ['C', 'B', 'D']);
    assertEqual(P.relatedTitles({ title: 'A', keys: ['kettle'] }, idx, 1), ['B']);
    assertEqual(P.relatedTitles({ title: 'Z' }, idx), []);
});

test('your own fields: values from the vault, lists flattened, empty fields left out', () => {
    const e = [{ customFields: { era: 'modern', place: ['Kitchen', 'Garden'] } }, { customFields: { era: 'old' } }, { customFields: { mood: '' } }];
    assertEqual(P.fieldValues(e, [{ name: 'era', label: 'Era' }, { name: 'place', label: 'Place' }, { name: 'mood', label: 'Mood' }]),
        [{ name: 'era', label: 'Era', values: ['modern', 'old'] }, { name: 'place', label: 'Place', values: ['Garden', 'Kitchen'] }]);
});

test('filter chips: "this chat’s folders" is the normal view; each other filter counts once', () => {
    assertEqual(P.filterSummary({ folder: '__chat__' }), { on: 0, text: 'Filters' });
    assertEqual(P.filterSummary({ folder: 'Kitchen', status: 'pinned', tag: 'x', fields: { era: 'old', place: '' }, quick: 'since-gen' }).text, 'Filters (5 on)');
    assertEqual(P.folderLabel('__chat__'), 'this chat’s');
    assertEqual(P.folderLabel(''), 'any folder');
    assertEqual(P.folderLabel('Kitchen/Run A'), 'Run A');
    assertEqual(P.folderLabel('00 Inbox', '00 Inbox'), 'New');
    assertEqual(P.sortWord('alpha_asc'), 'A to Z');
    assertEqual(P.statusWord('nope'), 'Any status');
});

test('folder picker: this chat’s folders starred first, empty folders listed, search matches the folder’s own name', () => {
    const counts = P.countByFolder([{ folderPath: 'Kitchen/Run A' }, { folderPath: 'Kitchen' }, { folderPath: 'Places' }]);
    assertEqual([counts.get('Kitchen'), counts.get('Kitchen/Run A'), counts.get('Places')], [2, 1, 1]);
    const rows = P.folderRows(['Places', 'Kitchen', 'Kitchen/Run A', '00 Inbox/Review'], counts, ['Kitchen']);
    assertEqual(rows.map(r => r.heading || r.folder), ['This chat’s folders', 'Kitchen', 'Kitchen/Run A', 'All folders', '00 Inbox/Review', 'Places']);
    assertEqual(rows.find(r => r.folder === '00 Inbox/Review').count, 0);
    assertEqual(P.folderRows(['Kitchen', 'Kitchen/Run A', 'Run'], counts, [], 'run').map(r => r.heading || r.folder), ['Folders', 'Kitchen/Run A', 'Run']);
});

test('pins and blocks: stored as { title, vaultSource }, a pin lifts a block, several at once, legacy strings read', () => {
    let s = P.togglePinBlock({ pins: [], blocks: ['Sink'] }, 'pin', [{ title: 'sink', vaultSource: '' }]);
    assertEqual(s, { pins: [{ title: 'sink', vaultSource: null }], blocks: [], on: true });
    s = P.togglePinBlock(s, 'pin', [{ title: 'Sink', vaultSource: null }]);
    assertEqual([s.pins, s.on], [[], false]);
    s = P.togglePinBlock({ pins: [{ title: 'A', vaultSource: 'v' }], blocks: [] }, 'block', [{ title: 'A', vaultSource: 'v' }, { title: 'B', vaultSource: 'v' }], true);
    assertEqual(s.pins, []);
    assertEqual(s.blocks.map(b => b.title), ['A', 'B']);
    assertEqual(P.isIn(['Kettle'], 'kettle', ''), true);
    assertEqual(P.isIn([{ title: 'Kettle', vaultSource: 'other' }], 'Kettle', ''), false);
    const before = { pins: ['X'], blocks: [] };
    P.togglePinBlock(before, 'pin', [{ title: 'Y' }]);
    assertEqual(before, { pins: ['X'], blocks: [] });
});

test('long lists: a page at a time', () => {
    assertEqual(P.capRows([1, 2, 3], 2), { shown: [1, 2], more: 1 });
    assertEqual(P.capRows(null, 5), { shown: [], more: 0 });
});

summary();
