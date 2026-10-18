/**
 * LOCAL PATCH 2026-08-04 — the ONLY generic vault delete in DeepLore, deliberately isolated.
 *
 * Upstream keeps an architectural cage (test/prompts-api.test.mjs, "L6"): `obsidian-api.js`
 * must not export a generic delete, so that the general-purpose vault layer — which nearly
 * every module imports — cannot remove a lore file. DELETE capability is confined to named,
 * auditable places. `deleteNote` originally landed in `obsidian-api.js` and broke that cage.
 *
 * It lives here instead. Anything that can delete a vault file must import THIS module by
 * name, which makes the capability greppable and reviewable. The cage's intent is
 * containment, not prohibition, so widening it from one file to two named files preserves
 * the property that matters.
 *
 * The only intended caller is `moveEntryToFolder` in vault.js, whose safety sequence
 * (move-entry-pure.js) never deletes anything until a byte-for-byte verified copy exists.
 */
import { obsidianFetch, validateVaultPath, encodeVaultPath } from './obsidian-api.js';

/**
 * LOCAL PATCH 2026-08-03 (Miinthe): delete a vault note. Added for the "move entry to
 * another folder" action in the Browse tab — DeepLore had `writeNote`/`readNote` but
 * no delete, so a move could only ever copy and leave the original behind.
 *
 * This is the ONLY code path in DeepLore that removes a file from the lore vault.
 * It is deliberately a dumb primitive: it deletes exactly the path it is given and
 * makes no decisions. Every safety check (does the destination already exist, did the
 * copy land, does the copy match byte-for-byte) belongs to the caller — see
 * `moveEntryToFolder` in vault.js, which is the only intended caller.
 *
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filename - vault-relative path
 * @param {boolean} [useHttps=false]
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
export async function deleteNote(host, port, apiKey, filename, useHttps = false) {
    try {
        const normalizedPath = validateVaultPath(filename);
        const result = await obsidianFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'DELETE',
            accept: 'application/json',
        });
        if (result.status === 200 || result.status === 204) {
            return { ok: true, status: result.status };
        }
        return { ok: false, status: result.status, error: `HTTP ${result.status}: ${String(result.data ?? '').substring(0, 200)}` };
    } catch (err) {
        return { ok: false, status: 0, error: err.message };
    }
}
