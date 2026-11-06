/**
 * Setup wizard fixes (2026-11-05): the Matching page shows the preset its numbers really match; the Done-page
 * shortcuts save before they run; "Import a lorebook" goes through Connection; Settings › Run resumes; the setup
 * actions work while Onyx Quill is still off.
 * setup-wizard.js imports SillyTavern, so the pure bits are read out of the source.
 * Run: node test/setup-wizard.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assert, assertEqual, test, summary } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wizSrc = read('src/ui/setup-wizard.js');
const objectAfter = (src, marker) => {
    const i = src.indexOf(marker); let depth = 0; const j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) return src.slice(j, k + 1); } }
    throw new Error('no object after ' + marker);
};
const PRESETS = new Function(`return ${objectAfter(wizSrc, 'const PRESETS =')}`)();
const fnStart = wizSrc.indexOf('export function matchPreset(');
const fnBody = objectAfter(wizSrc.slice(fnStart), ') {');
const matchPreset = new Function('PRESETS', `return function (scanDepth, maxEntries, budget) ${fnBody}`)(PRESETS);
const DEFAULTS = new Function(`return ${objectAfter(read('settings.js'), 'export const defaultSettings =')}`)();

test('matchPreset: each preset matches its own numbers (strings from inputs too)', () => {
    for (const [name, v] of Object.entries(PRESETS)) {
        assertEqual(matchPreset(v.scanDepth, v.maxEntries, v.budget), name, name);
        assertEqual(matchPreset(String(v.scanDepth), String(v.maxEntries), String(v.budget)), name, name + ' (strings)');
    }
});

test('matchPreset: the fresh-install defaults match no preset → Custom, not Medium', () => {
    const got = matchPreset(DEFAULTS.scanDepth, DEFAULTS.maxEntries, DEFAULTS.maxTokensBudget);
    const expected = Object.entries(PRESETS).find(([, v]) => v.scanDepth === DEFAULTS.scanDepth && v.maxEntries === DEFAULTS.maxEntries && v.budget === DEFAULTS.maxTokensBudget)?.[0] ?? null;
    assertEqual(got, expected, 'shown preset agrees with the default numbers');
    assertEqual(matchPreset('', '', ''), null, 'empty fields → custom');
});

test('prefill syncs the preset display to the numbers', () => {
    assert(/syncPresetDisplay\(\); \/\/ the highlighted preset/.test(wizSrc), 'prefillFromSettings calls syncPresetDisplay');
});

test('Done-page shortcuts save (finishWizard) before running', () => {
    const i = wizSrc.indexOf('function wireDoneActions()');
    const body = wizSrc.slice(i, wizSrc.indexOf('async function applyWizardSettings', i));
    assert(body.includes('await finishWizard()'), 'shortcut awaits finishWizard');
    assert(!body.includes('.popup_ok, .popup_close'), 'no close-without-saving');
});

test('"Import a lorebook" goes to the Connection page first', () => {
    const i = wizSrc.indexOf("case 'import':");
    const body = wizSrc.slice(i, wizSrc.indexOf('break;', i));
    assert(body.includes('goToPage(2)') && !body.includes('goToPage(7)'), 'import fork lands on Connection');
    assert(wizSrc.includes('wizardState.importAfterConnect'), 'Next from Connection continues to Import');
});

test('Settings › Advanced › Setup wizard › Run resumes like /oq-setup', () => {
    assert(/case 'wizard':[^\n]*showSetupWizard\(getWizardResumeStep\(\)\)/.test(read('src/settings/settings-view.js')), 'Run passes the resume step');
});

test('setup wizard + Import World Info are not blocked while Onyx Quill is off', () => {
    const src = read('src/drawer/drawer-events.js');
    assert(src.includes("const SETUP_ACTIONS_WHILE_OFF = new Set(['setup', 'import-wi']);"), 'exempt set');
    assertEqual(src.split('!settings.enabled && !SETUP_ACTIONS_WHILE_OFF.has(action)').length - 1, 2, 'both the ⋯ menu/tools and the empty-state buttons use it');
});

await summary('Setup Wizard Tests');
