/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — the storyboard data model, version 2.
 * Pure rules only (no SillyTavern, no jQuery); tested in test/board-model.test.mjs.
 * Design: `8 storyboard design.md` (the frozen mock-up, v61) and `6 merge roadmap.md` §4 G / G+.
 *
 * WHAT CHANGES FROM VERSION 1 (storyboard-pure.js)
 * ------------------------------------------------
 * v1 knew one kind: a tracker with step NAMES, "starts when" and "only possible once".
 * v2 holds everything the mock-up does: steps as objects (entries, rules, detours, a fork
 * after ANY step), collections (with a purse), counters, places, state (fields + a calendar),
 * every line kind (needs · starts · blocks · only one · triggers) and odds on any line.
 *
 * STABLE IDS. Every step, branch, detour, item, place, field and date has an `id`; lines
 * point at ids, never at names or positions — so renaming or reordering never breaks a line.
 *
 * TWO HALVES, as before: the BOARD (definitions; extension settings, per account) and each
 * chat's PLACE on it (`chatState`, chat_metadata). Nothing here touches either store — the
 * caller reads and writes; this module only shapes, converts, evaluates and checks.
 *
 * NOT WIRED YET (stage 1): the live engine (trackers.js, autotrack.js) still runs on the
 * v1 list. `toEngineList` / `fromEngineList` translate between the two, so the board
 * window (stage 2) can store v2 while every existing feature keeps working unchanged.
 */
import { normWorld } from './world/world-pure.js';

export const BOARD_VERSION = 2;
export const KINDS = ['steps', 'collection', 'counter', 'place', 'state', 'cast'];   // cast: NPCs (cast-pure.js, 2026-10-13)
const FIELD_TYPES = ['cycle', 'day', 'choice'];

// ── small helpers ───────────────────────────────────────────────────────────

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const low = s => String(s ?? '').trim().toLowerCase();
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const slug = s => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';

/** An id built from `name`, unique within `taken` (a Set, updated). */
export function uniqueId(name, taken) {
    const base = slug(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
}

/** Give every object in `list` an id (keeps good existing ones, fixes duplicates). */
function withIds(list, nameOf = x => x.name) {
    const taken = new Set();
    return list.map(x => {
        const want = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : null;
        if (want && !taken.has(want)) { taken.add(want); return { ...x, id: want }; }
        return { ...x, id: uniqueId(nameOf(x) || 'x', taken) };
    });
}

const entriesOf = o => (Array.isArray(o?.entries) ? o.entries.filter(e => typeof e === 'string' && e.trim()) : typeof o?.entry === 'string' && o.entry.trim() ? [o.entry] : []);
const kindsOf = o => (isObj(o?.kinds) ? Object.fromEntries(Object.entries(o.kinds).filter(([, v]) => ['context', 'guidance', 'judge'].includes(v))) : {});
const pinsOf = o => (isObj(o?.pins) ? Object.fromEntries(Object.entries(o.pins).filter(([, v]) => v === true)) : {});
const note = o => (typeof o?.note === 'string' && o.note.trim() ? { note: o.note } : {});
const entryPart = o => ({ entries: entriesOf(o), kinds: kindsOf(o), pins: pinsOf(o) });

// ── conditions (lines) ──────────────────────────────────────────────────────

/**
 * One condition — the thing a line waits for. Exactly one source shape:
 *   { tracker, step }            a tracker reaches that step (or later)
 *   { tracker, running: true }   while a tracker runs (blocks only)
 *   { tracker, at, branch }      a tracker takes that branch of the fork after step `at`
 *   { collection, count, state } how many of a collection are in a state
 *   { collection, item, state }  one item is in a state
 *   { collection, item, amount } the collection has at least `amount` of an item
 *   { collection, purse, min }   the collection's purse holds at least `min`
 *   { counter, min }             a counter is at least `min`
 *   { counter, band }            a meter is in that band or a higher one (meters-pure.js)
 *   { place, at }                the scene is at that place (or somewhere inside it)
 *   { world, field, is }         a state field has that value
 *   { world, field, min }        the day field is at least `min`
 *   { world, due }               a calendar date is due
 *   { cast, person }             that person is in the scene (cast-pure.js)
 * plus optional `odds` (1 in N), `retry` (messages, or 'visit': again each time it comes to hold anew),
 * `color` / `own` (look), `note`. Odds count only on starts and triggers (rolls-pure.js).
 */
export function normCond(c) {
    if (!isObj(c)) return null;
    const extra = {};
    if (num(c.odds) > 1) { extra.odds = Math.round(num(c.odds)); if (c.retry === 'visit') extra.retry = 'visit'; else if (num(c.retry) > 0) extra.retry = Math.round(num(c.retry)); }
    if (num(c.color) >= 1 && num(c.color) <= 6) extra.color = Math.round(num(c.color));
    if (c.own === true) extra.own = true;
    Object.assign(extra, note(c));
    const S = v => (typeof v === 'string' && v ? v : null);
    if (S(c.world)) {
        if (S(c.due)) return { world: c.world, due: c.due, ...extra };
        if (S(c.field) && c.is !== undefined) return { world: c.world, field: c.field, is: String(c.is), ...extra };
        if (S(c.field)) return { world: c.world, field: c.field, min: Math.max(1, num(c.min, 1)), ...extra };
        return null;
    }
    if (S(c.place) && S(c.at)) return { place: c.place, at: c.at, ...extra };
    if (S(c.cast) && S(c.person)) return { cast: c.cast, person: c.person, ...extra };
    if (S(c.counter)) return S(c.band) ? { counter: c.counter, band: c.band, ...extra } : { counter: c.counter, min: num(c.min), ...extra };
    if (S(c.collection)) {
        if (S(c.purse)) return { collection: c.collection, purse: c.purse, min: num(c.min), ...extra };
        if (S(c.item) && num(c.amount) > 0) return { collection: c.collection, item: c.item, amount: Math.round(num(c.amount)), ...extra };
        if (S(c.item)) return { collection: c.collection, item: c.item, ...(S(c.state) ? { state: c.state } : {}), ...extra };
        return { collection: c.collection, count: Math.max(1, Math.round(num(c.count, 1))), ...(S(c.state) ? { state: c.state } : {}), ...extra };
    }
    if (S(c.tracker)) {
        if (c.running === true) return { tracker: c.tracker, running: true, ...extra };
        if (S(c.branch) && S(c.at)) return { tracker: c.tracker, at: c.at, branch: c.branch, ...extra };
        if (S(c.step)) return { tracker: c.tracker, step: c.step, ...extra };
    }
    return null;
}
const conds = list => arr(list).map(normCond).filter(Boolean);

// ── the board ───────────────────────────────────────────────────────────────

function normBranch(b) {
    const then = isObj(b.then) && ['on', 'back', 'end', 'next'].includes(b.then.kind) ? { kind: b.then.kind, ...(b.then.step ? { step: String(b.then.step) } : {}), ...(b.then.tracker ? { tracker: String(b.then.tracker) } : {}) } : null;
    return { id: b.id, name: str(b.name, 'Branch'), ...entryPart(b), ...(num(b.weight) > 1 ? { weight: Math.round(num(b.weight)) } : {}), ...(then ? { then } : {}), ...note(b) };
}

function normStep(s) {
    const o = typeof s === 'string' ? { name: s } : isObj(s) ? s : { name: 'Step' };
    const out = { id: o.id, name: str(o.name, 'Step').trim() || 'Step', ...entryPart(o), needs: conds(o.needs), blocks: conds(o.blocks) };
    const det = withIds(arr(o.detours).map(d => (typeof d === 'string' ? { name: d } : d)).filter(isObj));
    // `once` (Miinthe, 2026-10-19: "limiting the fall back to one"): once left, the helper never sets it again in that chat
    if (det.length) out.detours = det.map(d => ({ id: d.id, name: str(d.name, 'Detour'), ...entryPart(d), ...note(d), ...(d.once === true ? { once: true } : {}) }));
    if (isObj(o.fallTo) && o.fallTo.step) out.fallTo = { step: String(o.fallTo.step), ...(o.fallTo.detour ? { detour: String(o.fallTo.detour) } : {}) };
    if (o.oneWay === true) out.oneWay = true;
    if (['relaxed', 'normal', 'strict'].includes(o.strict)) out.strict = o.strict;
    if (['low', 'medium', 'all', 'never'].includes(o.ask)) out.ask = o.ask;
    const fk = isObj(o.fork) ? o.fork : Array.isArray(o.fork) ? { branches: o.fork } : null;
    const branches = fk ? withIds(arr(fk.branches).filter(isObj)).map(normBranch) : [];
    if (branches.length) out.fork = { by: (fk.by || o.forkBy) === 'roll' ? 'roll' : 'story', branches };
    return { ...out, ...note(o) };
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-12) — a METER is a counter the helper watches (`14 meters and flags design.md`, all
 * five calls ✔ 2026-10-05): the helper reports slight / clear / big gain or loss, the board turns the size into
 * points; bands with names are what the writer is told. Each band is a tile: its own entries, and lines into it
 * ("Trust can only reach Devoted once …" — `needs`). Judge entries ("what counts") sit on the tracker's `keep`.
 */
const SIZES = { slight: 2, clear: 5, big: 10 };
function normMeter(m, t) {
    if (!isObj(m)) return null;
    const lo = t.min ?? 0;
    const bands = withIds(arr(m.bands).filter(isObj)).map(b => ({ id: b.id, name: str(b.name, 'Band').trim() || 'Band', from: num(b.from, lo), ...(b.c ? { c: String(b.c) } : {}), ...entryPart(b), needs: conds(b.needs), ...note(b) }))
        .sort((a, b) => a.from - b.from);
    if (!bands.length) bands.push({ id: 'all', name: 'All', from: lo, entries: [], kinds: {}, pins: {}, needs: [] });
    bands[0].needs = [];   // the lowest band is always reachable
    const sz = isObj(m.sizes) ? m.sizes : {};
    const sizes = Object.fromEntries(Object.entries(SIZES).map(([k, d]) => [k, Math.max(1, Math.round(num(sz[k], d)))]));
    return {
        ...(m.who ? { who: String(m.who) } : {}), bands, sizes,
        cap: Math.max(1, Math.round(num(m.cap, sizes.big))),
        drift: m.drift === true, rest: num(m.rest, t.start), every: Math.max(1, Math.round(num(m.every, 5))),
        twoEnded: m.twoEnded === true,
        ask: ['low', 'medium', 'all', 'never'].includes(m.ask) ? m.ask : 'never',
    };
}
export const isMeter = t => t?.kind === 'counter' && isObj(t.meter);
export const bandOfValue = (t, v) => [...arr(t?.meter?.bands)].reverse().find(b => v >= b.from) || t?.meter?.bands?.[0] || null;
export const bandById = (t, id) => arr(t?.meter?.bands).find(b => b.id === id) || null;

function normTracker(t, i) {
    const kind = KINDS.includes(t.kind) ? t.kind : 'steps';
    const base = { id: t.id, kind, name: str(t.name, `Tracker ${i + 1}`).trim() || `Tracker ${i + 1}`, ...(t.icon ? { icon: String(t.icon) } : {}), ...(t.color ? { color: String(t.color) } : {}), ...(t.folder ? { folder: String(t.folder) } : {}), starts: conds(t.starts), blocks: conds(t.blocks), ...note(t) };
    if (t.onFall === 'pause') base.onFall = 'pause';
    if (kind === 'steps') {
        const steps = withIds(arr(t.steps).map(normStep));
        const ids = new Set(steps.map(s => s.id));
        const out = { ...base, direction: t.direction === 'forward' ? 'forward' : 'both', skip: t.skip === true, steps,
            triggers: arr(t.triggers).map(c => { const n = normCond(c); return n && c.to != null ? { ...n, to: String(c.to) } : null; }).filter(c => c && ids.has(c.to)) };
        if (t.loop === true) { out.loop = true; if (t.rounds) out.rounds = String(t.rounds); }
        if (num(t.settle) > 0) out.settle = Math.round(num(t.settle));
        if (['relaxed', 'normal', 'strict'].includes(t.strict)) out.strict = t.strict;
        if (['low', 'medium', 'all', 'never'].includes(t.askAt)) out.askAt = t.askAt;
        if (t.worldMoves === true) out.worldMoves = true;   // world layer stage 5: news and rumors can move this (off unless switched on)
        return out;
    }
    if (kind === 'collection') {
        const states = withIds(arr(t.states).filter(isObj), x => x.label).map(s => ({ id: s.id, label: str(s.label, s.id), ...(s.c ? { c: String(s.c) } : {}), ...(s.strike ? { strike: true } : {}) }));
        const items = withIds(arr(t.items).filter(isObj)).map(it => ({ id: it.id, name: str(it.name, 'Item'), ...entryPart(it), needs: conds(it.needs), ...(conds(it.finds).length ? { finds: conds(it.finds) } : {}), ...(it.oneWay === true ? { oneWay: true } : {}),
            ...(isObj(it.cost) && num(it.cost.amount) > 0 && (it.cost.purse || it.cost.counter) ? { cost: { ...(it.cost.purse ? { purse: String(it.cost.purse) } : { counter: String(it.cost.counter) }), amount: num(it.cost.amount) } } : {}), ...note(it) }));
        const purse = withIds(arr(t.purse).filter(isObj), x => x.unit || 'money').map(p => ({ id: p.id, unit: str(p.unit, '$'), before: p.before !== false, start: num(p.start) }));
        return { ...base, states: states.length >= 2 ? states : [{ id: 'first', label: 'first' }, { id: 'second', label: 'second' }], items, amounts: t.amounts === true,
            ...(purse.length ? { purse } : {}), ...(t.grows ? { grows: true, growAsk: t.growAsk === 'auto' ? 'auto' : 'ask', ...(t.growFolder ? { growFolder: String(t.growFolder) } : {}) } : {}),
            ...(t.keep ? { keep: entryPart(t.keep) } : {}), ...(t.writerLabel ? { writerLabel: String(t.writerLabel) } : {}), ...(t.preset === 'flags' ? { preset: 'flags' } : {}) };
    }
    if (kind === 'counter') {
        const out = { ...base, ...(t.unit ? { unit: String(t.unit), unitBefore: t.unitBefore === true } : {}), start: num(t.start), ...(t.min != null && t.min !== '' ? { min: num(t.min) } : {}), ...(t.max != null && t.max !== '' ? { max: num(t.max) } : {}) };
        const m = normMeter(t.meter, out);
        return m ? { ...out, meter: m, ...(t.keep ? { keep: entryPart(t.keep) } : {}) } : out;
    }
    if (kind === 'place') {
        const places = withIds(arr(t.places).filter(isObj)).map(p => ({ id: p.id, name: str(p.name, 'Place'), ...(p.parent ? { parent: String(p.parent) } : {}), related: arr(p.related).map(String), ...entryPart(p),
            roles: isObj(p.roles) ? Object.fromEntries(Object.entries(p.roles).filter(([, v]) => ['often', 'only', 'place'].includes(v))) : {}, ...note(p) }));
        const ids = new Set(places.map(p => p.id));
        places.forEach(p => { if (p.parent && (!ids.has(p.parent) || p.parent === p.id)) delete p.parent; p.related = p.related.filter(r => ids.has(r) && r !== p.id); });
        return { ...base, places, pinHere: t.pinHere !== false, nearby: t.nearby !== false, setsLocation: t.setsLocation !== false, ...(t.source ? { source: String(t.source) } : {}), ...(t.keep ? { keep: entryPart(t.keep) } : {}) };
    }
    if (kind === 'cast') {
        // LOCAL PATCH (Miinthe, 2026-10-13) — the Cast (`12 cast and agendas design.md`): one tile per NPC
        const people = withIds(arr(t.people).filter(isObj)).map(p => ({ id: p.id, name: str(p.name, 'Someone').trim() || 'Someone', ...(p.card ? { card: String(p.card) } : {}), ...entryPart(p),
            hangouts: arr(p.hangouts).filter(h => isObj(h) && h.place && h.at).map(h => ({ place: String(h.place), at: String(h.at) })),
            wants: str(p.wants).trim(), plans: arr(p.plans).map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 3), ...(p.hidden === true ? { hidden: true } : {}),
            ...(p.fav === true ? { fav: true } : {}),   // ★ a favorite: first in the Cast tab's People (Miinthe 2026-10-18, per board)
            speaks: ['call', 'suggest', 'self', 'mine'].includes(p.speaks) ? p.speaks : 'suggest',
            appears: ['off', 'places', 'plans'].includes(p.appears) ? p.appears : 'plans', odds: Number(p.odds) >= 1 ? Math.round(Number(p.odds)) : 3, ...note(p) }));   // appearing (step 2)   // when they speak (step 3): call only · suggests themselves · steps in by themselves
        return { ...base, people, pinHere: t.pinHere !== false, setsPresent: t.setsPresent === true, director: t.director !== false, ...(t.keep ? { keep: entryPart(t.keep) } : {}) };
    }
    // state
    const fields = withIds(arr(t.fields).filter(isObj)).map(f => {
        const type = FIELD_TYPES.includes(f.type) ? f.type : 'choice';
        if (type === 'day') return { id: f.id, type, name: str(f.name, 'Day'), start: Math.max(1, num(f.start, 1)) };
        const values = arr(f.values).map(String).filter(Boolean);
        return { id: f.id, type, name: str(f.name, type === 'cycle' ? 'Cycle' : 'Choice'), values: values.length ? values : ['…'], ...(type === 'cycle' && f.addsDay ? { addsDay: true } : {}) };
    });
    const dates = withIds(arr(t.dates).filter(isObj)).map(d => ({ id: d.id, name: str(d.name, 'Date'), due: Math.max(1, Math.round(num(d.due, 1))), by: d.by === 'ai' ? 'ai' : 'you', ...(d.by === 'ai' && d.q ? { q: String(d.q), m: num(d.m) } : {}) }));
    return { ...base, fields, dates, datesGrow: t.datesGrow === true, datesAsk: t.datesAsk === 'ask' ? 'ask' : 'auto' };
}

/**
 * Bring any stored board to the v2 shape: a v1 board is converted (see migrateV1),
 * a damaged one is repaired as far as possible. Never throws.
 */
export function normalizeBoard(raw, fallbackName = 'Storyboard') {
    const b = isObj(raw) ? raw : {};
    if (b.v !== BOARD_VERSION) return migrateV1(b, fallbackName);
    const trackers = withIds(arr(b.trackers).filter(isObj)).map(normTracker);
    const ids = new Set(trackers.map(t => t.id));
    return {
        v: BOARD_VERSION, name: str(b.name, fallbackName) || fallbackName,
        folders: arr(b.folders).map(String), applied: arr(b.applied).map(String), off: arr(b.off).map(String),
        mode: b.mode === 'immersion' ? 'immersion' : 'director',
        ...(b.steer === true ? { steer: true } : {}),   // LOCAL PATCH (Miinthe, 2026-10-19): the writer hears the next step, gently (board-links-pure steerLines)
        ask: { level: ['rarely', 'some', 'often'].includes(b.ask?.level) ? b.ask.level : 'some', found: b.ask?.found !== false, unsure: b.ask?.unsure !== false, suggest: b.ask?.suggest === true },
        exclusive: arr(b.exclusive).filter(c => isObj(c) && ids.has(c.a) && ids.has(c.b) && c.a !== c.b)
            .map(c => ({ a: c.a, b: c.b, ...(num(c.color) >= 1 && num(c.color) <= 6 ? { color: Math.round(num(c.color)) } : {}), ...(c.own === true ? { own: true } : {}), ...note(c) })),
        ...(isObj(b.look) ? { look: b.look } : {}), ...note(b), trackers,
        ...(isObj(b.world) ? { world: normWorld(b.world) } : {}),   // world layer (Miinthe, 2026-10-19)
    };
}

/**
 * v1 → v2. A v1 board: { name, trackers: [{ id, name, steps: [string], direction, skip,
 * starts: [{ tracker, step: name }], needs: [{ step: name, tracker, reach: name }], onFall }] }.
 * Step names become step objects with ids; conditions point at those ids; a v1 tracker-level
 * `needs` moves onto the step it guards.
 */
export function migrateV1(b, fallbackName = 'Storyboard') {
    const list = withIds(arr(b.trackers).filter(t => isObj(t) && Array.isArray(t.steps)));
    const shaped = list.map(t => ({ ...t, steps: withIds(t.steps.map(s => (typeof s === 'string' ? { name: s } : s))) }));
    const byRef = ref => shaped.find(t => t.id === ref) || shaped.find(t => low(t.name) === low(ref));
    const stepId = (t, name) => t?.steps.find(s => low(s.name) === low(name))?.id;
    // a v1 condition names the step to reach: `step` on starts, `reach` on needs (whose `step` is the guarded one)
    const conv = (c, want) => { const src = byRef(c?.tracker); const sid = stepId(src, want); return src && sid ? { tracker: src.id, step: sid, ...(c.color ? { color: c.color } : {}) } : null; };
    const trackers = shaped.map(t => {
        const steps = t.steps.map(s => ({ ...s, needs: arr(t.needs).filter(n => low(n.step) === low(s.name)).map(n => conv(n, n.reach)).filter(Boolean) }));
        return { ...t, kind: 'steps', steps, starts: arr(t.starts).map(c => conv(c, c.step)).filter(Boolean), needs: undefined };
    });
    return normalizeBoard({ v: BOARD_VERSION, name: str(b.name, fallbackName), folders: b.folders, applied: b.applied, trackers }, fallbackName);
}

// ── lookups ─────────────────────────────────────────────────────────────────

export const trackerOf = (board, id) => arr(board?.trackers).find(t => t.id === id) || null;
export const stepIndex = (t, stepId) => arr(t?.steps).findIndex(s => s.id === stepId);
export const stepOf = (t, stepId) => arr(t?.steps).find(s => s.id === stepId) || null;
export const forkAt = (t, stepId) => stepOf(t, stepId)?.fork?.branches || [];
export const branchOf = (t, stepId, branchId) => forkAt(t, stepId).find(b => b.id === branchId) || null;
export const itemOf = (col, id) => arr(col?.items).find(i => i.id === id) || null;
export const placeOf = (t, id) => arr(t?.places).find(p => p.id === id) || null;
export const fieldOf = (t, id) => arr(t?.fields).find(f => f.id === id) || null;
export const dateOf = (t, id) => arr(t?.dates).find(d => d.id === id) || null;
export const isEndFork = (t, stepId) => stepIndex(t, stepId) === arr(t?.steps).length - 1;

/** What a branch does afterwards: 'on' (next step; default in the middle), 'end' (default at the end), 'back' (go to a step), 'next' (a new tracker). */
export const thenOf = (t, stepId, b) => b?.then?.kind || (isEndFork(t, stepId) ? 'end' : 'on');

/** The place and everything it sits in, innermost first. */
export function chainOf(t, placeId) {
    const out = []; let p = placeOf(t, placeId);
    while (p && out.length < 16 && !out.includes(p)) { out.push(p); p = placeOf(t, p.parent); }
    return out;
}

// ── a chat's place on the board ─────────────────────────────────────────────

/**
 * The chat's state for a v2 board:
 *   { v: 2,
 *     trackers:    { [id]: { at: stepId | null (waiting), aside?: detourId, started?, startedAt?, run?: 'paused'|'abandoned', forks?: { [stepId]: branchId } } },
 *     collections: { [id]: { items: { [itemId]: { state, amount? } }, purse: { [purseId]: n }, pending: [ new things waiting for Miinthe's yes ], refused?: [ names she said no to ] } },
 *     counters:    { [id]: n },
 *     places:      { [id]: placeId },
 *     states:      { [id]: { day, vals: { [fieldId]: value } } } }
 * Anything missing reads as the start: first step (or waiting when it has start conditions),
 * every item in the first state, a purse at its start, the first place, day `start`.
 */
export function freshState(board) {
    const st = { v: BOARD_VERSION, trackers: {}, collections: {}, counters: {}, places: {}, states: {}, cast: {} };
    for (const t of arr(board?.trackers)) resetInto(st, t);
    return st;
}

function resetInto(st, t) {
    if (t.kind === 'steps') st.trackers[t.id] = { at: t.starts.length ? null : t.steps[0]?.id ?? null };
    else if (t.kind === 'collection') st.collections[t.id] = { items: {}, purse: Object.fromEntries(arr(t.purse).map(p => [p.id, p.start])), pending: [] };
    else if (t.kind === 'counter') st.counters[t.id] = t.start;
    else if (t.kind === 'place') st.places[t.id] = t.places[0]?.id ?? null;
    else if (t.kind === 'state') st.states[t.id] = { day: fieldOfType(t, 'day')?.start ?? 1, vals: {} };
    else if (t.kind === 'cast') (st.cast ||= {})[t.id] = {};
}
const fieldOfType = (t, type) => arr(t?.fields).find(f => f.type === type) || null;

/** Repair a stored chat state against its board (new trackers get their start; removed ones drop out). */
export function normalizeState(raw, board) {
    const fresh = freshState(board);
    const s = isObj(raw) && raw.v === BOARD_VERSION ? raw : {};
    const out = freshState(board);
    for (const t of arr(board?.trackers)) {
        if (t.kind === 'steps') {
            const p = isObj(s.trackers?.[t.id]) ? s.trackers[t.id] : null;
            if (!p) continue;
            // waiting (null) only makes sense while it has start conditions — one whose last start line was removed runs from its first step
            const at = p.at === null ? fresh.trackers[t.id].at : stepOf(t, p.at) ? p.at : fresh.trackers[t.id].at;
            out.trackers[t.id] = { ...p, at, forks: isObj(p.forks) ? Object.fromEntries(Object.entries(p.forks).filter(([sid, bid]) => branchOf(t, sid, bid))) : {} };
            if (p.aside && !stepOf(t, at)?.detours?.some(d => d.id === p.aside)) delete out.trackers[t.id].aside;
        } else if (t.kind === 'collection' && isObj(s.collections?.[t.id])) {
            const c = s.collections[t.id];
            out.collections[t.id] = { items: Object.fromEntries(Object.entries(isObj(c.items) ? c.items : {}).filter(([iid, v]) => itemOf(t, iid) && isObj(v) && t.states.some(x => x.id === v.state))),
                purse: { ...fresh.collections[t.id].purse, ...(isObj(c.purse) ? Object.fromEntries(Object.entries(c.purse).filter(([pid]) => arr(t.purse).some(p => p.id === pid)).map(([k, v]) => [k, num(v)])) : {}) },
                pending: arr(c.pending).filter(p => isObj(p) && p.name), ...(arr(c.refused).length ? { refused: arr(c.refused).map(String) } : {}) };
        } else if (t.kind === 'counter' && s.counters?.[t.id] !== undefined) out.counters[t.id] = num(s.counters[t.id], t.start);
        else if (t.kind === 'place' && placeOf(t, s.places?.[t.id])) out.places[t.id] = s.places[t.id];
        else if (t.kind === 'state' && isObj(s.states?.[t.id])) {
            const v = s.states[t.id];
            out.states[t.id] = { day: Math.max(1, num(v.day, out.states[t.id].day)), vals: Object.fromEntries(Object.entries(isObj(v.vals) ? v.vals : {}).filter(([fid, val]) => fieldOf(t, fid)?.values?.includes(val))) };
            // dates the story added in THIS chat (state-pure.js) — the board's own dates stay on the board
            const own = arr(v.dates).filter(d => isObj(d) && d.id && d.name && Number.isFinite(Number(d.due)));
            if (own.length) out.states[t.id].dates = own.map(d => ({ ...d, due: Math.round(Number(d.due)) }));
        } else if (t.kind === 'cast' && isObj(s.cast?.[t.id])) {
            // each person as this chat has them (cast-pure.js personNow reads it; what's missing is the board's)
            const ids = new Set(arr(t.people).map(p => p.id));
            out.cast[t.id] = Object.fromEntries(Object.entries(s.cast[t.id]).filter(([pid, v]) => ids.has(pid) && isObj(v)).map(([pid, v]) => [pid, {
                ...(v.here === true ? { here: true } : {}), ...(typeof v.wants === 'string' ? { wants: v.wants } : {}),
                ...(v.muted === true ? { muted: true } : {}),   // 🔇 muted in this chat (Miinthe 2026-10-18)
                ...(Array.isArray(v.plans) ? { plans: v.plans.filter(x => isObj(x) && x.text).map(x => ({ id: String(x.id ?? ''), text: String(x.text), ...(Number.isFinite(x.i) ? { i: x.i } : {}) })) } : {}),
                ...(isObj(v.thoughts) && v.thoughts.text ? { thoughts: { text: String(v.thoughts.text), ...(Number.isFinite(v.thoughts.i) ? { i: v.thoughts.i } : {}) } } : {}),
                ...(arr(v.rolled).length ? { rolled: arr(v.rolled).map(String).slice(-12) } : {}),
                // what they did while away (cast-pure offscreenChanges) — was dropped here, so the Cast tab never showed it (found 2026-10-18)
                ...(arr(v.offscreen).length ? { offscreen: arr(v.offscreen).filter(x => isObj(x) && x.text).map(x => ({ text: String(x.text), ...(Number.isFinite(x.from) ? { from: x.from } : {}), ...(Number.isFinite(x.to) ? { to: x.to } : {}) })) } : {}),
                // ties (2026-11-02): how they feel about someone — cast-pure.js normTie keeps the shape
                ...(arr(v.ties).length ? { ties: arr(v.ties).filter(x => isObj(x) && x.to && x.w).map(x => ({ to: String(x.to), w: String(x.w), ...(x.tr === 'up' || x.tr === 'down' ? { tr: x.tr } : {}), ...(x.q ? { q: String(x.q) } : {}), ...(Number.isFinite(x.i) ? { i: x.i } : {}), ...(x.pin === true ? { pin: true } : {}) })) } : {}),
                ...(arr(v.knows).length ? { knows: arr(v.knows).filter(k => isObj(k) && k.fact).map(k => ({ id: String(k.id ?? ''), fact: String(k.fact), how: String(k.how || 'saw'), ...(k.quote ? { quote: String(k.quote) } : {}), ...(Number.isFinite(k.i) ? { i: k.i } : {}) })) } : {}),
            }]));
        }
    }
    // pause / abandon of the kinds without steps (steps keep theirs on the tracker)
    const runs = isObj(s.runs) ? Object.fromEntries(Object.entries(s.runs).filter(([id, v]) => ['paused', 'abandoned'].includes(v) && trackerOf(board, id) && trackerOf(board, id).kind !== 'steps')) : {};
    if (Object.keys(runs).length) out.runs = runs;
    // what changed by itself, by message (collections-pure.js) — for Undo, rewinds and the timeline
    if (Array.isArray(s.log) && s.log.length) { out.log = s.log.slice(); if (Number.isFinite(s.logDropped)) out.logDropped = s.logDropped; capLog(out); }
    if (Array.isArray(s.undone) && s.undone.length) out.undone = s.undone.slice(-20);
    if (s.v2steps === true) out.v2steps = true;
    if (s.stepsRebuilt) out.stepsRebuilt = 1;   // engine on v2, step 6: the step log was rebuilt from the list's history   // engine on v2, step 1: step moves are logged here too (board-live.js recordSteps)
    if (Number.isFinite(s.v2since)) out.v2since = s.v2since;
    if (isObj(s.lastRun) && trackerOf(board, s.lastRun.id)) out.lastRun = s.lastRun;   // the Undo of pausing a collection / place / state (was dropped by every save)
    if (Number.isFinite(s.logDropped) && !Number.isFinite(out.logDropped)) out.logDropped = s.logDropped;   // the message from which the v2 log holds every step move
    // the timeline's chapters (board window): { name, from, to, c }
    const ch = arr(s.chapters).filter(c => isObj(c) && c.name && Number.isFinite(Number(c.from)) && Number.isFinite(Number(c.to)));
    if (ch.length) out.chapters = ch.map(c => ({ name: String(c.name), from: Number(c.from), to: Number(c.to), c: Number(c.c) || 1 }));
    // triggers + odds (rolls-pure.js): the rolls made, the triggers fired, the triggers Undo stopped
    if (isObj(s.rolls) && Object.keys(s.rolls).length) out.rolls = { ...s.rolls };
    if (isObj(s.fired) && Object.keys(s.fired).length) out.fired = { ...s.fired };
    if (Array.isArray(s.denied) && s.denied.length) out.denied = s.denied.slice(-100);
    return out;
}

// pure readers of a chat state
export const runOf = (st, t) => (t?.kind === 'steps' ? st?.trackers?.[t.id]?.run : st?.runs?.[t?.id]) || null;
export const itemState = (st, col, itemId) => st?.collections?.[col.id]?.items?.[itemId]?.state || col.states[0].id;
export const itemAmount = (st, col, itemId) => num(st?.collections?.[col.id]?.items?.[itemId]?.amount, 0);
export const purseValue = (st, col, purseId) => num(st?.collections?.[col.id]?.purse?.[purseId], arr(col.purse).find(p => p.id === purseId)?.start ?? 0);
export const counterValue = (st, t) => num(st?.counters?.[t.id], t.start);
export const hereOf = (st, t) => st?.places?.[t.id] ?? t.places[0]?.id ?? null;
export const stateNow = (st, t) => st?.states?.[t.id] || { day: fieldOfType(t, 'day')?.start ?? 1, vals: {} };
export const fieldValue = (st, t, f) => (f.type === 'day' ? stateNow(st, t).day : stateNow(st, t).vals?.[f.id] ?? f.values?.[0]);

// ── conditions: do they hold right now? ─────────────────────────────────────

/** Is a steps tracker running in this chat (started, not waiting, not abandoned)? */
export function isRunning(board, st, t) {
    if (!t || t.kind !== 'steps') return false;
    const p = st?.trackers?.[t.id];
    return !!p && p.at != null && p.run !== 'abandoned';
}
export const isWaiting = (board, st, t) => t?.kind === 'steps' && t.starts.length > 0 && (st?.trackers?.[t.id]?.at ?? null) === null && runOf(st, t) !== 'abandoned';

/**
 * Does condition `c` hold for this chat? `rolls` (optional) answers conditions with odds:
 * a map from a condition key to true / false, set when the roll happened (see rollKey).
 * Without an entry, a condition with odds counts as NOT yet holding — it has not been rolled.
 */
export function holds(board, st, c, rolls = null) {
    const base = holdsBase(board, st, c);
    if (!base || !(c.odds > 1)) return base;
    return rolls ? rolls[rollKey(c)] === true : false;
}
export const rollKey = c => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => !['color', 'own', 'note', 'odds', 'retry', 'line'].includes(k)).sort()));
/** A line's own key — tracker + kind + condition — so a start and a trigger on the same condition roll apart. */
export const lineKey = (kind, trackerId, c) => `${kind}|${trackerId}|${rollKey(c)}`;
/** The condition without its odds (needs, blocks: odds don't count there — Miinthe, 2026-10-04). */
export const certain = c => { if (!c) return c; const { odds: _o, retry: _r, line: _l, ...rest } = c; return rest; };

function holdsBase(board, st, c) {
    if (!c) return false;
    if (c.world) {
        const t = trackerOf(board, c.world); if (!t) return false;
        const now = stateNow(st, t);
        if (c.due) { const d = dateOf(t, c.due); return !!d && now.day >= d.due; }
        const f = fieldOf(t, c.field); if (!f) return false;
        return f.type === 'day' ? now.day >= c.min : fieldValue(st, t, f) === c.is;
    }
    if (c.place) { const t = trackerOf(board, c.place); return !!t && chainOf(t, hereOf(st, t)).some(p => p.id === c.at); }
    if (c.cast) { const t = trackerOf(board, c.cast); return !!t && arr(t.people).some(p => p.id === c.person) && st?.cast?.[t.id]?.[c.person]?.here === true; }
    if (c.counter) { const t = trackerOf(board, c.counter); if (!t) return false; if (c.band) { const b = bandById(t, c.band); return !!b && counterValue(st, t) >= b.from; } return counterValue(st, t) >= c.min; }
    if (c.collection) {
        const col = trackerOf(board, c.collection); if (!col) return false;
        if (c.purse) return purseValue(st, col, c.purse) >= c.min;
        const want = c.state || col.states[1]?.id;
        if (c.item && c.amount) return itemState(st, col, c.item) === col.states[1]?.id && itemAmount(st, col, c.item) >= c.amount;
        if (c.item) return itemState(st, col, c.item) === want;
        return col.items.filter(it => itemState(st, col, it.id) === want).length >= c.count;
    }
    const src = trackerOf(board, c.tracker);
    if (!src) return false;
    if (c.running) return isRunning(board, st, src) && runOf(st, src) !== 'paused';
    // a branch taken there — now, or before and gone back past since (the branch history; engine on v2, step 7c)
    if (c.branch) { const p = st?.trackers?.[src.id]; return p?.forks?.[c.at] === c.branch || arr(p?.branchLog).some(x => x.at === c.at && x.branch === c.branch); }
    if (!isRunning(board, st, src)) return false;
    const at = stepIndex(src, st.trackers[src.id].at), want = stepIndex(src, c.step);
    return want >= 0 && at >= want;
}

/** Its start lines all hold now (a line with odds: once its roll came up — rolls-pure.js keeps it under the line's key). */
export function startsHold(board, st, t) {
    return arr(t?.starts).every(c => (c.odds > 1 ? st?.rolls?.[lineKey('start', t.id, c)]?.ok === true && holds(board, st, certain(c)) : holds(board, st, c)));
}

/**
 * Why a tracker is paused right now (null if it isn't): by you; set to pause when its start falls and it no longer
 * holds (engine on v2, step 7c — the engine's rule, now the board's too); by a block; or another holds the floor.
 */
export function pausedBy(board, st, t) {
    if (runOf(st, t) === 'paused') return 'you paused it';
    if (t.onFall === 'pause' && arr(t.starts).length && isRunning(board, st, t) && !startsHold(board, st, t)) return 'its start no longer holds';
    const b = arr(t.blocks).find(c => (c.step ? isAt(board, st, c) : holds(board, st, c)));
    if (b) return blockClause(board, b);
    const ex = arr(board?.exclusive).find(e => e.b === t.id && isRunning(board, st, trackerOf(board, e.a)));
    return ex ? `${trackerOf(board, ex.a).name} holds the floor` : null;
}
/** A block on a step means "while it is AT that step", not "reached". */
function isAt(board, st, c) {
    const src = trackerOf(board, c.tracker);
    return !!src && isRunning(board, st, src) && st.trackers[src.id].at === c.step;
}

/** Running and not paused: the helper watches it, the writer is told, its lore can show. */
export function isActive(board, st, t) {
    if (t.kind !== 'steps') return runOf(st, t) == null;
    return isRunning(board, st, t) && !pausedBy(board, st, t);
}

/** The conditions keeping step `stepId` of tracker `t` closed right now (empty = open). */
export function unmetNeeds(board, st, t, stepId, _rolls = null) {   // odds don't count on needs (rolls-pure.js)
    const s = stepOf(t, stepId); if (!s) return [];
    const open = arr(s.needs).filter(c => !holds(board, st, certain(c)));
    const locked = arr(s.blocks).filter(c => (c.step ? isAt(board, st, c) : holds(board, st, c)));
    return [...open, ...locked];
}

/** A tracker stands on a step whose fork is not decided yet — it waits there. */
export function waitsAtFork(board, st, t) {
    const p = st?.trackers?.[t.id];
    return !!p && p.at != null && forkAt(t, p.at).length > 0 && !p.forks?.[p.at];
}

/** Waiting trackers whose start conditions now hold — they start (a chain resolves in one go). */
export function startsNow(board, st, rolls = null) {
    const next = structuredClone(st), started = [];
    for (let guard = 0; guard <= arr(board?.trackers).length; guard++) {
        let changed = false;
        for (const t of arr(board?.trackers)) {
            if (!isWaiting(board, next, t) || !t.starts.every(c => holds(board, next, c, rolls))) continue;
            next.trackers[t.id] = { ...(next.trackers[t.id] || {}), at: t.steps[0].id, started: true };
            started.push({ id: t.id, name: t.name, why: t.starts.map(c => condText(board, c)).join(' and ') });
            changed = true;
        }
        if (!changed) break;
    }
    return { state: next, started };
}

/** Pause / continue / abandon / reactivate — in this chat only. Abandon resets to the start. */
export function setRun(board, st, t, run) {
    const next = structuredClone(st);
    if (run === 'abandoned') { resetInto(next, t); if (t.kind === 'steps') next.trackers[t.id].run = 'abandoned'; else (next.runs ||= {})[t.id] = 'abandoned'; }
    else if (run === 'paused') { if (t.kind === 'steps') next.trackers[t.id] = { ...(next.trackers[t.id] || {}), run: 'paused' }; else (next.runs ||= {})[t.id] = 'paused'; }
    else if (t.kind === 'steps') {
        const was = next.trackers[t.id]?.run;
        if (was === 'abandoned') resetInto(next, t); else if (next.trackers[t.id]) delete next.trackers[t.id].run;
    } else if (next.runs) delete next.runs[t.id];
    return next;
}

// ── the sentence builder ────────────────────────────────────────────────────

const fmtPurse = (p, v) => (p ? (p.before ? `${p.unit}${v}` : `${v} ${p.unit}`) : String(v));
const fmtCount = (t, v) => `${t.unit && t.unitBefore ? t.unit : ''}${v}${t.unit && !t.unitBefore ? ' ' + t.unit : ''}`;

/** The clause of a condition — fits after "when" / "once" (design §6). */
export function condText(board, c) {
    return condBase(board, c) + (c.odds > 1 ? `, with a 1 in ${c.odds} chance` : '');
}
export function condBase(board, c) {
    if (!c) return '?';
    if (c.world) {
        const t = trackerOf(board, c.world);
        if (c.due) return `${dateOf(t, c.due)?.name ?? '?'} is due`;
        const f = fieldOf(t, c.field);
        return !f ? '?' : f.type === 'day' ? `it is at least Day ${c.min}` : `the ${f.name.toLowerCase()} is ${c.is}`;
    }
    if (c.place) return `the scene is at 📍 ${placeOf(trackerOf(board, c.place), c.at)?.name ?? '?'}`;
    if (c.cast) return `${arr(trackerOf(board, c.cast)?.people).find(p => p.id === c.person)?.name ?? '?'} is in the scene`;
    if (c.counter) { const t = trackerOf(board, c.counter); if (!t) return '?'; if (c.band) return `${t.name} reaches ${bandById(t, c.band)?.name ?? '?'}`; return `${t.name} is at least ${fmtCount(t, c.min)}`; }
    if (c.collection) {
        const col = trackerOf(board, c.collection); if (!col) return '?';
        if (c.purse) return `the ${col.name} has ${fmtPurse(arr(col.purse).find(p => p.id === c.purse), c.min)}`;
        const st = col.states.find(x => x.id === (c.state || col.states[1]?.id)) || col.states[1] || col.states[0];
        const name = itemOf(col, c.item)?.name ?? '?';
        if (c.item && c.amount) return `the ${col.name} has ${c.amount} × ${name}`;
        if (c.item) return `${name} is ${st.label}`;
        return `${c.count} of the ${col.name} ${c.count === 1 ? 'is' : 'are'} ${st.label}`;
    }
    const t = trackerOf(board, c.tracker), tn = t?.name ?? '?';
    if (c.running) return `while ${tn} is running`;
    if (c.branch) { const b = branchOf(t, c.at, c.branch)?.name ?? '?'; return isEndFork(t, c.at) ? `${tn} ends in ${b}` : `${tn} takes “${b}” after ${stepOf(t, c.at)?.name ?? '?'}`; }
    return `${tn} reaches ${stepOf(t, c.step)?.name ?? '?'}`;
}
export function blockClause(board, c) {
    const tn = trackerOf(board, c.tracker)?.name ?? '?';
    if (c.running) return `while ${tn} is running`;
    if (c.branch) return `once ${condBase(board, c)}`;
    if (c.tracker) return `while ${tn} is at ${stepOf(trackerOf(board, c.tracker), c.step)?.name ?? '?'}`;
    return `while ${condBase(board, c)}`;
}

/**
 * Every line on the board as a sentence — what the board draws, the Connections overview
 * lists and the panels show. kind: start · need · block · excl · trigger.
 */
export function lines(board) {
    const out = [];
    for (const t of arr(board?.trackers)) {
        t.starts.forEach((c, k) => out.push({ kind: 'start', c, to: { tracker: t.id }, key: `s|${t.id}|${k}`, text: `${t.name} starts when ${condText(board, c)}` }));
        t.blocks.forEach((c, k) => out.push({ kind: 'block', c, to: { tracker: t.id }, key: `b|${t.id}|${k}`, text: `${t.name} is paused ${blockClause(board, c)}` }));
        if (t.kind === 'steps') {
            t.steps.forEach(s => {
                s.needs.forEach((c, k) => out.push({ kind: 'need', c, to: { tracker: t.id, step: s.id }, key: `n|${t.id}|${s.id}|${k}`, text: `${s.name} (${t.name}) only possible once ${condText(board, c)}` }));
                s.blocks.forEach((c, k) => out.push({ kind: 'block', c, to: { tracker: t.id, step: s.id }, key: `x|${t.id}|${s.id}|${k}`, text: `${s.name} (${t.name}) is locked ${blockClause(board, c)}` }));
            });
            t.triggers.forEach((c, k) => out.push({ kind: 'trigger', c, to: { tracker: t.id, step: c.to }, key: `g|${t.id}|${k}`, text: `When ${condText(board, c)}, ${t.name} moves to ${stepOf(t, c.to)?.name ?? '?'}` }));
        }
        if (isMeter(t)) t.meter.bands.forEach(b => b.needs.forEach((c, k) => out.push({ kind: 'need', c, to: { tracker: t.id, band: b.id }, key: `m|${t.id}|${b.id}|${k}`, text: `${t.name} can only reach ${b.name} once ${condText(board, c)}` })));
        if (t.kind === 'collection') t.items.forEach(it => it.needs.forEach((c, k) => out.push({ kind: 'need', c, to: { tracker: t.id, item: it.id }, key: `i|${t.id}|${it.id}|${k}`, text: `${it.name} (${t.name}) can only become ${t.states[1]?.label ?? 'active'} once ${condText(board, c)}` })));
        // triggers that offer an item to find (rolls-pure.js) — "while the scene is at the Pantry, 1 in 2: there is glue"
        if (t.kind === 'collection') t.items.forEach(it => arr(it.finds).forEach((c, k) => out.push({ kind: 'trigger', c, to: { tracker: t.id, item: it.id }, key: `f|${t.id}|${it.id}|${k}`, text: `When ${condText(board, c)}, ${it.name} (${t.name}) is there to be found` })));
    }
    arr(board?.exclusive).forEach((e, k) => out.push({ kind: 'excl', c: e, to: { tracker: e.b }, key: `e|${k}`, text: `Only one of ${trackerOf(board, e.a)?.name} and ${trackerOf(board, e.b)?.name} at a time — whichever starts first holds the floor` }));
    return out;
}

// ── Check: is something broken? ─────────────────────────────────────────────

/**
 * Structural problems of a board (no vault needed). Each: { sev: 'error'|'warn'|'info', text, at }.
 * Errors: a line points at something that no longer exists; a trigger / branch / fall-back goes
 * to a missing step; trackers waiting on each other in a circle. Warnings: a fork with one branch,
 * a step without an entry. Notes: a branch without an entry.
 */
export function checkBoard(board) {
    const out = [], add = (sev, text, at) => out.push({ sev, text, at });
    const T = id => trackerOf(board, id);
    const missing = c => {
        if (c.world) { const t = T(c.world); return !t || t.kind !== 'state' ? 'a state tracker' : c.due ? (!dateOf(t, c.due) && 'a date') : (!fieldOf(t, c.field) && 'a field'); }
        if (c.place) { const t = T(c.place); return !t || t.kind !== 'place' ? 'a place tracker' : !placeOf(t, c.at) && 'a place'; }
        if (c.cast) { const t = T(c.cast); return !t || t.kind !== 'cast' ? 'a cast' : !arr(t.people).some(p => p.id === c.person) && 'a person'; }
        if (c.counter) { const t = T(c.counter); if (!t || t.kind !== 'counter') return 'a counter'; return c.band ? !bandById(t, c.band) && 'a band' : false; }
        if (c.collection) { const col = T(c.collection); if (!col || col.kind !== 'collection') return 'a collection';
            if (c.purse) return !arr(col.purse).some(p => p.id === c.purse) && 'a purse';
            if (c.item && !itemOf(col, c.item)) return 'an item';
            if (c.state && !col.states.some(s => s.id === c.state)) return 'a state';
            if (!c.item && c.count > col.items.length) return `${c.count} items (it has ${col.items.length})`;
            return false; }
        const src = T(c.tracker); if (!src || src.kind !== 'steps') return 'a tracker';
        if (c.branch) return !branchOf(src, c.at, c.branch) && 'a branch';
        if (c.step) return !stepOf(src, c.step) && 'a step';
        return false;
    };
    for (const l of lines(board)) { if (l.kind === 'excl') continue; const m = missing(l.c); if (m) add('error', `${l.text.replace(/\?/g, '…')} — it points at ${m} that no longer exists.`, l.to); }
    // odds count only on starts and triggers (Miinthe, 2026-10-04) — elsewhere the line holds as if certain
    for (const l of lines(board)) if (l.c?.odds > 1 && !['start', 'trigger'].includes(l.kind)) add('warn', `${l.text} — odds only count on “starts when” and trigger lines; this one holds as if certain.`, l.to);
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        t.steps.forEach(s => {
            if (s.fallTo && !stepOf(t, s.fallTo.step)) add('error', `${s.name} (${t.name}) falls back to a step that no longer exists.`, { tracker: t.id, step: s.id });
            if (s.fallTo?.detour && !stepOf(t, s.fallTo.step)?.detours?.some(d => d.id === s.fallTo.detour)) add('error', `${s.name} (${t.name}) falls back into a detour that no longer exists.`, { tracker: t.id, step: s.id });
            const br = forkAt(t, s.id);
            if (br.length === 1) add('warn', `The fork after ${s.name} (${t.name}) has only one branch.`, { tracker: t.id, step: s.id });
            br.forEach(b => {
                if (b.then?.kind === 'back' && !stepOf(t, b.then.step)) add('error', `${b.name} (${t.name}) goes to a step that no longer exists.`, { tracker: t.id, step: s.id, branch: b.id });
                if (b.then?.kind === 'next' && !T(b.then.tracker)) add('error', `${b.name} (${t.name}) continues as a tracker that no longer exists.`, { tracker: t.id, step: s.id, branch: b.id });
                if (!b.entries.length) add('info', `The branch “${b.name}” of ${t.name} has no entry yet.`, { tracker: t.id, step: s.id, branch: b.id });
            });
            if (!s.entries.length) add('warn', `${s.name} (${t.name}) has no entry — the writer gets nothing extra there.`, { tracker: t.id, step: s.id });
        });
    }
    // trackers waiting on each other in a circle never start
    const waitsOn = t => arr(t.starts).map(c => c.tracker || c.collection || c.counter || c.place || c.world || c.cast).filter(Boolean);
    const seen = new Set();
    for (const t of arr(board?.trackers)) {
        const stack = [[t.id, [t.id]]];
        while (stack.length) {
            const [id, path] = stack.pop();
            for (const nx of waitsOn(T(id) || { starts: [] })) {
                if (nx === t.id && path.length > 1) { const key = [...path].sort().join('|'); if (!seen.has(key)) { seen.add(key); add('error', `${path.map(x => T(x)?.name).join(' → ')} → ${t.name}: these wait on each other and never start.`, { tracker: t.id }); } }
                else if (!path.includes(nx) && path.length < 12) stack.push([nx, [...path, nx]]);
            }
        }
    }
    return out;
}

// ── v1 engine list ⇄ v2 chat state ──────────────────────────────────────────

/**
 * The v1 engine list (chat_metadata.deeplore_trackers) for the steps trackers of a v2 board,
 * so the existing helper, writer block and journal keep working. Collections, places and
 * state have no v1 form and are left out. `prev` keeps journal, last moves and undo memory.
 */
export function toEngineList(board, st, prev = []) {
    const old = arr(prev);
    return arr(board?.trackers).filter(t => t.kind === 'steps').map(t => {
        const p = st?.trackers?.[t.id] || {}, keep = old.find(x => x.id === t.id) || {};
        const index = Math.max(0, stepIndex(t, p.at ?? p.waitAt));
        const aside = p.aside ? stepOf(t, p.at)?.detours?.find(d => d.id === p.aside)?.name ?? null : p.asideText || null;
        const onceAsides = [...new Set(t.steps.flatMap(s => arr(s.detours).filter(d => d.once === true).map(d => d.name)))];   // detours the helper may set once per chat
        const col = c => (c.color ? { color: c.color } : {});    // the line's colour on the board
        const sName = (tid, sid) => stepOf(trackerOf(board, tid), sid)?.name;
        const bName = (tid, sid, bid) => branchOf(trackerOf(board, tid), sid, bid)?.name;
        // a line waiting for a fork branch (forks-pure.js): { tracker, at: step name, branch: branch name }
        const branchCond = c => (c.tracker && c.branch && sName(c.tracker, c.at) && bName(c.tracker, c.at, c.branch) ? { tracker: c.tracker, at: sName(c.tracker, c.at), branch: bName(c.tracker, c.at, c.branch), ...col(c) } : null);
        // a line from a collection, counter, place or state: the board answers it (board-live.js)
        const extCond = c => (c.collection || c.counter || c.place || c.world ? { ext: certain(c) } : null);
        // a start with odds: the board rolls it once and answers it (rolls-pure.js, board-live.js)
        const oddsStart = c => (c.odds > 1 ? { ext: { ...c, line: lineKey('start', t.id, c) }, ...col(c) } : null);
        const starts = t.starts.map(c => oddsStart(c) || (c.tracker && c.step ? { tracker: c.tracker, step: sName(c.tracker, c.step), ...col(c) } : branchCond(c) || extCond(c))).filter(Boolean);
        const needs = t.steps.flatMap(s => s.needs.map(c => (c.tracker && c.step ? { step: s.name, tracker: c.tracker, reach: sName(c.tracker, c.step), ...col(c) } : branchCond(c) ? { step: s.name, ...branchCond(c) } : extCond(c) ? { step: s.name, ...extCond(c) } : null)).filter(Boolean));
        // forks after steps, by name, as the engine's list carries them
        const forks = Object.fromEntries(t.steps.filter(s => s.fork?.branches?.length).map(s => [s.name, {
            by: s.fork.by,
            branches: s.fork.branches.map(b => ({ name: b.name, ...(b.weight ? { weight: b.weight } : {}), ...(b.entries.length ? { entries: [...b.entries] } : {}),
                ...(b.then ? { then: { kind: b.then.kind, ...(b.then.step ? { step: sName(b.then.tracker || t.id, b.then.step) } : {}), ...(b.then.tracker ? { tracker: b.then.tracker } : {}) } } : {}) })),
        }]));
        const took = Object.fromEntries(Object.entries(p.forks || {}).map(([sid, bid]) => [stepOf(t, sid)?.name, branchOf(t, sid, bid)?.name]).filter(([a, b]) => a && b));
        return { ...(isObj(p.memo) ? structuredClone(p.memo) : {}), ...keep, id: t.id, name: t.name, steps: t.steps.map(s => s.name), direction: t.direction, skip: t.skip, index, aside, ...(onceAsides.length ? { onceAsides } : {}),
            ...(starts.length ? { starts } : { starts: undefined }), ...(needs.length ? { needs } : { needs: undefined }), ...(t.onFall === 'pause' ? { onFall: 'pause' } : { onFall: undefined }),
            ...(Object.keys(forks).length ? { forks } : { forks: undefined }), ...(Object.keys(took).length ? { took } : { took: undefined }),
            ...(t.starts.length ? { started: p.at != null, ...(p.startedAt ? { startedAt: p.startedAt } : {}) } : {}),
            run: p.run === 'paused' || p.run === 'abandoned' ? p.run : undefined,   // pause / abandon in this chat
            ...(p.ended ? { ended: { ...p.ended } } : {}),   // engine on v2: an ended tracker, from the v2 state
            ...(Array.isArray(p.branchLog) ? { branchLog: p.branchLog.map(x => ({ step: stepOf(t, x.at)?.name, branch: branchOf(t, x.at, x.branch)?.name, i: x.i })).filter(x => x.step && x.branch) } : {}) };
    });
}

/** Read positions back from a v1 engine list into the v2 chat state (after the helper moved things). */
/** A step tracker's memory, kept on its v2 place (step 7): the Undos of its last automatic move, pause / abandon and
 *  trigger move; moves undone before (not re-applied); refused moves (for the timeline). */
export const MEMO = ['lastAuto', 'lastRun', 'lastTrigger', 'undone', 'refused'];

export function fromEngineList(board, st, list) {
    const next = structuredClone(st || freshState(board));
    for (const e of arr(list)) {
        const t = trackerOf(board, e.id) || arr(board?.trackers).find(x => x.kind === 'steps' && low(x.name) === low(e.name));
        if (!t || t.kind !== 'steps') continue;
        const waiting = t.starts.length > 0 && !e.started;   // v1 leaves `started` unset until it starts
        const step = t.steps[Math.min(Math.max(num(e.index), 0), t.steps.length - 1)];
        const det = e.aside ? step?.detours?.find(d => low(d.name) === low(e.aside)) : null;
        // a waiting tracker moved by hand keeps the step it will start at (`waitAt`, step 3b part 2)
        if (waiting && num(e.index) > 0 && step) next.trackers[t.id] = { ...(next.trackers[t.id] || {}), waitAt: step.id }; else if (next.trackers[t.id]) delete next.trackers[t.id].waitAt;
        next.trackers[t.id] = { ...(next.trackers[t.id] || {}), at: waiting ? null : step?.id ?? null, ...(det ? { aside: det.id } : {}), ...(e.started ? { started: true } : {}), ...(e.startedAt ? { startedAt: e.startedAt } : {}) };
        if (e.ended) next.trackers[t.id].ended = { ...e.ended }; else delete next.trackers[t.id].ended;   // engine on v2, step 1
        // started / started-at exactly as the list says (abandon and reactivate clear them — a stale copy would never wait again)
        if (!e.started) delete next.trackers[t.id].started;
        if (!e.startedAt) delete next.trackers[t.id].startedAt;
        if (!det) delete next.trackers[t.id].aside;
        // the branches the engine took (forks-pure.js), by name → ids
        const forks = {};
        for (const [stepName, brName] of Object.entries(isObj(e.took) ? e.took : {})) {
            const st2 = t.steps.find(x => low(x.name) === low(stepName));
            const br = st2?.fork?.branches.find(b => low(b.name) === low(brName));
            if (st2 && br) forks[st2.id] = br.id;
        }
        next.trackers[t.id].forks = forks;
        // every branch ever taken here (not forgotten by going back — a line waiting for a branch still holds), by ids
        const hist = arr(e.branchLog).map(x => { const s2 = t.steps.find(y => low(y.name) === low(x?.step)); const b2 = s2?.fork?.branches.find(b => low(b.name) === low(x?.branch)); return s2 && b2 ? { at: s2.id, branch: b2.id, i: Math.floor(num(x.i)) } : null; }).filter(Boolean);
        if (hist.length) next.trackers[t.id].branchLog = hist; else delete next.trackers[t.id].branchLog;
        if (e.run === 'paused' || e.run === 'abandoned') next.trackers[t.id].run = e.run; else delete next.trackers[t.id].run;
        // engine on v2, step 7: the tracker's memory (its Undos, what was undone, refused moves) lives here too
        const memo = Object.fromEntries(MEMO.filter(k => e[k] != null && !(Array.isArray(e[k]) && !e[k].length)).map(k => [k, structuredClone(e[k])]));
        if (Object.keys(memo).length) next.trackers[t.id].memo = memo; else delete next.trackers[t.id].memo;
        // a v1 detour set by hand is free text that may not exist on the board — keep it as text, never lose it
        if (!det && typeof e.aside === 'string' && e.aside.trim()) next.trackers[t.id].asideText = e.aside.trim(); else delete next.trackers[t.id].asideText;
    }
    return next;
}

// ── the board's change log: one cap, and a note of what was dropped (engine on v2, 2026-10-05) ──────────────
/** The board's change log keeps its newest LOG_CAP entries (was 300 — a branch far back needs older tracker moves). */
export const LOG_CAP = 1000;
/** Trim `st.log` to the cap; `logDropped` remembers the newest message index whose changes were dropped. */
export function capLog(st) {
    const l = arr(st?.log);
    if (l.length > LOG_CAP) {
        const cut = l.slice(0, l.length - LOG_CAP);
        st.logDropped = Math.max(Number.isFinite(st.logDropped) ? st.logDropped : -1, ...cut.map(e => Number(e?.i) || 0));
        st.log = l.slice(-LOG_CAP);
    }
    return st;
}

// ── engine on v2, step 1 (2026-10-05): step positions written to the v2 state too ──────────────────────────

/** A step tracker's place as v2 keeps it — the fields a step move changes. */
export const stepPlace = p => ({ at: p?.at ?? null, waitAt: p?.waitAt ?? null, aside: p?.aside ?? null, asideText: p?.asideText ?? null, forks: { ...(p?.forks || {}) }, ended: p?.ended ? { step: p.ended.step, branch: p.ended.branch } : null, started: !!p?.started, run: p?.run ?? null,
    branchLog: arr(p?.branchLog).map(x => ({ at: x.at, branch: x.branch, i: x.i })) });
const samePlace = (a, b) => JSON.stringify(stepPlace(a)) === JSON.stringify(stepPlace(b));

/**
 * The step moves between two v2 states, as log entries (kind 'step') — `meta(trackerId)` gives who / quote / reason /
 * confidence / i of the move (from the engine's journal). Nothing reads these yet (step 1 of `13 engine on v2 plan.md`);
 * a delete rolls them back like every other logged change.
 */
export function stepEntries(board, prev, next, i, meta = () => ({})) {
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        const a = prev?.trackers?.[t.id], b = next?.trackers?.[t.id];
        if (samePlace(a, b)) continue;
        const m = meta(t.id) || {};
        out.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, i: Math.floor(i || 0), key: `step:${t.id}`, kind: 'step', col: t.id,
            from: stepPlace(a), to: stepPlace(b), who: m.who || 'engine', ...(m.why ? { why: m.why } : {}), ...(m.quote ? { quote: m.quote } : {}), ...(m.reason ? { reason: m.reason } : {}), ...(m.confidence ? { confidence: m.confidence } : {}), at: new Date().toISOString() });
    }
    return out;
}

/** Where the engine's list and the v2 state disagree about a step tracker (the check command; empty = they agree). */
export function engineDiff(board, list, st) {
    const fromList = fromEngineList(board, st || freshState(board), list);
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps') continue;
        const a = stepPlace(st?.trackers?.[t.id]), b = stepPlace(fromList.trackers[t.id]);
        for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ tracker: t.name, field: k, v2: a[k], engine: b[k] });
    }
    return out;
}
