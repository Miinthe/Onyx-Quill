/**
 * Onyx Quill — the one browser database (IndexedDB) shared by the vault cache
 * (src/vault/cache.js) and the "Why these entries" history (src/verdict/verdict-store.js).
 *
 * The database used to be called `DeepLoreEnhanced`. The vault cache simply rebuilds
 * under the new name; the `verdicts` store (past messages' history) is copied over
 * once, the first time the new database is created. The old database is never
 * deleted — the original DeepLore extension may still use it.
 */

export const DB_NAME = 'OnyxQuill';
export const LEGACY_DB_NAME = 'DeepLoreEnhanced';
// v2: `vaultCache` + `verdicts` stores. Both modules must use the same version so
// neither throws VersionError when the other has upgraded.
export const DB_VERSION = 2;
export const VAULT_STORE = 'vaultCache';
export const VERDICT_STORE = 'verdicts';

// The one-time copy of the old history: set the moment an upgrade creates the database (before any open of it can
// succeed), so every open — the vault cache's and the history's alike — waits for the copy, not only the one that
// created the database (else the open chat's history read an empty store once; bug hunt 2026-11-06).
let copyDone = null, copyFinished = null;

/** True when this open's upgrade created the database (onupgradeneeded event). */
export function isFreshDatabase(event) {
    const fresh = event?.oldVersion === 0;
    if (fresh && !copyDone) copyDone = new Promise(r => { copyFinished = r; });
    return fresh;
}

/**
 * Open the old database only if it already exists — opening an IndexedDB name
 * creates it, so a missing one is detected in onupgradeneeded and the creation
 * is aborted (an aborted first upgrade leaves no database behind).
 * @returns {Promise<IDBDatabase|null>}
 */
function openLegacyIfExists() {
    return new Promise((resolve) => {
        let request;
        try { request = indexedDB.open(LEGACY_DB_NAME); } catch { resolve(null); return; }
        let missing = false;
        request.onupgradeneeded = () => {
            missing = true;
            try { request.transaction.abort(); } catch { /* already aborting */ }
        };
        request.onsuccess = () => {
            if (missing) { try { request.result.close(); } catch { /* noop */ } resolve(null); return; }
            resolve(request.result);
        };
        request.onerror = (e) => { try { e?.preventDefault?.(); } catch { /* noop */ } resolve(null); };
        request.onblocked = () => resolve(null);
    });
}

/**
 * Copy every row of the old database's `verdicts` store into `db` (the new one).
 * Never throws; returns how many rows were copied.
 * @param {IDBDatabase} db
 * @returns {Promise<number>}
 */
export async function copyLegacyVerdicts(db) {
    let legacy = null;
    try {
        legacy = await openLegacyIfExists();
        if (!legacy || !legacy.objectStoreNames.contains(VERDICT_STORE)) return 0;
        const { keys, values } = await new Promise((resolve, reject) => {
            const tx = legacy.transaction(VERDICT_STORE, 'readonly');
            const store = tx.objectStore(VERDICT_STORE);
            const keyReq = store.getAllKeys();
            const valReq = store.getAll();
            tx.oncomplete = () => resolve({ keys: keyReq.result || [], values: valReq.result || [] });
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        if (!keys.length || keys.length !== values.length) return 0;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(VERDICT_STORE, 'readwrite');
            const store = tx.objectStore(VERDICT_STORE);
            for (let i = 0; i < keys.length; i++) store.put(values[i], keys[i]);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return keys.length;
    } catch (err) {
        console.warn('[Onyx Quill] Could not copy the old "Why these entries" history:', err?.message);
        return 0;
    } finally {
        try { legacy?.close(); } catch { /* noop */ }
    }
}

/**
 * Finish an open: when this open created the database, copy the old history over
 * first, then hand the database back. Any other open waits for that copy.
 * @param {IDBDatabase} db
 * @param {boolean} fresh
 * @returns {Promise<IDBDatabase>}
 */
export async function finishOpen(db, fresh) {
    if (fresh) {
        try { await copyLegacyVerdicts(db); } finally { copyFinished?.(); }
    } else if (copyDone) {
        // an open that failed after creating the database never finishes the copy: don't wait forever
        await Promise.race([copyDone, new Promise(r => setTimeout(r, 5000))]);
    }
    return db;
}
