/**
 * Onyx Quill start-up (2026-11-03): imported by index.js before anything reads the settings.
 * The rules are in onyx-start-pure.js.
 */
import * as ST from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { moveSettings, findDeepLore } from './onyx-start-pure.js';

// 1. settings move-over (copies only; the old DeepLore-named settings stay as they are)
try {
    const moved = moveSettings(ST.extension_settings);
    if (moved.length) {
        console.info(`[Onyx Quill] settings copied from their DeepLore names: ${moved.join(', ')}`);
        saveSettingsDebounced();
    }
} catch (err) { console.warn('[Onyx Quill] settings move-over failed', err); }

// 2. the original DeepLore switched on too?
let clash = '';
try {
    const manifestOf = typeof ST.getExtensionManifest === 'function' ? ST.getExtensionManifest : () => null;
    clash = findDeepLore(ST.extensionNames, manifestOf, ST.extension_settings?.disabledExtensions);
} catch { clash = ''; }

/** The original DeepLore's extension name when it is switched on (then Onyx Quill stays off), else ''. */
export const deepLoreClash = clash;

/** Tell the user once, and keep the notice up until they close it. */
export function showClashNotice() {
    const say = () => {
        try {
            globalThis.toastr?.error(
                'The original DeepLore is switched on too. Onyx Quill is built on it, and the two can\'t run at the same time — '
                + 'Onyx Quill stays off for now. Turn one of them off in Extensions → Manage extensions, then reload the page.',
                'Onyx Quill', { timeOut: 0, extendedTimeOut: 0, closeButton: true, preventDuplicates: true });
        } catch { /* noop */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', say, { once: true }); else setTimeout(say, 1500);
}
