/**
 * LOCAL PATCH suite — notices gathered (2026-10-13) and a new chat's own run letter (2026-10-13).
 * Failures to avoid: a summary that shows the quote or "Undo" instead of the change; a list that grows forever or
 * mixes messages; a new chat taking a run letter that is already used — or none when the character has runs.
 * Run: npm run test:notices
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { firstLine, summaryText, addToFeed, groupFeed, FEED_KEPT } from '../src/notices-pure.js';
import { autoRunLetter } from '../src/characters-pure.js';
import { nextInstanceLetter } from '../src/drawer/new-run-pure.js';

test('a notice\'s first line is the change itself — no quote, no reason, no Undo, entities undone', () => {
    assertEqual(firstLine('🎭 Kettle turns up at Kitchen (1 in 3)<br><i>“quote”</i><br><u>Undo</u>'), '🎭 Kettle turns up at Kitchen (1 in 3)');
    assertEqual(firstLine('📍 Where: the scene is now at Kitchen &amp; Pantry<br/>x'), '📍 Where: the scene is now at Kitchen & Pantry');
});

test('the summary: two changes in full, then "+N more"; long ones clipped', () => {
    const it = t => ({ html: `${t}<br><u>Undo</u>` });
    assertEqual(summaryText([it('📍 Where: Kitchen'), it('🎭 Kettle turns up')]), '📍 Where: Kitchen · 🎭 Kettle turns up');
    assertEqual(summaryText([it('a'), it('b'), it('c'), it('d')]), 'a · b · +2 more');
    assertEqual(summaryText([it('x'.repeat(10) + ' ' + 'y'.repeat(80))]).endsWith('…'), true);
    assertEqual(summaryText([]), '');
});

test('the list: kept to its size, grouped by message, newest message first', () => {
    let f = [];
    for (let n = 0; n < FEED_KEPT + 5; n++) f = addToFeed(f, [{ html: String(n), i: Math.floor(n / 3) }]);
    assertEqual([f.length, f[0].html], [FEED_KEPT, '5']);
    const g = groupFeed([{ html: 'a', i: 4 }, { html: 'b', i: 6 }, { html: 'c', i: 4 }, { html: 'd' }]);
    assertEqual(g.map(x => [x.i, x.items.map(y => y.html).join('')]), [[6, 'b'], [4, 'ac'], [-1, 'd']]);
});

test('a new chat\'s run letter: the character\'s next free one, found by the card\'s name when the chat has no Character', () => {
    const v = [
        { customFields: { character: 'Toaster; The Kitchen', instance: 'a' } },
        { customFields: { character: 'Toaster; The Kitchen', instance: 'b' } },
        { customFields: { character: 'Toaster; The Kitchen', instance: ['c'] } },
        { customFields: { character: 'Corvin', instance: 'f' } },
    ];
    assertEqual(autoRunLetter(v, '', 'Toaster', nextInstanceLetter), { letter: 'd', character: 'Toaster; The Kitchen' });
    assertEqual(autoRunLetter(v, ['Corvin'], 'Whoever', nextInstanceLetter), { letter: 'g', character: 'Corvin' });
    assertEqual(autoRunLetter(v, '', 'Nobody', nextInstanceLetter), { letter: 'a', character: '' });
    assertEqual(autoRunLetter([], '', '', nextInstanceLetter).letter, 'a');
});

summary();
