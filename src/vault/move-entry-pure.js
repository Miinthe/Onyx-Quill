/**
 * LOCAL PATCH 2026-08-04 — the move-entry safety sequence, extracted so it can be tested.
 *
 * No imports at all. `vault.js` resolves the vault credentials and hands the three IO
 * functions in; everything that decides anything lives here.
 *
 * THE ORDER IS THE FEATURE. This is the only code path in DeepLore that deletes a file
 * from the lore vault, so it is written to be all-or-nothing:
 *
 *   1. refuse a no-op (same folder)
 *   2. refuse if ANYTHING already exists at the destination — never overwrite, never merge.
 *      A failed *check* also refuses: "I could not see it" is not "it is not there".
 *   3. read the original; abort if it cannot be read
 *   4. write the copy
 *   5. read the copy BACK and compare byte-for-byte with the original
 *   6. only then delete the original
 *
 * If 4 or 5 fails, the copy is removed and nothing is deleted — the vault ends up exactly
 * as it started. If 6 fails, the copy is likewise removed, so a failed delete does not
 * leave the entry existing twice. Only a rollback that ITSELF fails leaves a duplicate,
 * and that is reported loudly because a duplicate title is a health-check error.
 *
 * The rollback deletes only the path this function just wrote, which is safe **because
 * step 2 proved nothing was there beforehand**. Weaken step 2 and the rollback becomes
 * dangerous — the two belong together.
 */

/**
 * @param {object} opts
 * @param {string} opts.from - vault-relative path of the entry to move
 * @param {string} opts.destFolder - destination folder ('' = vault root)
 * @param {{read: Function, write: Function, del: Function}} opts.io - vault operations,
 *   each already bound to a vault: read(path) → {ok, content, status, error},
 *   write(path, content) → {ok, error}, del(path) → {ok, error}
 * @param {(msg: string) => void} [opts.log] - optional progress/telemetry sink
 * @returns {Promise<{ok: boolean, from: string, to: string, error?: string,
 *                    rolledBack?: boolean, orphaned?: boolean}>}
 */
export async function moveEntry({ from, destFolder, io, log = () => {} }) {
    const base = from.includes('/') ? from.slice(from.lastIndexOf('/') + 1) : from;
    const cleanFolder = String(destFolder || '').replace(/^\/+|\/+$/g, '');
    const to = cleanFolder ? `${cleanFolder}/${base}` : base;

    if (to === from) {
        return { ok: false, from, to, error: 'That entry is already in this folder.' };
    }

    // 2. Destination must be empty. A transport error is NOT treated as "free".
    const occupied = await io.read(to);
    if (occupied.ok) {
        return { ok: false, from, to, error: `Something already exists at "${to}". Nothing was moved.` };
    }
    if (occupied.status === 0) {
        return { ok: false, from, to, error: `Could not check the destination (${occupied.error}). Nothing was moved.` };
    }

    // 3. Read the original.
    const original = await io.read(from);
    if (!original.ok) {
        return { ok: false, from, to, error: `Could not read "${from}" (${original.error}). Nothing was moved.` };
    }

    // 4. Write the copy.
    const written = await io.write(to, original.content);
    if (!written.ok) {
        return { ok: false, from, to, error: `Could not write "${to}" (${written.error}). Nothing was moved.` };
    }

    // Undo the copy WE just wrote. Safe only because step 2 proved the slot was empty.
    const rollback = async (why) => {
        const undone = await io.del(to);
        if (undone.ok) {
            log(`move rolled back (${why})`);
            return { ok: false, from, to, rolledBack: true, error: `${why} Nothing was moved — "${from}" is untouched and the partial copy was removed.` };
        }
        return {
            ok: false, from, to, orphaned: true,
            error: `${why} "${from}" is untouched, but the copy at "${to}" could not be removed (${undone.error}). Delete "${to}" by hand — until you do, the index will show a duplicate title.`,
        };
    };

    // 5. Prove the copy matches before destroying anything.
    const verify = await io.read(to);
    if (!verify.ok || verify.content !== original.content) {
        return await rollback(`The copy at "${to}" did not match the original.`);
    }

    // 6. Only now remove the original.
    const removed = await io.del(from);
    if (!removed.ok) {
        return await rollback(`Could not delete "${from}" (${removed.error}).`);
    }

    log(`moved ${from} -> ${to}`);
    return { ok: true, from, to };
}
