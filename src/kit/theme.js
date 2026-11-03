/**
 * Overhaul step 1 (2026-10-15) — keeps every DeepLore page in SillyTavern's current colors.
 *
 * followTheme(doc) writes the --dk-* colors (theme-pure.js → palette) onto `doc` and redraws them whenever the
 * theme changes: picking another theme, or changing one color by hand in ST's User Settings. Works for SillyTavern's
 * own page and for DeepLore's windows that live in an iframe (the board, Mero's window), which can't see ST's
 * variables on their own. Also loads the shared stylesheet (kit.css) and fonts into that page.
 */
import { palette, ST_VARS, MERO_DEFAULT } from './theme-pure.js';

const followed = new Set();   // documents kept in step
let meroColor = MERO_DEFAULT;
let schemeOf = () => null;   // Settings › Interface › Look: null = follow SillyTavern, or 'light' / 'dark'
let watching = false;

/** The page SillyTavern itself runs in (its variables live there), from here or from inside an iframe. */
function stDocument() {
    try { if (window.top?.document?.documentElement?.style.getPropertyValue('--SmartThemeBodyColor') !== undefined) return window.top.document; } catch { /* other origin */ }
    return document;
}

/** ST's current theme values, as strings. */
export function readStTheme(src = stDocument()) {
    const cs = src.defaultView.getComputedStyle(src.body || src.documentElement);
    const out = {};
    for (const [k, name] of Object.entries(ST_VARS)) out[k] = cs.getPropertyValue(name).trim();
    return out;
}

function paint(doc) {
    const src = stDocument();
    // the forced light / dark (Settings › Interface › Look) is known on SillyTavern's page; it is written there as
    // --dle-scheme-pick, so DeepLore's windows in iframes (Mero, the board) follow it too (bug hunt 2026-11-03: Mero stayed dark)
    const own = schemeOf(), stRoot = src.documentElement;
    if (doc === src) { const want = own === 'light' || own === 'dark' ? own : ''; if (stRoot.style.getPropertyValue('--dle-scheme-pick') !== want) { if (want) stRoot.style.setProperty('--dle-scheme-pick', want); else stRoot.style.removeProperty('--dle-scheme-pick'); } }
    const picked = stRoot.style.getPropertyValue('--dle-scheme-pick').trim();
    const forced = own === 'light' || own === 'dark' ? own : picked === 'light' || picked === 'dark' ? picked : null;
    const { scheme, vars } = palette(readStTheme(src), { mero: meroColor, scheme: forced });
    const root = doc.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.dkScheme = scheme;
    // ST's text size setting, so DeepLore grows and shrinks with the rest of SillyTavern
    const scale = src.defaultView.getComputedStyle(src.documentElement).getPropertyValue('--fontScale').trim();
    if (doc !== src) { if (scale) root.style.setProperty('--fontScale', scale); else root.style.removeProperty('--fontScale'); }
}

let queued = false;
function repaintAll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
        queued = false;
        for (const d of followed) {
            if (!d.defaultView) { followed.delete(d); continue; }   // a closed window
            try { paint(d); } catch { followed.delete(d); }
        }
    });
}

function watch() {
    if (watching) return;
    const src = stDocument();
    const MO = src.defaultView.MutationObserver;
    // ST writes its colors as inline variables on <html>; custom CSS or theme switches can also touch <body>.
    new MO(repaintAll).observe(src.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    if (src.body) new MO(repaintAll).observe(src.body, { attributes: true, attributeFilter: ['style', 'class'] });
    watching = true;
}

/** The stylesheet with the shared parts, next to this file. */
export const KIT_CSS = new URL('./kit.css', import.meta.url).href;
/** SillyTavern's page only: the bar, the side panel's frame, the ⋯ on each reply (overhaul 2a). */
export const FRAME_CSS = new URL('./frame.css', import.meta.url).href;
/** SillyTavern's page only: the new look for DeepLore's older pop-ups (legacy-skin.js marks them, 2026-10-16). */
export const LEGACY_CSS = new URL('./legacy-skin.css', import.meta.url).href;
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap';

function addStyles(doc, opts = {}) {
    const { css = true } = opts;
    const head = doc.head || doc.documentElement;
    if (css && !doc.querySelector('link[data-dk="kit"]')) {
        const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = KIT_CSS; l.dataset.dk = 'kit'; head.appendChild(l);
    }
    if (opts.frame && !doc.querySelector('link[data-dk="frame"]')) {
        const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = FRAME_CSS; l.dataset.dk = 'frame'; head.appendChild(l);
    }
    if (opts.frame && !doc.querySelector('link[data-dk="legacy"]')) {
        const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = LEGACY_CSS; l.dataset.dk = 'legacy'; head.appendChild(l);
    }
    if (!doc.querySelector('link[data-dk="fonts"]')) {
        const f = doc.createElement('link'); f.rel = 'stylesheet'; f.href = FONTS; f.dataset.dk = 'fonts'; head.appendChild(f);
    }
}

/**
 * Keep `doc` in SillyTavern's colors from now on. `css: false` when the page already loads kit.css itself
 * (SillyTavern's page gets it through style.css).
 */
export function followTheme(doc = document, opts = {}) {
    addStyles(doc, opts);
    followed.add(doc);
    paint(doc);
    watch();
}

/** configureTheme({ scheme }) — where the forced light / dark choice is read (null = follow SillyTavern). */
export function configureTheme({ scheme } = {}) { if (scheme) schemeOf = scheme; repaintAll(); }
/** Redraw every followed page now (e.g. after a setting changed). */
export const repaintTheme = () => repaintAll();

/**
 * DeepLore's accent (Settings › Interface › Look › Accent color): written onto SillyTavern's page as --dle-accent-pick,
 * where every DeepLore page (iframes too) reads its colors from; '' = the default (Mero's pink).
 */
export function setAccent(color) {
    const root = stDocument().documentElement, v = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '';
    if (root.style.getPropertyValue('--dle-accent-pick') === v) return;
    if (v) root.style.setProperty('--dle-accent-pick', v); else root.style.removeProperty('--dle-accent-pick');
    repaintAll();
}

/** Mero's color (an appearance option later). Repaints every followed page. */
export function setMeroColor(color) {
    meroColor = color || MERO_DEFAULT;
    repaintAll();
}
