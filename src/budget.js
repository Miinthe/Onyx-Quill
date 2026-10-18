/**
 * Overhaul (built 2026-10-17) — budgets per chat and per character: SillyTavern glue. Rules: budget-pure.js.
 *   This chat       chat_metadata.deeplore_budget = { tokens?, entries? }      (0 = no limit)
 *   A character     settings.characterBudgets[avatar] = { tokens?, entries? }
 *   Everywhere      today's maxTokensBudget / unlimitedBudget / maxEntries / unlimitedEntries (unchanged)
 */
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { saveMetadataDebounced } from '../../../../extensions.js';
import { getSettings } from '../settings.js';
import { currentCharacter } from './characters.js';
import { CHAT_BUDGET_KEY, cleanBudget, withPart, resolveBudget, budgetKeys } from './budget-pure.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** This chat's own budget ({} = follows the character / Everywhere). */
export const chatBudget = () => cleanBudget(chat_metadata?.[CHAT_BUDGET_KEY]);
/** A character's own budget ({} = follows Everywhere). */
export function characterBudget(key) {
    const m = getSettings().characterBudgets;
    return key && isObj(m) ? cleanBudget(m[key]) : {};
}

/** Set (a number, 0 = no limit) or clear (undefined) one part of this chat's budget. */
export function setChatBudget(part, value) {
    if (!chat_metadata) return;
    const b = withPart(chat_metadata[CHAT_BUDGET_KEY], part, value);
    if (Object.keys(b).length) chat_metadata[CHAT_BUDGET_KEY] = b; else delete chat_metadata[CHAT_BUDGET_KEY];
    saveMetadataDebounced();
}
/** Set or clear one part of a character's budget. */
export function setCharacterBudget(key, part, value) {
    if (!key) return;
    const s = getSettings();
    if (!isObj(s.characterBudgets)) s.characterBudgets = {};
    const b = withPart(s.characterBudgets[key], part, value);
    if (Object.keys(b).length) s.characterBudgets[key] = b; else delete s.characterBudgets[key];
    saveSettingsDebounced();
}

/**
 * The budget for the open chat (most specific wins). `layers` can be given to look at another character
 * ({ character }) — the settings window does that. → resolveBudget's answer.
 */
export function effectiveBudget(settings = getSettings(), layers = null) {
    if (layers) return resolveBudget(settings, layers);
    let character = {};
    try { character = characterBudget(currentCharacter()?.key); } catch { /* no chat */ }
    return resolveBudget(settings, { chat: chatBudget(), character });
}

/** The four budget settings that count for the open chat (to lay over a settings snapshot). */
export function budgetOverlay(settings = getSettings()) {
    try { return budgetKeys(effectiveBudget(settings)); } catch (err) { console.warn('[DLE] budget: using Everywhere —', err?.message || err); return {}; }
}
