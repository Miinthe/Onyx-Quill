/**
 * Mero's games, by kind (🎲 Games talks). Each game module has the same shape: normGame · newGame · linePrompt ·
 * safeLine · stockLine. Wordle (2026-10-27) · Four in a Row (2026-11-03).
 */
import * as wordle from './wordle-pure.js';
import * as four from './four-pure.js';

export const GAMES = { wordle, four };
export const TITLES = { wordle: 'Wordle with Mero', four: 'Four in a Row with Mero' };
export const gameOf = g => GAMES[g?.kind] || null;

/** A game from whatever was stored; null when it isn't one. */
export function normGame(g) { const m = gameOf(g); return m ? m.normGame(g) : null; }
