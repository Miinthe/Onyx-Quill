/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — Re-evaluate + swipe (triggers + odds, part 3; roadmap §4 G2 point 5).
 * Pure rules; tested in test/reevaluate.test.mjs. The glue is src/reevaluate.js.
 *
 * A normal swipe keeps everything the board did for the reply (a swipe keeps the roll; the helper
 * skips swipes; the judge reuses its answer). Re-evaluate is the deliberate other one: it undoes
 * everything THIS TURN caused — the helper's moves, branches taken, rolls, triggers, items, places,
 * the clock, dates — runs the helper and the board again as if the message had just been sent,
 * makes the judge ask fresh, and then swipes.
 *
 * THE TURN of the newest reply: the messages after the previous AI reply up to the one before the
 * newest reply (usually just Miinthe's message). Everything recorded at those messages or later is
 * undone; the helper runs again on the messages up to the reply, recorded at the message before it
 * — exactly where it was recorded when the message was first sent.
 */

const isAi = m => !!m && !m.is_user && !m.is_system;

/**
 * The turn of the newest reply, or null when there is nothing to re-evaluate (no reply at the end,
 * or only a greeting). { reply, start, keep, at }: `keep` — the last message whose changes stay;
 * `at` — the message the helper records at (the one before the reply).
 */
export function turnOf(chat) {
    const c = Array.isArray(chat) ? chat : [];
    const reply = c.length - 1;
    if (reply < 1 || !isAi(c[reply])) return null;
    let prev = reply - 1;
    while (prev >= 0 && !isAi(c[prev])) prev--;
    const start = prev + 1;
    if (start > reply - 1) return null;          // two AI replies in a row: no message of Miinthe's to re-read
    return { reply, start, keep: start - 1, at: reply - 1 };
}

/**
 * What re-evaluating would undo, for the confirmation: tracker moves (journal entries) and board
 * changes (the v2 state's log) recorded at `start` or later. Returns { lines: string[], count }.
 */
export function turnChanges(trackers, boardLog, start) {
    const lines = [];
    const steps = (Array.isArray(boardLog) ? boardLog : []).filter(e => e?.kind === 'step' && e.i >= start);
    for (const t of Array.isArray(trackers) ? trackers : []) {
        // engine on v2, step 7: from the v2 log when it has the moves (one per message, like the list's history did)
        const own = steps.filter(e => e.col === t.id && !(e.from && !e.from.started && e.to?.started && e.from.at == null));
        const moved = t.lastMoveAt !== undefined ? [...new Set(own.map(e => e.i))] : (Array.isArray(t.journal) ? t.journal : []).filter(e => e && Number.isFinite(e.i) && e.i >= start);
        if (moved.length) lines.push(`${t.name}: ${moved.length === 1 ? 'a move' : moved.length + ' moves'}`);
        if (t.startedAt && t.startedAt.i >= start) lines.push(`${t.name}: started`);
    }
    const kinds = { item: 'item', money: 'money', place: 'place', state: 'time / weather', date: 'date', roll: 'roll', trigger: 'trigger' };
    const counts = {};
    for (const e of Array.isArray(boardLog) ? boardLog : []) if (e && e.i >= start && kinds[e.kind]) counts[e.kind] = (counts[e.kind] || 0) + 1;
    for (const [k, n] of Object.entries(counts)) lines.push(`${n} ${kinds[k]} change${n > 1 ? 's' : ''}`.replace('roll changes', 'rolls').replace('roll change', 'roll').replace('trigger changes', 'triggers fired').replace('trigger change', 'trigger fired'));
    return { lines, count: lines.length };
}

/** Undo memory that pointed at this turn is dropped (its Undo would refer to a move that is gone). */
export function forgetTurnUndo(t, start) {
    let out = t;
    if (out.lastAuto && Number.isFinite(out.lastAuto.message) && out.lastAuto.message >= start) { const { lastAuto: _a, ...r } = out; out = r; }
    if (out.lastTrigger && Number.isFinite(out.lastTrigger.message) && out.lastTrigger.message >= start) { const { lastTrigger: _t, ...r } = out; out = r; }
    return out;
}
