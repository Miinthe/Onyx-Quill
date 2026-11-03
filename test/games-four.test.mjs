/**
 * LOCAL PATCH suite — Four in a Row with Mero (Miinthe, 2026-11-03). Failures to avoid: a piece landing in the wrong row or
 * a full column taking one; a four missed (diagonals above all) or seen where there is none; Mero passing up a win or
 * not blocking one; a hint that isn't the best move; Mero told a grid instead of what happened; a call for every move;
 * a stored game that comes back half-broken.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { replay, normGame, newGame, play, pickCol, winsFor, roundFacts, linePrompt, stockLine, safeLine } from '../src/games/four-pure.js';
import { normGame as anyGame, gameOf, TITLES } from '../src/games/games-pure.js';
import { normTalk } from '../src/mero-pure.js';

const G = (moves, first = 'miinthe') => normGame({ kind: 'four', first, moves });
const seq = n => () => n;   // a fixed "random"

test('pieces stack from the bottom; a full column takes no more', () => {
    const b = replay(G([3, 3, 3]));
    assertEqual(b.cells[5 * 7 + 3], 'r'); assertEqual(b.cells[4 * 7 + 3], 'm'); assertEqual(b.cells[3 * 7 + 3], 'r');
    assertEqual(b.turn, 'm');
    assertEqual(G([0, 0, 0, 0, 0, 0, 0, 0]).moves.length, 6);   // the 7th and 8th never landed
});

test('four in a row: across, down and both diagonals', () => {
    assertEqual(replay(G([0, 0, 1, 1, 2, 2, 3])).over, 'won');                     // across
    assertEqual(replay(G([0, 1, 0, 1, 0, 1, 0])).over, 'won');                     // down
    assertEqual(replay(G([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3])).over, 'won');         // ↗
    assertEqual(replay(G([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3])).over, 'won');         // ↖
    assertEqual(replay(G([0, 0, 1, 1, 2, 2, 3])).four.length, 4);
    assertEqual(replay(G([0, 1, 2, 3, 4, 5, 6])).over, '');                        // a row of mixed pieces is nothing
    assertEqual(replay(G([0, 0, 1, 1, 2, 2, 6, 3, 6, 3, 6, 3, 5, 3])).over, 'lost'); // Mero's four
});

test('nothing more after the end; a draw on a full board', () => {
    const won = G([0, 0, 1, 1, 2, 2, 3, 4]);
    assertEqual(won.moves.length, 7);
    assertEqual(play(won, 5).why, 'over');
    // a full board with no four (columns filled in pairs so nothing lines up)
    const order = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
    const b = replay(G(order));
    assertEqual(b.moves.length, 42); assertEqual(b.over, 'draw');
});

test('Mero takes a win, blocks one, and never hands one over', () => {
    const w = G([0, 1, 0, 2, 6, 3]);   // Miinthe 0,0,6 · Mero 1,2,3 → Miinthe's turn; give Miinthe a harmless move, then Mero must win
    const r = play(w, 6, seq(0.9)); assertEqual(r.game.moves.at(-1), 4); assertEqual(r.what, 'lost');
    // Miinthe has three across (0,1,2): Mero blocks col 3
    const b = play(G([0, 6, 1, 6]), 2, seq(0.9));
    assertEqual(b.game.moves.at(-1), 3); assertEqual(b.what, 'block');
    // even on her "random" moves (rand < 0.2) she still blocks
    assertEqual(play(G([0, 6, 1, 6]), 2, seq(0.1)).game.moves.at(-1), 3);
});

test('a hint is the best column for Miinthe (takes her win)', () => {
    const g = G([0, 6, 1, 6, 2, 5]);   // Miinthe 0,1,2 across; her turn
    assertEqual(pickCol(g, seq(0.9), { hint: true }), 3);
});

test('Mero speaks only when something happened; the facts are words, not a grid', () => {
    assertEqual(play(G([]), 3, seq(0.9)).what, '');                // an opening move: no call
    const b = play(G([0, 6, 1, 6]), 2, seq(0.9));
    assert(b.facts.join(' ').includes('column 3') && b.facts.join(' ').includes('column 4, blocking it'));
    const p = linePrompt(b.game, 'block', { facts: b.facts }).user;
    assert(p.includes('blocked') && !/[.rm]{7}/.test(p), 'no grid');
    assert(roundFacts({ c: 2, m: -1, end: { over: 'won' } }).join(' ').includes('Miinthe won'));
});

test('a new game: who starts swaps, and Mero\'s first piece is in when it is her', () => {
    const a = newGame(null, seq(0.9)); assertEqual(a.first, 'miinthe'); assertEqual(a.moves.length, 0);
    const b = newGame(a, seq(0.9)); assertEqual(b.first, 'mero'); assertEqual(b.moves.length, 1); assertEqual(replay(b).turn, 'r');
    assertEqual(newGame(b, seq(0.9)).first, 'miinthe');
    assert(linePrompt(b, 'start').user.includes('you went first'));
});

test('ready-made lines for every moment; empty answers fall back', () => {
    const g = G([]);
    for (const w of ['start', 'won', 'lost', 'draw', 'riiFork', 'meroFork', 'block', 'riiBlock', 'threat']) assert(stockLine(g, w).length > 0, w);
    assert(safeLine('', g, 'block').length > 0);
    assertEqual(safeLine('Mero ☆: Ha!', g, 'block'), 'Ha!');
});

test('it survives the talk store, beside Wordle', () => {
    const t = normTalk({ tag: 'game', game: { kind: 'four', first: 'mero', moves: [3, '2', 9, 'x', 3], hints: 2 } });
    assertEqual(t.game.kind, 'four'); assertEqual(t.game.moves.join(), '3,2,3'); assertEqual(t.game.first, 'mero'); assertEqual(t.game.hints, 2);
    assertEqual(anyGame({ kind: 'wordle', answer: 'ghost', guesses: [] }).kind, 'wordle');
    assertEqual(anyGame({ kind: 'chess' }), null);
    assert(gameOf({ kind: 'four' }) && TITLES.four.includes('Four'));
    assert(winsFor(replay(G([0, 6, 1, 6, 2])).cells, 'r').includes(3));
});

test('bug hunt 2026-11-03: Mero opens in the center and says the real column; junk moves are dropped', () => {
    for (let k = 0; k < 50; k++) assertEqual(newGame({ kind: 'four', first: 'miinthe' }).moves[0], 3);
    assert(linePrompt(newGame({ kind: 'four', first: 'miinthe' }), 'start').user.includes('column 4'));
    assertEqual(normGame({ kind: 'four', moves: [3, null, true, '2', 'x'] }).moves.join(), '3,2');
});

summary('games-four');
