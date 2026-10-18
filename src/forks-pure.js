/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — forks in play (storyboard stage 3, round 1).
 * Pure rules only; tested in test/forks.test.mjs. Design: `8 storyboard design.md` (forks)
 * and `6 merge roadmap.md` §4 G+.
 *
 * A FORK sits after any step: at "Friends" the story goes one of several ways ("Confesses",
 * "Chickens out"). In the middle of a tracker it is an interlude; after the last step, an ending.
 * The engine's tracker list (v1, names — see trackers-pure.js) carries them as
 *
 *     forks: { [stepName]: { by: 'story' | 'roll', branches: [{ name, weight?, then?, entries? }] } }   (board definition)
 *     took:  { [stepName]: branchName }                                                               (this chat)
 *     ended: { step, branch, i }                                                                     (this chat, after an ending)
 *     branchLog: [{ step, branch, i }]                                                               (this chat: every branch taken)
 *
 * RULES
 *  - A tracker standing on a step with an undecided fork WAITS there: it does not move on
 *    past it (by itself or in one jump). It may still move back.
 *  - The story decides (the helper reports the branch, with a quote) or a roll does, by the
 *    branches' weights, the moment the tracker arrives on the step.
 *  - Afterwards (`then.kind`): 'on' → the next step (default in the middle), 'back' → to
 *    `then.step`, 'end' → the tracker ends there (default after the last step), 'next' → it
 *    ends and another tracker (`then.tracker`) starts.
 *  - Going back to a step (or before it) makes its fork open again (`took` forgets it), but
 *    the branch stays in `branchLog`: a line waiting for "Chickens out" still holds after the
 *    story went back. Both are journalled / logged by message, so a delete rolls them back.
 *  - Lines can wait for a branch: { tracker, at: stepName, branch: branchName }.
 *  - Entries named on a branch only exist (for judge and writer) once that branch was taken.
 */

const low = s => String(s ?? '').trim().toLowerCase();
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clampIdx = t => Math.min(Math.max(Math.floor(Number(t?.index) || 0), 0), (t?.steps?.length || 1) - 1);

function findT(list, ref) {
    const k = low(ref);
    return list.find(t => t.id && low(t.id) === k) || list.find(t => low(t.name) === k) || null;
}

/** The fork after step `stepName` (case-insensitive), or null. */
export function forkAtStep(t, stepName) {
    if (!isObj(t?.forks)) return null;
    const key = Object.keys(t.forks).find(k => low(k) === low(stepName));
    const f = key ? t.forks[key] : null;
    return f && Array.isArray(f.branches) && f.branches.length ? f : null;
}

/** The branch taken after `stepName` in this chat, or null. */
export function tookAt(t, stepName) {
    if (!isObj(t?.took)) return null;
    const key = Object.keys(t.took).find(k => low(k) === low(stepName));
    return key ? t.took[key] : null;
}

export const isLastStep = (t, stepName) => low(t.steps[t.steps.length - 1]) === low(stepName);

/** What a branch does afterwards. */
export function thenKind(t, stepName, br) {
    const k = br?.then?.kind;
    if (['on', 'back', 'end', 'next'].includes(k)) return k === 'on' && isLastStep(t, stepName) ? 'end' : k;
    return isLastStep(t, stepName) ? 'end' : 'on';
}

/** The fork the tracker waits at right now (current step, not decided, not ended), or null. */
export function pendingFork(t) {
    if (!t || t.ended) return null;
    const step = t.steps[clampIdx(t)];
    const fork = forkAtStep(t, step);
    return fork && !tookAt(t, step) ? { step, fork } : null;
}

/** Moving from `fromIndex` to a later `toIndex` would pass an undecided fork: its step name, else null. */
export function forkInTheWay(t, fromIndex, toIndex) {
    for (let k = fromIndex; k < toIndex; k++) {
        const step = t.steps[k];
        if (forkAtStep(t, step) && !tookAt(t, step)) return step;
    }
    return null;
}


/** Does a line waiting for a branch hold? `{ tracker, at, branch }` */
export function branchHolds(c, list) {
    const src = findT(list, c.tracker);
    if (!src) return false;
    if (low(tookAt(src, c.at)) === low(c.branch)) return true;
    return (Array.isArray(src.branchLog) ? src.branchLog : []).some(e => low(e.step) === low(c.at) && low(e.branch) === low(c.branch));
}

/** After a delete back to `messageIndex`: branches taken later are forgotten. */
export function unbranchAfter(t, messageIndex) {
    if (!Array.isArray(t.branchLog) || !t.branchLog.some(e => e.i > messageIndex)) return t;
    return { ...t, branchLog: t.branchLog.filter(e => e.i <= messageIndex) };
}

/** "The Broken Fuse ends in Fail" / "Relationship takes “Confesses” after Friends" */
export function branchText(c, list) {
    const src = findT(list, c.tracker);
    const name = src ? src.name : c.tracker;
    return src && isLastStep(src, c.at) ? `${name} ends in ${c.branch}` : `${name} takes “${c.branch}” after ${c.at}`;
}

/** The notice for a taken branch. */
export function describeTake(e) {
    const what = e.kind === 'on' ? ` → ${e.to}` : e.kind === 'back' ? ` → back to ${e.to}` : e.kind === 'next' ? ` — ends${e.started ? `; ${e.started} starts` : ''}` : ' — ends here';
    return `${e.tracker}: after ${e.step}, “${e.branch}”${what}`;
}

/** What the writer and the judge are told about a tracker's forks: the branches taken (never the open ones). */
export function forkNote(t) {
    if (t.ended) return `ended — ${t.ended.branch}`;
    const took = isObj(t.took) ? Object.entries(t.took) : [];
    return took.length ? took.map(([s, b]) => `after ${s}: ${b}`).join('; ') : '';
}

/**
 * Entries named on a branch exist only once that branch was taken (and the tracker runs).
 * Others are untouched. Pinned entries always stay.
 */
export function filterByBranch(entries, list, isPinned = () => false, isActive = () => true) {
    const owners = new Map();   // entry title (lower) → [{ t, step, branch }]
    for (const t of list) {
        for (const [step, f] of Object.entries(isObj(t.forks) ? t.forks : {})) {
            for (const b of (f?.branches || [])) for (const title of (Array.isArray(b.entries) ? b.entries : [])) {
                const k = low(title);
                if (!owners.has(k)) owners.set(k, []);
                owners.get(k).push({ t, step, branch: b.name });
            }
        }
    }
    if (!owners.size) return entries;
    return entries.filter(e => {
        const own = owners.get(low(e?.title));
        if (!own || isPinned(e)) return true;
        return own.some(o => isActive(o.t) && low(tookAt(o.t, o.step)) === low(o.branch));
    });
}
