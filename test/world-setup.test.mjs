/**
 * World layer — setting up the world with Mero (src/world/setup-pure.js, stage 6, 2026-10-19).
 * Failures to avoid: dials for someone who isn't in the story; a look that isn't phone or letters; quirks for Miinthe herself;
 * an empty proposal shown as if Mero had answered.
 * Run: npm run test:world
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { setupPrompt, parseSetup, aliveWords } from '../src/world/setup-pure.js';

const people = [{ key: 'main', name: 'Toaster', about: 'a shiny toaster' }, { key: 'c:k', name: 'Kettle', about: 'dramatic, gaslights' }];

test('the prompt: her words, the cards, Mero in her own voice, never Miinthe herself', () => {
    const p = setupPrompt({ persona: 'Warm and nosy.', user: 'Miinthe', storyName: 'Harbor', about: 'a harbor town in 1890', people });
    assert(p.system.includes('Mero ☆') && p.system.includes('Warm and nosy.') && p.system.includes('Never for Miinthe herself'));
    assert(p.user.includes('a harbor town in 1890') && p.user.includes('Kettle: dramatic, gaslights'));
    assert(setupPrompt({ people: [] }).user.includes('said nothing about the world'));
});

test('reading it: known people only, look phone/letters, alive repaired, names kept', () => {
    const s = parseSetup(JSON.stringify({
        note: 'A sleepy harbor!', look: { value: 'letters', why: '1890s' }, alive: { open: true, big: true, time: false, every: true, everyN: 7, quiet: false, why: 'sleepy' },
        newsName: 'The Harbor Herald', rumorName: 'Dockside Whispers',
        voices: [{ name: 'The Harbor Herald', kind: 'voice', bio: 'the paper', g: 2, m: 1, p: 3 }, { name: 'Old Nell', kind: 'regular', quirks: 'ALL CAPS' }],
        people: [{ name: 'Kettle', g: 1, m: 3, p: 3, interests: ['herself'], quirks: 'many emoji' }, { name: 'Ghost', g: 3 }],
    }), people);
    assertEqual([s.look.value, s.alive.every, s.alive.everyN, s.newsName, s.rumorName], ['letters', true, 7, 'The Harbor Herald', 'Dockside Whispers']);
    assertEqual(s.voices.map(v => [v.name, v.kind]), [['The Harbor Herald', 'voice'], ['Old Nell', 'regular']]);
    assertEqual(s.people.map(p => [p.key, p.g, p.quirks]), [['c:k', 1, 'many emoji']]);
    assertEqual(parseSetup(JSON.stringify({ look: { value: 'smoke signals' }, voices: [], people: [] }), people), null, 'nothing usable: no proposal');
    assertEqual(parseSetup('nonsense', people), null);
});

test('the alive mix in words', () => {
    assertEqual(aliveWords({ open: true, big: true, time: false, every: true, everyN: 7, quiet: false, pace: 'lively' }), 'Catches up when you open it, after big moments, every 7 exchanges; 1–6 little moves after every reply');
    assertEqual(aliveWords({ open: false, big: false, time: false, every: false, quiet: false, pulse: false }), 'Only when you ask');
});

summary();
