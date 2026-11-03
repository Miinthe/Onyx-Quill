/**
 * Four in a Row with Mero (Miinthe, 2026-11-03: "lets do four in a row"). Pure; tested in test/games-four.test.mjs.
 *
 * Same rule as Wordle: the GAME plays — it drops the pieces, makes Mero's moves and sees every line of four. Mero only
 * talks, and only when something happens (a threat, a block, the end), so a game costs a handful of short calls; with
 * 💬 off it costs none. She is told what happened in words the game worked out (`roundFacts`), never a grid to read —
 * an AI misreads grids the way it miscounted Wordle letters.
 *
 * 7 columns × 6 rows; columns 1–7 from the left for her, 0–6 here. The state lives in the talk (mero-pure.js normTalk):
 *   { kind: 'four', first: 'miinthe' | 'mero', moves: [col, …], hints }
 * Everything else (the cells, whose turn, won/lost/draw, the winning four) is worked out from the moves, so a stored
 * game can't be half-broken.
 */
import { named, nameRule } from '../mero-names-pure.js';

export const COLS = 7, ROWS = 6;
const arr = v => (Array.isArray(v) ? v : []);
const other = p => (p === 'r' ? 'm' : 'r');
const at = (r, c) => r * COLS + c;   // row 0 is the top

/** The board after the moves: { cells (42 × '.'/'r'/'m'), turn ('r' | 'm'), over ('' | 'won' | 'lost' | 'draw'), four: [cell, …], moves (the ones that counted), placed: [cell of each move] }. */
export function replay(game) {
    const cells = Array(ROWS * COLS).fill('.'), moves = [], placed = [];
    let turn = game?.first === 'mero' ? 'm' : 'r', over = '', four = [];
    for (const c of arr(game?.moves)) {
        if (over) break;
        const r = dropRow(cells, c); if (r < 0) continue;
        cells[at(r, c)] = turn; moves.push(c); placed.push(at(r, c));
        four = fourAt(cells, r, c);
        if (four.length) over = turn === 'r' ? 'won' : 'lost';
        else if (!cells.includes('.')) over = 'draw';
        turn = other(turn);
    }
    return { cells, turn, over, four, moves, placed };
}

/** The row a piece dropped in column c lands on; -1 when it is full (or no column). */
export function dropRow(cells, c) {
    if (!Number.isInteger(c) || c < 0 || c >= COLS) return -1;
    for (let r = ROWS - 1; r >= 0; r--) if (cells[at(r, c)] === '.') return r;
    return -1;
}

/** The four (or more) in a row through (r, c), as cell numbers; [] when there is none. */
export function fourAt(cells, r, c) {
    const p = cells[at(r, c)]; if (p === '.') return [];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [at(r, c)];
        for (const s of [1, -1]) for (let k = 1; k < 4; k++) {
            const rr = r + dr * k * s, cc = c + dc * k * s;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || cells[at(rr, cc)] !== p) break;
            line.push(at(rr, cc));
        }
        if (line.length >= 4) return line.sort((a, b) => a - b);
    }
    return [];
}

const open = cells => [0, 1, 2, 3, 4, 5, 6].filter(c => dropRow(cells, c) >= 0);

/** The columns where p would make four right now. */
export function winsFor(cells, p) {
    return open(cells).filter(c => { const r = dropRow(cells, c), x = cells.slice(); x[at(r, c)] = p; return fourAt(x, r, c).length > 0; });
}

/** A game from whatever was stored; null when it isn't one. */
export function normGame(g) {
    if (!g || typeof g !== 'object' || g.kind !== 'four') return null;
    const first = g.first === 'mero' ? 'mero' : 'miinthe';
    const moves = replay({ first, moves: arr(g.moves).filter(v => (typeof v === 'number') || (typeof v === 'string' && /^\d$/.test(v))).map(Number).filter(Number.isInteger) }).moves;
    return { kind: 'four', first, moves, hints: Math.max(0, Math.min(99, Math.round(Number(g.hints) || 0))) };
}

/** A new game: whoever didn't start last time starts now; when it's Mero, her first piece is already in. */
export function newGame(prev = null, rand = Math.random) {
    const first = prev?.kind === 'four' && prev.first === 'miinthe' ? 'mero' : 'miinthe';
    const g = { kind: 'four', first, moves: [], hints: 0 };
    if (first === 'mero') g.moves.push(pickCol(g, rand, { hint: true }));   // her best opening (the center): never a random one
    return g;
}

// ── Mero's moves (the game's, not the AI's) ───────────────────────────────────────────────────────────────────────

function lineScore(w, p) {
    const mine = w.filter(x => x === p).length, theirs = w.filter(x => x === other(p)).length, empty = 4 - mine - theirs;
    if (mine && theirs) return 0;
    if (mine === 4) return 1000;
    if (mine === 3 && empty === 1) return 6;
    if (mine === 2 && empty === 2) return 2;
    if (theirs === 3 && empty === 1) return -8;
    if (theirs === 2 && empty === 2) return -2;
    return 0;
}
function evalFor(cells, p) {
    let s = 0;
    for (let r = 0; r < ROWS; r++) if (cells[at(r, 3)] === p) s += 3; else if (cells[at(r, 3)] === other(p)) s -= 3;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const er = r + dr * 3, ec = c + dc * 3; if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        s += lineScore([0, 1, 2, 3].map(k => cells[at(r + dr * k, c + dc * k)]), p);
    }
    return s;
}
function search(cells, p, me, depth, a, b) {
    const cols = open(cells);
    if (!depth || !cols.length) return evalFor(cells, me);
    let best = p === me ? -Infinity : Infinity;
    for (const c of [3, 2, 4, 1, 5, 0, 6].filter(x => cols.includes(x))) {
        const r = dropRow(cells, c), x = cells.slice(); x[at(r, c)] = p;
        const v = fourAt(x, r, c).length ? (p === me ? 100000 + depth : -100000 - depth) : search(x, other(p), me, depth - 1, a, b);
        if (p === me) { best = Math.max(best, v); a = Math.max(a, v); } else { best = Math.min(best, v); b = Math.min(b, v); }
        if (a >= b) break;
    }
    return best;
}

/**
 * The best column for whoever's turn it is (Mero's move, or Miinthe's 💡 hint). Always takes a win, always blocks one,
 * never hands over a win on the next move when it can help it; otherwise looks 4 moves ahead. Mero (not a hint)
 * sometimes picks a merely safe move instead of the best one — she plays to win, but she can be beaten.
 */
export function pickCol(game, rand = Math.random, { hint = false } = {}) {
    const { cells, turn } = replay(game), cols = open(cells);
    if (!cols.length) return -1;
    const win = winsFor(cells, turn); if (win.length) return win[0];
    const block = winsFor(cells, other(turn)); if (block.length) return block[0];
    const safe = cols.filter(c => { const r = dropRow(cells, c), x = cells.slice(); x[at(r, c)] = turn; return !winsFor(x, other(turn)).length; });
    const pool = safe.length ? safe : cols;
    if (!hint && rand() < 0.2) return pool[Math.floor(rand() * pool.length) % pool.length];
    const scored = pool.map(c => { const r = dropRow(cells, c), x = cells.slice(); x[at(r, c)] = turn; return { c, v: search(x, other(turn), turn, 4, -Infinity, Infinity) - Math.abs(3 - c) * 0.1 }; });
    const top = Math.max(...scored.map(s => s.v)), best = scored.filter(s => s.v >= top - 0.001);
    return best[Math.floor(rand() * best.length) % best.length].c;
}

/**
 * Miinthe drops in column c (0–6); Mero answers at once. → { ok, game, what, facts } or { ok: false, why: 'over' | 'full' }.
 * `what`: what Mero reacts to — 'won' · 'lost' · 'draw' · 'riiFork' · 'meroFork' · 'block' · 'riiBlock' · 'threat',
 * or '' when nothing happened (then she stays quiet: no call).
 */
export function play(game, c, rand = Math.random) {
    const g = normGame(game); if (!g) return { ok: false, why: 'over' };
    const before = replay(g); if (before.over || before.turn !== 'r') return { ok: false, why: 'over' };
    if (dropRow(before.cells, c) < 0) return { ok: false, why: 'full' };
    const meroHad = winsFor(before.cells, 'm');
    const g1 = { ...g, moves: [...g.moves, c] }, mid = replay(g1);
    const riiHas = mid.over ? [] : winsFor(mid.cells, 'r');
    let g2 = g1, m = -1;
    if (!mid.over) { m = pickCol(g1, rand); g2 = { ...g1, moves: [...g1.moves, m] }; }
    const end = replay(g2), meroHas = end.over ? [] : winsFor(end.cells, 'm');
    const what = end.over
        || (riiHas.length >= 2 ? 'riiFork' : '')
        || (meroHas.length >= 2 ? 'meroFork' : '')
        || (riiHas.includes(m) ? 'block' : '')
        || (meroHad.includes(c) ? 'riiBlock' : '')
        || (meroHas.length ? 'threat' : '');
    return { ok: true, game: g2, what, facts: roundFacts({ c, m, riiHas, meroHad, meroHas, end }) };
}

const col = c => `column ${c + 1}`;
const cols = l => l.map(c => c + 1).join(' and ');

/** What just happened, in plain words for Mero (she never gets a grid to read). "Miinthe" is swapped for her name later. */
export function roundFacts({ c, m, riiHas = [], meroHad = [], meroHas = [], end }) {
    const f = [`Miinthe dropped a piece in ${col(c)}.`];
    if (meroHad.includes(c)) f.push(`That blocked your four — you were one piece from winning there.`);
    if (end?.over === 'won') { f.push('That made four in a row: Miinthe won.'); return f; }
    if (riiHas.length) f.push(`It gave Miinthe a winning spot in ${riiHas.length > 1 ? `columns ${cols(riiHas)}` : col(riiHas[0])}.`);
    if (m >= 0) f.push(`You dropped yours in ${col(m)}${riiHas.includes(m) ? ', blocking it' : ''}.`);
    if (end?.over === 'lost') f.push('That made four in a row: you won.');
    else if (end?.over === 'draw') f.push('The board is full: a draw.');
    else if (meroHas.length) f.push(`Now you are one piece from four in ${meroHas.length > 1 ? `columns ${cols(meroHas)} — Miinthe can only block one` : col(meroHas[0])}.`);
    return f;
}

// ── what Mero says ──────────────────────────────────────────────────────────

export function linePrompt(game, what, { persona = '', names = {}, before = [], facts = [] } = {}) {
    const N = t => named(t, names);
    const system = [
        N(`You are Mero ☆, Miinthe's co-writer and story bestie, playing Four in a Row against Miinthe for fun.`) + (persona ? ` ${persona}` : ''),
        nameRule(names),
        N('The game itself drops the pieces and makes your moves — treat them as yours. You only talk: teasing, gloating, groaning, one or two short sentences. Use only the facts given; never describe the board beyond them, never make up moves, never tell Miinthe where to play. Plain text, no lists, no emoji spam. Stay out of the story; this is a break.'),
    ].join('\n');
    const lines = [];
    const first = game.first === 'mero' ? 'You' : 'Miinthe';
    if (what === 'start') lines.push(N(game.first === 'mero' ? `A new game just started and you went first: your piece is in column ${(game.moves[0] ?? 3) + 1}. Say hi and dare Miinthe to beat you.` : 'A new game just started; Miinthe goes first. Say hi and dare Miinthe to beat you.'));
    else {
        if (arr(facts).length) lines.push(N(`What just happened (the game worked it out, so it is exact; columns 1–7 from the left; ${first} started):\n${arr(facts).join(' ')}`));
        const how = {
            won: 'Miinthe beat you. Be a good sport about it (a little dramatic is fine). Ask if they want another round.',
            lost: 'You won. Gloat a little, kindly. Ask if they want another round.',
            draw: 'A draw. React, and ask if they want another round.',
            riiFork: 'Miinthe has two ways to win and you can only block one — you are about to lose. React.',
            meroFork: 'You have two ways to win and Miinthe can only block one. React, but don\'t say which columns.',
            block: 'You just blocked Miinthe\'s win. React.',
            riiBlock: 'Miinthe just blocked your win. React.',
            threat: 'You are one piece from winning. Tease a little, but don\'t say where.',
        }[what];
        if (how) lines.push(N(how));
    }
    if (arr(before).length) lines.push(`Your last lines (don't repeat them):\n${arr(before).slice(-3).map(t => `- ${t}`).join('\n')}`);
    return { system, user: lines.join('\n\n') };
}

/** Her answer, cleaned: one short paragraph. */
export function safeLine(text, game, what, rand = Math.random) {
    let t = String(text ?? '').replace(/^\s*(?:Mero\s*☆?\s*:)\s*/i, '').replace(/\s+/g, ' ').trim();
    if (t.length > 400) t = t.slice(0, 399).replace(/\s\S*$/, '') + '…';
    return t || stockLine(game, what, rand);
}

/** The ready-made lines: no AI, or an error. */
export function stockLine(game, what, rand = Math.random) {
    const one = list => list[Math.floor(rand() * list.length) % list.length];
    return one({
        start: game.first === 'mero' ? ['I went first. Center column, obviously. Your move.', 'My piece is in. Try to keep up.'] : ['Your move first. Go easy on me. (Don\'t.)', 'Fresh board. Show me what you\'ve got.'],
        won: ['Okay, okay, you got me. Rematch?', 'Four in a row?! I demand a rematch.'],
        lost: ['Four in a row! Better luck next time. Another one?', 'And that\'s mine. Another round?'],
        draw: ['A full board and nobody won. Again?', 'A draw! We\'re too evenly matched. Another?'],
        riiFork: ['Oh no. Two ways in. I can only block one…', 'Wait. That\'s… that\'s not fair.'],
        meroFork: ['Hm. Two ways to win. Which one will you block?', 'I have a feeling this is going my way.'],
        block: ['Nope! Not on my watch.', 'Blocked. Nice try.'],
        riiBlock: ['Hey! I had that one.', 'Rude. I was so close.'],
        threat: ['Careful… I\'m one piece away.', 'Something\'s brewing over here.'],
    }[what] || ['Your move.']);
}
