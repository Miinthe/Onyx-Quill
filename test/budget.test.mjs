/**
 * Overhaul (2026-10-17) — the small general settings built after the bug hunt:
 *   budgets per chat / character (src/budget-pure.js) — "the most specific wins: chat → run → character → board → everywhere"
 *   where new entries go and how they are marked (src/new-entry-pure.js)
 *   her own prompt pieces (src/own-prompts-pure.js)
 * Failures to avoid: a chat's budget ignored, Everywhere's settings changed by an override, a "no limit" lost, entries
 * filed into the wrong folder, a prompt piece sent empty or twice.
 * Run: npm run test:budget
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { resolveBudget, cleanBudget, withPart, cleanPart, everywherePart, budgetKeys, partText, fromText, BUDGET_LAYERS } from '../src/budget-pure.js';
import { newEntryFolder, entryMarks, marksYaml, foldersByType } from '../src/new-entry-pure.js';
import { ownPrompts, ownInjections, ownWhere, cleanOwn, newOwnId, OWN_PREFIX } from '../src/own-prompts-pure.js';

const EVERY = { maxTokensBudget: 3072, unlimitedBudget: false, maxEntries: 10, unlimitedEntries: false };

test('budget: nothing set anywhere else = Everywhere, untouched', () => {
    const r = resolveBudget(EVERY, {});
    assertEqual(budgetKeys(r), EVERY, 'the four keys as Everywhere has them');
    assertEqual(r.from, { tokens: 'everywhere', entries: 'everywhere' }, 'both from Everywhere');
    const unl = resolveBudget({ ...EVERY, unlimitedBudget: true }, {});
    assertEqual(unl.unlimitedBudget, true, 'Everywhere’s “no limit” kept');
});

test('budget: the most specific wins — chat → run → character → board → everywhere', () => {
    assertEqual(BUDGET_LAYERS, ['chat', 'run', 'character', 'board'], 'the order');
    const all = { chat: { tokens: 1000 }, run: { tokens: 2000 }, character: { tokens: 3000 }, board: { tokens: 4000 } };
    assertEqual(resolveBudget(EVERY, all).maxTokensBudget, 1000, 'chat beats all');
    assertEqual(resolveBudget(EVERY, { ...all, chat: {} }).maxTokensBudget, 2000, 'then the run');
    assertEqual(resolveBudget(EVERY, { character: { tokens: 3000 }, board: { tokens: 4000 } }).maxTokensBudget, 3000, 'then the character');
    assertEqual(resolveBudget(EVERY, { board: { tokens: 4000 } }).maxTokensBudget, 4000, 'then the board');
    const r = resolveBudget(EVERY, { chat: { tokens: 2500 }, character: { entries: 4 } });
    assertEqual([r.maxTokensBudget, r.maxEntries], [2500, 4], 'tokens and entries resolve on their own');
    assertEqual(r.from, { tokens: 'chat', entries: 'character' }, 'and say where each came from');
});

test('budget: 0 = no limit, and an override turns Everywhere’s “no limit” off', () => {
    const r = resolveBudget(EVERY, { chat: { entries: 0 } });
    assertEqual(r.unlimitedEntries, true, 'chat: no limit on entries');
    assertEqual(r.maxEntries, 10, 'the number stays (unused)');
    const r2 = resolveBudget({ ...EVERY, unlimitedBudget: true }, { character: { tokens: 1500 } });
    assertEqual([r2.unlimitedBudget, r2.maxTokensBudget], [false, 1500], 'a character’s own budget limits again');
});

test('budget: overrides are tidied (ranges, junk, clearing)', () => {
    assertEqual(cleanPart('tokens', 50), 100, 'tokens at least 100');
    assertEqual(cleanPart('tokens', 999999), 100000, 'tokens at most 100000');
    assertEqual(cleanPart('entries', 2.6), 3, 'whole entries');
    assertEqual(cleanPart('entries', -1), undefined, 'negative = not set');
    assertEqual(cleanPart('entries', 'x'), undefined, 'junk = not set');
    assertEqual(cleanBudget({ tokens: '2500', entries: null, other: 1 }), { tokens: 2500 }, 'unknown keys dropped, strings read');
    assertEqual(cleanBudget(null), {}, 'nothing stored');
    assertEqual(withPart({ tokens: 2000 }, 'entries', 5), { tokens: 2000, entries: 5 }, 'set one part');
    assertEqual(withPart({ tokens: 2000, entries: 5 }, 'tokens', undefined), { entries: 5 }, 'clear one part');
    const stored = { tokens: 2000 };
    withPart(stored, 'tokens', 10);
    assertEqual(stored, { tokens: 2000 }, 'the stored object is not changed in place');
    resolveBudget(EVERY, { chat: { tokens: 1 } });
    assertEqual(EVERY.maxTokensBudget, 3072, 'Everywhere’s settings are never written');
});

test('budget: words', () => {
    assertEqual(everywherePart(EVERY, 'tokens'), 3072, 'Everywhere tokens');
    assertEqual(everywherePart({ ...EVERY, unlimitedEntries: true }, 'entries'), 0, 'no limit = 0');
    assertEqual(partText('tokens', 2500), '2500 tokens', 'tokens');
    assertEqual(partText('entries', 1), '1 entry', 'one entry');
    assertEqual(partText('entries', 0), 'no limit', 'no limit');
    assertEqual(fromText('chat', { here: 'chat' }), 'this chat', 'its own, on the chat page');
    assertEqual(fromText('character', { here: 'chat', characterName: 'Kettle' }), 'from Kettle', 'from the character');
    assertEqual(fromText('everywhere', { here: 'character' }), 'from Everywhere', 'from Everywhere');
});

test('new entries: by what they are about, else the Target folder', () => {
    const o = { mode: 'about', target: '00 Inbox', base: ['Characters/Kettle/', 'Kitchen'], run: ['Kitchen/Run A'] };
    assertEqual(newEntryFolder({ ...o, type: 'story' }), { folder: 'Kitchen/Run A', why: 'run' }, 'about the run → the run’s folder');
    assertEqual(newEntryFolder({ ...o, type: 'character' }), { folder: 'Characters/Kettle', why: 'character' }, 'about the character → its first base folder');
    assertEqual(newEntryFolder({ ...o, type: 'location' }).why, 'character', 'lasting things go with the character');
    assertEqual(newEntryFolder({ ...o, type: 'story', run: [] }).folder, 'Characters/Kettle', 'no run folder → the character’s');
    assertEqual(newEntryFolder({ ...o, type: 'lore', base: [] }).folder, 'Kitchen/Run A', 'no base folder → the run’s');
    assertEqual(newEntryFolder({ ...o, type: 'lore', base: [], run: [] }), { folder: '00 Inbox', why: 'target' }, 'no folders yet → the Target folder');
    assertEqual(newEntryFolder({ ...o, mode: 'target', type: 'story' }), { folder: '00 Inbox', why: 'target' }, 'always the Target folder');
    assertEqual(newEntryFolder({ mode: 'target', target: '' }).folder, '', 'empty Target = the vault’s top (as before)');
});

test('new entries: the marks', () => {
    const m = entryMarks({ chat: 'Claude test', message: 12 });
    assertEqual(m, { madeBy: 'Mero', from: '“Claude test” · message 12', tags: ['made-by-mero'] }, 'made_by, from, tag');
    assertEqual(marksYaml(m), 'made_by: Mero\nfrom: "“Claude test” · message 12"\n', 'as frontmatter');
    assertEqual(marksYaml(null), '', 'Mark them off: no lines');
    assertEqual(entryMarks({}).from, undefined, 'no chat: no from');
});

test('own prompts: tidy, where they go, what is sent', () => {
    const list = ownPrompts([{ id: 'a', name: ' Tense ', text: 'Keep it in present tense.', position: 0 }, { id: 'a', name: '', text: '  ', position: 1, depth: 2, role: 1 }, null]);
    assertEqual(list.map(p => p.id), ['a', 'a-2', 'p3'], 'ids unique');
    assertEqual(list[0].name, 'Tense', 'name trimmed');
    assertEqual(list[1].name, 'My prompt', 'a name always');
    assertEqual(cleanOwn({ position: 7 }).position, 0, 'unknown place → after the main prompt');
    assertEqual(ownWhere(list[0]), 'after the main prompt', 'words');
    assertEqual(ownWhere(list[1]), 'in the chat, depth 2, as user', 'words in the chat');
    assertEqual(ownWhere({ position: 2 }), 'before the main prompt', 'before');
    const inj = ownInjections(list);
    assertEqual(inj.length, 1, 'an empty one is not sent');
    assertEqual(inj[0], { slot: OWN_PREFIX + 'a', text: 'Keep it in present tense.', position: 0, depth: 4, role: 0 }, 'slot, text, place');
    assert(OWN_PREFIX.startsWith('deeplore_'), 'cleared with DeepLore’s other parts before each reply');
    assert(!list.some(p => p.id === newOwnId(list, 1)), 'a new id is new');
});

test('new entries: the folder for each kind (Write a new entry… follows the kind)', () => {
    const rule = { mode: 'about', target: 'Inbox', base: ['Characters/Kettle'], run: ['Kitchen/Run A'] };
    assertEqual(foldersByType(rule, ['story', 'lore', 'character']), { story: 'Kitchen/Run A', lore: 'Characters/Kettle', character: 'Characters/Kettle' });
    assertEqual(foldersByType({ ...rule, mode: 'target' }, ['story', 'lore']), { story: 'Inbox', lore: 'Inbox' });
    assertEqual(foldersByType({ mode: 'about', target: 'Inbox/' }, ['story']), { story: 'Inbox' }, 'no folders yet → the Target folder');
    assertEqual(foldersByType(rule, null), {});
});

await summary('budget, new entries, own prompts');
