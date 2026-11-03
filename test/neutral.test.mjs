/**
 * Neutral wording (2026-11-03, Onyx Quill publishing prep): Mero's instructions name the author with the placeholder
 * {{author}}, which mero-names-pure.js `named` turns into the name chosen in Mero's settings, or "the author".
 * Failures to avoid: a real person's name in anything the extension says or sends; a {{author}} placeholder reaching
 * the model unswapped; a talk saved with the old 'miinthe' label losing the author's messages.
 * Run: npm run test:neutral
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { named } from '../src/mero-names-pure.js';
import { buildMeroPrompt, asStore } from '../src/mero-pure.js';
import { pitchPrompt, talkPitchPrompt, rewritePrompt } from '../src/pitches-pure.js';
import { buildLookPrompt } from '../src/mero-lore-pure.js';
import { buildBoardMeroPrompt } from '../src/board-mero-pure.js';
import * as four from '../src/games/four-pure.js';
import * as wordle from '../src/games/wordle-pure.js';

const root = new URL('..', import.meta.url).pathname;
const acorn = createRequire(root + 'package.json')('acorn');

test('no personal name in any text the code says or sends (string literals; comments are not checked here)', () => {
    const files = execSync("git ls-files '*.js'", { cwd: root, encoding: 'utf8' }).split('\n')
        .filter(f => f && !f.startsWith('test/') && !f.startsWith('node_modules/'));
    const bad = [];
    for (const f of files) {
        const src = readFileSync(root + f, 'utf8');
        for (const t of acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })) {
            if (t.type.label !== 'string' && t.type.label !== 'template') continue;
            const raw = src.slice(t.start, t.end);
            if (/\bRii\b/.test(raw)) bad.push(`${f}:${t.loc.start.line}`);
            // the old talk label is read once more for talks saved before the change — only there
            if (/^['"`]miinthe['"`]$/.test(raw) && f !== 'src/mero-pure.js') bad.push(`${f}:${t.loc.start.line} ('miinthe')`);
        }
    }
    assertEqual(bad, []);
});

test('the placeholder: the chosen name, else "the author" (a capital where a sentence starts)', () => {
    assertEqual(named('{{author}} asked. Then {{author}}\'s idea.', {}), 'The author asked. Then the author\'s idea.');
    assertEqual(named('- {{author}} wins\n## {{author}}\'s vault [Context {{author}} added]', {}), '- The author wins\n## The author\'s vault [Context the author added]');
    assertEqual(named('{{author}} and Mero', { you: 'Sam', me: 'Lumi' }), 'Sam and Mero', 'Mero is always Mero');
});

test('no prompt reaches the model with {{author}} still in it — with and without a chosen name', () => {
    for (const names of [{}, { you: 'Sam', me: 'Mero' }]) {
        const talk = { tag: 'plan', title: 'T', msgs: [{ who: 'author', t: 'What if the kettle lies?', ctx: [{ label: 'A post', text: 'x' }] }, { who: 'mero', t: 'Ooh.' }] };
        const out = [
            buildMeroPrompt({ settings: { callMe: names.you || '' }, talk, guides: [{ title: 'Style', content: 'Short lines.' }], vault: [{ title: 'K', content: 'c' }], moments: ['m'], talkNotes: [{ text: 'n' }], lookups: true, web: true, pitchAsked: true }),
            buildMeroPrompt({ settings: { callMe: names.you || '', bringUp: true }, talk }),
            pitchPrompt({}, { names, guides: [{ title: 'Style', content: 'Short lines.' }] }, { comment: 'more angst' }),
            pitchPrompt({ kind: 'plan', hidden: true, moment: 'at dinner' }, { names }, {}),
            talkPitchPrompt(talk, { names, guides: [{ title: 'Style', content: 'Short lines.' }] }),
            rewritePrompt({ text: 'x', plan: { beats: [{ text: 'a' }, { text: 'b' }] } }, 'more', { names, guides: [{ title: 'Style', content: 'Short lines.' }] }),
            buildLookPrompt({ entries: [{ title: 'K', content: 'c' }], replies: [{ i: 1, name: 'K', text: 'x' }], names }),
            buildBoardMeroPrompt('chat', { brief: 'b', talk: [{ who: 'you', t: 'hi' }], quick: 'add a step' }, { names }),
            four.linePrompt(four.newGame(null, () => 0.9), 'start', { names }),
            four.linePrompt(four.newGame(null, () => 0.9), 'won', { names, facts: four.roundFacts({ c: 2, m: -1, end: { over: 'won' } }) }),
            wordle.linePrompt({ kind: 'wordle', word: 'apple', guesses: ['crane'], hints: 0 }, 'guess', { names, word: 'apple' }),
        ];
        const text = JSON.stringify(out);
        assert(!text.includes('{{author}}'), `no leftover placeholder (${names.you || 'no name'}): ${text.match(/.{40}\{\{author\}\}.{20}/)?.[0]}`);
        assert(!/\bRii\b/.test(text), 'no personal name');
        if (names.you) assert(text.includes('Sam'), 'the chosen name is used');
        assertEqual((text.match(/Short lines\./g) || []).length, 4, 'the guide reaches all four prompts');
    }
});

test('talks saved with the old label keep the author\'s messages (they load as "author")', () => {
    const s = asStore({ chars: { 'k.png': { talks: [{ title: 'Old', msgs: [{ who: 'miinthe', t: 'hi' }, { who: 'mero', t: 'hey' }] }] } } });
    assertEqual(s.chars['k.png'].talks[0].msgs.map(m => m.who), ['author', 'mero']);
    assertEqual(four.normGame({ kind: 'four', first: 'miinthe', moves: [] }).first, 'author');
});

summary('neutral');
