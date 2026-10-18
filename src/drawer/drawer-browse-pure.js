/**
 * Pure helpers for the Browse tab — folder grouping + selection math.
 *
 * No imports from ST modules or jQuery. Keep it that way so test/unit.mjs
 * can import without standing up the harness.
 *
 * Row-model contract:
 *   [{ type: 'header', folder, count, expanded, groupIndex }, { type: 'entry', entry, folder, groupIndex }, ...]
 *
 * Headers are virtual-scrollable rows just like entries — they occupy a row
 * slot. When grouping is OFF, the row model is just flat entry rows (no headers).
 * When a folder is COLLAPSED, its child entry rows are omitted from the model.
 */

const ROOT_LABEL = '(root)';

/**
 * Folder bucket for an entry — the entry's OWN folder, full path.
 *
 * LOCAL PATCH 2026-08-03 (Miinthe): this used to bucket on the first path segment only, so
 * 'Locations/Cities/Vire' grouped under 'Locations'. Where the subfolder IS the distinction
 * that matters, that erases exactly what you are looking for: all 68 entries under
 * `02 Regency` landed beneath a single header with base / modern / historical / dark
 * indistinguishable — and which flavour an entry belongs to is the entire point of that
 * scheme. Bucketing on the full path gives one header per real folder.
 *
 * The function name is kept so the four call sites (row model, collapse state, "select all
 * in folder", nav-target resolution) stay consistent — they all ask "which bucket is this
 * entry in", and they must all agree on the answer.
 *
 * @param {{folderPath?: string}} entry
 * @returns {string}
 */
export function topFolderOf(entry) {
    if (!entry || !entry.folderPath) return ROOT_LABEL;
    return String(entry.folderPath) || ROOT_LABEL;
}

/**
 * Build the row model the virtual-scroll renderer walks.
 *
 * @param {Array<object>} entries - already filtered + sorted
 * @param {object} opts
 * @param {boolean} [opts.grouping=false] - false → flat row list (current behavior)
 * @param {Set<string>|null} [opts.expandedFolders=null] - which top-folder names are expanded
 * @returns {Array<{type: string, folder?: string, entry?: object, count?: number, expanded?: boolean}>}
 */
export function buildBrowseRowModel(entries, opts = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const grouping = !!opts.grouping;
    if (!grouping) {
        return entries.map(e => ({ type: 'entry', entry: e, folder: topFolderOf(e) }));
    }

    const expandedFolders = opts.expandedFolders instanceof Set ? opts.expandedFolders : null;

    // Stable bucket order = order of first appearance in entries (preserves sort).
    const bucketOrder = [];
    const buckets = new Map();
    for (const e of entries) {
        const folder = topFolderOf(e);
        if (!buckets.has(folder)) {
            bucketOrder.push(folder);
            buckets.set(folder, []);
        }
        buckets.get(folder).push(e);
    }

    const rows = [];
    // LOCAL PATCH 2026-08-03 (Miinthe): stamp each group with its ordinal so the renderer can
    // alternate the left accent bar between consecutive folders. It must come from the MODEL,
    // not from render order — the list is virtualised, so the renderer only ever sees a
    // window of rows and its own loop index would flip the colours as you scroll.
    let groupIndex = 0;
    for (const folder of bucketOrder) {
        const group = buckets.get(folder);
        // Default expanded = true (no Set means everything open); explicit Set means
        // only listed folders are expanded.
        const expanded = expandedFolders ? expandedFolders.has(folder) : true;
        rows.push({ type: 'header', folder, count: group.length, expanded, groupIndex });
        if (expanded) {
            for (const e of group) {
                rows.push({ type: 'entry', entry: e, folder, groupIndex });
            }
        }
        groupIndex++;
    }
    return rows;
}

/**
 * Collect distinct top-folder names across the entry list. Used to seed the
 * "expand all" / "collapse all" actions on first render.
 *
 * @param {Array<object>} entries
 * @returns {string[]} sorted unique folder names
 */
export function listTopFolders(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const seen = new Set();
    for (const e of entries) seen.add(topFolderOf(e));
    return [...seen].sort();
}

/**
 * Resolve a Browse-tab navigation target to its entry (P3-9, gotcha #50).
 *
 * Two cross-vault entries can share a title; a bare-title `find(e => e.title === t)`
 * opens whichever appears first, which may be the WRONG vault's row. When a
 * vaultSource is supplied, match on BOTH title and vaultSource. When it's null/''
 * (legacy callers, single-vault), fall back to title-only for back-compat.
 *
 * @param {Array<object>} entries - the filtered Browse list
 * @param {string} title
 * @param {string|null} [vaultSource=null]
 * @returns {object|null} the matched entry, or null
 */
export function resolveNavTarget(entries, title, vaultSource = null) {
    if (!Array.isArray(entries) || !title) return null;
    if (vaultSource) {
        const exact = entries.find(e => e.title === title && (e.vaultSource || '') === vaultSource);
        if (exact) return exact;
        // vaultSource given but no exact match (e.g. vault renamed/filtered out) —
        // fall through to title-only so the nav still lands somewhere sensible.
    }
    return entries.find(e => e.title === title) || null;
}

/**
 * Return the trackerKey-equivalent strings for entries that belong to a given
 * top-folder bucket. Used for "select all in folder" wiring.
 *
 * @param {Array<object>} entries
 * @param {string} folder
 * @param {(entry: object) => string} keyFn - usually trackerKey from state.js
 * @returns {string[]}
 */
export function entryKeysInFolder(entries, folder, keyFn) {
    if (!Array.isArray(entries) || typeof keyFn !== 'function') return [];
    const out = [];
    for (const e of entries) {
        if (topFolderOf(e) === folder) out.push(keyFn(e));
    }
    return out;
}
