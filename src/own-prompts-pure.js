/**
 * Overhaul (built 2026-10-17) — "+ Your own prompt": Miinthe's own prompt pieces, next to the built-in ones in
 * Settings › Prompts. Pure; tested in test/budget.test.mjs (with the other small 2026-10-17 settings rules).
 *
 * Stored in settings.ownPrompts: [{ id, name, text, position, depth, role }]. Each one with text goes into every
 * prompt, where it says — the same places DeepLore offers for its lore: before / after the main prompt, or in the
 * chat at a depth, as system / user / assistant. Its prompt slot is `deeplore_own_<id>` (cleared with DeepLore's
 * other parts before each reply, so a removed one is gone at the next reply).
 */

export const OWN_PREFIX = 'deeplore_own_';
const POSITIONS = [0, 1, 2];   // 0 after the main prompt · 1 in the chat · 2 before the main prompt (SillyTavern's numbers)

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };

/** One prompt, tidied (a missing place = after the main prompt, the mock-up's "after the character card"). */
export function cleanOwn(p, i = 0) {
    const o = isObj(p) ? p : {};
    const id = String(o.id || '').replace(/[^\w-]/g, '') || `p${i + 1}`;
    return {
        id,
        name: String(o.name ?? '').trim() || 'My prompt',
        text: String(o.text ?? ''),
        position: POSITIONS.includes(Number(o.position)) ? Number(o.position) : 0,
        depth: int(o.depth, 0, 9999, 4),
        role: int(o.role, 0, 2, 0),
    };
}

/** The stored list, tidied; ids unique. */
export function ownPrompts(raw) {
    const out = [], seen = new Set();
    (Array.isArray(raw) ? raw : []).forEach((p, i) => {
        const c = cleanOwn(p, i);
        let id = c.id, n = 2;
        while (seen.has(id)) id = `${c.id}-${n++}`;
        seen.add(id);
        out.push({ ...c, id });
    });
    return out;
}

/** A new id not in the list. */
export function newOwnId(list, now = Date.now()) {
    const ids = new Set(ownPrompts(list).map(p => p.id));
    let id = `p${now.toString(36)}`, n = 2;
    while (ids.has(id)) id = `p${now.toString(36)}${n++}`;
    return id;
}

/** What goes into the prompt: [{ slot, text, position, depth, role }] for each one with text. */
export function ownInjections(raw) {
    return ownPrompts(raw).filter(p => p.text.trim()).map(p => ({ slot: OWN_PREFIX + p.id, text: p.text.trim(), position: p.position, depth: p.depth, role: p.role }));
}

/** Where it goes, in words ("after the main prompt", "in the chat, depth 4, as user"). */
export function ownWhere(p) {
    const c = cleanOwn(p);
    if (c.position === 2) return 'before the main prompt';
    if (c.position === 0) return 'after the main prompt';
    return `in the chat, depth ${c.depth}${c.role ? `, as ${c.role === 1 ? 'user' : 'assistant'}` : ''}`;
}
