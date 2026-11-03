/**
 * Onyx Quill start-up (2026-11-03): the settings move-over from the DeepLore names, and the check for the original
 * DeepLore switched on at the same time.
 * Failures to avoid: settings lost or overwritten on the first start; the old DeepLore-named settings changed or
 * deleted (they are the way back); Onyx Quill starting next to the original DeepLore; Onyx Quill mistaking itself
 * (or a switched-off DeepLore) for a clash; any code still reading a DeepLore-named setting.
 * Run: npm run test:onyx-start
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { SETTINGS_MOVES, moveSettings, findDeepLore, DEEPLORE_HOOK } from '../src/onyx-start-pure.js';

test('first start: every DeepLore-named setting is copied to its new name, the old one stays as it was', () => {
    const ext = {
        deeplore_enhanced: { enabled: true, vaults: [{ name: 'Main' }] },
        deeplore_storyboards_v2: { boards: { 'My board': { board: { trackers: [] } } }, oneStore: 1 },
        deeplore_mero: { v: 3, settings: { callMe: 'Sam' } },
        other_extension: { x: 1 },
    };
    const before = JSON.stringify(ext.deeplore_enhanced);
    assertEqual(moveSettings(ext), ['deeplore_enhanced', 'deeplore_storyboards_v2', 'deeplore_mero']);
    assertEqual(ext.onyxquill, { enabled: true, vaults: [{ name: 'Main' }] });
    assertEqual(ext.onyxquill_storyboards.boards['My board'].board.trackers, []);
    assertEqual(ext.onyxquill_mero.settings.callMe, 'Sam');
    assertEqual(JSON.stringify(ext.deeplore_enhanced), before, 'old copy untouched');
    assert(ext.onyxquill !== ext.deeplore_enhanced, 'a real copy, not the same object');
    ext.onyxquill.enabled = false;
    assertEqual(ext.deeplore_enhanced.enabled, true, 'changing the new one leaves the old one alone');
    assert(!('onyxquill_slop' in ext) && !('onyxquill_characters' in ext), 'nothing made up for settings that never existed');
    assertEqual(ext.other_extension, { x: 1 });
});

test('later starts: an existing Onyx Quill setting is never overwritten', () => {
    const ext = { deeplore_mero: { v: 1 }, onyxquill_mero: { v: 9 } };
    assertEqual(moveSettings(ext), []);
    assertEqual(ext.onyxquill_mero, { v: 9 });
});

test('a new user (no DeepLore before): nothing is moved, nothing breaks', () => {
    const ext = {};
    assertEqual(moveSettings(ext), []);
    assertEqual(ext, {});
    assertEqual(moveSettings(null), []);
    assertEqual(moveSettings({ deeplore_slop: null }), [], 'an empty old value is not copied');
});

test('the original DeepLore switched on is found; switched off, missing or Onyx Quill itself is not', () => {
    const manifests = {
        'third-party/sillytavern-DeepLore': { generate_interceptor: DEEPLORE_HOOK },
        'third-party/Onyx-Quill': { generate_interceptor: 'onyxQuill_onGenerate' },
        'third-party/Other': {},
    };
    const of = n => manifests[n] || null;
    const names = Object.keys(manifests);
    assertEqual(findDeepLore(names, of, []), 'third-party/sillytavern-DeepLore');
    assertEqual(findDeepLore(names, of, ['third-party/sillytavern-DeepLore']), '', 'switched off = no clash');
    assertEqual(findDeepLore(['third-party/Onyx-Quill', 'third-party/Other'], of, []), '');
    assertEqual(findDeepLore(names, () => { throw new Error('x'); }, []), '', 'a broken manifest lookup is not a clash');
    assertEqual(findDeepLore(undefined, of, undefined), '');
});

test('the manifest uses Onyx Quill\'s own reply hook (never the original DeepLore\'s)', () => {
    const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assertEqual(m.generate_interceptor, 'onyxQuill_onGenerate');
    assert(m.generate_interceptor !== DEEPLORE_HOOK);
    const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert(idx.includes('globalThis.onyxQuill_onGenerate ='), 'index.js sets the hook the manifest names');
    assert(!/globalThis\.deepLoreEnhanced_/.test(idx), 'no DeepLore-named globals left');
});

test('no code reads a DeepLore-named setting any more (only the move-over knows the old names)', () => {
    const root = new URL('..', import.meta.url).pathname;
    const files = execSync("git ls-files '*.js' '*.html'", { cwd: root, encoding: 'utf8' }).split('\n')
        .filter(f => f && !f.startsWith('test/') && !f.startsWith('node_modules/') && f !== 'src/onyx-start-pure.js');
    const old = Object.keys(SETTINGS_MOVES).map(k => k.replace(/_/g, '_'));
    const re = new RegExp(`(extension_settings|extensionSettings)\\??\\.?\\[?['"]?(${old.join('|')})\\b(?!_)`);
    const bad = [];
    for (const f of files) {
        const src = readFileSync(root + f, 'utf8');
        src.split('\n').forEach((l, i) => { if (re.test(l) && !/^\s*(\*|\/\/)/.test(l)) bad.push(`${f}:${i + 1}`); });
    }
    assertEqual(bad, []);
});

summary('onyx-start');
