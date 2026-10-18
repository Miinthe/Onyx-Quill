/**
 * Overhaul (2026-10-16) — the new look for DeepLore's older pop-ups.
 *
 * Many DeepLore windows are still SillyTavern pop-ups (callGenericPopup) filled with the old `.dle-*` markup: the
 * graph, Browse, Why, health check, the notebooks, the setup wizard, the confirms… Rather than rebuild each one,
 * every pop-up DeepLore opens gets the class `dle-skin`, and legacy-skin.css (loaded with frame.css) restyles it in
 * the kit's colors, fonts, buttons, fields and tables. The old FontAwesome icons inside are drawn as the kit's line
 * icons (a CSS mask per icon name, so an icon that changes class — a chevron that opens — follows by itself).
 *
 * How a pop-up is recognized as DeepLore's: SillyTavern's Popup.show() is wrapped once; when the call comes from
 * DeepLore's own files (its URL is on the call stack) the dialog is marked before it appears. A pop-up whose
 * content carries `.dle-*` markup is marked too, whoever opened it.
 */
import { Popup } from '../../../../../popup.js';
import { ICONS } from './icons.js';

const ROOT = new URL('../../', import.meta.url).href;   // the extension's folder
const OURS = '[class*="dle-"], [id^="dle-"]';

/** FontAwesome name → kit icon. Unlisted names keep their FontAwesome glyph (spinners, rare ones). */
export const FA_MAP = {
    'xmark': 'close', 'circle-xmark': 'close', 'check': 'check', 'circle-check': 'check', 'square-check': 'check',
    'chevron-right': 'right', 'chevron-left': 'left', 'chevron-down': 'down', 'chevron-up': 'up', 'caret-down': 'down', 'caret-right': 'right',
    'rotate-left': 'undo', 'arrow-rotate-left': 'undo', 'rotate-right': 'refresh', 'arrows-rotate': 'refresh', 'rotate': 'refresh', 'sync': 'refresh',
    'magnifying-glass': 'search', 'magnifying-glass-chart': 'search', 'search': 'search',
    'circle-info': 'info', 'info-circle': 'info', 'circle-question': 'why', 'question-circle': 'why',
    'triangle-exclamation': 'warn', 'circle-exclamation': 'warn', 'exclamation-triangle': 'warn',
    'wand-magic-sparkles': 'wand', 'wand-magic': 'wand', 'hat-wizard': 'wand',
    'ban': 'block', 'thumbtack': 'pinI', 'trash': 'trash', 'trash-can': 'trash',
    'pen-to-square': 'edit', 'pen': 'edit', 'pencil': 'edit', 'file-import': 'import', 'download': 'import', 'arrow-right-to-bracket': 'import',
    'file-export': 'export', 'arrow-up-from-bracket': 'export', 'upload': 'export',
    'copy': 'copy', 'clipboard': 'copy', 'stop': 'stop', 'pause': 'pause', 'play': 'play', 'paper-plane': 'send',
    'gear': 'settings', 'gears': 'settings', 'sliders': 'settings', 'wrench': 'settings',
    'stethoscope': 'health', 'shield-halved': 'lock', 'lock': 'lock', 'unlock': 'unlock',
    'robot': 'ai', 'brain': 'ai', 'lightbulb': 'pitch', 'flask': 'test', 'floppy-disk': 'save',
    'clock-rotate-left': 'history', 'clock': 'clock', 'book-open': 'book', 'book-bookmark': 'book', 'book-open-reader': 'book', 'book': 'book',
    'up-right-from-square': 'popout', 'arrow-up-right-from-square': 'popout', 'plus': 'plus', 'plus-circle': 'plus', 'circle-plus': 'plus',
    'folder': 'group', 'folder-open': 'group', 'folder-plus': 'folder', 'filter': 'filter', 'filter-circle-xmark': 'filter',
    'database': 'vault', 'code-branch': 'newrun', 'grip': 'grip', 'grip-vertical': 'grip', 'ellipsis-vertical': 'more', 'ellipsis': 'more',
    'dice': 'reroll', 'link': 'link', 'link-slash': 'unlink', 'plug': 'plug', 'flag': 'flag', 'eraser': 'undo', 'broom': 'undo',
    'scissors': 'cut', 'eye': 'eye', 'diagram-project': 'graph', 'hand': 'stop', 'list': 'notes', 'list-check': 'check',
    'feather': 'scribe', 'feather-pointed': 'scribe', 'comments': 'talks', 'comment': 'talks', 'star': 'mero', 'inbox': 'inbox',
};

function maskUrl(name) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name].replace(/currentColor/g, '#000')}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The CSS that draws mapped FontAwesome icons as kit line icons inside a skinned pop-up. */
export function iconMaskCss(scope = ':is(dialog.dle-skin, [id="dle-panel-librarian"])') {
    const byIcon = {};
    for (const [fa, ic] of Object.entries(FA_MAP)) if (ICONS[ic]) (byIcon[ic] ||= []).push(fa);
    let css = `${scope} :is(${Object.keys(FA_MAP).map(f => '.fa-' + f).join(',')})::before { content: '' !important; display: inline-block; width: 1.05em; height: 1.05em; vertical-align: -0.16em; background: currentColor; -webkit-mask: var(--dk-fa) center / contain no-repeat; mask: var(--dk-fa) center / contain no-repeat; }\n`;
    for (const [ic, fas] of Object.entries(byIcon)) css += `${scope} :is(${fas.map(f => '.fa-' + f).join(',')}) { --dk-fa: ${maskUrl(ic)}; }\n`;
    return css;
}

let started = false;
/** Wire once (SillyTavern's page only). */
/**
 * DeepLore's messages (SillyTavern's toastr) in the new look (bug hunt 2026-10-17: ~295 of them were still the old
 * colored boxes). Only a class is added — found the same way as the pop-ups, by DeepLore's own code being the caller —
 * so clicks, Undo links, progress messages and clearing work exactly as before.
 */
function skinToasts() {
    const T = globalThis.toastr;
    if (!T || T.__dleSkin) return;
    for (const kind of ['info', 'success', 'warning', 'error']) {
        const orig = T[kind];
        if (typeof orig !== 'function') continue;
        T[kind] = function (message, title, opts) {
            try {
                const fromUs = String(new Error().stack || '').split('\n').some(l => l.includes(ROOT) && !l.includes('/kit/legacy-skin.js'));
                if (fromUs) opts = { ...(opts || {}), toastClass: `${opts?.toastClass || T.options?.toastClass || 'toast'} dle-toast dle-toast-${kind}` };
            } catch { /* never block a message */ }
            return orig.call(this, message, title, opts);
        };
    }
    T.__dleSkin = true;
}

export function initLegacySkin(doc = document) {
    if (started) return;
    started = true;
    if (!doc.querySelector('style[data-dk="fa-map"]')) {
        const s = doc.createElement('style'); s.dataset.dk = 'fa-map'; s.textContent = iconMaskCss();
        (doc.head || doc.documentElement).append(s);
    }
    skinToasts();
    const show = Popup?.prototype?.show;
    if (typeof show !== 'function' || show.__dleSkin) return;
    const wrapped = function (...args) {
        try {
            const fromUs = String(new Error().stack || '').split('\n').some(l => l.includes(ROOT) && !l.includes('/kit/legacy-skin.js'));
            const ours = fromUs || !!this.content?.querySelector?.(OURS);
            if (ours) this.dlg?.classList.add('dle-skin');
        } catch { /* never block a pop-up */ }
        return show.apply(this, args);
    };
    wrapped.__dleSkin = true;
    Popup.prototype.show = wrapped;
}
