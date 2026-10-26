/**
 * What Mero calls the author, and what the author calls Mero (Miinthe, 2026-10-26: "why the hest does she know my name? We
 * should add to general setting how mero should call the user and also how the user wants to call Mero").
 * Her instructions are written with "Miinthe" and "Mero"; `named` swaps those words in the INSTRUCTIONS only — never in the
 * story, the talk or the lore, which are passed around it untouched. No name set: she uses no name at all.
 */
const str = v => (typeof v === 'string' ? v : '');

/** { you, me } from Mero's settings: you = '' (no name) or what she calls the author; me = her name ('Mero'). */
export const meroNames = (settings = {}) => ({ you: str(settings?.callMe).trim(), me: str(settings?.meroName).trim() || 'Mero' });

/** An instruction text with the chosen names in it. */
export function named(text, names = {}) {
    const you = str(names.you).trim(), me = str(names.me).trim() || 'Mero';
    let t = String(text ?? '')
        .replace(/\bRii's\b/g, you ? `${you}'s` : "the author's")
        .replace(/\bRii\b/g, you || 'the author');
    if (me !== 'Mero') t = t.replace(/\bMero\b/g, me);
    return t;
}

/** One line for her instructions: what to call the author. */
export const nameRule = (names = {}) => (str(names.you).trim()
    ? `Call the author "${str(names.you).trim()}".`
    : 'Never call the author by a name — not one from the story, the persona or anywhere else. Just talk to them.');
