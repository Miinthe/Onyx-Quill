/**
 * LOCAL PATCH (Miinthe, 2026-10-02) — Story trackers. Pure rules only; no SillyTavern,
 * no jQuery, so every rule is testable in Node (test/trackers.test.mjs).
 *
 * WHAT A TRACKER IS
 * -----------------
 * A named, ordered list of steps and a pointer: "Relationship" at Friends of
 * Strangers → Neighbours → Friends → Sweethearts → Married, "The Broken Fuse" at
 * Sparks. The author moves it with ◀ ▶. Nothing advances it on its own.
 *
 * It is a TRACKER, NOT A FILTER — Miinthe's decision, 2026-10-02. It never touches
 * DeepLore's gating fields and never hides an entry. It TELLS: the current step
 * of every tracker goes to the writer (a short block in the reply prompt) and to
 * the judge (so it can pick lore that fits where the story stands). Current step
 * only, never the next one — naming the next step is what pushes a slow burn.
 *
 * WHERE THE STATE LIVES
 * ---------------------
 * `chat_metadata.deeplore_trackers`, per chat — never the vault. The position
 * belongs to THIS run: a delete rewinds it, a branch asks first, and New Run
 * starts every tracker again at step 1.
 *
 *     [ { name, steps: string[], index, aside, journal: [{ i, index, aside }] }, … ]   (display order)
 *
 * DETOURS (Miinthe, 2026-10-03, decision A1): a detour such as Dragon's *Nuisance* sits
 * outside the ordered steps. It is an `aside` on the tracker — set and cleared by hand —
 * while the step itself stays where it is: "Relationship: Close Friend — currently:
 * Nuisance". Asides are journalled with the step, so a delete or a branch rolls them
 * back too.
 */

export const TRACKERS_KEY = 'deeplore_trackers';

/** Split typed steps: commas, line breaks or |. Never spaces — a step can be several words. */
function splitSteps(text) {
    return String(text ?? '').split(/[,|\n]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Validate a step list.
 * @returns {{ ok: true, steps: string[] } | { ok: false, error: string }}
 */
export function checkSteps(steps) {
    if (steps.length < 2) {
        const got = steps[0] ? `only one step was read: "${steps[0]}"` : 'no steps were read';
        return { ok: false, error: `${got}. Put each step on its own line, or a comma between them` };
    }
    const seen = new Set();
    for (const s of steps) {
        const k = s.toLowerCase();
        if (seen.has(k)) return { ok: false, error: `"${s}" appears twice` };
        seen.add(k);
    }
    return { ok: true, steps };
}

/** The steps typed into the tracker box: one per line (commas and | also work). */
export function parseStepsText(text) {
    return checkSteps(splitSteps(text));
}

/**
 * Parse the command form `Name = Step 1, Step 2, …`.
 * @returns {{ ok: true, name, steps } | { ok: false, error }}
 */
export function parseTrackerSpec(text) {
    const raw = String(text ?? '');
    const eq = raw.indexOf('=');
    if (eq === -1) return { ok: false, error: 'usage' };
    const name = raw.slice(0, eq).trim();
    if (!name) return { ok: false, error: 'the tracker needs a name before the =' };
    const r = checkSteps(splitSteps(raw.slice(eq + 1)));
    return r.ok ? { ok: true, name, steps: r.steps } : r;
}

/** Normalise stored trackers to a clean array (tolerates a missing or damaged value). */
export function asList(stored) {
    return (Array.isArray(stored) ? stored : [])
        .filter(t => t && typeof t.name === 'string' && Array.isArray(t.steps) && t.steps.length);
}

export function findIndex(list, name) {
    const k = String(name ?? '').trim().toLowerCase();
    return list.findIndex(t => t.name.toLowerCase() === k);
}

function clamp(t, index) {
    return Math.min(Math.max(Math.floor(Number(index) || 0), 0), t.steps.length - 1);
}

/** A fresh tracker at step 1, journalled from the start of the chat. */
export function newTracker(name, steps) {
    return { name, steps: [...steps], index: 0, aside: null, journal: [{ i: 0, index: 0, aside: null }] };
}

const cleanAside = a => (typeof a === 'string' && a.trim() ? a.trim() : null);

/**
 * Record a move: one entry per message index, newest answer wins.
 * `meta` (Miinthe, 2026-10-03 — the timeline): who moved it ('auto' | 'hand' | 'undo'),
 * when (`at`, ISO), and for automatic moves the quote, reason and confidence.
 */
export function record(journal, messageIndex, index, aside = null, meta = null) {
    const list = (Array.isArray(journal) ? journal : []).filter(e => e && e.i !== messageIndex);
    if (Number.isFinite(messageIndex) && messageIndex >= 0) list.push({ i: Math.floor(messageIndex), index, aside: cleanAside(aside), ...(meta || {}) });
    list.sort((a, b) => a.i - b.i);
    return list.length > 500 ? list.slice(list.length - 500) : list;
}

/** The journal entry in force at `messageIndex`, or null. */
export function entryAt(journal, messageIndex) {
    let found = null;
    for (const e of (Array.isArray(journal) ? journal : [])) {
        if (e && Number.isFinite(e.i) && e.i <= messageIndex) found = e;
        else if (e && e.i > messageIndex) break;
    }
    return found;
}

export function pruneAfter(journal, messageIndex, keep = null) {
    return (Array.isArray(journal) ? journal : []).filter(e => e && Number.isFinite(e.i) && (e.i <= messageIndex || (keep && keep(e))));
}

// LOCAL PATCH (Miinthe, 2026-10-05): forks (forks-pure.js) — every journal entry carries the
// tracker's fork state, so a rewind to any message restores the branches with the step.
const forkSnap = t => ({
    ...(t.took && typeof t.took === 'object' && Object.keys(t.took).length ? { took: { ...t.took } } : {}),
    ...(t.ended ? { ended: { ...t.ended } } : {}),
    ...(t.run ? { run: t.run } : {}),   // paused / abandoned (runTracker) — a delete puts it back too
});

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — bug fix found by the engine characterization tests: a tracker that came from
 * the board window had NO journal, so its first move was journalled without a starting point — deleting back to
 * before that move restored nothing (it stayed where the helper had put it). Every tracker now gets its starting
 * point (where it stands when first read, at message 0) before anything moves it. Trackers that already moved
 * before this fix keep their journal as it is.
 */
export function withBaseline(t) {
    if (!t || (Array.isArray(t.journal) && t.journal.length)) return t;
    return { ...t, journal: record([], 0, clamp(t, t.index ?? 0), t.aside ?? null, forkSnap(t)) };
}

/** Move to `toIndex` (clamped), journalled at `messageIndex`. */
export function moveTo(t, toIndex, messageIndex, meta = null) {
    const index = clamp(t, toIndex);
    return { ...t, index, journal: record(t.journal, messageIndex ?? 0, index, t.aside, { ...(meta || {}), ...forkSnap(t) }) };
}



/** "paused" / "abandoned" / … for notices. */
export const RUN_WORDS = { pause: 'paused', continue: 'running again', abandon: 'abandoned — back to the start, switched off in this chat', reactivate: 'switched back on, from the start' };


/** Remember a refused automatic move for the timeline (last 50; pruned like the journal). */
export function recordRefusal(t, messageIndex, r) {
    const list = (Array.isArray(t.refused) ? t.refused : []).concat([{ i: Math.floor(messageIndex || 0), ...r }]);
    return { ...t, refused: list.slice(-50) };
}

/**
 * Edit a tracker's steps. Keeps the current step when it is still in the list
 * (so fixing a typo elsewhere does not reset the story); otherwise step 1.
 */
export function withSteps(t, steps) {
    const cur = String(t.steps[clamp(t, t.index)] ?? '').toLowerCase();
    const keep = steps.findIndex(s => s.toLowerCase() === cur);
    const index = keep >= 0 ? keep : 0;
    return { ...t, steps: [...steps], index, journal: keep >= 0 ? t.journal : [{ i: 0, index: 0, aside: cleanAside(t.aside) }] };
}

export function currentStep(t) {
    return t.steps[clamp(t, t.index)];
}


/** New Run: steps kept, every tracker back at step 1 with a fresh journal. */
export function resetForNewRun(list) {
    // Steps and settings carry over; position, detour, history and undo memory do not.
    return list.map(t => ({ ...newTracker(t.name, t.steps), direction: t.direction === 'forward' ? 'forward' : 'both', skip: t.skip === true }));
}

/** "Close Friend" or "Close Friend — currently: Nuisance". */
export function describe(t) {
    const a = cleanAside(t.aside);
    return a ? `${currentStep(t)} — currently: ${a}` : currentStep(t);
}

/**
 * The lines the writer and the judge see. Current step only (plus any aside).
 * @returns {string} e.g. "Relationship: Friends\nThe Broken Fuse: Sparks", or '' with no trackers
 */
export function stateLines(list) {
    return list.map(t => `${t.name}: ${describe(t)}${forkLine(t)}`).join('\n');
}

// LOCAL PATCH (Miinthe, 2026-10-05): forks — the branches taken (never the open ones: naming the
// ways ahead would push the story, like naming the next step). Same text as forks-pure forkNote.
function forkLine(t) {
    if (t.ended?.branch) return ` (ended — ${t.ended.branch})`;
    const took = t.took && typeof t.took === 'object' ? Object.entries(t.took) : [];
    return took.length ? ` (${took.map(([s, b]) => `after ${s}: ${b}`).join('; ')})` : '';
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — entries linked to a tracker step.
 * An entry with `storyStep {tracker, steps}` is available only while that tracker
 * (in this chat) stands at one of its steps; at Friends, the Married entry does not
 * exist for the judge or the writer, whatever the chat says. Entries without a link
 * — and links to a tracker this chat does not have — are untouched. A step name
 * that is not on the tracker never matches (hidden), so a typo shows as "missing",
 * never as lore running ahead.
 */
export function storyStepAllows(entry, trackers, isActive = () => true) {
    const link = entry?.storyStep;
    if (!link) return true;
    const t = asList(trackers).find(x => x.name.toLowerCase() === String(link.tracker).toLowerCase());
    if (!t) return true;
    if (!isActive(t)) return false;   // a waiting or paused tracker's lore stays hidden
    const cur = String(currentStep(t) ?? '').toLowerCase();
    return link.steps.some(s => String(s).toLowerCase() === cur);
}

/** The snapshot without entries for other steps; pinned entries always stay. */
export function filterByStoryStep(entries, trackers, isPinned = () => false, isActive = () => true) {
    if (!asList(trackers).length) return entries;
    return entries.filter(e => storyStepAllows(e, trackers, isActive) || isPinned(e));
}

/** The block injected into the reply prompt. Empty string clears it. */
export function writerBlock(list, extraLines = []) {
    // LOCAL PATCH (Miinthe, 2026-10-05): + the board's kept items and money (collections-pure.js)
    const lines = [stateLines(list), ...extraLines].filter(Boolean).join('\n');
    return lines ? `[Where the story currently stands]\n${lines}\n[End of story state]` : '';
}
