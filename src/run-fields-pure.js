/**
 * Onyx Quill — the two fields runs depend on (Miinthe, 2026-11-06: New run asked for a Character that a fresh install had
 * no field for — "it should be a default filter option … or make it not deletable AT ALL").
 *
 * `character` says whose story a note belongs to, `instance` which run (A, B, …). New run, Branch here as a new run,
 * Scribe and New lore read and write them, so they are always defined: built in for a new vault, added to a
 * field-definitions file that lacks them, and never removed or renamed in the rule builder.
 * Moderate, not strict: a chat that sets no character / run yet leaves no note out (with strict, any board's
 * Characters Present made every note with a `character:` line vanish in a fresh vault). A vault's own file decides for itself.
 */

export const RUN_FIELDS = Object.freeze([
    Object.freeze({
        name: 'character', label: 'Character (whose story)', type: 'string', multi: true,
        gating: Object.freeze({ enabled: true, operator: 'match_any', tolerance: 'moderate' }), values: Object.freeze([]), contextKey: 'character',
    }),
    Object.freeze({
        name: 'instance', label: 'Run (A, B, …)', type: 'string', multi: true,
        gating: Object.freeze({ enabled: true, operator: 'match_any', tolerance: 'moderate' }), values: Object.freeze([]), contextKey: 'instance',
    }),
]);
export const RUN_FIELD_NAMES = new Set(RUN_FIELDS.map(f => f.name));

const copy = f => ({ ...f, gating: { ...f.gating }, values: [...f.values] });

/** A loaded definitions list with the run fields added in front when it lacks them (an empty list stays empty: the defaults have them). */
export function withRunFields(defs) {
    if (!Array.isArray(defs) || !defs.length) return defs;
    const have = new Set(defs.map(d => d?.name));
    const add = RUN_FIELDS.filter(f => !have.has(f.name)).map(copy);
    return add.length ? [...add, ...defs] : defs;
}

/** Fresh copies of the run fields, for the built-in defaults. */
export const runFieldCopies = () => RUN_FIELDS.map(copy);
