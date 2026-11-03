/**
 * Onyx Quill start-up checks (2026-11-03) — no SillyTavern imports, so the tests can run it.
 *
 * 1. Settings move-over. Onyx Quill keeps its settings under its own names, so it never shares them with the
 *    original DeepLore. On the first start after the rename, each DeepLore-named setting is COPIED to its new
 *    name — only when the new name is still empty. The old copy stays where it was (the way back: an older
 *    version still finds everything as it was on the day of the switch).
 *    Data stored inside chats keeps its `deeplore_…` labels (decided 2026-11-03) and is not touched here.
 * 2. The original DeepLore switched on at the same time: both would hook into every reply and share the
 *    per-chat data, so Onyx Quill stays off and says so.
 */

/** old settings name → new settings name */
export const SETTINGS_MOVES = Object.freeze({
    deeplore_enhanced: 'onyxquill',
    deeplore_storyboards_v2: 'onyxquill_storyboards',
    deeplore_board_prefs: 'onyxquill_board_prefs',
    deeplore_characters: 'onyxquill_characters',
    deeplore_mero: 'onyxquill_mero',
    deeplore_slop: 'onyxquill_slop',
});

const copy = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * Copy every old setting whose new name is still empty. Returns the old names that were copied.
 * Never deletes or changes the old ones.
 */
export function moveSettings(ext) {
    const moved = [];
    if (!ext || typeof ext !== 'object') return moved;
    for (const [from, to] of Object.entries(SETTINGS_MOVES)) {
        if (ext[to] !== undefined || ext[from] === undefined || ext[from] === null) continue;
        ext[to] = copy(ext[from]);
        moved.push(from);
    }
    return moved;
}

/** The original DeepLore's reply hook — only it uses this name (Onyx Quill's is `onyxQuill_onGenerate`). */
export const DEEPLORE_HOOK = 'deepLoreEnhanced_onGenerate';

/**
 * The original DeepLore, if it is installed AND switched on: its extension name, else ''.
 * `names` = SillyTavern's extension names; `manifestOf(name)` = that extension's manifest (or null);
 * `disabled` = SillyTavern's list of switched-off extensions.
 */
export function findDeepLore(names, manifestOf, disabled) {
    const off = new Set(Array.isArray(disabled) ? disabled : []);
    for (const name of Array.isArray(names) ? names : []) {
        if (off.has(name)) continue;
        let m = null;
        try { m = manifestOf(name); } catch { m = null; }
        if (m && m.generate_interceptor === DEEPLORE_HOOK) return name;
    }
    return '';
}
