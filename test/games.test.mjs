/**
 * LOCAL PATCH suite — Mero's Wordle (Miinthe, 2026-10-27: "mini games with Mero … just for funnies"). Failures to avoid:
 * wrong colors (repeated letters above all); a made-up word costing a try; the word changing mid-game; Mero told the
 * word while the game runs, or a line of hers that gives it away reaching the screen; the same word straight again;
 * a game lost on the way through the talk store.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { ANSWERS, GUESSES } from '../src/games/wordle-words.js';
import { score, keyColors, isWord, pickAnswer, newGame, guess, normGame, board, linePrompt, safeLine, stockLine, TRIES } from '../src/games/wordle-pure.js';
import { normTalk, TAGS } from '../src/mero-pure.js';

const G = (answer, guesses = []) => normGame({ kind: 'wordle', answer, guesses });

test('the lists: five lowercase letters, every answer may be guessed, no repeats', () => {
    assert(ANSWERS.length > 1000 && GUESSES.length > 8000);
    assert([...ANSWERS, ...GUESSES].every(w => /^[a-z]{5}$/.test(w)));
    const all = new Set(GUESSES); assert(ANSWERS.every(w => all.has(w)));
    assertEqual(new Set(ANSWERS).size, ANSWERS.length);
});

test('colors: right spot green, elsewhere yellow, absent gray', () => {
    assertEqual(score('crane', 'crane').join(), 'hit,hit,hit,hit,hit');
    assertEqual(score('about', 'ghost').join(), 'miss,miss,hit,miss,hit');
    assertEqual(score('smile', 'ghost').join(), 'near,miss,miss,miss,miss');
});

test('repeated letters count once each (the classic Wordle bug)', () => {
    // answer has one E: only the first E can be yellow
    assertEqual(score('geese', 'crane').join(), 'miss,miss,miss,miss,hit');
    assertEqual(score('eerie', 'crane').join(), 'miss,miss,near,miss,hit');   // the green E used the only E
    // answer has two Ls, both green: a third L is gray
    assertEqual(score('lolly', 'hello').join(), 'miss,near,hit,hit,miss');
    // one E in the answer: the first E is yellow, the second gray
    assertEqual(score('speed', 'abide').join(), 'miss,miss,near,miss,near');
});

test('the keyboard shows each letter\'s best color so far', () => {
    const k = keyColors(['smile', 'storm'], 'ghost');
    assertEqual(k.s, 'near'); assertEqual(k.o, 'hit'); assertEqual(k.m, 'miss');
});

test('a made-up word or a short one doesn\'t count; a real one does', () => {
    const g = G('ghost');
    assertEqual(guess(g, 'xxxxx').why, 'word');
    assertEqual(guess(g, 'abc').why, 'short');
    assertEqual(guess(g, 'ABOUT').game.guesses.join(), 'about');
    assert(isWord('zesty') && !isWord('qzxvw'));
});

test('a game ends on the word or after six tries, and takes no guess after', () => {
    let g = G('ghost');
    g = guess(g, 'ghost').game; assertEqual(g.over, 'won');
    assertEqual(guess(g, 'about').why, 'over');
    let h = G('ghost');
    for (const w of ['about', 'smile', 'storm', 'crane', 'pride', 'tiger']) h = guess(h, w).game;
    assertEqual(h.over, 'lost'); assertEqual(h.guesses.length, TRIES);
});

test('the word stays the same for the whole game', () => {
    let g = newGame(null, () => 0.5); const w = g.answer;
    for (const x of ['about', 'smile']) g = guess(g, x).game;
    assertEqual(g.answer, w);
});

test('a new game never brings back a word just played', () => {
    let g = newGame(null, () => 0);
    const seen = new Set([g.answer]);
    for (let k = 0; k < 20; k++) { g = newGame(g, () => 0); assert(!seen.has(g.answer), 'repeat ' + g.answer); seen.add(g.answer); }
    assertEqual(pickAnswer(ANSWERS, () => 0), ANSWERS[0]);   // all played: start over rather than fail
});

test('Mero is not told the word while the game runs — only for a hint and at the end', () => {
    const g = guess(G('ghost'), 'about').game;
    for (const what of ['start', 'guess', 'notword']) assert(!linePrompt(g, what, { word: 'qzxvw' }).user.toLowerCase().includes('ghost'), what);
    assert(linePrompt({ ...g, hints: 1 }, 'hint').user.includes('GHOST'));
    assert(linePrompt(guess(g, 'ghost').game, 'won').user.includes('GHOST'));
    assert(board(g).includes('ABOUT → --G-G'));
});

test('her names are used: no name set, no name; her own name kept', () => {
    const p = linePrompt(G('ghost'), 'start', { names: { you: '', me: 'Mero' } });
    assert(!/\bRii\b/.test(p.system + p.user) && /Never call the author by a name/.test(p.system));
    const q = linePrompt(G('ghost'), 'start', { names: { you: 'Boss', me: 'Mimi' } });
    assert(q.system.includes('Mimi') && q.system.includes('"Boss"'));
});

test('a line that gives the word away mid-game is swapped; at the end it may say it', () => {
    const g = guess(G('ghost'), 'about').game;
    assert(!safeLine('Is it GHOST? 👻', g, 'guess', () => 0).toLowerCase().includes('ghost'));
    assertEqual(safeLine('Mero ☆: Nice one!', g, 'guess'), 'Nice one!');
    assert(safeLine('It was GHOST all along!', g, 'lost').includes('GHOST'));
    assert(safeLine('', g, 'guess').length > 0);   // nothing back: a ready-made line
});

test('ready-made lines exist for every moment and never leak the word mid-game', () => {
    let g = G('ghost');
    for (const w of ['about', 'smile', 'storm', 'ghast']) {
        g = guess(g, w).game;
        assert(!stockLine(g, 'guess').toLowerCase().includes('ghost'));
    }
    assert(stockLine({ ...g, hints: 2 }, 'hint').includes('“G”'));
    assert(stockLine(guess(g, 'ghost').game, 'won').includes('Five'));
});

test('a game survives the talk store; junk is dropped', () => {
    assertEqual(TAGS.game, '🎲 Games');
    const t = normTalk({ tag: 'game', game: { kind: 'wordle', answer: 'ghost', guesses: ['about', 'NOPE!', 'smile'], hints: 1 } });
    assertEqual(t.tag, 'game'); assertEqual(t.game.guesses.join(), 'about,smile'); assertEqual(t.game.hints, 1);
    assert(!('game' in normTalk({ tag: 'yap', game: { kind: 'chess' } })));
    assertEqual(normGame({ kind: 'wordle', answer: 'ghost', guesses: ['ghost', 'about'] }).over, 'won');
});

summary('games');
