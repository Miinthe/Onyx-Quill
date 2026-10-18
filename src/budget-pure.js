/**
 * Overhaul (Miinthe, 2026-10-05; built 2026-10-17) — budgets per chat and per character: "the most specific wins:
 * chat → run → character → board → everywhere". Pure; tested in test/budget.test.mjs.
 *
 * Everywhere is today's four settings (maxTokensBudget + unlimitedBudget, maxEntries + unlimitedEntries) — read as
 * they are, never moved. A more specific place may set its own, as an override:
 *   { tokens?: number, entries?: number }      0 = no limit · missing = follow the next place down
 * Kept for a chat in chat_metadata[CHAT_BUDGET_KEY], for a character in settings.characterBudgets[avatar].
 * The run and board layers are understood here so they can be added later; the settings window shows chat,
 * character and everywhere only (a board's own budget, if one is ever made, stays a board setting).
 * Tokens and entries are resolved separately: a chat can set only its token budget and keep the character's count.
 */

export const CHAT_BUDGET_KEY = 'deeplore_budget';
/** From most specific to least (everywhere comes last, from the settings). */
export const BUDGET_LAYERS = ['chat', 'run', 'character', 'board'];
export const PARTS = {
    tokens: { max: 'maxTokensBudget', unlimited: 'unlimitedBudget', min: 100, top: 100000 },
    entries: { max: 'maxEntries', unlimited: 'unlimitedEntries', min: 1, top: 100 },
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** One part's override, tidied: 0 (no limit), a number in range, or undefined (not set). */
export function cleanPart(part, v) {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return undefined;
    if (n === 0) return 0;
    const p = PARTS[part];
    return Math.max(p.min, Math.min(p.top, Math.round(n)));
}

/** A stored override, tidied ({} when nothing is set). Unknown keys are dropped. */
export function cleanBudget(raw) {
    const out = {};
    if (!isObj(raw)) return out;
    for (const part of Object.keys(PARTS)) { const v = cleanPart(part, raw[part]); if (v !== undefined) out[part] = v; }
    return out;
}

/** Set (value) or clear (undefined) one part of an override → a new override ({} = nothing set). */
export function withPart(raw, part, value) {
    const out = cleanBudget(raw);
    const v = cleanPart(part, value);
    if (v === undefined) delete out[part]; else out[part] = v;
    return out;
}

/** Everywhere's value of a part, as an override number (0 = no limit). */
export function everywherePart(settings, part) {
    const p = PARTS[part];
    return settings?.[p.unlimited] ? 0 : Number(settings?.[p.max]) || 0;
}

/**
 * The budget that counts. `layers`: { chat, run, character, board } overrides (any may be missing).
 * → { maxTokensBudget, unlimitedBudget, maxEntries, unlimitedEntries, from: { tokens, entries } } where `from` is the
 * layer each part came from ('chat' … 'everywhere').
 */
export function resolveBudget(settings, layers = {}) {
    const out = { from: {} };
    for (const [part, p] of Object.entries(PARTS)) {
        let v, from = 'everywhere';
        for (const L of BUDGET_LAYERS) {
            const x = cleanBudget(layers?.[L])[part];
            if (x !== undefined) { v = x; from = L; break; }
        }
        if (from === 'everywhere') {
            out[p.max] = settings?.[p.max];
            out[p.unlimited] = !!settings?.[p.unlimited];
        } else if (v === 0) {
            out[p.max] = settings?.[p.max];   // the number is not used while there is no limit
            out[p.unlimited] = true;
        } else {
            out[p.max] = v;
            out[p.unlimited] = false;
        }
        out.from[part] = from;
    }
    return out;
}

/** The four settings keys of a resolved budget (to lay over a settings snapshot). */
export const budgetKeys = r => ({ maxTokensBudget: r.maxTokensBudget, unlimitedBudget: r.unlimitedBudget, maxEntries: r.maxEntries, unlimitedEntries: r.unlimitedEntries });

/** A part's value in words: "4000 tokens", "no limit", "10 entries". */
export function partText(part, v) {
    if (v === 0) return 'no limit';
    return part === 'tokens' ? `${v} tokens` : `${v} ${v === 1 ? 'entry' : 'entries'}`;
}

/** Where a value comes from, in words, for a badge ("this chat", "from Kettle", "from Everywhere"). */
export function fromText(from, { here = null, characterName = 'the character' } = {}) {
    if (from === here) return here === 'chat' ? 'this chat' : here === 'character' ? characterName : here;
    if (from === 'chat') return 'from this chat';
    if (from === 'character') return `from ${characterName}`;
    if (from === 'run') return 'from the run';
    if (from === 'board') return 'from the board';
    return 'from Everywhere';
}
