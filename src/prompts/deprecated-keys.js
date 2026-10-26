/**
 * DeepLore — Deprecated prompt keys allowlist.
 *
 * Layer 2 of the delete cage (see `prompt-validators.js`) refuses to delete
 * any vault prompt file whose stem is not a recognized key. This breaks
 * forward compat for one case: a prompt key that USED to exist but was
 * removed in a later version. Those orphan files would be undeletable.
 *
 * Solution: keys removed from the canonical EN dict get added here.
 * The cage accepts: { current canonical EN keys } ∪ DEPRECATED_PROMPT_KEYS.
 *
 * Add keys here ONLY when removing them from `src/i18n/prompts/en.js`.
 * Never speculative additions — that would weaken the whitelist.
 *
 * @type {Set<string>}
 */
export const DEPRECATED_PROMPT_KEYS = new Set([
    // Removed 2026-10-19 with the old writer engine (its greetings, primer, Q&A script and tool-loop pieces). An old prompt
    // file for one of these in the vault stays deletable; Settings › Prompts doesn't list them (prompts-tab.js).
    'EMMA_FIRSTRUN_GREETING',
    'EMMA_ADHOC_GREETING',
    'EMMA_AUDIT_GREETING',
    'LIBRARIAN_PRIMER',
    'LIBRARIAN_FIRSTRUN_QA_SCRIPT',
    'AGENTIC_ROLE_SECTION',
    'AGENTIC_FENCE_CHARACTER_HEADER',
    'AGENTIC_FENCE_SCENARIO_HEADER',
    'AGENTIC_FENCE_LORE_CONTEXT_HEADER',
    'AGENTIC_FENCE_INJECTED_TITLES_HEADER',
    'AGENTIC_FENCE_NOTEBOOK_HEADER',
    'AGENTIC_FENCE_NOTEPAD_HEADER',
    'AGENTIC_FENCE_SCRIBE_HEADER',
    'AGENTIC_TOOLS_INTRO',
    'AGENTIC_TOOL_SEARCH',
    'AGENTIC_TOOL_WRITE',
    'AGENTIC_TOOL_WRITE_FLAG_HINT',
    'AGENTIC_TOOL_FLAG',
    'AGENTIC_WORKFLOW',
    'AGENTIC_WORKFLOW_STEP_SEARCH',
    'AGENTIC_WORKFLOW_STEP_WRITE',
    'AGENTIC_WORKFLOW_STEP_FLAG',
    'AGENTIC_WORKFLOW_STEP_END',
    'AGENTIC_IMPORTANT_FINAL',
]);
