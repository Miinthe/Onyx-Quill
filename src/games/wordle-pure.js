/**
 * Mero's Wordle (Miinthe, 2026-10-27; mock-up https://claude.ai/artifact/138w9AchcDdmyuijzsLpoC). Pure; tested in
 * test/games.test.mjs.
 *
 * The GAME picks the word and colors the letters — an AI sees words in chunks, not letters, so it would color wrong
 * and could change the word mid-game (Miinthe agreed). MERO only talks: a short line after every guess, a hint on request.
 * She is never told the word while the game runs, except for a hint; a line that names it anyway is swapped for a
 * ready-made one (`safeLine`). The game counts the letters for her (`readGuess`) and picks any letter a hint gives. Every line has a ready-made stand-in, so the game also works with no AI at all.
 *
 * The state lives in the talk (mero-pure.js normTalk → `game`):
 *   { kind: 'wordle', answer, guesses: [word], over: '' | 'won' | 'lost', hints, recent: [answers before] }
 */
import { ANSWERS, GUESSES } from './wordle-words.js';
import { named, nameRule } from '../mero-names-pure.js';

export const TRIES = 6;
const VALID = new Set(GUESSES);
const arr = v => (Array.isArray(v) ? v : []);
const word5 = v => (typeof v === 'string' && /^[a-z]{5}$/.test(v) ? v : '');

/** A word you may guess. */
export const isWord = w => VALID.has(String(w || '').toLowerCase());

/** A fresh word, not one of the last 50 played (`rand` for tests). */
export function pickAnswer(recent = [], rand = Math.random) {
    const skip = new Set(arr(recent));
    const pool = ANSWERS.filter(w => !skip.has(w));
    const list = pool.length ? pool : ANSWERS;
    return list[Math.floor(rand() * list.length) % list.length];
}

/** The colors of a guess: 'hit' (right spot) · 'near' (in the word, elsewhere) · 'miss'. Repeated letters count once each. */
export function score(guess, answer) {
    const g = String(guess).toLowerCase(), a = String(answer).toLowerCase();
    const res = Array(5).fill('miss'), left = {};
    for (let i = 0; i < 5; i++) { if (g[i] === a[i]) res[i] = 'hit'; else left[a[i]] = (left[a[i]] || 0) + 1; }
    for (let i = 0; i < 5; i++) if (res[i] !== 'hit' && left[g[i]]) { res[i] = 'near'; left[g[i]]--; }
    return res;
}

/** The best color each letter has shown so far (for the keyboard). */
export function keyColors(guesses, answer) {
    const rank = { miss: 0, near: 1, hit: 2 }, out = {};
    for (const g of arr(guesses)) score(g, answer).forEach((s, i) => { const ch = g[i]; if (!out[ch] || rank[s] > rank[out[ch]]) out[ch] = s; });
    return out;
}

/** A game from whatever was stored; null when it isn't one. */
export function normGame(g) {
    if (!g || typeof g !== 'object' || g.kind !== 'wordle' || !word5(g.answer)) return null;
    const guesses = arr(g.guesses).map(word5).filter(Boolean).slice(0, TRIES);
    const over = guesses.includes(g.answer) ? 'won' : guesses.length >= TRIES ? 'lost' : '';
    return { kind: 'wordle', answer: g.answer, guesses, over, hints: Math.max(0, Math.min(9, Math.round(Number(g.hints) || 0))), recent: arr(g.recent).map(word5).filter(Boolean).slice(-50) };
}

/** A new game; the word just played joins `recent` so it doesn't come straight back. */
export function newGame(prev = null, rand = Math.random) {
    const recent = [...arr(prev?.recent), ...(prev?.answer ? [prev.answer] : [])].slice(-50);
    return { kind: 'wordle', answer: pickAnswer(recent, rand), guesses: [], over: '', hints: 0, recent };
}

/** Play a guess. → { ok, game } or { ok: false, why: 'over' | 'short' | 'word' }. */
export function guess(game, w) {
    const g = normGame(game); if (!g) return { ok: false, why: 'over' };
    if (g.over) return { ok: false, why: 'over' };
    const word = String(w || '').toLowerCase().trim();
    if (word.length !== 5) return { ok: false, why: 'short' };
    if (!isWord(word)) return { ok: false, why: 'word' };
    return { ok: true, game: normGame({ ...g, guesses: [...g.guesses, word] }) };
}

// ── what Mero says ──────────────────────────────────────────────────────────

const NTH = ['1st', '2nd', '3rd', '4th', '5th'];
const UP = c => String(c).toUpperCase();
const count = (s, k) => s.filter(x => x === k).length;

/**
 * One guess in words, counted by the game: "VIRAL — 1 green, 1 yellow, 3 gray; right spot: R (3rd); in the word but
 * elsewhere: A; not in the word: V, I, L". Mero used to get a G/Y/- code and count it herself — and miscounted
 * (Miinthe, 2026-11-03: "commentary sometimes is kind of wrong"; VIRAL against MARRY became "two greens and a yellow").
 * A letter that is gray only because the word has fewer of it is not listed as "not in the word".
 */
export function readGuess(g, answer) {
    const s = score(g, answer), hit = [], near = [], miss = [];
    const inWord = new Set([...g].filter((ch, i) => s[i] !== 'miss'));
    s.forEach((x, i) => {
        if (x === 'hit') hit.push(`${UP(g[i])} (${NTH[i]})`);
        else if (x === 'near') near.push(UP(g[i]));
        else if (!inWord.has(g[i]) && !miss.includes(UP(g[i]))) miss.push(UP(g[i]));
    });
    const parts = [`${count(s, 'hit')} green, ${count(s, 'near')} yellow, ${count(s, 'miss')} gray`];
    if (hit.length) parts.push(`right spot: ${hit.join(', ')}`);
    if (near.length) parts.push(`in the word but elsewhere: ${near.join(', ')}`);
    if (miss.length) parts.push(`not in the word: ${miss.join(', ')}`);
    return `${UP(g)} — ${parts.join('; ')}`;
}

/** The guesses so far as she sees them, one line each (readGuess). Never the answer. */
export const board = game => game.guesses.map((g, i) => `${i + 1}. ${readGuess(g, game.answer)}`).join('\n');

/**
 * A letter Miinthe hasn't pinned down yet, for a late hint — chosen by the game, so Mero can't give away more. Hint 3 gives
 * the first spot not green yet, hint 4 the next one, and so on (wrapping round), so a later hint is never the same letter.
 */
export function hintLetter(game) {
    const green = new Set();
    for (const g of arr(game.guesses)) score(g, game.answer).forEach((x, i) => { if (x === 'hit') green.add(i); });
    const open = [0, 1, 2, 3, 4].filter(i => !green.has(i));
    if (!open.length) return null;
    const i = open[Math.max(0, (Number(game.hints) || 3) - 3) % open.length];
    return { letter: UP(game.answer[i]), spot: NTH[i] };
}

/**
 * The one call for a line. what: 'start' · 'guess' · 'hint' · 'won' · 'lost' · 'notword' (with `word`).
 * Only a hint and the end get the answer. `before`: her last lines in this game (so she doesn't repeat herself).
 */
export function linePrompt(game, what, { persona = '', names = {}, before = [], word = '' } = {}) {
    const N = t => named(t, names);
    const system = [
        N(`You are Mero ☆, Miinthe's co-writer and story bestie, playing a game of Wordle with Miinthe for fun.`) + (persona ? ` ${persona}` : ''),
        nameRule(names),
        N('The game itself picks the word and colors the letters — never correct the colors, never make up letters. You only react, like a friend watching over Miinthe\'s shoulder: teasing, cheering, groaning, one or two short sentences. Plain text, no lists, no emoji spam. Stay out of the story; this is a break.'),
    ].join('\n');
    const lines = [];
    if (game.guesses.length) lines.push(`The board so far — the game counted every letter, so these counts are exact:\n${board(game)}`);
    const left = TRIES - game.guesses.length, n = game.guesses.length;
    if (what === 'start') lines.push(N('A new game just started. Say hi and dare Miinthe to beat it. Don\'t give any clue.'));
    if (what === 'guess') {
        const greens = i => count(score(game.guesses[i], game.answer), 'hit');
        const trend = n >= 2 ? ` Greens went from ${greens(n - 2)} on the guess before to ${greens(n - 1)} now.` : '';
        lines.push(N(`Miinthe just played guess ${n} (the last line above).${trend} ${left} ${left === 1 ? 'try is' : 'tries are'} left. React to how it went. Use the counts and letters exactly as the game gave them — never count letters yourself, never name a letter or spot that isn't listed above. If in doubt, react to the mood, not the details. You do not know the word — don't guess it, don't hint at it.`));
    }
    if (what === 'notword') lines.push(N(`Miinthe typed "${String(word).toUpperCase()}", which isn't in the dictionary, so it didn't count. Tease a little.`));
    if (what === 'hint') {
        // hints step up slowly (Miinthe, 2026-11-03: "the hint is spoiling too much"): a vague category, then one
        // association, and only from the third on a letter — picked by the game, not by Mero
        const no = 'No synonym, no definition, no rhyme, no "sounds like", no letters, no word that contains it — and never the word itself.';
        const L = game.hints >= 3 ? hintLetter(game) : null;
        const how = game.hints <= 1 ? `Give ONE vague clue: only a broad category or a feeling (like "it's something you'd find outdoors" or "it's something people do"). ${no}`
            : game.hints === 2 ? `Give ONE clue a little closer than a category: a place, a situation or a mood it belongs to. Still vague — Miinthe should have to think. ${no}`
            : L ? `The game picked the clue: the ${L.spot} letter is ${L.letter}. Tell Miinthe just that, in your own words, with no other clue. Never write the word itself.`
            : `Miinthe already has every letter in the right spot somewhere on the board. Say so, with no other clue. Never write the word itself.`;
        lines.push(N(`Miinthe asks for hint number ${game.hints}. The word is "${game.answer.toUpperCase()}" — for you only. ${how}`));
    }
    if (what === 'won') lines.push(N(`Miinthe got it: "${game.answer.toUpperCase()}" in ${game.guesses.length} ${game.guesses.length === 1 ? 'try' : 'tries'}. Celebrate (or tease, if it was close). Ask if they want another round.`));
    if (what === 'lost') lines.push(N(`Out of tries. The word was "${game.answer.toUpperCase()}". Commiserate warmly, maybe a playful jab. Ask if they want another round.`));
    if (arr(before).length) lines.push(`Your last lines (don't repeat them):\n${arr(before).slice(-3).map(t => `- ${t}`).join('\n')}`);
    return { system, user: lines.join('\n\n') };
}

/** Her answer, cleaned: one short paragraph; a line that gives the word away while the game runs is swapped. */
export function safeLine(text, game, what, rand = Math.random) {
    let t = String(text ?? '').replace(/^\s*(?:Mero\s*☆?\s*:)\s*/i, '').replace(/\s+/g, ' ').trim();
    if (t.length > 400) t = t.slice(0, 399).replace(/\s\S*$/, '') + '…';
    // the word, also with an ending (GHOSTS, GHOSTED, GHOSTLY), or spelled out letter by letter (G-H-O-S-T, G H O S T) — a separator
    // between EVERY letter, so "the red letters" isn't THERE (bug hunt 2026-11-03)
    const a = game.answer, sep = '[\\s\\-.,·*_"\'“”]+';
    const reveals = !['won', 'lost'].includes(what) && (new RegExp(`(^|[^a-z])${a}(s|es|d|ed|ing|er|ers|ly|y|ish)?([^a-z]|$)`, 'i').test(t) || new RegExp(`(^|[^a-z])${[...a].join(sep)}([^a-z]|$)`, 'i').test(t));
    return !t || reveals ? stockLine(game, what, rand) : t;
}

/** The ready-made lines: no AI, an error, or a line that gave the word away. */
export function stockLine(game, what, rand = Math.random) {
    const one = list => list[Math.floor(rand() * list.length) % list.length];
    const n = game.guesses.length, last = game.guesses[n - 1];
    if (what === 'start') return one(['I picked a word. Five letters, six tries. Go on, impress me.', 'New word! Fresh start, no pressure. (Some pressure.)', 'Okay, I have one. Try not to take all six.']);
    if (what === 'notword') return one(['Not a word I know. That one\'s free.', 'Nice try, but that isn\'t a word. Doesn\'t count.']);
    if (what === 'hint') {
        // letters only from hint 3, as with her AI (the bug hunt: this ready-made line gave one at hint 2)
        const L = game.hints >= 3 ? hintLetter(game) : null;
        return game.hints <= 1 ? 'My lips are sealed… mostly. Look at your yellows again.'
            : game.hints === 2 ? 'Think about where you would find it. That\'s all you get. For now.'
            : L ? `Fine: the ${L.spot} letter is “${L.letter}”. Don't tell anyone I helped.` : 'You already have every letter somewhere. Trust your greens.';
    }
    if (what === 'won') return ['First try?! Did you peek?', 'Two tries. Okay, show-off.', 'Three! Very respectable.', 'Four tries. Solid. I knew you had it.', 'Five… that was close. My heart!', 'SIX. Down to the wire. I aged a century.'][Math.min(n, 6) - 1] + ' Another one?';
    if (what === 'lost') return `Out of tries! It was “${game.answer.toUpperCase()}”. I'll pretend that was hard. Another one?`;
    const s = last ? score(last, game.answer) : [], hits = s.filter(x => x === 'hit').length, near = s.filter(x => x === 'near').length;
    if (hits >= 4) return n === TRIES - 1 ? 'One letter off and one try left. No pressure.' : 'So close I can taste it. One letter!';
    if (hits >= 2) return `${hits} green! You're onto something.`;
    if (hits === 1 && near) return `One in the right spot and ${near} wandering around. Getting warmer.`;
    if (near >= 2) return `${near} letters are in there, just in the wrong seats. Shuffle them.`;
    if (near === 1) return 'One letter\'s in there somewhere. Hm.';
    if (hits === 1) return 'One green. A start is a start.';
    return n === 1 ? 'Nothing! Bold opening. At least you know five letters it isn\'t.' : 'Ouch, all gray. Shake it off.';
}
