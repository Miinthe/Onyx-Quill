/**
 * LOCAL PATCH suite — creating an entry from the board (2026-10-04).
 * Failures to avoid: a broken frontmatter (a quote or a "---" in her text); a file name with
 * characters the vault can't take; keys lost or doubled; a place entry without its location;
 * her text changed.
 * Run: npm run test:board-entry
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { buildEntryFile, safeTitle, splitKeys } from '../src/board-entry-pure.js';

test('a plain entry: folder, type, tag, keys, summary, run stamp, heading, her text', () => {
    const { filename, content } = buildEntryFile(
        { title: 'Gerry the Caterpillar', folder: 'The Kitchen/', type: 'character', keys: 'gerry, caterpillar, gerry', summary: 'Gerry, often in the garden. Select when Gerry comes up.', body: 'A fat green caterpillar.\nHe likes cabbage.' },
        { stamp: 'instance: a\ndate: 2026-10-04T20:00:00.000Z\n', lorebookTag: 'lorebook' });
    assertEqual(filename, 'The Kitchen/Gerry the Caterpillar.md');
    assertEqual(content, `---
type: character
priority: 50
tags:
  - lorebook
keys:
  - gerry
  - caterpillar
summary: "Gerry, often in the garden. Select when Gerry comes up."
instance: a
date: 2026-10-04T20:00:00.000Z
---
# Gerry the Caterpillar

A fat green caterpillar.
He likes cabbage.
`);
});

test('a place entry carries its location, the spot first, then what it sits in', () => {
    const { content } = buildEntryFile({ title: 'Crumb monster', folder: 'Places', type: 'character', location: ['counter', 'kitchen'] });
    assert(content.includes('location:\n  - counter\n  - kitchen\n'));
});

test('quotes, colons and a line of dashes in her words don\'t break the file; her text is otherwise untouched', () => {
    const { content } = buildEntryFile({ title: 'Note', summary: 'Say "hi": now', body: 'Line one\n---\nLine three' });
    assert(content.includes('summary: "Say \\"hi\\": now"'));
    assert(content.includes('Line one\n- - -\nLine three'));
    assertEqual(buildEntryFile({ title: 'K', keys: ['a: b', '-x'] }).content.split('\n').filter(l => l.startsWith('  - ')).slice(1), ['  - "a: b"', '  - "-x"']);
});

test('no keys, no text: still a valid file; an unknown type becomes lore; no folder = vault root', () => {
    const { filename, content } = buildEntryFile({ title: 'Empty', type: 'weird' });
    assertEqual(filename, 'Empty.md');
    assert(content.includes('type: lore\n') && content.includes('keys: []\n') && content.endsWith('# Empty\n'));
});

test('file names: characters the vault can\'t take are replaced; reserved names guarded', () => {
    assertEqual(safeTitle('What? A/B: "test"'), 'What_ A_B_ _test_');
    assertEqual(safeTitle('CON'), '_CON');
    assertEqual(safeTitle('  '), 'Untitled');
    assertEqual(splitKeys(' a, b ,, a'), ['a', 'b']);
});

test('a draft Mero wrote: made_by, from, her tag after the lorebook tag (the date comes with the run stamp)', () => {
    const { content } = buildEntryFile({ title: 'Neighbours · How they act', type: 'story', keys: ['neighbour'], summary: 'x', madeBy: 'Mero', from: '"Claude test" · board Toaster & Kettle · Neighbours', tags: ['made-by-mero', 'lorebook'] },
        { stamp: 'date: 2026-10-16T10:00:00.000Z\n', lorebookTag: 'lorebook' });
    assert(content.includes('tags:\n  - lorebook\n  - made-by-mero\nkeys:'), 'tags');
    assert(content.includes('made_by: Mero\nfrom: "\\"Claude test\\" · board Toaster & Kettle · Neighbours"\ndate: 2026-10-16'), content);
    assert(!buildEntryFile({ title: 'Mine' }).content.includes('made_by'), 'her own entries carry no made_by');
});

summary('board-entry');
