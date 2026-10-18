/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — which gating fields the Filters tab shows.
 *
 * Pure; no SillyTavern, no jQuery. Her vault defines eight fields, and four of them
 * (era, world, character_present, scene_type) are carried by no entry at all — they
 * only cluttered the tab. A field is shown when an entry uses it, OR when it currently
 * holds a value (so a value that is set can never become invisible), OR when the
 * author asked to see everything.
 *
 * @param {Array<{name:string, contextKey:string}>} defs - enabled field definitions
 * @param {Array<{customFields?:object}>} entries - vault index
 * @param {object|null} ctx - chat_metadata.deeplore_context
 * @param {boolean} showAll
 * @returns {{ visible: object[], hidden: object[] }}
 */
export function splitGatingFields(defs, entries, ctx, showAll) {
    const has = v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
    const used = new Set();
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const cf = e?.customFields;
        if (!cf) continue;
        for (const fd of defs) if (!used.has(fd.name) && has(cf[fd.name])) used.add(fd.name);
    }
    const visible = [];
    const hidden = [];
    for (const fd of (Array.isArray(defs) ? defs : [])) {
        if (showAll || used.has(fd.name) || has(ctx?.[fd.contextKey])) visible.push(fd);
        else hidden.push(fd);
    }
    return { visible, hidden };
}
