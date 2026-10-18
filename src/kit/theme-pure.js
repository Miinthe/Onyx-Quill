/**
 * Overhaul step 1 (2026-10-15) — the shared colors, worked out from SillyTavern's live theme.
 *
 * Miinthe: "those are just the themes I use right now. there are more themes and you can also change the colors
 * yourself". So nothing here knows a theme by name: it reads ST's own color variables (text, italics, quote,
 * underline, tint, border) and builds every DeepLore color from them, then nudges each one until it is readable
 * on the background it sits on. Light themes (dark text) get a light DeepLore, dark themes a dark one.
 *
 * Pure: no DOM. Tested in test/kit.test.mjs (contrast on her themes, a light theme and odd custom colors).
 * Glue: src/kit/theme.js writes the result as --dk-* variables on each page (SillyTavern, the board, Mero's window).
 */

/** Mero's own color. One token, so a later appearance option can change it (overhaul plan, step 1). */
export const MERO_DEFAULT = '#ff4f98';

/** Fallbacks: SillyTavern's "Dark Lite" look, used when a variable is missing or unreadable. */
export const ST_FALLBACK = {
    text: 'rgb(220, 220, 210)', em: 'rgb(145, 145, 145)', quote: 'rgb(225, 138, 36)', under: 'rgb(188, 231, 207)',
    tint: 'rgb(23, 23, 23)', border: 'rgb(0, 0, 0)',
};

// ── color parsing ───────────────────────────────────────────────────────────

/** "#abc", "#aabbcc", "#aabbccdd", "rgb(…)", "rgba(…)" (comma or space form) → {r,g,b,a} 0–255 / 0–1, or null. */
export function parseColor(s) {
    const t = String(s ?? '').trim().toLowerCase();
    let m = t.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        const n = i => parseInt(h.slice(i, i + 2), 16);
        return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
    }
    m = t.match(/^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/);
    if (m) {
        const a = m[4] === undefined ? 1 : (m[5] ? Number(m[4]) / 100 : Number(m[4]));
        return { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]), a: Math.max(0, Math.min(1, a)) };
    }
    return null;
}
const clamp255 = v => Math.max(0, Math.min(255, v));
export const toHex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');

// ── sRGB ⇄ OKLab (mixing and lightening in OKLab keeps hues honest) ─────────

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function toOklab({ r, g, b }) {
    const R = lin(r), G = lin(g), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s };
}
export function fromOklab({ L, A, B }) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return { r: clamp255(gam(Math.max(0, Math.min(1, r)))), g: clamp255(gam(Math.max(0, Math.min(1, g)))), b: clamp255(gam(Math.max(0, Math.min(1, b)))), a: 1 };
}
/** `w` of `a` and the rest of `b`, in OKLab, opaque. */
export function mix(a, b, w) {
    const x = toOklab(a), y = toOklab(b);
    return fromOklab({ L: x.L * w + y.L * (1 - w), A: x.A * w + y.A * (1 - w), B: x.B * w + y.B * (1 - w) });
}
/** A see-through color laid over a solid one (what the eye sees). */
export const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });

// ── readability ─────────────────────────────────────────────────────────────

export const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG contrast ratio, 1–21. */
export function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Lighten or darken `c` (away from `bg`) in small steps until it reaches `min` contrast on `bg`. Keeps the hue. */
export function ensureContrast(c, bg, min) {
    if (contrast(c, bg) >= min) return c;
    const lab = toOklab(c), up = luminance(bg) < 0.18;
    for (let i = 1; i <= 50; i++) {
        const L = Math.max(0, Math.min(1, lab.L + (up ? 0.02 : -0.02) * i));
        const t = fromOklab({ L, A: lab.A * (1 - i / 60), B: lab.B * (1 - i / 60) });
        if (contrast(t, bg) >= min) return t;
    }
    return up ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
}

// ── the palette ─────────────────────────────────────────────────────────────

const C = s => parseColor(s);
const ANCHOR = {
    dark: { desk: C('#0d0f14'), page: C('#171a21'), accent: C('#7c9cff') },
    light: { desk: C('#e6e9ef'), page: C('#ffffff'), accent: C('#2c55c9') },
};
/** Fixed meaning colors per scheme (board v27's), nudged for readability on the page. */
const MEANING = {
    dark: { good: '#6fd19c', wait: '#e2b04f', bad: '#ff8a8a', info: '#6cc4f2' },
    light: { good: '#23784e', wait: '#a2690a', bad: '#b23b3b', info: '#2a86b8' },
};

/**
 * SillyTavern's theme values (strings as ST stores them) → { scheme, vars } where vars maps each --dk-* name to a
 * hex color. `mero` is Mero's chosen color (any CSS hex/rgb), default MERO_DEFAULT.
 */
export function palette(st = {}, { mero = MERO_DEFAULT, scheme: forced = null } = {}) {
    const get = k => { const c = C(st[k]); return c && c.a > 0.05 ? c : C(ST_FALLBACK[k]); };
    const text0 = get('text');
    // light text = a dark theme; Settings › Interface › Look can force light or dark (the text is then made readable)
    const scheme = forced === 'light' || forced === 'dark' ? forced : luminance({ ...text0, a: 1 }) > 0.18 ? 'dark' : 'light';
    const A = ANCHOR[scheme];

    // ST's tint is usually see-through (Azure: 61%); DeepLore's surfaces are solid, so lay it over the anchor.
    // A tint that fights the scheme (a white tint under white text) is ignored instead of making text unreadable.
    let tint = over(get('tint'), A.page);
    if ((scheme === 'dark') !== (luminance(tint) < 0.18)) tint = A.page;
    const page = mix(tint, A.page, 0.6);
    const desk = mix(page, A.desk, 0.55);
    const menu = mix(page, A.desk, 0.82);

    const ink = ensureContrast(over(text0, page), page, 7);
    const muted = ensureContrast(mix(ink, page, 0.66), page, 4.5);
    const border = over(get('border'), page);
    const line = mix(mix(ink, page, 0.17), border, 0.8);
    const lineStrong = mix(ink, page, 0.32);

    // The accent follows the theme's quote color, half-blended with DeepLore's blue (the approved mock-ups' mix),
    // so a gray or very pale quote color still gives a clear accent.
    const accent = ensureContrast(mix(get('quote'), A.accent, 0.5), page, 3);
    const accentInk = ensureContrast(accent, page, 4.5);
    const onAccent = contrast(C('#ffffff'), accent) >= contrast(C('#101216'), accent) ? C('#ffffff') : C('#101216');
    const accentSoft = mix(accent, page, 0.16);
    const selected = mix(accent, page, 0.3);

    const meroBase = C(mero) || C(MERO_DEFAULT);
    const meroC = ensureContrast(scheme === 'dark' ? mix(meroBase, C('#ffffff'), 0.85) : meroBase, page, 4.5);
    const onMero = contrast(C('#ffffff'), meroC) >= contrast(C('#101216'), meroC) ? C('#ffffff') : C('#101216');

    const vars = {
        desk, page, menu, ink, muted, line, 'line-strong': lineStrong,
        accent, 'accent-ink': accentInk, 'on-accent': onAccent, 'accent-soft': accentSoft, selected,
        mero: meroC, 'on-mero': onMero, 'mero-soft': mix(meroC, page, 0.16),
    };
    for (const [k, v] of Object.entries(MEANING[scheme])) {
        const c = ensureContrast(C(v), page, 4.5);
        vars[k] = c; vars[k + '-soft'] = mix(c, page, 0.16);
    }
    const out = {};
    for (const [k, v] of Object.entries(vars)) out['--dk-' + k] = toHex(v);
    return { scheme, vars: out };
}

/** Is this an ST theme value DeepLore reads? (names of SillyTavern's own CSS variables) */
export const ST_VARS = {
    text: '--SmartThemeBodyColor', em: '--SmartThemeEmColor', quote: '--SmartThemeQuoteColor',
    under: '--SmartThemeUnderlineColor', tint: '--SmartThemeBlurTintColor', border: '--SmartThemeBorderColor',
};
