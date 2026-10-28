/**
 * LOCAL PATCH suite — cleaning up a run (Miinthe, 2026-10-27: "if you delete a chat with an instance it should ask you if
 * you want to delete it from obsidian as well"). Failures to avoid: a shared story folder swept along; another run's or
 * another story's file offered; a file two runs use offered; the base Sessions folder treated as the run's; a run
 * counted as finished while a chat still uses it; trashed files offered again.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { runOfMeta, sameRun, chatsLeft, planCleanup, trashFolder, trashDest, runsInVault } from '../src/run-cleanup-pure.js';

const FOX = 'Corvin; A Fox as a Pet is an Ask for Trouble';
const f = (path, fm = {}) => ({ vault: 'Lore', path, fm });
const FILES = [
    // run B's session notes, in its own session folder
    f('01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble/Session 1.md', { character: FOX, instance: 'b', date: 'x' }),
    f('01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble/Session 2.md', { character: `"${FOX}"`, instance: ['b'] }),
    // run B's entries in the story's run folder and the Inbox
    f('03 Corvin; A Fox as a Pet is an Ask for Trouble/2 Instance B/Tea house.md', { character: FOX, instance: 'b' }),
    f('00 Inbox/Jade pendant.md', { character: FOX, instance: 'B' }),
    f('00 Inbox/Mero – the ledger.md', { character: FOX, instance: 'b', made_by: 'Mero' }),
    f('01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble/Session 0 (from A).md', { character: FOX, instance: 'b', carried_from: '01 Sessions/A…/Session 0.md' }),
    // not run B's: the shared story lore, run C, another story with a run B, two runs, no stamp outside its folders
    f('03 Corvin; A Fox as a Pet is an Ask for Trouble/Ostmark Harbor.md', { tags: ['lorebook'] }),
    f('03 Corvin; A Fox as a Pet is an Ask for Trouble/3 Instance C/Scene.md', { character: FOX, instance: 'c' }),
    f('08 Wren; Gallery Light/2 Instance B/Gallery.md', { character: 'Wren; Gallery Light', instance: 'b' }),
    f('03 Corvin; A Fox as a Pet is an Ask for Trouble/Shared.md', { character: FOX, instance: ['b', 'c'] }),
    f('00 Inbox/Retired/The Boss.md', { instance: 'b' }),
    f('01 Sessions/Loose note.md', { instance: 'b' }),
    // already in the trash
    f('zz Deleted runs/Corvin B (2026-10-01)/00 Inbox/Old.md', { character: FOX, instance: 'b' }),
];
const SF = '01 Sessions/B; Corvin; A Fox as a Pet is an Ask for Trouble';
const plan = (o = {}) => planCleanup({ files: FILES, run: 'b', story: FOX, sessionFolder: SF, trash: 'zz Deleted runs', ...o });
const paths = p => p.groups.flatMap(g => g.files.map(x => x.path));

test('a chat\'s run comes from its context: letter and story', () => {
    assertEqual(JSON.stringify(runOfMeta({ deeplore_context: { character: [FOX], instance: ['B'] } })), JSON.stringify({ run: 'b', story: FOX }));
    assertEqual(runOfMeta({}).run, '');
});

test('a run is finished only when no chat of the same story and letter is left', () => {
    const r = { run: 'b', story: FOX };
    const meta = (story, instance) => ({ deeplore_context: { character: story, instance } });
    assertEqual(chatsLeft([meta(FOX, 'b'), meta(FOX, 'c')], r), 1);
    assertEqual(chatsLeft([meta(FOX, 'c'), meta('Wren; Gallery Light', 'b')], r), 0);   // another story's run B doesn't count
    assertEqual(chatsLeft([meta(`  ${FOX.toUpperCase()} `, ['B'])], r), 1);
    assert(!sameRun({ run: '', story: FOX }, { run: '', story: FOX }));
});

test('the run\'s own files are offered, in their groups', () => {
    const p = plan();
    const by = Object.fromEntries(p.groups.map(g => [g.id, g.files.map(x => x.path.split('/').pop())]));
    assertEqual(by.sessions.join('|'), 'Session 1.md|Session 2.md');
    assertEqual(by.entries.join('|'), 'Jade pendant.md|Tea house.md');
    assertEqual(by.copies.join(), 'Session 0 (from A).md');
    assertEqual(by.mero.join(), 'Mero – the ledger.md');
    assertEqual(p.count, 6);
    assert(p.groups.every(g => g.files.every(x => x.vault === 'Lore')));
});

test('never offered: shared story lore, run C, another story, the trash, unstamped files outside the run\'s folders', () => {
    const got = paths(plan());
    for (const bad of ['Ostmark Harbor.md', 'Scene.md', 'Gallery.md', 'The Boss.md', 'Loose note.md', 'Old.md']) assert(!got.some(x => x.endsWith(bad)), bad);
});

test('a file two runs use is kept, with the reason', () => {
    const p = plan();
    assert(!paths(p).some(x => x.endsWith('Shared.md')));
    const k = p.kept.find(x => x.path.endsWith('Shared.md'));
    assertEqual(k.why, 'also used by run C');
});

test('no session folder of its own: session notes still go by stamp, the base Sessions folder is never swept', () => {
    const p = plan({ sessionFolder: '' });
    assert(paths(p).some(x => x.endsWith('Session 1.md')));
    assert(!paths(p).some(x => x.endsWith('Loose note.md')));
});

test('an unstamped file inside the run\'s own folder goes too; one stamped for another run there is kept', () => {
    const files = [f('Runs/B/Plain.md', {}), f('Runs/B/Other.md', { character: FOX, instance: 'c' })];
    const p = planCleanup({ files, run: 'b', story: FOX, runFolders: ['Runs/B'] });
    assertEqual(paths(p).join(), 'Runs/B/Plain.md');
    assertEqual(p.kept[0].why, 'stamped run C');
});

test('no letter: nothing at all', () => {
    assertEqual(planCleanup({ files: FILES, run: '', story: FOX }).count, 0);
});

test('the trash: one folder per cleanup, the file\'s own folders kept under it, a name Obsidian accepts', () => {
    const folder = trashFolder('zz Deleted runs/', { run: 'b', story: FOX }, new Date('2026-10-27T10:00:00Z'));
    assertEqual(folder, 'zz Deleted runs/Corvin; A Fox as a Pet is an Ask for Trouble B (2026-10-27)');
    assertEqual(trashDest(folder, '00 Inbox/Jade pendant.md'), `${folder}/00 Inbox`);
    assertEqual(trashDest(folder, 'Top.md'), folder);
    assert(!/[\\:*?"<>|]/.test(trashFolder('', { run: 'a', story: 'A/B: "C"?' })));
    assert(trashFolder('', { run: 'a', story: '' }).startsWith('zz Deleted runs/Run A ('));
});

test('every run in the vault, for cleaning up by hand', () => {
    const runs = runsInVault(FILES);
    const fox = runs.filter(r => r.story === FOX).map(r => `${r.run}:${r.files}`).join(',');
    assertEqual(fox, 'b:8,c:2');   // counts the trashed one too: the real read (readVault) never sees the trash
    assert(runs.some(r => r.story === 'Wren; Gallery Light' && r.run === 'b'));
});

summary('run-cleanup');
