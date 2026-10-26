/**
 * Pure model-classification helper (moved here from src/librarian/agentic-api-pure.js when that folder was
 * removed, 2026-10-19) so the regex contract is unit-testable without standing up ST mocks.
 *
 * No imports from ST modules. Keep it that way.
 */

/**
 * Detect Claude regardless of provider source — covers OpenRouter relays
 * (`anthropic/claude-*`) that source-only checks miss. Gates Claude-specific
 * request mitigations (thinking-vs-tool_choice 400 sidestep, `json_schema`
 * skip on Claude routes).
 *
 * Pure form: takes an explicit model string, returns boolean (no model → false).
 *
 * @param {string|null|undefined} model
 * @returns {boolean}
 */
export function isUnderlyingClaudeModel(model) {
    if (!model || typeof model !== 'string') return false;
    return /^claude-/i.test(model) || /^anthropic\/claude/i.test(model);
}
