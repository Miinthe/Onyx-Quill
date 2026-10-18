/**
 * LOCAL PATCH 2026-08-04 — pure decision logic for the New Run button.
 *
 * Extracted from the click handler in drawer-events.js so it can be tested in Node,
 * following the same convention as drawer-browse-pure.js / drawer-dismiss-pure.js.
 * No imports from SillyTavern or jQuery — keep it that way.
 *
 * Both functions here decide something that is expensive to get wrong: which run letter
 * a new playthrough opens as, and which of the chat's folders are scoped to that run.
 * A wrong answer applied silently is how a chat ends up filtered to a folder that does
 * not exist, injecting nothing.
 */

/**
 * Work out the next instance letter for a character.
 *
 * Reads the vault rather than assuming the current chat is the newest run — reopening
 * an older run to look something up must not regress the counter and hand out a letter
 * that is already in use.
 *
 * @param {Array<{customFields?: Record<string, any>}>} entries - vault index
 * @param {string} character - the chat's character value; only entries matching it count
 * @param {string} current - the chat's current instance letter (may be '' or an array value)
 * @returns {string|null} the next free letter, or null if 'z' is already taken
 */
export function nextInstanceLetter(entries, character, current) {
    const used = new Set();
    const want = String(character || '').trim();
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const ec = e?.customFields?.character;
        const ecs = Array.isArray(ec) ? ec : [ec];
        if (!ecs.some(v => String(v ?? '').trim() === want)) continue;
        const ei = e?.customFields?.instance;
        for (const v of (Array.isArray(ei) ? ei : [ei])) {
            const s = String(v ?? '').trim().toLowerCase();
            if (/^[a-z]$/.test(s)) used.add(s);
        }
    }
    const cur = String(Array.isArray(current) ? current[0] : (current ?? '')).trim().toLowerCase();
    if (/^[a-z]$/.test(cur)) used.add(cur);
    if (!used.size) return 'a';
    const highest = [...used].sort().pop();
    const next = String.fromCharCode(highest.charCodeAt(0) + 1);
    return next > 'z' ? null : next;
}

/**
 * Does this folder's own name encode the given run letter?
 *
 * Boundary-anchored on purpose. A bare substring test matches the "c" inside "Instance",
 * so `3 Instance C` would be rewritten to `3 InstanDe C`.
 *
 * @param {string} leaf - the folder's own name, not its full path
 * @param {string} letter
 * @returns {boolean}
 */
export function leafEncodesLetter(leaf, letter) {
    const l = String(leaf ?? '').toLowerCase().trim();
    const L = String(letter ?? '').toLowerCase();
    if (!L) return false;
    return new RegExp(`(^|[^a-z])${L}([^a-z]|$)`).test(l);
}

/**
 * Rewrite the run-scoped folders in a filter for a new letter, leaving the rest alone.
 *
 * Only the folder's OWN name is considered, never the full path — a lorebook called
 * "03 Character; A Story" must not be treated as run-scoped just because its name
 * happens to contain a standalone letter somewhere upstream of the leaf.
 *
 * @param {string[]} folders - the chat's folder filter
 * @param {string} current - the run letter being replaced
 * @param {string} next - the new run letter
 * @returns {{folders: string[], swapped: Array<{from: string, to: string}>}}
 */
export function swapInstanceFolders(folders, current, next) {
    const cur = String(Array.isArray(current) ? current[0] : (current ?? '')).trim();
    const swapped = [];
    const out = (Array.isArray(folders) ? folders : []).map((f) => {
        const path = String(f ?? '');
        const cut = path.lastIndexOf('/');
        const leaf = cut >= 0 ? path.slice(cut + 1) : path;
        if (!cur || !leafEncodesLetter(leaf, cur)) return path;
        const newLeaf = leaf.replace(
            new RegExp(`(^|[^a-zA-Z])${cur}([^a-zA-Z]|$)`, 'i'),
            (_m, before, after) => `${before}${String(next).toUpperCase()}${after}`,
        );
        const newPath = path.slice(0, path.length - leaf.length) + newLeaf;
        swapped.push({ from: path, to: newPath });
        return newPath;
    });
    return { folders: out, swapped };
}
