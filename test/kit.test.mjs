/**
 * Overhaul step 1 suite — the shared parts' colors and picker lists (src/kit/*-pure.js, icons.js).
 * Failures to avoid: unreadable text under one of Miinthe's themes, a light theme, or colors she changed by hand
 * (Miinthe: "you can also change the colors yourself"); a see-through ST tint making DeepLore see-through; Mero's
 * color not following its one setting; the board's icons or 14 colors going missing on the move.
 * Run: npm run test:kit
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { palette, parseColor, contrast, MERO_DEFAULT, ST_FALLBACK } from '../src/kit/theme-pure.js';
import { EMOJI, SWATCHES, searchEmoji, normalHex } from '../src/kit/pickers-pure.js';
import { ICONS, icon } from '../src/kit/icons.js';

// her themes on test-user (data/test-user/themes/*.json), the Glimmer values from the mock-ups, a light one, odd ones
const THEMES = {
    Azure: { text: 'rgba(171, 198, 223, 1)', em: 'rgba(199, 189, 255, 1)', under: 'rgba(188, 231, 207, 1)', quote: 'rgba(111, 133, 253, 1)', tint: 'rgba(23, 30, 33, 0.61)', border: 'rgba(0, 0, 0, 0.5)' },
    Cappuccino: { text: 'rgba(235, 235, 235, 1)', em: 'rgba(230, 210, 190, 1)', under: 'rgba(205, 180, 160, 1)', quote: 'rgba(165, 140, 115, 1)', tint: 'rgba(34, 30, 32, 0.95)', border: 'rgba(80, 80, 80, 0.89)' },
    'Celestial Macaron': { text: 'rgba(229, 175, 162, 1)', em: 'rgba(146, 147, 161, 1)', under: 'rgba(157, 215, 198, 1)', quote: 'rgba(197, 202, 206, 1)', tint: 'rgba(23, 36, 55, 0.9)', border: 'rgba(60, 74, 110, 0.93)' },
    'Dark Lite': { text: 'rgba(220, 220, 210, 1)', em: 'rgba(145, 145, 145, 1)', under: 'rgba(188, 231, 207, 1)', quote: 'rgba(225, 138, 36, 1)', tint: 'rgba(23, 23, 23, 1)', border: 'rgba(0, 0, 0, 1)' },
    'Dark V 1.0': { text: 'rgba(207, 207, 197, 1)', em: 'rgba(145, 145, 145, 1)', under: 'rgba(145, 145, 145, 1)', quote: 'rgba(198, 193, 151, 1)', tint: 'rgba(29, 33, 40, 0.9)', border: 'rgba(0, 0, 0, 1)' },
    Glimmer: { text: '#c6c6c6', quote: '#51a0de', tint: '#1e1e1e', border: '#c6c6c6' },
    'light, own colors': { text: 'rgb(42, 42, 46)', em: 'rgb(107, 107, 117)', quote: 'rgb(176, 48, 107)', under: 'rgb(44, 85, 201)', tint: 'rgba(250, 248, 244, 0.9)', border: 'rgba(0, 0, 0, 0.2)' },
    'dark text, dark tint (fighting)': { text: '#202020', quote: '#3060ff', tint: 'rgba(10, 10, 10, 1)', border: '#000' },
    'neon, own colors': { text: '#ffe6a0', quote: '#a0ff00', tint: 'rgba(60, 0, 90, 0.7)', border: '#ff00ff' },
    'pale yellow quote on light': { text: '#111', quote: '#fff8b0', tint: '#fff', border: '#ddd' },
    'nothing set': {},
};
const P = s => parseColor(s);

test('colors read: hex, rgb and rgba in the forms SillyTavern writes', () => {
    assertEqual(P('#abc'), { r: 170, g: 187, b: 204, a: 1 });
    assertEqual(P('rgba(23, 30, 33, 0.61)'), { r: 23, g: 30, b: 33, a: 0.61 });
    assertEqual(P('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
    assertEqual(P('#11223380').a.toFixed(2), '0.50');
    assertEqual(P('purple'), null);
    assertEqual(P(''), null);
});

test('every theme: text, gray text, accent, meaning colors and Mero stay readable on DeepLore\'s background', () => {
    for (const [name, st] of Object.entries(THEMES)) {
        const { vars } = palette(st);
        const page = P(vars['--dk-page']), c = k => contrast(P(vars[k]), page);
        assert(c('--dk-ink') >= 7, `${name}: text ${c('--dk-ink').toFixed(2)}`);
        assert(c('--dk-muted') >= 4.5, `${name}: gray text ${c('--dk-muted').toFixed(2)}`);
        assert(c('--dk-accent') >= 3, `${name}: accent ${c('--dk-accent').toFixed(2)}`);
        assert(c('--dk-accent-ink') >= 4.5, `${name}: accent text ${c('--dk-accent-ink').toFixed(2)}`);
        for (const k of ['--dk-good', '--dk-wait', '--dk-bad', '--dk-info', '--dk-mero']) assert(c(k) >= 4.5, `${name}: ${k} ${c(k).toFixed(2)}`);
        assert(contrast(P(vars['--dk-on-accent']), P(vars['--dk-accent'])) >= 3, `${name}: text on an accent button`);
        assert(contrast(P(vars['--dk-on-mero']), P(vars['--dk-mero'])) >= 3, `${name}: text on a Mero button`);
        assert(Object.values(vars).every(v => /^#[0-9a-f]{6}$/.test(v)), `${name}: every color solid hex`);
    }
});

test('light text = a dark DeepLore, dark text = a light DeepLore', () => {
    assertEqual(palette(THEMES.Cappuccino).scheme, 'dark');
    assertEqual(palette(THEMES['light, own colors']).scheme, 'light');
    assertEqual(palette({}).scheme, palette(ST_FALLBACK).scheme);
});

test('the theme shows: different themes give different backgrounds and accents, the same theme the same', () => {
    const a = palette(THEMES.Azure).vars, c = palette(THEMES.Cappuccino).vars, cm = palette(THEMES['Celestial Macaron']).vars;
    assert(a['--dk-page'] !== c['--dk-page'] && c['--dk-page'] !== cm['--dk-page'], 'backgrounds differ');
    assert(a['--dk-accent'] !== c['--dk-accent'], 'accents differ');
    assertEqual(palette(THEMES.Azure).vars, a);
    // a hand change to one color moves DeepLore with it
    const own = { ...THEMES.Cappuccino, quote: 'rgba(40, 200, 120, 1)' };
    assert(palette(own).vars['--dk-accent'] !== c['--dk-accent'], 'changed quote color → changed accent');
});

test('a see-through tint is laid over a solid color, never left see-through', () => {
    const v = palette({ ...THEMES.Azure, tint: 'rgba(23, 30, 33, 0.1)' }).vars;
    assert(/^#[0-9a-f]{6}$/.test(v['--dk-page']), 'solid');
});

test('Mero\'s color is one setting: it changes Mero and nothing else', () => {
    const a = palette(THEMES.Azure).vars, b = palette(THEMES.Azure, { mero: '#3aa0ff' }).vars;
    assert(a['--dk-mero'] !== b['--dk-mero'], 'Mero changed');
    for (const k of Object.keys(a)) if (!k.includes('mero')) assertEqual(b[k], a[k], k);
    assertEqual(palette(THEMES.Azure, { mero: 'not a color' }).vars['--dk-mero'], palette(THEMES.Azure, { mero: MERO_DEFAULT }).vars['--dk-mero']);
});

test('the icon picker keeps the board\'s groups; search finds words and the emoji itself, each once', () => {
    assertEqual(EMOJI.map(g => g[0]), ['Love & people', 'Mystery & danger', 'Plot & progress', 'Places', 'Nature & weather', 'Things & items', 'Magic & mood']);
    assertEqual(searchEmoji('key').flatMap(g => g[1].map(x => x.e)), ['🗝️', '🔑']);
    assertEqual(searchEmoji('🐉').flatMap(g => g[1].map(x => x.e)), ['🐉']);
    assertEqual(searchEmoji('zzz-nothing'), []);
    const all = searchEmoji('').flatMap(g => g[1].map(x => x.e));
    assertEqual(all.length, new Set(all).size);
});

test('the color picker keeps the board\'s 14 colors; colors stored as #rrggbb', () => {
    assertEqual(SWATCHES.length, 14);
    assert(SWATCHES.every(([c]) => /^#[0-9a-f]{6}$/.test(c)), 'hex');
    assertEqual(normalHex('#ABC'), '#aabbcc');
    assertEqual(normalHex(' #D0145E '), '#d0145e');
    assertEqual(normalHex('red'), '');
});

test('one icon set: every icon draws something; an unknown name gives an empty icon, not an error', () => {
    for (const [n, d] of Object.entries(ICONS)) assert(/<(path|rect|circle)/.test(d), n);
    assert(icon('nope').includes('<svg'), 'empty svg');
    for (const n of ['more', 'close', 'chev', 'mero', 'lock', 'unlock', 'mail', 'popout', 'trash', 'undo', 'plus', 'palette']) assert(n in ICONS, n);
});

test('Settings › Look: forced light or dark still gives readable text on every theme', () => {
    for (const forced of ['light', 'dark']) for (const [name, st] of Object.entries(THEMES)) {
        const { scheme, vars } = palette(st, { scheme: forced });
        assertEqual(scheme, forced, name);
        const page = P(vars['--dk-page']);
        assert(contrast(P(vars['--dk-ink']), page) >= 7, `${forced} ${name}: text`);
        assert(contrast(P(vars['--dk-muted']), page) >= 4.5, `${forced} ${name}: gray text`);
    }
});

summary();
