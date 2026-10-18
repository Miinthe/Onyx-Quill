/**
 * Overhaul (built 2026-10-17) — where new entries go and how they are marked (Settings › Story & memory › New
 * entries). Miinthe's idea: entries file themselves — about this run → the run's folder, about the character → the
 * character's base folder. Pure; tested in test/budget.test.mjs.
 *
 * "About the run" = an entry of type `story` (what happened in this run); every other type (character, location,
 * lore, organization) is lasting and goes with the character. A chat with no folders yet (no character, no run
 * folders) uses the Target folder — as does "always the Target folder".
 */

const arr = v => (Array.isArray(v) ? v : []);
const tidy = f => String(f ?? '').trim().replace(/^\/+|\/+$/g, '');

/**
 * The folder for a new entry.
 * @param {object} o { type, mode: 'about' | 'target', target, base: [folders], run: [folders] }
 * @returns {{ folder: string, why: 'run' | 'character' | 'target' }}
 */
export function newEntryFolder({ type = 'lore', mode = 'about', target = '', base = [], run = [] } = {}) {
    const t = tidy(target);
    if (mode !== 'about') return { folder: t, why: 'target' };
    const b = arr(base).map(tidy).find(Boolean), r = arr(run).map(tidy).find(Boolean);
    if (type === 'story' && r) return { folder: r, why: 'run' };
    if (b) return { folder: b, why: 'character' };
    if (r) return { folder: r, why: 'run' };
    return { folder: t, why: 'target' };
}

/** The folder for each kind of entry, by the same rule: { story: 'Kitchen/Run A', lore: 'Characters/Kettle', … }. */
export function foldersByType(rule = {}, types = []) {
    return Object.fromEntries(arr(types).map(type => [type, newEntryFolder({ ...rule, type }).folder]));
}

/** The marks for a new entry (Mark them on): who made it, where from. The date is always in the run stamp. */
export function entryMarks({ chat = '', message = null } = {}) {
    const from = [chat ? `“${chat}”` : '', Number.isFinite(message) ? `message ${message}` : ''].filter(Boolean).join(' · ');
    return { madeBy: 'Mero', ...(from ? { from } : {}), tags: ['made-by-mero'] };
}

const yamlStr = v => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
/** The marks as frontmatter lines (each ending in "\n"); '' when there are none. */
export function marksYaml(m) {
    if (!m) return '';
    return (m.madeBy ? `made_by: ${m.madeBy}\n` : '') + (m.from ? `from: ${yamlStr(m.from)}\n` : '');
}
