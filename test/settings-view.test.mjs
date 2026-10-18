/**
 * Overhaul step 4 — the settings window (src/settings/settings-pure.js).
 * Failures to avoid: a row writing a key that doesn't exist (a setting silently lost); a control of the old window that
 * the new one forgot; a merged row changing one of its two old keys when it shouldn't; old deep links landing nowhere;
 * the Librarian showing up in the new window.
 * Run: npm run test:settings-view
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assert, assertEqual, test, summary } from './helpers.mjs';
import {
    SECTIONS, allRows, findRow, rowValue, writeRow, isChanged, resetRow, showValue, cardSummary, changedCount, searchRows, searchAll,
    clampNumber, sectionForNav, JOBS, JOB_KEYS, jobRuns, connChoice, writeConnChoice, followers, PROMPTS, NOT_DRAWN, SPACING, spacingOf, roughTokens,
} from '../src/settings/settings-pure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsSrc = readFileSync(join(ROOT, 'settings.js'), 'utf8');
const objectAfter = (src, marker) => {
    const i = src.indexOf(marker); let depth = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) return src.slice(j, k + 1); } }
    throw new Error('no object after ' + marker);
};
const DEFAULTS = new Function(`return ${objectAfter(settingsSrc, 'export const defaultSettings =')}`)();
const CONSTRAINTS = new Function(`return ${objectAfter(settingsSrc, 'export const settingsConstraints =')}`)();
const fresh = () => JSON.parse(JSON.stringify(DEFAULTS));
const dleRows = allRows().filter(x => !x.row.src || x.row.src === 'dle').map(x => x.row);

test('every row stores a key that exists in settings.js defaults', () => {
    for (const r of dleRows) {
        if (r.type === 'btn') continue;
        if (r.key) assert(r.key in DEFAULTS, `${r.id}: ${r.key} is a real setting`);
        else assert(typeof r.read === 'function' && typeof r.write === 'function', `${r.id}: merged rows have read and write`);
    }
    assert('askBeforeRemoving' in DEFAULTS, 'Ask before removing has a default');
    assertEqual(DEFAULTS.askBeforeRemoving, false, 'off by default (small things go at once with Undo)');
});

test('ids are unique; choices match settings.js enums', () => {
    const ids = allRows().map(x => x.row.id);
    assertEqual(new Set(ids).size, ids.length, 'unique ids');
    for (const r of dleRows) {
        const en = r.key && CONSTRAINTS[r.key]?.enum;
        if (en && r.opts) for (const [v] of r.opts) assert(en.includes(v), `${r.id}: ${v} is allowed for ${r.key}`);
        if (r.opts && r.key && !r.optsFrom) assert(r.opts.some(([v]) => v === DEFAULTS[r.key]), `${r.id}: the default ${DEFAULTS[r.key]} is one of the choices`);
    }
});

test('every control of the old window is drawn, or listed with a reason', () => {
    const ui = readFileSync(join(ROOT, 'src/ui/settings-ui.js'), 'utf8');
    const from = ui.indexOf('function loadPopupSettings');
    const to = ui.indexOf('// Prompts tab — extracted');
    const keys = new Set([...ui.slice(from, to).matchAll(/settings\.([a-zA-Z]\w+)\s*(?:=[^=]|\))/g)].map(m => m[1]));
    const drawn = new Set();
    for (const r of dleRows) {
        if (r.key) drawn.add(r.key);
        for (const k of r.keys || []) drawn.add(k);
        const src = `${r.read || ''} ${r.write || ''}`;
        for (const k of Object.keys(DEFAULTS)) if (new RegExp(`\\b${k}\\b`).test(src)) drawn.add(k);
    }
    for (const k of Object.values(JOB_KEYS).flatMap(o => Object.values(o))) drawn.add(k);
    for (const p of PROMPTS) drawn.add(p.key);
    drawn.add('promptPresets');
    const skip = k => k.startsWith('librarian') || k.startsWith('_') || k === 'advancedVisible' || k === 'analyticsData' || /ProxyUrl$/.test(k) || /^obsidian/.test(k);
    for (const k of keys) {
        if (!(k in DEFAULTS) || skip(k)) continue;
        assert(drawn.has(k) || k in NOT_DRAWN, `old control ${k} is in the new window (or NOT_DRAWN says why)`);
    }
});

test('the Librarian is not in the new window', () => {
    for (const { row, card, sec } of allRows()) {
        const words = [row.label, row.hint, row.tip, card.t, sec.name].filter(Boolean).join(' ');
        assert(!/librarian/i.test(words), `${row.id} doesn't mention the Librarian`);
    }
    assert(!JOBS.some(j => j.tool === 'librarian'), 'no Librarian job');
});

test('merged rows: "every N · 0 = off" keeps both old keys as the old controls did', () => {
    const s = fresh();
    const sc = findRow('sc-on').row;
    s.scribeInterval = 7;
    assertEqual(rowValue(sc, s), 0, 'off reads 0');
    writeRow(sc, s, 12);
    assertEqual([s.scribeEnabled, s.scribeInterval], [true, 12], 'a number switches it on');
    writeRow(sc, s, 0);
    assertEqual([s.scribeEnabled, s.scribeInterval], [false, 12], '0 switches it off and keeps the number');
    const n = findRow('n-on').row;
    writeRow(n, s, 1);
    assertEqual([s.autoSuggestEnabled, s.autoSuggestInterval], [true, 3], 'clamped to New lore’s minimum (3)');
    const sk = findRow('b-skip').row;
    assertEqual(rowValue(sk, fresh()), DEFAULTS.stripLookbackDepth, 'skip shows the lookback when on (the default)');
    writeRow(sk, s, 0);
    assertEqual([s.stripDuplicateInjections, s.stripLookbackDepth], [false, DEFAULTS.stripLookbackDepth], 'skip 0 = off, lookback kept');
    assert(isChanged(sk, s, DEFAULTS), 'changed');
    resetRow(sk, s, DEFAULTS);
    assertEqual([s.stripDuplicateInjections, s.stripLookbackDepth], [true, DEFAULTS.stripLookbackDepth], 'reset puts both back');
    const ch = findRow('s-chain').row;
    writeRow(ch, s, 4);
    assertEqual([s.recursiveScan, s.maxRecursionSteps], [true, 4], 'chain steps');
});

test('search mode: the same two keys as the old Search mode list', () => {
    const r = findRow('s-mode').row, s = fresh();
    assertEqual(rowValue(r, s), 'keywords-only', 'default: keywords only');
    s.aiSearchMode = 'ai-only';
    writeRow(r, s, 'two-stage');
    assertEqual([s.aiSearchEnabled, s.aiSearchMode], [true, 'two-stage'], 'two-stage');
    writeRow(r, s, 'ai-only');
    assertEqual([s.aiSearchEnabled, s.aiSearchMode], [true, 'ai-only'], 'judge only');
    writeRow(r, s, 'keywords-only');
    assertEqual([s.aiSearchEnabled, s.aiSearchMode], [false, 'two-stage'], 'keywords only (as the old window wrote it)');
});

test('fields list, graph spacing', () => {
    const r = findRow('s-jfields').row, s = fresh();
    writeRow(r, s, ' era, , faction ');
    assertEqual(s.aiManifestIncludeFields, ['era', 'faction'], 'comma list');
    assertEqual(rowValue(r, s), 'era, faction', 'shown');
    assertEqual(spacingOf(DEFAULTS), 'normal', 'the shipped physics is “normal”');
    assertEqual(SPACING.normal.graphGravity, DEFAULTS.graphGravity, 'normal = defaults');
    const g = findRow('g-space').row;
    writeRow(g, s, 'loose');
    assertEqual(spacingOf(s), 'loose', 'loose');
    s.graphGravity = 3.3;
    assertEqual(rowValue(g, s), 'custom', 'hand-set physics reads custom');
});

test('changed, reset, summaries, counts', () => {
    const s = fresh();
    const r = findRow('b-max').row;
    assert(!isChanged(r, s, DEFAULTS), 'default not changed');
    s.maxEntries = 15;
    assert(isChanged(r, s, DEFAULTS), 'changed');
    assertEqual(showValue(r, DEFAULTS.maxEntries), '10', 'default shown');
    resetRow(r, s, DEFAULTS);
    assertEqual(s.maxEntries, 10, 'reset');
    s.aiManifestIncludeFields = ['x'];
    resetRow(findRow('s-jfields').row, s, DEFAULTS);
    assertEqual(s.aiManifestIncludeFields, [], 'reset an array');
    const budget = SECTIONS.find(x => x.id === 'budget');
    s.maxEntries = 20; s.unlimitedBudget = true;
    assertEqual(changedCount(budget, () => s, () => DEFAULTS), 2, 'two changed in Budget & variety');
    assert(/Entries per reply 20/.test(cardSummary(budget.cards[0], () => s)), 'summary says the value');
    assert(isChanged(findRow('ui-ask').row, { askBeforeRemoving: true }, { askBeforeRemoving: false }), 'own rows compare too');
    assert(!isChanged(findRow('a-resetall').row, s, DEFAULTS), 'buttons are never changed');
});

test('search finds labels, hints and the old names', () => {
    const ids = q => searchRows(q).map(h => h.row.id);
    assert(ids('bootstrap').includes('v-boot'), 'old name Bootstrap → Starter tag');
    assert(ids('test match').includes('a-try'), 'Test Match → Try matching');
    assert(ids('cooldown').includes('b-cool'), 'Repeat cooldown');
    assert(ids('depth').length >= 5, 'depth finds several');
    assert(searchAll('API key').extras.some(x => x.sec === 'vault'), 'vault fields are found');
    assert(searchAll('inherit').extras.some(x => x.sec === 'ai'), 'inherit → AI & connections');
    assertEqual(searchRows('').length, 0, 'empty search finds nothing');
});

test('numbers: the settings.js range, and seconds for time limits', () => {
    const r = findRow('b-max').row;
    assertEqual(clampNumber(r, '500', CONSTRAINTS), 100, 'max 100');
    assertEqual(clampNumber(r, '0', CONSTRAINTS), 1, 'min 1');
    assertEqual(clampNumber(r, '', CONSTRAINTS), null, 'empty keeps');
    assertEqual(clampNumber(r, 'abc', CONSTRAINTS), null, 'not a number keeps');
    assertEqual(clampNumber({ key: 'meroTimeout', scale: 1000 }, '90', CONSTRAINTS), 90000, 'seconds → ms');
    assertEqual(clampNumber({ key: 'meroTimeout', scale: 1000 }, '1', CONSTRAINTS), 5000, 'clamped in ms');
    assertEqual(clampNumber(findRow('b-skip').row, '0', CONSTRAINTS), 0, '0 allowed on merged rows');
});

test('old deep links land on the new sections', () => {
    assertEqual(sectionForNav({ tab: 'ai-connections', toolKey: 'scribe' }), 'ai', 'proxy-migration notice');
    assertEqual(sectionForNav({ tab: 'connection', subtab: 'ai-connections', toolKey: 'librarian' }), 'ai', 'two-tier tokens');
    assertEqual(sectionForNav({ tab: 'search' }), 'select', 'search');
    assertEqual(sectionForNav({ tab: 'session-scribe' }), 'story', 'scribe');
    assertEqual(sectionForNav({ section: 'filters' }), 'filters', 'the hub');
    assertEqual(sectionForNav(null), null, 'none');
});

test('connections: the same mode / profile keys the old radios wrote', () => {
    const s = fresh();
    assertEqual(connChoice('scribe', s), 'inherit', 'scribe inherits by default');
    writeConnChoice('scribe', s, 'p1');
    assertEqual([s.scribeConnectionMode, s.scribeProfileId], ['profile', 'p1'], 'profile');
    writeConnChoice('scribe', s, 'st');
    assertEqual([s.scribeConnectionMode, s.scribeProfileId], ['st', 'p1'], 'SillyTavern keeps the profile id');
    assertEqual(connChoice('scribe', s), 'st', 'reads st');
    assert(followers(fresh()).includes('New lore'), 'New lore follows the judge by default');
    assert(!followers(fresh()).includes('Story helper'), 'the story helper never inherits');
    for (const j of JOBS) for (const k of Object.values(JOB_KEYS[j.tool])) assert(k in DEFAULTS, `${j.tool}: ${k}`);
    for (const j of JOBS) if (CONSTRAINTS[JOB_KEYS[j.tool].mode]?.enum) for (const m of j.modes) assert(CONSTRAINTS[JOB_KEYS[j.tool].mode].enum.includes(m), `${j.tool} offers only allowed modes`);
    assertEqual(jobRuns('scribe', { scribeEnabled: true, scribeInterval: 8 }), 'every 8 messages', 'runs');
    assertEqual(jobRuns('aiSearch', { aiSearchEnabled: false }), 'off (keywords only)', 'judge off');
    assertEqual(roughTokens('abcdefgh'), 2, 'tokens');
});

test('2026-10-17 rows: story block keeps today’s place; new entries; budgets per chat / character', () => {
    assertEqual([DEFAULTS.storyBlockPosition, DEFAULTS.storyBlockDepth, DEFAULTS.storyBlockRole], [1, 4, 0], 'story block: in the chat, depth 4, system (as it was fixed before)');
    for (const id of ['i-story', 'i-stdepth', 'i-strole', 'n-file', 'n-mark']) assert(findRow(id), `${id} is drawn`);
    assertEqual(findRow('n-file').sec.id, 'story', 'Where they go: Story & memory');
    assertEqual(DEFAULTS.newEntryPlacement, 'about', 'by what they’re about (the mock-up)');
    assertEqual(DEFAULTS.newEntryMark, true, 'marked (the mock-up)');
    assertEqual(DEFAULTS.characterBudgets, {}, 'no character has its own budget at first');
    assertEqual(DEFAULTS.ownPrompts, [], 'no own prompts at first');
    assert(SECTIONS.find(x => x.id === 'budget').cards[0].custom === 'budgetScopes', 'the Budget card shows this chat / a character');
    assert(!allRows().some(x => /^(t-ask|c-dir|c-max)$/.test(x.row.id)), 'board / Cast settings stay on the board (Miinthe, 2026-10-17)');
    assertEqual(searchAll('own prompt').extras.map(x => x.id), ['x-own'], 'search finds your own prompts');
});

await summary('settings view');
