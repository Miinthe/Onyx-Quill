/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — the board window ⇄ the stored board (stage 2).
 * Pure rules only; tested in test/board-window.test.mjs.
 *
 * The board window is the frozen mock-up (v61), moved into DeepLore almost unchanged.
 * It thinks in its own shapes: a line points at a step by POSITION (`step: 3`), at a fork
 * branch, an item or a detour by NAME, and a chat's place is one flat bag
 * (`{ rel: 2, run_rel: 'paused', fork_rel_2: 'Confesses', stash: { Tape: 'have', '#Tape': 2, '$usd': 8 } }`).
 * Storage is the v2 model (board-model-pure.js): every step, branch, item and detour has a
 * fixed id and lines point at ids.
 *
 * So the window gets every object WITH its id (it carries unknown fields along), and the
 * positions / names are turned back into ids only when saving — at that moment the window's
 * own references are consistent (it renumbers lines when steps move and renames them
 * when things are renamed), so position → id is exact. New things get fresh ids.
 */
import { normalizeBoard, normalizeState, freshState, uniqueId, trackerOf, stepIndex, toEngineList, migrateV1, BOARD_VERSION } from './board-model-pure.js';
import { defOf } from './storyboard-pure.js';
import { moveTo } from './trackers-pure.js';   // cloud bug hunt 2026-10-04: window moves are journalled
import { describeCastChange } from './cast-pure.js';   // the Cast (2026-10-13): its changes on the Timeline

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** Every list of lines on a tracker, as [owner, key] pairs (owner[key] is an array of conditions). */
function lineLists(t) {
    const out = [[t, 'starts'], [t, 'blocks'], [t, 'triggers']];
    for (const s of arr(t.steps)) out.push([s, 'needs'], [s, 'blocks']);
    for (const it of arr(t.items)) out.push([it, 'needs'], [it, 'finds']);   // finds: items to find (rolls-pure.js)
    for (const b of arr(t.meter?.bands)) out.push([b, 'needs']);   // lines into a meter's band (meters, 2026-10-12)
    return out.filter(([o, k]) => Array.isArray(o[k]));
}
const forEachLine = (board, fn) => {
    for (const t of arr(board.trackers)) for (const [o, k] of lineLists(t)) o[k] = o[k].map(c => fn(c, t)).filter(Boolean);
};

// ── board: stored (v2) → window ─────────────────────────────────────────────

/** The board as the window wants it. `board` must be v2 (run it through normalizeBoard first). */
export function toWindowBoard(board) {
    const b = clone(board);
    const src = id => trackerOf(board, id);
    const idx = (t, sid) => stepIndex(t, sid);
    const brName = (t, sid, bid) => t?.steps?.find(s => s.id === sid)?.fork?.branches?.find(x => x.id === bid)?.name;
    const itName = (col, iid) => arr(col?.items).find(i => i.id === iid)?.name;
    forEachLine(b, (c, owner) => {
        const out = { ...c };
        if (c.tracker && c.step) { const i = idx(src(c.tracker), c.step); if (i < 0) return null; out.step = i; }
        if (c.tracker && c.branch) {
            const t = src(c.tracker), name = brName(t, c.at, c.branch), i = idx(t, c.at);
            if (name == null || i < 0) return null;
            out.at = i; out.branch = name;
        }
        if (c.collection && c.item) { const n = itName(src(c.collection), c.item); if (n == null) return null; out.item = n; }
        if (c.counter && c.band) { const bd = arr(src(c.counter)?.meter?.bands).find(x => x.id === c.band); if (!bd) return null; out.band = bd.name; out.min = bd.from; }   // meters (2026-10-12)
        if (c.to != null) { const i = idx(owner, c.to); if (i < 0) return null; out.to = i; }
        return out;
    });
    for (const t of b.trackers) {
        t.steps ||= [];             // the window reads steps / starts on every row, collections too
        t.starts ||= [];
        const orig = src(t.id);
        for (const s of arr(t.steps)) {
            if (s.fallTo) {
                const tgt = orig.steps.find(x => x.id === s.fallTo.step);
                s.fallTo = { step: idx(orig, s.fallTo.step), ...(s.fallTo.detour ? { detour: tgt?.detours?.find(d => d.id === s.fallTo.detour)?.name ?? s.fallTo.detour } : {}) };
            }
            if (s.fork) {
                const by = s.fork.by;
                s.fork = s.fork.branches.map(br => {
                    if (br.then?.step) {
                        const owner = br.then.tracker ? src(br.then.tracker) : orig;
                        br.then = { ...br.then, step: idx(owner, br.then.step) };
                    }
                    return br;
                });
                if (by === 'roll') s.forkBy = 'roll';
            }
        }
    }
    return b;
}

// ── board: window → stored (v2) ─────────────────────────────────────────────

/** Give objects without a (unique) id one, from their name. */
function ensureIds(list, nameOf = x => x.name) {
    const taken = new Set();
    for (const x of list) {
        if (typeof x.id === 'string' && x.id.trim() && !taken.has(x.id)) taken.add(x.id);
        else x.id = uniqueId(nameOf(x) || 'x', taken);
    }
}

/** The window's board, back as a v2 board (normalized). Never throws on odd input. */
export function fromWindowBoard(doc, fallbackName = 'Storyboard') {
    const b = clone(isObj(doc) ? doc : {});
    b.trackers = arr(b.trackers).filter(isObj);
    ensureIds(b.trackers);
    for (const t of b.trackers) {
        t.steps = arr(t.steps).map(s => (typeof s === 'string' ? { name: s } : s)).filter(isObj);
        ensureIds(t.steps);
        for (const s of t.steps) {
            if (Array.isArray(s.detours)) { s.detours = s.detours.map(d => (typeof d === 'string' ? { name: d } : d)).filter(isObj); ensureIds(s.detours); }
            if (Array.isArray(s.fork)) { s.fork = s.fork.filter(isObj); ensureIds(s.fork); }
        }
        if (Array.isArray(t.items)) { t.items = t.items.filter(isObj); ensureIds(t.items); }
        if (Array.isArray(t.meter?.bands)) { t.meter.bands = t.meter.bands.filter(isObj); ensureIds(t.meter.bands); }   // meters (2026-10-12)
        if (Array.isArray(t.people)) { t.people = t.people.filter(isObj); ensureIds(t.people); }   // the Cast (2026-10-13)
        delete t.fork; delete t.forkBy;     // only very old window boards had a tracker-level fork; the window moves it onto the last step itself
    }
    const T = id => b.trackers.find(t => t.id === id);
    const stepId = (t, i) => (Number.isInteger(i) ? t?.steps?.[i]?.id : typeof i === 'string' && t?.steps?.some(s => s.id === i) ? i : undefined);
    forEachLine(b, (c, owner) => {
        if (!isObj(c)) return null;
        const out = { ...c };
        if (c.tracker && c.step != null && !c.branch) { const sid = stepId(T(c.tracker), c.step); if (!sid) return null; out.step = sid; }
        if (c.tracker && c.branch) {
            const t = T(c.tracker), sid = stepId(t, c.at);
            const br = arr(t?.steps?.find(s => s.id === sid)?.fork).find(x => x.name === c.branch || x.id === c.branch);
            if (!br) return null;
            out.at = sid; out.branch = br.id;
        }
        if (c.collection && c.item) {
            const it = arr(T(c.collection)?.items).find(x => x.name === c.item || x.id === c.item);
            if (!it) return null;
            out.item = it.id;
        }
        if (c.counter && c.band) {
            const bd = arr(T(c.counter)?.meter?.bands).find(x => x.name === c.band || x.id === c.band);
            if (!bd) return null;
            out.band = bd.id; delete out.min;
        }
        if (c.to != null) { const sid = stepId(owner, c.to); if (!sid) return null; out.to = sid; }
        return out;
    });
    for (const t of b.trackers) {
        for (const s of t.steps) {
            if (s.fallTo) {
                const sid = stepId(t, s.fallTo.step);
                const tgt = t.steps.find(x => x.id === sid);
                s.fallTo = sid ? { step: sid, ...(s.fallTo.detour ? { detour: arr(tgt?.detours).find(d => d.name === s.fallTo.detour || d.id === s.fallTo.detour)?.id } : {}) } : undefined;
                if (s.fallTo && !s.fallTo.detour) delete s.fallTo.detour;
            }
            if (Array.isArray(s.fork)) {
                for (const br of s.fork) {
                    if (br.then?.step != null) {
                        const sid = stepId(br.then.tracker ? T(br.then.tracker) : t, br.then.step);
                        if (sid) br.then = { ...br.then, step: sid }; else delete br.then.step;
                    }
                }
                s.fork = { by: s.forkBy === 'roll' ? 'roll' : 'story', branches: s.fork };
                delete s.forkBy;
            }
        }
    }
    return normalizeBoard({ ...b, v: BOARD_VERSION }, fallbackName);
}

// ── a chat's place: stored (v2) → window bag ────────────────────────────────

/** A chat's v2 state as the window's flat bag. `board` is v2. */
export function toWindowChat(board, st) {
    const s = normalizeState(st, board);
    const bag = {};
    for (const t of board.trackers) {
        const run = t.kind === 'steps' ? s.trackers[t.id]?.run : s.runs?.[t.id];
        if (run) bag['run_' + t.id] = run;
        if (t.kind === 'steps') {
            const p = s.trackers[t.id] || {};
            bag[t.id] = p.at == null ? null : Math.max(0, stepIndex(t, p.at));
            for (const [sid, bid] of Object.entries(p.forks || {})) {
                const i = stepIndex(t, sid), br = t.steps[i]?.fork?.branches.find(x => x.id === bid);
                if (i >= 0 && br) bag[`fork_${t.id}_${i}`] = br.name;
            }
        } else if (t.kind === 'collection') {
            const c = s.collections[t.id], out = {};
            for (const it of t.items) {
                const v = c?.items?.[it.id];
                if (v?.state) out[it.name] = v.state;
                if (v?.amount) out['#' + it.name] = v.amount;
            }
            for (const [pid, n] of Object.entries(c?.purse || {})) out['$' + pid] = n;
            bag[t.id] = out;
            if (arr(c?.pending).length) bag['pend_' + t.id] = clone(c.pending);
            if (arr(c?.refused).length) bag['ref_' + t.id] = clone(c.refused);   // collections that grow: names Miinthe said no to
        } else if (t.kind === 'counter') bag[t.id] = s.counters[t.id];
        else if (t.kind === 'place') bag[t.id] = s.places[t.id];
        else if (t.kind === 'state') bag[t.id] = clone(s.states[t.id]);
        else if (t.kind === 'cast') bag[t.id] = clone(s.cast?.[t.id] || {});   // the Cast (2026-10-13): each person as this chat has them
    }
    if (arr(s.chapters).length) bag.__chapters = clone(s.chapters);   // the timeline's chapters
    return bag;
}

// ── a chat's place: window bag → stored (v2) ────────────────────────────────

/**
 * The window's bag back as a v2 chat state. `board` is the v2 board (from fromWindowBoard),
 * whose steps are in the window's order. `prev` (the stored state) keeps what the window
 * does not show: when a tracker stays on its step, its detour and start time stay too.
 */
export function fromWindowChat(board, bag, prev = null) {
    const b = isObj(bag) ? bag : {};
    const old = normalizeState(prev, board);
    const st = { v: BOARD_VERSION, trackers: {}, collections: {}, counters: {}, places: {}, states: {}, cast: {} };
    const runs = {};
    for (const t of board.trackers) {
        const run = ['paused', 'abandoned'].includes(b['run_' + t.id]) ? b['run_' + t.id] : null;
        if (t.kind === 'steps') {
            const raw = b[t.id];
            const at = raw === null ? null : Number.isInteger(raw) ? t.steps[raw]?.id ?? t.steps[0]?.id ?? null : old.trackers[t.id]?.at ?? null;
            const was = old.trackers[t.id] || {};
            const p = at === was.at ? { ...was } : { at, ...(was.started ? { started: true } : {}) };
            p.at = at;
            p.forks = {};
            for (const [k, v] of Object.entries(b)) {
                const m = k.match(/^fork_(.+)_(\d+)$/);
                if (!m || m[1] !== t.id) continue;
                const step = t.steps[+m[2]], br = step?.fork?.branches.find(x => x.name === v);
                if (br) p.forks[step.id] = br.id;
            }
            if (run) p.run = run; else delete p.run;
            st.trackers[t.id] = p;
        } else {
            if (run) runs[t.id] = run;
            const v = b[t.id];
            if (t.kind === 'collection') {
                const c = isObj(v) ? v : {}, items = {}, purse = {};
                for (const it of t.items) {
                    const state = c[it.name], amount = Number(c['#' + it.name]) || 0;
                    if (state || amount) items[it.id] = { state: state || t.states[0].id, ...(amount ? { amount } : {}) };
                }
                for (const p of arr(t.purse)) purse[p.id] = Number(c['$' + p.id] ?? p.start) || 0;
                st.collections[t.id] = { items, purse, pending: arr(b['pend_' + t.id]), ...(arr(b['ref_' + t.id]).length ? { refused: arr(b['ref_' + t.id]) } : {}) };
            } else if (t.kind === 'counter') st.counters[t.id] = v ?? t.start;
            else if (t.kind === 'place') st.places[t.id] = v ?? t.places[0]?.id ?? null;
            else if (t.kind === 'state') st.states[t.id] = isObj(v) ? clone(v) : undefined;
            else if (t.kind === 'cast') st.cast[t.id] = isObj(v) ? clone(v) : clone(old.cast?.[t.id] || {});
        }
    }
    for (const k of Object.keys(st.states)) if (st.states[k] === undefined) delete st.states[k];
    if (old.log) st.log = old.log;          // the window doesn't show the change log; keep it
    if (old.undone) st.undone = old.undone;
    // the timeline's chapters (named stretches of messages) — the window keeps them in its bag
    if (Array.isArray(b.__chapters)) st.chapters = clone(b.__chapters); else if (old.chapters) st.chapters = old.chapters;
    // what the window doesn't show is kept as it was (rolls, fired / denied triggers)
    for (const k of ['rolls', 'fired', 'denied']) if (old[k] !== undefined && st[k] === undefined) st[k] = old[k];
    // engine on v2: the markers that say how far back the change log holds every step move (else a delete can't roll back)
    for (const k of ['v2steps', 'v2since', 'logDropped', 'lastRun', 'stepsRebuilt']) if (old[k] !== undefined) st[k] = old[k];
    if (Object.keys(runs).length) st.runs = runs;
    return normalizeState(st, board);
}

/**
 * Moves made in the window (a tracker set to another step, a detour, a fork branch picked) go
 * into the tracker's journal at `messageIndex`, like a move with ◀ ▶ in the Story tab.
 * Without this the journal still says the old step, so deleting any message rolled the move
 * back without a word, and opening the chat again offered to "roll back" to the old step
 * (cloud bug hunt, 2026-10-04). `list` is the new engine list, `prev` the one before the save.
 */
export function journalWindowMoves(list, prev, messageIndex, at = new Date().toISOString()) {
    const before = arr(prev);
    const snap = t => JSON.stringify([t.index ?? 0, t.aside || null, isObj(t.took) ? t.took : {}, t.ended || null, t.run || null]);
    return arr(list).map(t => {
        const p = before.find(x => x.id === t.id);
        if (!p || !Array.isArray(t.journal) || snap(p) === snap(t)) return t;
        return moveTo(t, t.index, messageIndex, { who: 'hand', at });
    });
}

// ── storage: v2 beside the v1 board the engine still reads ──────────────────

/**
 * The v1 board (extension_settings.deeplore_storyboards) for a v2 board: its step trackers
 * with step names, starts and step-reach needs — what the current helper and writer read.
 */
export function toV1Board(board) {
    return { name: board.name, trackers: toEngineList(board, freshState(board)).map(defOf) };
}
/** A signature of a v1 board's definitions, to notice edits made by commands since the window last saved. */
export const v1Sig = v1 => JSON.stringify(arr(v1?.trackers).map(defOf));

/**
 * The board to show: the stored v2 board, brought in line with the v1 board when the v1
 * board was changed elsewhere (/oq-tracker commands) after the window last saved.
 * A steps tracker whose step names still match keeps everything v2 knows; one whose steps
 * changed is taken from v1 (its extras on those steps are lost — reported in `changed`);
 * trackers added by command are added, removed ones removed. Without a v2 board: v1 converted.
 */
export function reconcile(v2, sig, v1, name = 'Storyboard') {
    if (!isObj(v2)) return { board: migrateV1(isObj(v1) ? v1 : { trackers: [] }, name), changed: [] };
    const board = normalizeBoard(v2, name);
    if (!isObj(v1) || v1Sig(v1) === sig) return { board, changed: [] };
    const fromV1 = migrateV1(v1, name);
    const changed = [];
    const keep = board.trackers.filter(t => t.kind !== 'steps' || fromV1.trackers.some(x => x.id === t.id)).map(t => {
        if (t.kind !== 'steps') return t;
        const n = fromV1.trackers.find(x => x.id === t.id);
        const same = n.steps.length === t.steps.length && n.steps.every((s, i) => s.name === t.steps[i].name);
        if (same && n.name === t.name && n.direction === t.direction && n.skip === t.skip) return t;
        changed.push(t.name);
        if (same) return { ...t, name: n.name, direction: n.direction, skip: n.skip };
        return { ...n, icon: t.icon, color: t.color, folder: t.folder };
    });
    for (const n of fromV1.trackers) if (!keep.some(t => t.id === n.id)) { keep.push(n); changed.push(n.name); }
    for (const t of board.trackers) if (t.kind === 'steps' && !keep.some(x => x.id === t.id)) changed.push(t.name);
    return { board: normalizeBoard({ ...board, trackers: keep }, name), changed };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 5 (one board store): what the Story tab and the /oq-tracker
 * commands change — a tracker's name, steps, direction, "may skip", trackers added or removed (`defs`, the engine's
 * definitions) — goes into the board. Everything else the board knows stays: a step whose name is still there keeps
 * its id, links, needs, fork and detours; a tracker keeps its icon, colour, folder, starts and triggers. A new step
 * or tracker gets a fresh id. Non-step trackers (collections, places, …) are untouched.
 */
export function mergeDefs(board, defs, name = 'Storyboard') {
    const b = normalizeBoard(board, name);
    const list = arr(defs).filter(d => isObj(d) && Array.isArray(d.steps));
    const fresh = migrateV1({ name, trackers: list }, name);
    const out = [];
    for (const t of b.trackers) {
        if (t.kind !== 'steps') { out.push(t); continue; }
        const d = list.find(x => x.id === t.id);
        if (!d) continue;   // removed
        const taken = new Set(t.steps.map(s => s.id));
        const steps = d.steps.map(n => t.steps.find(s => s.name === n) || { ...(fresh.trackers.find(x => x.id === t.id)?.steps.find(s => s.name === n) || { name: n }), id: uniqueId(n, taken), needs: [] });
        out.push({ ...t, name: d.name, direction: d.direction === 'forward' ? 'forward' : 'both', skip: d.skip === true, steps });
    }
    const ids = new Set(out.map(t => t.id));
    for (const n of fresh.trackers) if (!out.some(t => t.id === n.id)) out.push(ids.has(n.id) ? { ...n, id: uniqueId(n.name, ids) } : (ids.add(n.id), n));
    return normalizeBoard({ ...b, trackers: out }, name);
}

/**
 * Entries that already name their step in the vault (`tracker:` / `step:` → entry.storyStep)
 * show on that step in the window, as if linked there — the same link, seen from the board.
 * Matches by tracker and step NAME (case-insensitive), the way the engine matches them.
 */
export function withVaultLinks(board, entries) {
    const b = clone(board);
    for (const e of arr(entries)) {
        const link = e?.storyStep;
        if (!link?.tracker || !e.title) continue;
        const t = arr(b.trackers).find(x => x.kind === 'steps' && x.name.toLowerCase() === String(link.tracker).toLowerCase());
        if (!t) continue;
        for (const name of arr(link.steps)) {
            const st = t.steps.find(x => x.name.toLowerCase() === String(name).toLowerCase());
            if (st && !st.entries.includes(e.title)) st.entries.push(e.title);
        }
    }
    return b;
}

// ── the timeline: this chat's real history for the window (round "timeline + lanes", 2026-10-04) ──

/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — engine on v2, step 7: the step trackers' timeline from the v2 log (`kind: 'step'`
 * entries), the same events the list's history gave: "Board applied" for a tracker without start lines, every visible
 * move with who / quote / why, a start (after the tracker's moves in that message), refused moves (its memory).
 */
function stepTimeline(board, list, st) {
    const out = [];
    const log = arr(st?.log).filter(x => x.kind === 'step');
    const idx = (t, p) => Math.max(0, stepIndexV(t, p?.at ?? p?.waitAt));
    const asideOf = (t, p) => (p?.aside ? t.steps.find(s => s.id === p.at)?.detours?.find(d => d.id === p.aside)?.name ?? null : p?.asideText || null);
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        const own = log.filter(x => x.col === t.id), hasStarts = arr(t.starts).length > 0, p = st.trackers?.[t.id] || {};
        if (!hasStarts) out.push({ m: 0, t: t.id, to: idx(t, own[0]?.from ?? p), who: 'start', why: 'Board applied to the chat.' });
        const starts = [], moves = [];
        for (const x of own) {
            if (hasStarts && !x.from?.started && x.to?.started) {
                const why = p.startedAt?.i === x.i && p.startedAt?.why ? p.startedAt.why : 'its start lines hold';
                starts.push({ m: x.i, t: t.id, to: idx(t, x.to), who: 'start', why: `Started: ${why}.` });
                continue;
            }
            // one event per message: from where it stood before the message to where the message left it (as the
            // list's history kept it — a detour set and moved back within one message shows nothing)
            const same = moves.at(-1);
            if (same && same.i === x.i) moves[moves.length - 1] = { ...x, from: same.from }; else moves.push(x);
        }
        for (const x of moves) {
            const to = idx(t, x.to), aside = asideOf(t, x.to), pto = idx(t, x.from), paside = asideOf(t, x.from);
            const run = x.why && RUN_WHY[x.why];
            if (!run && pto === to && paside === aside) continue;      // nothing visible changed
            const why = run || (x.who === 'undo' ? 'Undone — put back.' : x.reason || (pto === to ? (aside ? `Detour: ${aside}.` : 'Detour cleared.') : x.who === 'auto' ? '' : x.who === 'trigger' ? 'Moved by a trigger.' : 'Moved by hand.'));
            out.push({ m: x.i, t: t.id, to, who: whoOf(x.who), ...(x.quote ? { q: x.quote } : {}), ...(why ? { why } : {}), ...(x.confidence ? { conf: x.confidence } : {}) });
        }
        out.push(...starts);
        const e = arr(list).find(x => x.id === t.id);
        for (const r of arr(e?.refused ?? p.memo?.refused)) {
            const at = own.filter(x => x.i <= r.i).at(-1);
            out.push({ m: r.i, t: t.id, to: Number.isInteger(r.toIndex) ? r.toIndex : idx(t, at ? at.to : own[0]?.from ?? p), who: 'refused', ...(r.quote ? { q: r.quote } : {}), why: r.why || 'Refused.' });
        }
    }
    return out;
}
const stepIndexV = (t, id) => arr(t?.steps).findIndex(s => s.id === id);

const RUN_WHY = { pause: 'Paused by you.', continue: 'Running again.', abandon: 'Abandoned in this story — back to the start, switched off.', reactivate: 'Reactivated — on again from the start.' };
const whoOf = w => (w === 'auto' ? 'auto' : w === 'trigger' || w === 'start' || w === 'roll' ? 'start' : 'hand');

/**
 * The window's TIMELINE list for this chat, from what the chat really keeps:
 *  - step trackers: the engine's journal (every move: by the helper with its quote, reason and
 *    confidence; by hand; by a trigger; pause / abandon), its start, and the refused moves;
 *  - places, state (day, fields, dates), collections (items, money): the board's change log.
 * Event shape as the window draws it: { m, t, to | place | field+val | date | item+state, who, q, why, conf }.
 * `list` = the engine's list (v1, positions + journal); `st` = the v2 chat state.
 */
export function timelineEvents(board, list, st) {
    const out = [];
    out.push(...stepTimeline(board, list, st));   // engine on v2, step 7: the step trackers from the v2 log
    for (const x of arr(st?.log)) {
        const t = trackerOf(board, x.col);
        if (!t) continue;
        const base = { m: x.i, t: t.id, who: whoOf(x.who), ...(x.quote ? { q: x.quote } : {}), ...(x.reason ? { why: x.reason } : {}), ...(x.confidence ? { conf: x.confidence } : {}) };
        if (x.kind === 'place') out.push({ ...base, place: x.to });
        else if (x.kind === 'item') out.push({ ...base, item: arr(t.items).find(i => i.id === x.item)?.name ?? x.item, state: x.to?.state });
        else if (x.kind === 'money') { const p = arr(t.purse).find(q => q.id === x.purse); out.push({ ...base, item: 'Money', state: p ? (p.before ? `${p.unit}${x.to}` : `${x.to} ${p.unit}`) : String(x.to) }); }
        else if (x.kind === 'date') out.push({ ...base, date: x.date });
        else if (x.kind === 'cast' && x.field !== 'thoughts' && !(x.field === 'plans' && x.who === 'director' && !x.added?.length && !x.ended?.length)) out.push({ ...base, person: arr(t.people).find(p => p.id === x.person)?.name ?? x.person, cfield: x.field, ctext: describeCastChange(board, x) });   // the Cast (2026-10-13)
        else if (x.kind === 'meter') out.push({ ...base, meter: x.to, mfrom: x.from, band: arr(t.meter?.bands).find(b => b.id === x.bandTo)?.name ?? null, ...(x.held ? { held: x.held.band } : {}) });   // meters (2026-10-12)
        else if (x.kind === 'state') {
            if (x.dayTo !== undefined && x.dayTo !== x.dayFrom) out.push({ ...base, field: 'day', val: x.dayTo });
            if (x.field && x.to !== undefined) out.push({ ...base, field: x.field, val: x.to });
        }
    }
    return out.sort((a, b) => a.m - b.m);
}
