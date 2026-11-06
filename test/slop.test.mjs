/**
 * LOCAL PATCH suite — the slop guard (Miinthe, 2026-11-02). Failures to avoid: names or plain grammar taken for slop; a
 * phrase she called fine asked about again; the whole list sent to the writer; a "use less" phrase underlined every
 * time; a rewrite that lands on the wrong words (the screen shows formatted text, the message keeps asterisks).
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { asSlop, phrasesHere, repeats, usedIn, usedCount, writerLines, toUnderline, locate, sentenceAround, cleanRewrite, rewritePrompt } from '../src/slop-pure.js';

const R = [
    'Her breath hitched as he stepped closer. Corvin said nothing.',
    'The tea was cold. Her breath hitched when the door opened.',
    '*Her breath hitched.* "You came back," Corvin said.',
    'Rain on the roof. Her breath  hitched again, a mix of fear and relief.',
    'He smiled. Corvin said the market was closed.',
];

test('learned: a phrase in 4 of the replies; names, grammar and short ones are not', () => {
    const r = repeats(R, { names: ['Corvin'] });
    assertEqual(r[0].t, 'her breath hitched'); assertEqual(r[0].n, 4);
    assert(!r.some(x => x.t.includes('corvin')));
    assert(!r.some(x => x.t === 'breath hitched'), 'a shorter piece of a kept phrase');
    assertEqual(repeats(R.slice(0, 3)).length, 0);   // too few replies to say
});

test('learned: one already listed, fine or asked about is not suggested again', () => {
    assertEqual(repeats(R, { names: ['Corvin'], skip: ['her breath hitched'] }).filter(x => x.t.includes('breath')).length, 0);
});

test('matching: whole words, any case and spacing, curly or straight apostrophes', () => {
    assert(usedIn('Her  Breath\nhitched.', 'her breath hitched'));
    assert(!usedIn('their breath hitched', 'her breath hitched'));
    assert(usedIn('He didn’t care', "didn't care"));
    assertEqual(usedCount(R, 'her breath hitched'), 4);
});

test('the store: tidy, no doubles, a scoped phrase needs its place', () => {
    const s = asSlop({ phrases: [{ t: '  Her breath hitched. ' }, { t: 'her breath hitched' }, { t: 'x', sc: 'char' }, { t: 'little lamb', sc: 'char', k: 'jun.png', kn: 'Jun', m: 'less' }], fine: [{ t: 'By the Sovereigns' }], asked: ['a', 'a'] });
    assertEqual(s.phrases.length, 2); assertEqual(s.phrases[0].t, 'her breath hitched'); assertEqual(s.phrases[0].m, 'ban');
    assertEqual(s.fine[0].t, 'by the sovereigns'); assertEqual(s.asked.length, 1);
    assertEqual(phrasesHere(s, { charKey: 'jun.png' }).length, 2);
    assertEqual(phrasesHere(s, { charKey: 'other.png' }).length, 1);
});

test('the writer gets only what it used lately, banned and use-less apart', () => {
    const ph = [{ t: 'her breath hitched', m: 'ban' }, { t: 'a mix of', m: 'less' }, { t: 'a testament to', m: 'ban' }];
    const lines = writerLines(ph, R);
    assertEqual(lines.length, 2);
    assert(lines[0].text.includes('"her breath hitched"') && !lines[0].text.includes('testament'));
    assert(lines[1].text.includes('"a mix of"'));
    assertEqual(writerLines(ph, ['Nothing here.']).length, 0);
});

test('underline: banned always; use-less only when it comes back too soon', () => {
    const ph = [{ t: 'her breath hitched', m: 'ban' }, { t: 'a mix of', m: 'less' }];
    const now = 'Her breath hitched, a mix of fear and relief.';
    assertEqual(toUnderline(now, ph, ['Quiet day.']).map(p => p.t).join(), 'her breath hitched');
    assertEqual(toUnderline(now, ph, ['It was a mix of things.']).map(p => p.t).join(), 'her breath hitched,a mix of');
});

test('finding the selected words in the message: formatting and quotes don’t matter', () => {
    const src = '*She sets the cup down.* "You came back," he said, voice low.';
    const a = locate(src, 'She sets the cup down.');
    assertEqual(src.slice(a.start, a.end), 'She sets the cup down.');
    const b = locate(src, '“You came back,” he said');
    assertEqual(src.slice(b.start, b.end), '"You came back," he said');
    assertEqual(locate('the cat. the cat.', 'the cat'), null);   // twice: can't tell which
    assertEqual(locate(src, 'not in it'), null);
});

test('"Rewrite this line" takes the whole sentence around the phrase', () => {
    const t = 'He waited. Her breath hitched as the light caught his face. He didn\'t deny it.';
    const s = sentenceAround(t, 'her breath hitched');
    assertEqual(t.slice(s.start, s.end), 'Her breath hitched as the light caught his face.');
});

test('a rewrite comes back clean; the prompt never asks for the whole message', () => {
    assertEqual(cleanRewrite('Here is the rewritten passage: She went still.', 'x'), 'She went still.');
    assertEqual(cleanRewrite('"She went still."', 'She froze.'), 'She went still.');
    assertEqual(cleanRewrite('"Hi," she said.', '"Hello," she said.'), '"Hi," she said.');
    const p = rewritePrompt('slop', 'Her breath hitched.', { phrase: 'her breath hitched', avoid: ['a mix of'] });
    assert(p.user.includes('Don\'t use "her breath hitched"') && p.user.includes('"a mix of"'));
});

test('bug hunt 2026-11-03: a rewrite of plain narration doesn\'t come back as an *action*', () => {
    assertEqual(cleanRewrite('*She slides onto the counter.*', 'She slid onto the counter.'), 'She slides onto the counter.');
    assertEqual(cleanRewrite('*She grins.*', '*She grinned.*'), '*She grins.*');
});

test('the writer is told that close variants of a listed phrase count too (Miinthe, 2026-11-05)', () => {
    const lines = writerLines([{ t: 'her breath hitched', m: 'ban' }, { t: 'a testament to', m: 'less' }], ['Her breath hitched. It was a testament to everything.']);
    assert(lines[0].text.includes('her breath hitched') && /close variant/.test(lines[0].text), 'banned: variants named');
    assert(lines[1].text.includes('a testament to') && /close variants/.test(lines[1].text), 'use less: variants named');
});

summary('slop');
