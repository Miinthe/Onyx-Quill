/**
 * LOCAL PATCH (Miinthe, 2026-11-02) — one chat-completion request WITH tools, through SillyTavern's Connection Manager
 * (Mero's lookups; the rounds are run in mero.js). Kept apart from callAI: callAI turns every answer into plain text,
 * and a tool round needs the raw message (its tool_calls, and DeepSeek's reasoning to send back).
 *
 * SillyTavern passes `tools` / `tool_choice` on to the provider (chat-completions.js, the same path as its own function
 * calling) and keeps `tool` messages and `tool_calls` when it merges the prompt for tool-capable sources.
 * Text-completion profiles (a local model through the text API) can't do tools: toolsPossible() says no, and Mero
 * answers the old way.
 */
import { ConnectionManagerRequestService } from '../../../../shared.js';
import { readReply } from '../mero-tools-pure.js';

/** Can this profile carry tools at all? (Chat completion, not text completion.) */
export function toolsPossible(profileId) {
    try {
        const p = ConnectionManagerRequestService.getProfile(profileId);
        return !!p && ConnectionManagerRequestService.validateProfile(p)?.selected === 'openai';
    } catch { return false; }
}

/**
 * One request. messages: OpenAI-style (system, user, assistant with tool_calls, tool). choice 'none' = "answer now"
 * (the tools stay listed: some providers refuse tool messages in the history without them).
 * conn: resolveConnectionConfig('mero'). Returns { text, calls: [{ id, name, args }], reasoning }.
 */
export async function callWithTools(messages, tools, conn, { signal = null, choice = 'auto' } = {}) {
    const controller = new AbortController();
    const timeout = Math.max(15000, Number(conn.timeout) || 120000);
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const over = {};
    if (conn.model) over.model = conn.model;
    if (tools?.length) { over.tools = tools; over.tool_choice = choice; }
    try {
        const json = await ConnectionManagerRequestService.sendRequest(conn.profileId, messages, Number(conn.maxTokens) || 1500,
            { stream: false, signal: controller.signal, extractData: false, includePreset: false, includeInstruct: false }, over);
        const r = readReply(json);
        return choice === 'none' ? { ...r, calls: [] } : r;
    } catch (err) {
        const e = err?.message === 'API request failed' && err.cause ? err.cause : err;
        if (controller.signal.aborted && !signal?.aborted) throw new Error(`Request timed out (${Math.round(timeout / 1000)}s)`);
        throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
}
