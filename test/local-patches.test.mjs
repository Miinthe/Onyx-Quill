/**
 * LOCAL PATCH suite — covers the local patches whose logic can fail SILENTLY.
 *
 * Deliberately narrow. The CSS and DOM patches (scroll chaining, mobile layout, icon
 * rendering) are not covered: testing them needs a browser harness this repo does not
 * have, and a test that cannot fail is worse than no test.
 *
 * What IS covered is the two patches where a quiet regression costs something real:
 *   - moveEntry: the only code path that deletes a file from the lore vault
 *   - nextInstanceLetter / swapInstanceFolders: what a new run is filtered to
 * plus the cascade worklist, which is exercised against the real matchEntries().
 *
 * Run: npm run test:local-patches
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { moveEntry } from '../src/vault/move-entry-pure.js';
import { nextInstanceLetter, swapInstanceFolders, leafEncodesLetter } from '../src/drawer/new-run-pure.js';
import { resolveSessionFolder } from '../src/ai/session-folder-pure.js';
import { matchEntries } from '../src/pipeline/match.js';
import { splitGatingFields } from '../src/drawer/gating-visibility-pure.js';
import { frontmatterDate, frontmatterSummary, runEntries, planCarry, copyTarget, carriedContent } from '../src/drawer/branch-run-pure.js';
import { runStampYaml, insertIntoFrontmatter } from '../src/ai/run-stamp-pure.js';

// ── moveEntry — the safety sequence ────────────────────────────────────────
// A fake vault that records every operation, so ORDER can be asserted, not just outcome.
function fakeVault(files, faults = {}) {
    const v = { ...files };
    const log = [];
    const reads = {};
    return {
        files: v,
        log,
        io: {
            read: async (p) => {
                log.push(`read ${p}`);
                reads[p] = (reads[p] || 0) + 1;
                if (faults.corruptOnVerify === p && reads[p] > 1) return { ok: true, content: 'TRUNCATED', status: 200 };
                if (faults.vanishOnVerify === p && reads[p] > 1) return { ok: false, status: 404, error: 'HTTP 404' };
                if (faults.readFail === p) return { ok: false, status: 0, error: 'network' };
                return p in v ? { ok: true, content: v[p], status: 200 } : { ok: false, status: 404, error: 'HTTP 404' };
            },
            write: async (p, c) => {
                log.push(`write ${p}`);
                if (faults.writeFail === p) return { ok: false, error: 'disk full' };
                v[p] = c;
                return { ok: true };
            },
            del: async (p) => {
                log.push(`delete ${p}`);
                if (faults.deleteFail === p) return { ok: false, error: 'permission denied' };
                if (faults.rollbackFail === p) return { ok: false, error: 'permission denied' };
                delete v[p];
                return { ok: true };
            },
        },
    };
}
const START = { 'A/note.md': 'the real body' };
const run = (faults) => {
    const fv = fakeVault(START, faults);
    return moveEntry({ from: 'A/note.md', destFolder: 'B', io: fv.io }).then(r => ({ r, fv }));
};

test('moveEntry: clean move relocates the file and deletes the original last', async () => {
    const { r, fv } = await run({});
    assert(r.ok, 'reports success');
    assertEqual(Object.keys(fv.files).join(), 'B/note.md', 'only the destination remains');
    assertEqual(fv.log[fv.log.length - 1], 'delete A/note.md', 'the delete is the LAST operation');
});

test('moveEntry: refuses when the destination is occupied, touching nothing', async () => {
    const fv = fakeVault({ 'A/note.md': 'body', 'B/note.md': 'SOMETHING ELSE' });
    const r = await moveEntry({ from: 'A/note.md', destFolder: 'B', io: fv.io });
    assert(!r.ok, 'refused');
    assertEqual(fv.files['B/note.md'], 'SOMETHING ELSE', 'existing file untouched');
    assert(!fv.log.some(l => l.startsWith('write') || l.startsWith('delete')), 'nothing written or deleted');
});

test('moveEntry: refuses when the destination cannot be checked', async () => {
    const { r, fv } = await run({ readFail: 'B/note.md' });
    assert(!r.ok, 'refused — "could not see it" is not "not there"');
    assert(!fv.log.some(l => l.startsWith('delete')), 'no delete attempted');
});

test('moveEntry: a failed write leaves the original in place', async () => {
    const { r, fv } = await run({ writeFail: 'B/note.md' });
    assert(!r.ok, 'refused');
    assertEqual(fv.files['A/note.md'], 'the real body', 'original intact');
    assert(!fv.log.some(l => l.startsWith('delete')), 'no delete attempted');
});

test('moveEntry: a copy that reads back WRONG is rolled back, original never deleted', async () => {
    const { r, fv } = await run({ corruptOnVerify: 'B/note.md' });
    assert(!r.ok && r.rolledBack, 'rolled back');
    assertEqual(Object.keys(fv.files).join(), 'A/note.md', 'vault byte-identical to before');
    assert(!fv.log.includes('delete A/note.md'), 'the ORIGINAL was never deleted');
});

test('moveEntry: a copy that vanishes before verification is rolled back', async () => {
    const { r, fv } = await run({ vanishOnVerify: 'B/note.md' });
    assert(!r.ok && r.rolledBack, 'rolled back');
    assertEqual(Object.keys(fv.files).join(), 'A/note.md', 'vault unchanged');
});

test('moveEntry: a failed delete rolls the copy back rather than leaving a duplicate', async () => {
    const { r, fv } = await run({ deleteFail: 'A/note.md' });
    assert(!r.ok && r.rolledBack, 'rolled back');
    assertEqual(Object.keys(fv.files).join(), 'A/note.md', 'no duplicate left behind');
});

test('moveEntry: a rollback that itself fails reports an orphan loudly', async () => {
    const fv = fakeVault(START, { deleteFail: 'A/note.md', rollbackFail: 'B/note.md' });
    const r = await moveEntry({ from: 'A/note.md', destFolder: 'B', io: fv.io });
    assert(!r.ok && r.orphaned, 'flagged as orphaned, not silently swallowed');
    assertEqual(Object.keys(fv.files).sort().join(), 'A/note.md,B/note.md', 'both copies present');
});

test('moveEntry: same folder is a no-op', async () => {
    const fv = fakeVault(START);
    const r = await moveEntry({ from: 'A/note.md', destFolder: 'A', io: fv.io });
    assert(!r.ok, 'refused');
    assertEqual(fv.log.length, 0, 'no vault calls made at all');
});

test('moveEntry: trailing slashes and awkward filenames survive', async () => {
    const fv = fakeVault({ 'A/Char; a note.md': 'body' });
    const r = await moveEntry({ from: 'A/Char; a note.md', destFolder: 'B/Sub Folder/', io: fv.io });
    assert(r.ok, 'moved');
    assertEqual(r.to, 'B/Sub Folder/Char; a note.md', 'path built correctly');
});

// ── New Run — letter selection ─────────────────────────────────────────────
const CH = 'Some Character';
const entry = (character, instance) => ({ customFields: { character, instance: [instance] } });
const VAULT = [entry(CH, 'a'), entry(CH, 'a'), entry(CH, 'b'), entry(CH, 'c'), entry('Someone Else', 'z')];

test('nextInstanceLetter: increments past the highest letter in use', () => {
    assertEqual(nextInstanceLetter(VAULT, CH, 'c'), 'd', 'a,b,c used -> d');
});

test('nextInstanceLetter: reopening an OLD run does not regress the counter', () => {
    assertEqual(nextInstanceLetter(VAULT, CH, 'a'), 'd', 'still d, not b');
});

test('nextInstanceLetter: another character\'s letters are ignored', () => {
    assertEqual(nextInstanceLetter(VAULT, CH, ''), 'd', "the other character's 'z' must not count");
});

test('nextInstanceLetter: a character with no runs yet starts at a', () => {
    assertEqual(nextInstanceLetter([], 'Brand New', ''), 'a', 'first run');
});

test('nextInstanceLetter: returns null when z is taken', () => {
    assertEqual(nextInstanceLetter([entry(CH, 'z')], CH, 'z'), null, 'no letters left');
});

// ── New Run — folder swapping ──────────────────────────────────────────────
test('leafEncodesLetter: matches a standalone letter, not one inside a word', () => {
    assert(leafEncodesLetter('3 Instance C', 'c'), 'trailing standalone C');
    assert(leafEncodesLetter('C; Character; A Story', 'c'), 'leading standalone C');
    assert(!leafEncodesLetter('0 base', 'a'), "the 'a' inside 'base' must not match");
    assert(!leafEncodesLetter('Instance', 'c'), "the 'c' inside 'Instance' must not match");
});

test('swapInstanceFolders: rewrites only run-scoped folders', () => {
    const folders = [
        '02 Setting/base',
        '02 Setting/modern',
        '03 Character; A Story/0 base',
        '03 Character; A Story/3 Instance C',
        '01 Sessions/C; Character; A Story',
    ];
    const { folders: out, swapped } = swapInstanceFolders(folders, 'c', 'd');
    assertEqual(out[0], '02 Setting/base', 'shared folder untouched');
    assertEqual(out[2], '03 Character; A Story/0 base', "'0 base' untouched despite containing 'a'");
    assertEqual(out[3], '03 Character; A Story/3 Instance D', 'Instance C -> Instance D, not InstanDe');
    assertEqual(out[4], '01 Sessions/D; Character; A Story', 'session folder bumped');
    assertEqual(swapped.length, 2, 'exactly two folders reported as changed');
});

test('swapInstanceFolders: only the leaf is considered, never the parent path', () => {
    // A parent path containing a standalone letter must not make a child run-scoped.
    const { folders: out, swapped } = swapInstanceFolders(['03 C; A Story/0 base'], 'c', 'd');
    assertEqual(out[0], '03 C; A Story/0 base', 'unchanged — the C is in the parent, not the leaf');
    assertEqual(swapped.length, 0, 'nothing reported as swapped');
});

test('swapInstanceFolders: no current letter means nothing is rewritten', () => {
    const { folders: out, swapped } = swapInstanceFolders(['01 Sessions/C; X'], '', 'a');
    assertEqual(out[0], '01 Sessions/C; X', 'untouched');
    assertEqual(swapped.length, 0, 'nothing swapped');
});

// ── session-folder routing — character AND instance, never one alone ───────
// Miinthe's live layout on 2026-08-09. "A; Wren; Gallery Light" is deliberately ABSENT from this
// list even though it exists on disk: DeepLore derives folderList from folders that CONTAIN
// entries, so a brand-new empty session folder is invisible to it. That invisibility is
// exactly what made the old "only folder with this letter" fallback misfile.
const SESSION_FOLDERS = [
    { path: '01 Sessions/A; Corvin; A Fox as a Pet is an Ask for Trouble' },
    { path: '01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble' },
    { path: '01 Sessions/C; Corvin; A Fox as a Pet is an Ask for Trouble' },
];
const sf = (names, letter, folders = SESSION_FOLDERS) =>
    resolveSessionFolder('01 Sessions', names, letter, folders);

test('session folder: REGRESSION — Wren instance a never lands in Corvin instance a', () => {
    assertEqual(sf(['Wren; Gallery Light', 'Wren'], 'a'), '01 Sessions',
        'no A-folder names Wren, so it stays flat rather than taking Corvin\'s');
});

test('session folder: the matching character still routes correctly', () => {
    assertEqual(sf(['Corvin; A Fox as a Pet is an Ask for Trouble', 'Corvin'], 'c'),
        '01 Sessions/C; Corvin; A Fox as a Pet is an Ask for Trouble', 'Corvin c -> C folder');
});

test('session folder: matches on the context name\'s first segment', () => {
    // Context is "Wren; Gallery Light", folder is "A; Wren; Gallery Light" — once that folder
    // holds an entry and becomes visible, it must be found.
    const folders = [...SESSION_FOLDERS, { path: '01 Sessions/A; Wren; Gallery Light' }];
    assertEqual(sf(['Wren; Gallery Light', 'Wren'], 'a', folders),
        '01 Sessions/A; Wren; Gallery Light', 'picks Wren\'s own A folder, not Corvin\'s');
});

test('session folder: the card name is used when the context name matches nothing', () => {
    assertEqual(sf(['', 'Corvin, modern, Regency'], 'b'),
        '01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble', 'falls back to the card name');
});

test('session folder: a bare-letter folder naming nobody is still safe to use', () => {
    assertEqual(sf(['Wren'], 'a', [{ path: '01 Sessions/a' }]), '01 Sessions/a',
        'no character in the leaf means no character to collide with');
});

test('session folder: a letter folder naming SOMEONE ELSE is never the fallback', () => {
    assertEqual(sf(['Wren'], 'a', [{ path: '01 Sessions/A; Corvin; Whatever' }]), '01 Sessions',
        'single candidate, but it belongs to another character');
});

test('session folder: two folders for the same character and letter stay flat', () => {
    const folders = [
        { path: '01 Sessions/A; Corvin; A Fox as a Pet is an Ask for Trouble' },
        { path: '01 Sessions/A; Corvin; Head Over Heels' },
    ];
    assertEqual(sf(['Corvin'], 'a', folders), '01 Sessions', 'ambiguous — do not guess');
});

test('session folder: no instance means no subfolder', () => {
    assertEqual(sf(['Corvin'], ''), '01 Sessions', 'flat when the chat declares no instance');
});

test('session folder: nested folders are not treated as instance folders', () => {
    const folders = [{ path: '01 Sessions/A; Wren; Gallery Light/old' }];
    assertEqual(sf(['Wren'], 'a', folders), '01 Sessions', 'only direct children count');
});

test('session folder: the letter must be a whole token, not a word prefix', () => {
    const folders = [{ path: '01 Sessions/Archive; Wren; Gallery Light' }];
    assertEqual(sf(['Wren'], 'a', folders), '01 Sessions', "'Archive' must not match letter a");
});

// ── cascade_links — exercised against the REAL matchEntries() ──────────────
// Patch 14: cascade used a snapshot taken before the loop, so entries pulled in BY a
// cascade never had their own links read — A -> B -> C stopped at B.
const cEntry = (title, keys, cascadeLinks) => ({
    title, keys: keys || [], content: '', cascadeLinks: cascadeLinks || null,
    constant: false, bootstrap: false, scanDepth: null, probability: null, cooldown: null,
    warmup: null, refineKeys: null, excludeRecursion: false, priority: 50, vaultSource: '',
});
const CSETTINGS = {
    scanDepth: 2, newChatThreshold: 0, recursiveScan: false, maxRecursionSteps: 0,
    fuzzySearchEnabled: false, characterContextScan: false, keywordOccurrenceWeighting: false,
    priorityReversed: false, matchWholeWords: false, caseSensitive: false,
};
const cascadeOf = (entries) => matchEntries(
    [{ name: 'u', mes: 'alpha', is_user: true }], entries, { settings: CSETTINGS, characterName: null },
).matched.map(e => e.title).sort().join(',');

test('cascade: follows the whole chain, not one hop', () => {
    const r = cascadeOf([cEntry('A', ['alpha'], ['B']), cEntry('B', [], ['C']), cEntry('C', [], ['D']), cEntry('D')]);
    assertEqual(r, 'A,B,C,D', 'A -> B -> C -> D all pulled in');
});

test('cascade: a cycle terminates instead of hanging', () => {
    const r = cascadeOf([cEntry('A', ['alpha'], ['B']), cEntry('B', [], ['A'])]);
    assertEqual(r, 'A,B', 'A <-> B resolves once');
});

test('cascade: a self-link terminates', () => {
    assertEqual(cascadeOf([cEntry('A', ['alpha'], ['A'])]), 'A', 'no infinite loop');
});

test('cascade: a diamond pulls the shared target once', () => {
    const r = cascadeOf([cEntry('A', ['alpha'], ['B', 'C']), cEntry('B', [], ['D']), cEntry('C', [], ['D']), cEntry('D')]);
    assertEqual(r, 'A,B,C,D', 'D appears once, not twice');
});

test('cascade: link titles match case-insensitively', () => {
    const r = cascadeOf([cEntry('A', ['alpha'], ['the palace']), cEntry('The Palace')]);
    assertEqual(r, 'A,The Palace', 'case-insensitive title lookup');
});

// ── Filters tab: unused fields tucked away (2026-10-03) ────────────────────
const GDEFS = ['character', 'instance', 'era', 'scene_type'].map(n => ({ name: n, contextKey: n }));
const GENTRIES = [{ customFields: { character: 'Corvin', instance: ['c'] } }, { customFields: { character: 'Wren', era: [] } }, {}];
const names = r => r.map(f => f.name).join(',');

test('gating fields: only fields some entry uses are shown', () => {
    const r = splitGatingFields(GDEFS, GENTRIES, {}, false);
    assertEqual(names(r.visible), 'character,instance', 'visible');
    assertEqual(names(r.hidden), 'era,scene_type', 'hidden (an empty array does not count as use)');
});

test('gating fields: a field holding a value is never hidden', () => {
    const r = splitGatingFields(GDEFS, GENTRIES, { scene_type: ['battle'] }, false);
    assertEqual(names(r.visible), 'character,instance,scene_type', 'set value stays visible');
});

test('gating fields: show all shows everything', () => {
    const r = splitGatingFields(GDEFS, GENTRIES, null, true);
    assertEqual(r.hidden.length, 0, 'nothing hidden');
});

// ── Branch → new run (2026-10-03) ──────────────────────────────────────────
const NOTE = '---\ntags:\n  - lorebook\n  - lorebook-session\ndate: 2026-08-10T23:17:47.565Z\ncharacter: "Wren; Gallery Light"\nkeys:\n  - "car"\nsummary: "They argued in the car."\ninstance: a\n---\n\nThe body, exactly as Scribe wrote it.\n';

test('branch run: reads date and summary from frontmatter', () => {
    assertEqual(frontmatterDate(NOTE), Date.parse('2026-08-10T23:17:47.565Z'), 'date');
    assertEqual(frontmatterDate('---\ntags: []\n---\nno date'), null, 'no date');
    assertEqual(frontmatterSummary(NOTE), 'They argued in the car.', 'summary');
});

test('branch run: a copy changes only instance, adds provenance, keeps the body byte for byte', () => {
    const c = carriedContent(NOTE, { newLetter: 'b', carriedFrom: '01 Sessions/A; Wren; Gallery Light/n.md', atMessage: 41 });
    assert(c.includes('\ninstance: b\n'), 'instance rewritten');
    assert(!c.includes('instance: a'), 'old letter gone');
    assert(c.includes('carried_from: "01 Sessions/A; Wren; Gallery Light/n.md"'), 'from');
    assert(c.includes('carried_at_message: 41'), 'at');
    assert(c.includes('date: 2026-08-10T23:17:47.565Z'), 'original date kept');
    assertEqual(c.slice(c.indexOf('\n---', 3) + 4), NOTE.slice(NOTE.indexOf('\n---', 3) + 4), 'body identical');
});

test('branch run: instance as a list is replaced whole; a copy of a copy keeps one provenance', () => {
    const listy = '---\ninstance:\n  - a\n  - b\ncarried_from: "old"\ncarried_at_message: 3\n---\nx';
    const c = carriedContent(listy, { newLetter: 'c', carriedFrom: 'new', atMessage: 9 });
    assert(c.startsWith('---\ninstance: c\ncarried_from: "new"\ncarried_at_message: 9\n---'), c);
});

test('branch run: copies go to the swapped folder, or get a run suffix where the folder has no letter', () => {
    const swap = f => f.replace(/^01 Sessions\/C; /, '01 Sessions/D; ').replace(/3 Instance C$/, '3 Instance D');
    assertEqual(copyTarget('01 Sessions/C; Corvin; Fox/n.md', 'd', swap), '01 Sessions/D; Corvin; Fox/n.md', 'session folder');
    assertEqual(copyTarget('03 Fox/3 Instance C/Bell.md', 'd', swap), '03 Fox/3 Instance D/Bell.md', 'instance folder');
    assertEqual(copyTarget('00 Inbox/Bell.md', 'd', swap), '00 Inbox/Bell (run D).md', 'inbox suffix');
});

test('branch run: only this character\'s entries of this run; sessions apart from lore', () => {
    const E = [
        { filename: 's1', folderPath: '01 Sessions/C; Corvin; Fox', tags: ['lorebook-session'], customFields: { character: 'Corvin; Fox', instance: 'c' } },
        { filename: 'l1', folderPath: '03 Fox/3 Instance C', tags: [], customFields: { character: 'Corvin; Fox', instance: ['c'] } },
        { filename: 'l2', folderPath: '03 Corvin; Fox/3 Instance C', tags: [], customFields: { instance: 'c' } },   // old, no character: folder names him
        { filename: 'x1', folderPath: '08 Wren/1 Instance C', tags: [], customFields: { character: 'Wren', instance: 'c' } },  // other character
        { filename: 'x2', folderPath: '03 Fox/2 Instance B', tags: [], customFields: { character: 'Corvin; Fox', instance: 'b' } }, // other run
    ];
    const r = runEntries(E, { character: 'Corvin; Fox', instance: 'c' });
    assertEqual(r.sessions.map(e => e.filename).join(','), 's1', 'sessions');
    assertEqual(r.lore.map(e => e.filename).join(','), 'l1,l2', 'lore');
});

test('branch run: before ticked, the covering note apart, later lore left behind, undated listed', () => {
    const t = s => Date.parse(s);
    const p = planCarry(
        [{ path: 'n1', date: t('2026-08-01T10:00Z') }, { path: 'n3', date: t('2026-08-03T10:00Z') }, { path: 'n2', date: t('2026-08-02T10:00Z') }, { path: 'n4', date: t('2026-08-04T10:00Z') }],
        [{ path: 'e1', date: t('2026-08-01T12:00Z') }, { path: 'e2', date: null }, { path: 'e3', date: t('2026-08-05T00:00Z') }],
        t('2026-08-02T18:00Z'),
    );
    assertEqual(p.sessionsBefore.map(n => n.path).join(','), 'n1,n2', 'before, in order');
    assertEqual(p.sessionStraddle.path, 'n3', 'first after covers the point');
    assertEqual(p.loreBefore.map(e => e.path).join(','), 'e1', 'dated lore before');
    assertEqual(p.loreUndated.map(e => e.path).join(','), 'e2', 'undated');
    assertEqual(p.loreAfterCount, 1, 'later lore stays');
});

test('run stamp: character, instance and a date; inserted before the closing ---', () => {
    const y = runStampYaml({ character: ['Corvin; Fox'], instance: ['c'] }, ['character', 'instance'], new Date('2026-10-03T08:00:00Z'));
    assertEqual(y, 'character: Corvin; Fox\ninstance: c\ndate: 2026-10-03T08:00:00.000Z\n', 'yaml');
    assertEqual(runStampYaml(null, ['character'], new Date(0)), 'date: 1970-01-01T00:00:00.000Z\n', 'no context: date only');
    assertEqual(insertIntoFrontmatter('---\ntype: lore\n---\nbody', 'x: 1\n'), '---\ntype: lore\nx: 1\n---\nbody', 'insert');
    assertEqual(insertIntoFrontmatter('no frontmatter', 'x: 1\n'), 'no frontmatter', 'untouched');
});

await summary();
