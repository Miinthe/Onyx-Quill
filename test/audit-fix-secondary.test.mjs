/**
 * DeepLore Enhanced — Secondary-feature audit-fix tests
 *
 * Pure-logic coverage for the drawer / graph / cartographer
 * audit fixes (P3-9..P3-11). (P3-7 went with the Librarian, 2026-10-19.) Only ST-free, node-importable pure helpers are
 * exercised here; the ST-importing wiring (navigateToBrowseEntry arg shape,
 * graph.js titleToIdx build, cartographer obsidian handler) is verified by
 * source inspection / manual UAT and mirrors the pure logic tested below.
 *
 *   P3-9  — Browse nav title-resolution honors vaultSource (resolveNavTarget).
 *   P3-9  — nav-key normalization contract (string vs {title, vaultSource}).
 *   P3-10 — Graph cycle detection resolves a bare title to ALL matching nodes
 *           (detectCircular, the same Map<title, idx[]> shape graph.js now uses).
 *
 * Run with: node test/audit-fix-secondary.test.mjs
 */

import { resolveNavTarget } from '../src/drawer/drawer-browse-pure.js';
import { detectCircular } from '../src/graph/graph-health.js';
import { test, section, summary, assert, assertEqual } from './helpers.mjs';

// ─────────────────────────────────────────────────────────────────────────────
section('P3-9 — resolveNavTarget honors vaultSource (cross-vault same-title nav)');

const navEntries = [
    { title: 'Castle', vaultSource: 'VaultA', folderPath: 'Places' },
    { title: 'Castle', vaultSource: 'VaultB', folderPath: 'Lore' },
    { title: 'Alice', vaultSource: 'VaultA', folderPath: '' },
];

test('exact title+vaultSource resolves the RIGHT cross-vault row', () => {
    const a = resolveNavTarget(navEntries, 'Castle', 'VaultA');
    const b = resolveNavTarget(navEntries, 'Castle', 'VaultB');
    assertEqual(a.vaultSource, 'VaultA', 'Castle@VaultA resolves to VaultA');
    assertEqual(b.vaultSource, 'VaultB', 'Castle@VaultB resolves to VaultB — NOT first-wins');
});

test('null vaultSource falls back to title-only (back-compat / single-vault)', () => {
    const r = resolveNavTarget(navEntries, 'Castle', null);
    assert(r !== null && r.title === 'Castle', 'title-only resolves first Castle');
    assertEqual(r.vaultSource, 'VaultA', 'first-appearance Castle for legacy callers');
});

test('vaultSource given but no exact match → title-only fallback (renamed/filtered vault)', () => {
    const r = resolveNavTarget(navEntries, 'Castle', 'VaultGONE');
    assert(r !== null, 'still lands on a Castle rather than null');
    assertEqual(r.title, 'Castle', 'falls back to title-only match');
});

test('unique title resolves regardless of vaultSource arg', () => {
    assertEqual(resolveNavTarget(navEntries, 'Alice', 'VaultA').vaultSource, 'VaultA', 'exact');
    assertEqual(resolveNavTarget(navEntries, 'Alice', null).vaultSource, 'VaultA', 'title-only');
});

test('no match returns null; empty/invalid inputs are safe', () => {
    assertEqual(resolveNavTarget(navEntries, 'Nope', 'VaultA'), null, 'absent title → null');
    assertEqual(resolveNavTarget(navEntries, '', 'VaultA'), null, 'empty title → null');
    assertEqual(resolveNavTarget(null, 'Castle', 'VaultA'), null, 'non-array → null');
});

// ─────────────────────────────────────────────────────────────────────────────
section('P3-9 — navigateToBrowseEntry arg-shape normalization contract');

// Mirror the normalization logic in src/drawer/drawer.js navigateToBrowseEntry().
// Kept in lockstep with the source; documents the string|object contract.
function normalizeNavArg(target) {
    const title = typeof target === 'string' ? target : (target?.title || '');
    const vaultSource = typeof target === 'string' ? null : (target?.vaultSource ?? null);
    return { title, vaultSource };
}

test('bare string → title with null vaultSource (back-compat path)', () => {
    assertEqual(normalizeNavArg('Castle'), { title: 'Castle', vaultSource: null }, 'string form');
});

test('object form threads both title and vaultSource', () => {
    assertEqual(
        normalizeNavArg({ title: 'Castle', vaultSource: 'VaultB' }),
        { title: 'Castle', vaultSource: 'VaultB' },
        'object form',
    );
});

test('object with empty vaultSource preserves "" (single-vault entries)', () => {
    assertEqual(
        normalizeNavArg({ title: 'Castle', vaultSource: '' }),
        { title: 'Castle', vaultSource: '' },
        'empty-string vault kept (not coerced to null)',
    );
});

test('object missing vaultSource → null companion', () => {
    assertEqual(normalizeNavArg({ title: 'Castle' }), { title: 'Castle', vaultSource: null }, 'absent vault');
});

// ─────────────────────────────────────────────────────────────────────────────
section('P3-10 — detectCircular resolves a bare title to ALL matching node indices');

test('cross-vault same-title cycle is detected (was dropped under first-wins)', () => {
    // Two vaults each have "A" and "B". A requires B; B requires A. Under the old
    // first-wins title map, only the FIRST "A"/"B" indices were edge targets, so a
    // cycle through the SECOND vault's twins was silently missed.
    const entries = [
        { title: 'A', vaultSource: 'V1', requires: ['B'] }, // 0
        { title: 'B', vaultSource: 'V1', requires: ['A'] }, // 1
        { title: 'A', vaultSource: 'V2', requires: ['B'] }, // 2
        { title: 'B', vaultSource: 'V2', requires: ['A'] }, // 3
    ];
    const cycles = detectCircular(entries);
    assert(cycles.length > 0, 'at least one cycle detected across cross-vault twins');
    // Every reported back-edge must be a real A<->B title relation.
    for (const c of cycles) {
        const ok = (c.fromTitle === 'A' && c.toTitle === 'B') || (c.fromTitle === 'B' && c.toTitle === 'A');
        assert(ok, `back-edge is an A/B relation (got ${c.fromTitle}->${c.toTitle})`);
    }
});

test('a single requires:[Twin] reaches BOTH same-titled targets (idx[] resolution)', () => {
    // "Hub" requires "Leaf". There are two "Leaf" entries (cross-vault). One of them
    // (Leaf@V2) requires "Hub" back → a cycle. First-wins would only edge Hub→Leaf@V1
    // and miss the Hub<->Leaf@V2 cycle entirely.
    const entries = [
        { title: 'Hub', vaultSource: 'V1', requires: ['Leaf'] },  // 0
        { title: 'Leaf', vaultSource: 'V1', requires: [] },        // 1 (no back-edge)
        { title: 'Leaf', vaultSource: 'V2', requires: ['Hub'] },   // 2 (back-edge → cycle)
    ];
    const cycles = detectCircular(entries);
    assert(cycles.length > 0, 'Hub<->Leaf@V2 cycle found because Hub edges to BOTH Leaf nodes');
});

test('no cycle when twins are acyclic (no false positives)', () => {
    const entries = [
        { title: 'Root', vaultSource: 'V1', cascadeLinks: ['Child'] },
        { title: 'Child', vaultSource: 'V1', cascadeLinks: [] },
        { title: 'Child', vaultSource: 'V2', cascadeLinks: [] },
    ];
    assertEqual(detectCircular(entries).length, 0, 'acyclic cross-vault tree → no cycles');
});

await summary('Audit-Fix Secondary Tests');
