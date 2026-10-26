/**
 * Mero's summary of a board, made quietly (Miinthe, 2026-10-26: "rather silent, I don't want it to hugely announce itself";
 * then: written when Mero needs it, editable in her talk's ⓘ view — one home). Rules in mero-board-pure.js.
 *
 * Before Mero answers: when the board's trackers changed since the last summary, ONE call on her connection writes a
 * line per tracker — nothing while Miinthe builds the board, nothing if she doesn't talk to Mero. No notice, no toast; a
 * failure only leaves the names-only summary. A summary Miinthe edited is never rewritten on its own: it is marked "the
 * board changed since" in the ⓘ view, and she decides.
 */
import { callAI } from './ai/ai.js';
import { resolveConnectionConfig } from '../settings.js';
import { vaultIndex } from './state.js';
import { getBoard, getMeroMap, setMeroMap } from './board-store.js';
import { mapHash, mapPrompt, parseMapAbouts, mapText } from './mero-board-pure.js';

const entryText = title => String((vaultIndex || []).find(e => e.title === title)?.content || '');
const running = new Map();   // board name → the call in flight (two quick saves share it)

/** Make (or remake) the summary. `force`: also over her own edit (her "Write it again"). Resolves the stored record. */
export function refreshMeroMap(name, { force = false } = {}) {
    if (running.has(name)) return running.get(name);
    const job = (async () => {
        const board = getBoard(name);
        if (!board) return null;
        const hash = mapHash(board), old = getMeroMap(name);
        if (!force && old && old.hash === hash) return old;                                   // nothing changed
        if (!force && old?.edited) { const m = { ...old, stale: true }; setMeroMap(name, m); return m; }   // hers: she decides
        let abouts = {};
        const conn = resolveConnectionConfig('mero');
        if (conn?.profileId) {
            try {
                const p = mapPrompt(board, entryText);
                const r = await callAI(p.system, p.user, { ...conn, maxTokens: 1200, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.2 });
                abouts = parseMapAbouts(r?.text);
            } catch (err) { console.warn('[DLE] Mero summary: not written this time —', err?.message || err); }
        }
        const m = { text: mapText(board, abouts), hash, at: new Date().toISOString() };
        setMeroMap(name, m);
        return m;
    })().finally(() => running.delete(name));
    running.set(name, job);
    return job;
}

/** Her own version (text), or back to the automatic one (null → written again). */
export function editMeroMap(name, text) {
    if (text == null) { const old = getMeroMap(name); if (old) setMeroMap(name, { ...old, edited: false, stale: false }); return refreshMeroMap(name, { force: true }); }
    const old = getMeroMap(name) || {}, board = getBoard(name);
    const m = { ...old, text: String(text).trim(), edited: true, stale: false, hash: board ? mapHash(board) : old.hash, at: new Date().toISOString() };
    setMeroMap(name, m);
    return Promise.resolve(m);
}
