/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero's 📬 mailbox, step 3 (`10 co-writer design.md` §8, mock-ups v3–v13): the
 * requests, pure. A request is a question for Miinthe, grouped by who asks:
 *   🤖 from the board's helper — an unsure move (it holds the reply: `now`), a found item;
 *   ☆ from Mero, 🪜 from a plan — later steps.
 * Answered requests stay (with their result) in "Answered"; nothing expires (Miinthe, mock-up v9).
 *
 * When the helper asks (decided by Miinthe, 2026-10-03): per step (its own asking) or else per tracker ("Ask me at"):
 *   low (default) — only a low-confidence move · medium — low or medium · all — every move · never.
 * The board's "How often may the AI ask you?" can switch it off: "rarely", or "moves it isn't sure about" off.
 */
import { trackerOf, stepOf } from './board-model-pure.js';

export const REQ_KEY = 'deeplore_requests';
const arr = v => (Array.isArray(v) ? v : []);
const low = s => String(s ?? '').trim().toLowerCase();

/** How a move onto `toStepId` of tracker `trackerId` is asked about: 'low' | 'medium' | 'all' | 'never'. */
export function askLevel(board, trackerId, toStepId) {
    const a = board?.ask || {};
    if (a.unsure === false || a.level === 'rarely') return 'never';
    const t = trackerOf(board, trackerId);
    if (!t) return 'never';
    return stepOf(t, toStepId)?.ask || t.askAt || 'low';
}

/** Does a move with this confidence get asked at this level? (no confidence given: only "every move" asks) */
export function asks(level, confidence) {
    if (level === 'all') return true;
    if (level === 'medium') return confidence === 'low' || confidence === 'medium';
    if (level === 'low') return confidence === 'low';
    return false;
}

/**
 * The step a move goes to (for its asking): a branch — the step after which it is taken; else the target step.
 * `t` is the engine's tracker (names), `board` the v2 board.
 */
export function targetStepId(board, t, m) {
    const bt = trackerOf(board, t.id);
    if (!bt) return null;
    const name = m.branch ? m.step : t.steps[m.toIndex];
    return bt.steps.find(s => low(s.name) === low(name))?.id ?? null;
}

/** The card for an unsure move — it holds the reply (`now`). `t` the engine's tracker, `m` the helper's move. */
export function moveRequest(t, m, i, id) {
    const to = m.branch ? `“${m.branch}” after ${m.step}` : t.steps[m.toIndex];
    const aside = !m.branch && m.toAside && m.toAside !== m.fromAside ? ` (${m.toAside})` : '';
    return {
        id, from: 'board', kind: 'move', now: true,
        title: `${t.name} → ${to}${aside}?`,
        q: m.quote || '', why: m.reason || '', conf: m.confidence || null,
        recheck: m.recheck || 3, ...(m.recheckWhy ? { recheckWhy: m.recheckWhy } : {}),
        tracker: t.id, move: m, made: { i: Math.floor(i || 0), at: new Date().toISOString() },
    };
}

/** What an answer is called once given (the card's status in "Answered"). */
export function resultText(choice, n) {
    return {
        accept: 'Accepted', deny: 'Denied', wait: `Re-check in ${n || 3}`, keep: 'Kept', refuse: 'Not kept', add: 'Added', skip: 'Left out',
        apply: 'Written into the entry', notcanon: 'Not canon', auto: 'Applied on its own', undone: 'Undone',
        dropped: 'Dropped — the reply it held was stopped',
        abandon: 'Plan abandoned', more: 'More time', redirect: 'Redirect — review it in 💡', evolve: 'Evolve — review it in 💡',   // 🪜 plans (pitches.js)
    }[choice] || choice;
}

/** The chat's stored requests (open ones and the answered history, newest last; the history keeps 50). */
export function asRequests(v) {
    const list = arr(v?.list).filter(r => r && r.id && r.kind);
    return { list };
}
export function trimAnswered(store) {
    const open = store.list.filter(r => !r.done), done = store.list.filter(r => r.done).slice(-50);
    return { list: [...done, ...open] };
}
