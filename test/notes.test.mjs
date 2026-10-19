/**
 * My notes suite (src/notes-pure.js, 2026-10-18).
 * Failures to avoid: a plot note showing in another story's chats; a renamed board losing its notes; the library
 * crowding "here"; a note put in the reply box wiping what was typed; a broken file entry throwing; the Notebook
 * import losing text or keeping raw HTML.
 * Run: npm run test:notes
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { normNotes, isHere, groupsHere, searchNotes, whereText, moveTo, preview, intoBox, noteToHtml, notebookToText, notebookPages, sortNotes } from '../src/notes-pure.js';

const A = { chat: 'Kettle - run A', chatName: 'Kettle - run A', story: 'Harbor', char: 'kettle.png', charName: 'Kettle' };
const B = { chat: 'Kettle - run B', chatName: 'Kettle - run B', story: 'Harbor', char: 'kettle.png', charName: 'Kettle' };
const T = { chat: 'Toaster', chatName: 'Toaster', story: '', char: 'toaster.png', charName: 'Toaster' };
const notes = normNotes({ notes: [
    { id: '1', s: 'chat', k: 'Kettle - run A', t: 'left off', b: 'ledger', at: 5 },
    { id: '2', s: 'story', k: 'Harbor', t: 'threads', b: 'ferry', at: 4 },
    { id: '3', s: 'char', k: 'kettle.png', kn: 'Kettle', t: 'voice', b: 'dry', at: 3 },
    { id: '4', s: 'all', t: 'OOC slow', b: '(OOC: slow down)', at: 2, pin: true },
    { id: '5', s: 'all', t: 'OOC recap', b: '(OOC: recap)', at: 6 },
    { id: '6', s: 'story', k: 'Old name', t: 'renamed board', b: 'x', at: 1 },
] }).notes;

test('each note shows only in its own place', () => {
    const g = groupsHere(notes, A);
    assertEqual([g.chat.map(n => n.id), g.story.map(n => n.id), g.char.map(n => n.id)], [['1'], ['2'], ['3']]);
    const gb = groupsHere(notes, B);
    assertEqual([gb.chat.length, gb.story.map(n => n.id), gb.char.length], [0, ['2'], 1]);
    const gt = groupsHere(notes, T);
    assertEqual([gt.chat.length, gt.story.length, gt.char.length, gt.all.length], [0, 0, 0, 2]);
});

test('the library: pinned first, then newest; A to Z on request', () => {
    assertEqual(groupsHere(notes, A).all.map(n => n.id), ['4', '5']);
    assertEqual(sortNotes(notes.filter(n => n.s === 'all'), 'az').map(n => n.t), ['OOC slow', 'OOC recap']);   // pinned still first
});

test('a renamed board keeps its notes', () => {
    const resolve = k => (k === 'Old name' ? 'Harbor' : k);
    assertEqual(groupsHere(notes, A, { resolve }).story.map(n => n.id), ['2', '6']);
});

test('search finds notes from everywhere, the ones here first, and says where they live', () => {
    const f = searchNotes(notes, 'ledger', T);
    assertEqual(f.map(n => n.id), ['1']);
    assertEqual(whereText(f[0]), 'Chat: Kettle - run A');
    assertEqual(searchNotes(notes, 'OOC', A).map(n => n.id), ['4', '5']);
    assertEqual(searchNotes(notes, '  ', A), []);
});

test('moving: to a place of this chat; not to one it has not got', () => {
    assertEqual(moveTo('story', A), { s: 'story', k: 'Harbor', kn: 'Harbor' });
    assertEqual(moveTo('all', A), { s: 'all', k: '', kn: '' });
    assertEqual(moveTo('story', T), null);
});

test('a broken file never throws; odd entries are dropped or fixed', () => {
    const d = normNotes({ notes: [null, 5, { id: 'x', s: 'chat' }, { id: 'y', s: 'weird', t: 'kept' }, { id: 'y', s: 'all' }] });
    assertEqual(d.notes.map(n => [n.id, n.s]), [['y', 'all']]);
    assertEqual(normNotes('garbage').notes, []);
});

test('put in reply box: an empty box gets the note, typed text is kept', () => {
    assertEqual(intoBox('', 'hi'), 'hi');
    assertEqual(intoBox('  ', 'hi'), 'hi');
    assertEqual(intoBox('I walk in.  \n', '(OOC: slow)'), 'I walk in.\n(OOC: slow)');
});

test('card preview: one line, marks taken out', () => {
    assertEqual(preview('# Plot\n- **ledger** page\n- *ferry*'), 'Plot · ledger page · ferry');
});

test('the editor shows a note formatted, and what is typed there comes back as the same text', () => {
    const md = '**Test**\nThis is a test\n\n- 1\n- 2\n### Head *it*\n1. one';
    const html = noteToHtml(md);
    assertEqual(html, '<div><b>Test</b></div><div>This is a test</div><div><br></div><ul><li>1</li><li>2</li></ul><h3>Head <i>it</i></h3><ol><li>one</li></ol>');
    assertEqual(notebookToText(html), md);
    assertEqual(noteToHtml('<script>'), '<div>&lt;script&gt;</div>');
    // what a browser's editor makes: first line bare, the next ones in <div>s, bold ending in a space
    assertEqual(notebookToText('<div>a</div><div><ul><li>1</li></ul><h3>H</h3></div>'), 'a\n- 1\n### H');
    assertEqual(notebookToText('first<div><b>bold&nbsp;</b>word</div><div><br></div><div>last</div>'), 'first\n**bold** word\n\nlast');
});

test('Notebook pages: Quill HTML becomes text with marks; plain text stays', () => {
    assertEqual(notebookToText('<p><strong>OOC</strong>: slow &amp; <em>calm</em></p><p>line2</p>'), '**OOC**: slow & *calm*\nline2');
    assertEqual(notebookToText('<h2>Plot</h2><ul><li>one</li><li>two</li></ul>'), '## Plot\n- one\n- two');
    assertEqual(notebookToText('<p><span style="color: red;">red</span><br></p>'), 'red');
    assertEqual(notebookToText('just text'), 'just text');
    const p = notebookPages([{ title: 'OOC', content: '<p>x</p>' }, { title: '', content: '<p>y</p>' }, null]);
    assertEqual(p.map(x => [x.t, x.b, x.s, x.on]), [['OOC', 'x', 'all', true], ['Notebook page 2', 'y', 'all', true]]);
});

summary();
