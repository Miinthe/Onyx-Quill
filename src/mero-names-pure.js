/**
 * What Mero calls the author, and what the author calls Mero (Miinthe, 2026-10-26: "why the hest does she know my name? We
 * should add to general setting how mero should call the user and also how the user wants to call Mero").
 * Her instructions are written with "{{author}}" and "Mero"; `named` swaps those in the INSTRUCTIONS only — never in the
 * story, the talk or the lore, which are passed around it untouched. No name set: she uses no name at all ("the author").
 */
const str = v => (typeof v === 'string' ? v : '');

/** { you, me } from Mero's settings: you = '' (no name) or what she calls the author; me = her name — always Mero (her own
 * name was a setting until 2026-11-03; Miinthe: "it makes no sense since mero is put everywhere"). */
export const meroNames = (settings = {}) => ({ you: str(settings?.callMe).trim(), me: 'Mero' });

/** An instruction text with the chosen names in it. */
export function named(text, names = {}) {
    const you = str(names.you).trim();
    // no name: "the author", with a capital where a sentence (or a line, a heading, a bullet) starts
    const start = /(?:^|[.!?]\s+|\n)\s*(?:[-*#]+\s*)?$/;
    let t = String(text ?? '').replace(/\{\{author\}\}('s)?/g, (m, s, at, all) => {
        const word = you || (start.test(all.slice(0, at)) ? 'The author' : 'the author');
        return s ? `${word}'s` : word;
    });
    return t;
}

/** One line for her instructions: what to call the author. */
export const nameRule = (names = {}) => (str(names.you).trim()
    ? `Call the author "${str(names.you).trim()}".`
    : 'Never call the author by a name — not one from the story, the persona or anywhere else. Just talk to them.');
