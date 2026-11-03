/**
 * LOCAL PATCH suite — ✓ Fix spelling (Miinthe, 2026-11-03). Failures to avoid: a "correction" that rewrites her message;
 * *actions*, {{macros}}, [OOC] or line breaks lost; "Here is the corrected text:" left in her message; the change list
 * showing the wrong words.
 * Run: npm run test:spell
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { SPELL_SYSTEM, spellUser, cleanAnswer, wordChanges, checkFix, changesLine, looksLikeFix, cleanWords, wordHints, hintsBlock, keepHerWords, wordsToKeep } from '../src/spell-pure.js';

const MSG = '*mara smirkes and walkd to the dorr,* glancing bak at him. "your late again"';
const FIX = '*Mara smirks and walks to the door,* glancing back at him. "You\'re late again."';

test('the instruction: spelling only, keep her words and everything the story reads', () => {
    assert(/ONLY/.test(SPELL_SYSTEM) && /Never change the meaning/.test(SPELL_SYSTEM) && /\{\{macros\}\}/.test(SPELL_SYSTEM) && /\[OOC/.test(SPELL_SYSTEM));
    assert(spellUser('hi').includes('<<<\nhi\n>>>'));
});

test('the answer is cleaned: fences, "Here is…:", wrapping quotes', () => {
    assertEqual(cleanAnswer('```\nHello there.\n```'), 'Hello there.');
    assertEqual(cleanAnswer('Here is the corrected text:\nHello there.', 'helo there'), 'Hello there.');
    assertEqual(cleanAnswer('"Hello there."', 'helo there'), 'Hello there.');
    assertEqual(cleanAnswer('"You\'re late."', '"your late"'), '"You\'re late."', 'her own quotes stay');
    assertEqual(cleanAnswer('<<<\nHello.\n>>>'), 'Hello.');
});

test('what changed, word by word', () => {
    const c = wordChanges(MSG, FIX);
    assertEqual(c.map(x => `${x.from}→${x.to}`), ['*mara smirkes→*Mara smirks', 'walkd→walks', 'dorr,*→door,*', 'bak→back', '"your→"You\'re', 'again"→again."']);
    assertEqual(wordChanges('all fine here', 'all fine here'), []);
    assertEqual(changesLine(c, 3), '*mara smirkes → *Mara smirks · walkd → walks · dorr,* → door,* · +3 more');
});

test('a real correction passes; a rewrite, a lost *action* or {{macro}} does not', () => {
    assertEqual(checkFix(MSG, FIX), { ok: true });
    assertEqual(checkFix(MSG, MSG.replace(/\*/g, '')).ok, false, 'asterisks lost');
    assertEqual(checkFix('hi {{char}}, hw are you', 'Hi Mara, how are you?').ok, false, 'a macro replaced');
    assertEqual(checkFix('[OOC: brb] ok', 'ok').ok, false);
    assertEqual(checkFix('line one\nline two', 'Line one. Line two.').ok, false, 'line breaks kept');
    assertEqual(checkFix(MSG, 'Mara, with a knowing smirk, strolls toward the doorway and casts a lingering look back over his shoulder at him, then teases that he is late yet again.').ok, false, 'a rewrite is refused');
    assertEqual(checkFix('helo', '').ok, false);
});

test('a fix looks like the same word spelled better; a rewrite does not', () => {
    for (const [a, b] of [['smirkes', 'smirks'], ['walkd', 'walks'], ['dorr,*', 'door,*'], ['"your', '"You\'re'], ['teh', 'the'], ['mara', 'Mara'], ['', 'the']]) assert(looksLikeFix(a, b), `${a} → ${b}`);
    for (const [a, b] of [['walks', 'strolls'], ['door', 'doorway threshold'], ['angry', 'furious']]) assert(!looksLikeFix(a, b), `${a} → ${b}`);
});

test('bug hunt 2026-11-03: moved marks, a lost "not", dropped quotes and an over-long text are refused', () => {
    assert(!checkFix('*she smiles* "hi there"', '*she smiles "hi there"*').ok, 'moved asterisk');
    assert(!checkFix('{{char}} looks at {{user}}', '{{user}} looks at {{char}}').ok, 'macros swapped');
    assert(!checkFix('"I wont go," she said.', 'I won\'t go, she said.').ok, 'quotes dropped');
    assert(!checkFix('I do not love him.', 'I do love him.').ok, 'not dropped');
    assert(!checkFix('I can go.', 'I can\'t go.').ok, 'not added');
    assert(checkFix('i dont know waht to do', 'I don\'t know what to do').ok, 'dont → don\'t is a fix');
    assert(checkFix('*she smiels* "hi"\n', '*She smiles* "Hi."').ok, 'a trailing line break is no change');
    const long = Array.from({ length: 2100 }, (_, i) => 'word' + i).join(' ');
    assert(!checkFix(long, long.replace('word5 ', 'wrod5 ')).ok, 'too long to check');
    assertEqual(wordChanges(long, long), null);
});

// her words (Miinthe, 2026-11-03: "if the word is like Ashvale and I spell it Ashvalle … it also corrects it if its in the list")
const WORDS = ['Ashvale', 'spearling', 'Thornfield Inn', 'Velari', 'Coin', ' ashvale ', '', 'x'.repeat(50)];

test('her words: the list is cleaned (doubles, blanks, too long)', () => {
    assertEqual(cleanWords(WORDS), ['Ashvale', 'spearling', 'Thornfield Inn', 'Velari', 'Coin']);
    assertEqual(cleanWords(null), []);
});

test('her words: a near miss is pointed at her spelling, an exact one is kept, short and far words are left alone', () => {
    const h = wordHints('By the Ashvalle gate, the spaerling and velari wait near thornfield inn — more Coinn.', WORDS);
    assertEqual(h.fix, [{ typed: 'Ashvalle', word: 'Ashvale' }, { typed: 'spaerling', word: 'spearling' }]);
    assert(h.keep.includes('Velari') && h.keep.includes('Thornfield Inn'), 'found as written (any capitals)');
    assertEqual(wordHints('the dusk was near', WORDS).fix, [], 'a different word is not a near miss');
    assertEqual(wordHints('more', WORDS).fix, [], 'short words are never matched (more ≠ Coin)');
    assertEqual(hintsBlock({ keep: [], fix: [] }), '');
    const b = hintsBlock(wordHints('Ashvalle and spearling', WORDS));
    assert(/never change them: spearling/.test(b) && /"Ashvalle" → "Ashvale"/.test(b));
    assert(spellUser('hi', b).startsWith('Words of her story'), 'the hints go before the message');
    assert(spellUser('hi').startsWith('The message:'), 'no hints → as before');
});

test('her words: the safety net puts back a word of hers the AI "fixed", the real fixes stay', () => {
    const r = keepHerWords('*Brokk grumbls and sheathes his spearling* "go"', '*Brokk grumbles and sheathes his glaive* "Go."', WORDS);
    assertEqual(r.text, '*Brokk grumbles and sheathes his spearling* "Go."');
    assertEqual(r.kept, ['spearling']);
    const r2 = keepHerWords('the spearling, then\n\nvelari came', 'The glaive, then\n\nVelari came', WORDS);
    assertEqual(r2.text, 'The spearling, then\n\nVelari came', 'punctuation and line breaks of the fix stay; a capital is not a change');
    assertEqual(keepHerWords('helo there', 'Hello there.', WORDS).kept, [], 'nothing of hers → untouched');
    assertEqual(keepHerWords('a spearling', 'a glaive', []).text, 'a glaive', 'an empty list changes nothing');
});

test('her words: "Keep mine" takes the words of a change', () => {
    assertEqual(wordsToKeep({ from: 'spearling*', to: 'glaive*' }), ['spearling']);
    assertEqual(wordsToKeep({ from: '', to: 'the' }), []);
});

summary('spell');
