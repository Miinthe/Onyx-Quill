/**
 * DeepLore — settings migration pure helpers.
 *
 * Extracted so version-to-version transformations can be regression-tested
 * without ST globals. NO imports from ST modules. NO imports from state.js.
 *
 * Consumed by `settings.js` (`runMigrations()` is re-exported from there for
 * call-site compatibility) and `test/regression.test.mjs` (PRX-MIG suite).
 *
 * When adding a new migration step:
 *   1. Bump `defaultSettings.settingsVersion` in `settings.js`.
 *   2. Add `if (fromVersion < N)` branch here.
 *   3. Add regression test(s) — at minimum: from-v(N-1)-applies, from-vN-is-noop,
 *      no-op-when-nothing-to-do, idempotent.
 */

/**
 * Per-feature settings keys whose value gets flipped from 'proxy' → 'profile' in the v2.5
 * migration. Order matters: the boot popup highlights the FIRST entry that flipped, so this
 * is also the precedence order for "which dropdown gets the pulse-glow first." The visible
 * label is i18n-resolved at popup-render time (see _maybeShowProxyDeprecationNotice in
 * index.js) — these are the canonical mode-key identifiers.
 */
export const PROXY_DEPRECATION_MODE_KEYS = [
    'aiSearchConnectionMode',
    'scribeConnectionMode',
    'aiNotepadConnectionMode',
    'autoSuggestConnectionMode',
    'optimizeKeysConnectionMode',
];

/**
 * Pure version-to-version settings migration. Mutates `settings` in place.
 * Idempotent per-branch: each `if (fromVersion < N)` gate fires at most once,
 * so callers that re-invoke after a partial run (e.g. settings reload) don't
 * re-apply migrations.
 *
 * @param {object} settings - Settings object (mutated in place).
 * @param {number} fromVersion - Stored version (`settings.settingsVersion`, or 0 if unset).
 * @param {number} [_toVersion] - Target version (currently unused; kept for future fan-out).
 */
export function runMigrations(settings, fromVersion, _toVersion) {
    if (fromVersion < 1) {
        // 0 → 1: initial versioned settings (no-op).
        if (settings.debugMode) console.log('[DLE] Migrating settings to version 1');
    }
    // 1 → 2 and 2 → 3 only touched the retired Librarian's keys; step 6 drops those keys, so both are no-ops now.
    if (fromVersion < 4) {
        // 3 → 4: Custom Proxy connection mode removed in v2.5. Any per-feature mode
        // currently set to 'proxy' flips to 'profile'. We do NOT touch *ProxyUrl keys
        // (kept for rollback) and we do NOT touch profileId — the user may need to
        // pick a profile, which is the point of the post-migration popup.
        //
        // Sentinel: settings._proxyMigrationV2_5_notice = [modeKey, …] — consumed
        // by _maybeShowProxyDeprecationNotice() at boot, then cleared. Only set when
        // at least one key actually flipped (no popup for users who weren't on proxy).
        const migratedKeys = [];
        for (const key of PROXY_DEPRECATION_MODE_KEYS) {
            if (settings[key] === 'proxy') {
                settings[key] = 'profile';
                migratedKeys.push(key);
            }
        }
        if (migratedKeys.length > 0) {
            settings._proxyMigrationV2_5_notice = migratedKeys;
            console.warn('[DLE] v2.5 migration: flipped Custom Proxy mode to Connection Profile for:', migratedKeys);
        }
    }
    if (fromVersion < 5) {
        // 4 → 5: WI parity (Wave 4) added wiImportEmHandling setting.
        // Defensive default — every read site already does `|| 'append'` so
        // missing values work, but populate explicitly so the settings-popup
        // dropdown renders correctly for upgrading users (validateSettings
        // doesn't merge missing-then-default keys for non-numeric fields).
        if (settings.wiImportEmHandling == null) {
            settings.wiImportEmHandling = 'append';
        }
    }
    if (fromVersion < 6) {
        // 5 → 6 (Miinthe's fork, 2026-10-19): the Librarian is removed (Mero ☆ replaced it). Drop its saved settings
        // quietly. The writing-guide tag keeps its old key name (librarianGuideTag) — it is a vault setting.
        for (const key of Object.keys(settings)) {
            if (key.startsWith('librarian') && key !== 'librarianGuideTag') delete settings[key];
        }
        if (settings.analyticsData && typeof settings.analyticsData === 'object') delete settings.analyticsData._librarian;
        if (Array.isArray(settings._proxyMigrationV2_5_notice)) {
            const left = settings._proxyMigrationV2_5_notice.filter(k => !String(k).startsWith('librarian'));
            if (left.length) settings._proxyMigrationV2_5_notice = left; else delete settings._proxyMigrationV2_5_notice;
        }
    }
    if (fromVersion < 7) {
        // 6 → 7 (2026-11-02, Miinthe: "finally remove emma from my code"): the writing-guide tag drops the Librarian's name.
        if (typeof settings.librarianGuideTag === 'string' && settings.guideTag == null) settings.guideTag = settings.librarianGuideTag;
        delete settings.librarianGuideTag;
    }
}
