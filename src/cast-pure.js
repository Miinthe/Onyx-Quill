/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the Cast: NPCs who live in the story (`12 cast and agendas design.md`, build step 1).
 * Pure rules on the v2 board and chat state; tested in test/cast.test.mjs. Glue: autotrack.js (presence and knowledge,
 * in the story helper's call), cast.js (the director's call), board-live.js (what the writer and the judge get).
 *
 * A CAST is a row on the board, one tile per NPC ("person"): their character card, their vault entries, where they
 * hang out, their starting wants and plans, and whether they are hidden from Miinthe (hidden mode).
 *
 * IN EACH CHAT (chat state `cast[castId][personId]`, logged by message like every other change):
 *  - here     — in the scene or not. The story helper reports someone coming in or leaving, with a word-for-word quote;
 *               Miinthe can set it by hand. Only people in the scene are updated and told to the writer, so a big cast
 *               costs no more than a small one.
 *  - knows    — what they know, how they learned it (saw / heard / told / found) and the quote it was learned from.
 *               Knowledge is EARNED: only someone in the scene learns, and only with a quote. Vault entries are
 *               written from the author's view; without this every NPC would know everything. The director reports
 *               it (it reads the scene for the people in it); the story helper only says who comes and goes — asked
 *               for both, DeepSeek dropped the facts in most live turns (2026-10-13).
 *  - wants    — the long goal (changes rarely; the board's text until the story or Miinthe changes it in this chat).
 *  - plans    — up to three intentions, not a script: the director adds, keeps, rewords, finishes or drops them.
 *  - thoughts — this moment's private thought. NEVER reaches the writer.
 *
 * THE WRITER gets, for people in the scene only: who is here, their plans ("acts on this, never says it outright") and
 * what they know. Never thoughts, never wants (wants shape the plans; the plans are what the writer can act on).
 */
import { runOf, capLog, trackerOf, chainOf, hereOf, placeOf } from './board-model-pure.js';
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const low = s => String(s ?? '').trim().toLowerCase();
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };
const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const HOW = ['saw', 'heard', 'told', 'found'];
export const HOW_WORDS = { saw: 'saw it', heard: 'overheard it', told: 'was told', found: 'found it out' };
/** Open plans per person (the director keeps it to this many). */
export const MAX_PLANS = 3;
/** What the writer is told of a person's knowledge: the newest this many facts. */
export const KNOWS_TOLD = 6;
/** New facts per person per turn. */
export const LEARNS_PER_TURN = 3;
/** What a learned fact is about; "everyday" ones are dropped (live 2026-10-13: told not to, the director still kept "Miinthe made tea"). */
export const FACT_KINDS = ['secret', 'clue', 'promise', 'lie', 'feelings', 'danger', 'plan', 'everyday'];

// ── reading ─────────────────────────────────────────────────────────────────

export const castsOf = board => arr(board?.trackers).filter(t => t.kind === 'cast');
export const runningCasts = (board, st) => castsOf(board).filter(t => runOf(st, t) == null);
export const personOf = (cast, id) => arr(cast?.people).find(p => p.id === id) || null;

/** A person as they stand in this chat: { here, wants, plans: [{ id, text, i? }], thoughts: { text, i } | null, knows: [...] }. */
export function personNow(st, cast, p) {
    const raw = st?.cast?.[cast.id]?.[p.id] || {};
    return {
        here: raw.here === true,
        wants: typeof raw.wants === 'string' ? raw.wants : (p.wants || ''),
        plans: Array.isArray(raw.plans) ? raw.plans : arr(p.plans).map((text, k) => ({ id: `b${k}`, text })),
        thoughts: isObj(raw.thoughts) && raw.thoughts.text ? raw.thoughts : null,
        knows: arr(raw.knows),
        // 🔇 muted in this chat (Miinthe 2026-10-18): they never step in, offer, turn up or get thought for by themselves —
        // + and Speak now still bring them in
        muted: raw.muted === true,
    };
}

/** Everyone in the scene right now, over every running cast: [{ cast, p, now }]. */
export function presentPeople(board, st) {
    const out = [];
    for (const cast of runningCasts(board, st)) for (const p of arr(cast.people)) { const now = personNow(st, cast, p); if (now.here) out.push({ cast, p, now }); }
    return out;
}

/** Find a person by the name the helper used ("Kettle", "kettle", or the card's full name). */
function findPerson(board, st, name) {
    const n = low(name);
    if (!n) return null;
    for (const cast of runningCasts(board, st)) {
        const p = arr(cast.people).find(x => low(x.name) === n) || arr(cast.people).find(x => low(x.name).split(/\s+/)[0] === n.split(/\s+/)[0]);
        if (p) return { cast, p };
    }
    return null;
}

// ── what the story helper is told (presence + knowledge) ────────────────────

export function castHelperSection(board, st, { judgeText = () => '', placeName = () => null } = {}) {
    const casts = runningCasts(board, st).filter(c => arr(c.people).length);
    if (!casts.length) return '';
    const lines = ['', 'CAST (people who come and go — report "people" events: someone arrives or leaves)'];
    for (const cast of casts) {
        for (const p of cast.people) {
            const now = personNow(st, cast, p);
            const haunts = arr(p.hangouts).map(h => placeName(h)).filter(Boolean);
            lines.push(`- ${p.name}: ${now.here ? 'IN THE SCENE' : 'not in the scene'}${haunts.length ? `; often found at ${haunts.join(', ')}` : ''}`);
            if (now.here && now.knows.length) lines.push(`  Already knows: ${now.knows.slice(-KNOWS_TOLD).map(k => k.fact).join('; ')}`);
        }
        const rule = arr(cast.keep?.entries).filter(t => (cast.keep?.kinds || {})[t] === 'judge').map(t => String(judgeText(t) || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        if (rule) lines.push(`  What counts as being in the scene: ${clip(rule, 600)}`);
    }
    return lines.join('\n');
}

/**
 * One list of events — {"person", "event": "arrives" | "leaves", …}. Tested live 2026-10-13 on DeepSeek V4.1 Flash with
 * Miinthe's real tracker list: two separate lists ("cast" + "learns") came back with invented keys ("cast循", "cast_learns")
 * or empty; one "people" list was right 12 of 12 times in a probe. What people learn is the director's (see above).
 */
export const CAST_HELPER_RULES = `- PEOPLE: report in "people" when a listed person of the CAST plainly comes into the scene or leaves it — {"person", "event": "arrives" or "leaves", "quote", "reason", "confidence"}. Arrives: walks in, shows up, speaks up where they weren't before. Leaves: goes out, is sent away, falls asleep elsewhere. Being talked about is not being there. When the scene itself moves somewhere else and a person plainly stays behind, they leave. Most turns have none.`;

export const CAST_SCHEMA_PART = {
    people: { type: 'array', items: { type: 'object', properties: {
        person: { type: 'string' }, event: { type: 'string', enum: ['arrives', 'leaves'] },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['person', 'event', 'quote', 'reason', 'confidence'] } },
};

/** The helper's "people" events → the presence and learns lists validateCastChanges takes (plus any given the older way; a "learns" event is still read). */
export function splitPeopleEvents(people, presence = [], learns = []) {
    const p = [...arr(presence)], l = [...arr(learns)];
    for (const e of arr(people)) {
        const ev = low(e?.event);
        if (ev === 'arrives' || ev === 'leaves') p.push({ person: e.person, here: ev === 'arrives', quote: e.quote, reason: e.reason, confidence: e.confidence });
        else if (ev === 'learns') l.push({ person: e.person, fact: e.fact, how: e.how, quote: e.quote, reason: e.reason, confidence: e.confidence });
    }
    return { presence: p, learns: l };
}

// ── checking the helper's answer ────────────────────────────────────────────

/** The message they last came into the scene at (from the log), or null (here from the start, or set in the window). */
const arrivedAt = (st, castId, personId) => { const e = arr(st?.log).filter(x => x.kind === 'cast' && x.col === castId && x.person === personId && x.field === 'here' && x.to === true).at(-1); return e ? Number(e.i) : null; };
const lastAt = (st, key) => Math.max(-1, ...arr(st?.log).filter(e => e.key === key).map(e => Number(e.i)));
const undoneFrom = (st, key, quote) => arr(st?.undone).some(u => u.key === key && sameText(u.quote, quote));
const confOf = c => (['high', 'medium', 'low'].includes(low(c)) ? low(c) : null);

/**
 * The helper's `cast` and `learns` → safe changes:
 *   { kind: 'cast', key, col, person, field: 'here', from, to, quote, msgIdx, reason, confidence }
 *   { kind: 'cast', key, col, person, field: 'knows', add: { id, fact, how, quote, i }, quote, ... }
 */
/**
 * LOCAL PATCH (Miinthe, 2026-10-19): "people usually leave when the scene moves unless they go somewhere else as group".
 * When a place move happened this turn, everyone in the scene who isn't named in the user's newest message (and isn't
 * already reported) stays behind — unless that message says the group goes together. Returns presence changes in the
 * helper's own shape ({ person, here: false, quote, reason, confidence }), quoting the place move, so they are checked,
 * logged and undoable like any other.
 * @param placeChanges the applied place moves ({ quote, to }), placeName(change) → the new place's name
 */
export function leftBehind(board, st, placeChanges, messages, presence = [], placeName = () => 'somewhere else') {
    const moves = arr(placeChanges).filter(c => c?.quote);
    if (!moves.length) return [];
    const userMsg = [...arr(messages)].reverse().find(m => m?.is_user)?.mes || '';
    if (/\b(we all|all of us|everyone|everybody|together|the (?:whole )?group|the others (?:come|follow))\b/i.test(userMsg)) return [];
    const reported = new Set(arr(presence).map(c => String(c?.person ?? '').trim().toLowerCase()));
    const named = n => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(userMsg);
    const out = [];
    for (const cast of runningCasts(board, st)) for (const p of arr(cast.people)) {
        if (!personNow(st, cast, p).here || reported.has(p.name.toLowerCase()) || named(p.name)) continue;
        out.push({ person: p.name, here: false, quote: moves[0].quote, reason: `stayed behind when the scene moved to ${placeName(moves[0])}`, confidence: 'high' });
    }
    return out;
}

export function validateCastChanges(presence, learns, board, st, messages) {
    const rejected = [], changes = [];
    const best = new Map();   // person → the presence change from the newest line
    for (const c of arr(presence)) {
        const what = `${c?.person ?? '?'}: ${c?.here ? 'comes in' : 'leaves'}`;
        const f = findPerson(board, st, c?.person);
        if (!f) { rejected.push({ what, reason: 'no such person in the cast' }); continue; }
        if (typeof c?.here !== 'boolean') { rejected.push({ what, reason: 'here must be true or false' }); continue; }
        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); continue; }
        const key = `here:${f.cast.id}:${f.p.id}`;
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastAt(st, key)) { rejected.push({ what, reason: 'older than their last change' }); continue; }
        if (undoneFrom(st, key, quote)) { rejected.push({ what, reason: 'undone before from this line' }); continue; }
        const prev = best.get(key);
        if (prev && prev.msgIdx > msgIdx) { rejected.push({ what, reason: 'an older line than another change for them' }); continue; }
        best.set(key, { f, c, quote, msgIdx, key });
    }
    const entering = new Set();
    for (const { f, c, quote, msgIdx, key } of best.values()) {
        const from = personNow(st, f.cast, f.p).here;
        if (from === c.here) { rejected.push({ what: `${f.p.name}: ${c.here ? 'comes in' : 'leaves'}`, reason: 'no change' }); continue; }
        if (c.here) entering.add(`${f.cast.id}:${f.p.id}`);
        changes.push({ kind: 'cast', key, col: f.cast.id, person: f.p.id, field: 'here', from, to: c.here, quote, msgIdx, reason: clip(c.reason, 300) || null, confidence: confOf(c.confidence) });
    }
    const count = new Map();
    for (const c of arr(learns)) {
        const what = `${c?.person ?? '?'} learns: ${clip(c?.fact, 60)}`;
        const f = findPerson(board, st, c?.person);
        if (!f) { rejected.push({ what, reason: 'no such person in the cast' }); continue; }
        const pk = `${f.cast.id}:${f.p.id}`;
        const now = personNow(st, f.cast, f.p);
        if (!now.here && !entering.has(pk)) { rejected.push({ what, reason: 'not in the scene — they could not have learned it' }); continue; }
        const fact = clip(c?.fact, 200);
        if (!fact) { rejected.push({ what, reason: 'no fact' }); continue; }
        if (now.knows.some(k => sameText(k.fact, fact)) || changes.some(x => x.field === 'knows' && x.person === f.p.id && sameText(x.add.fact, fact))) { rejected.push({ what, reason: 'already known' }); continue; }
        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); continue; }
        // only what happened while they were there (live 2026-10-13: back from the garden, Kettle "saw" the fuse taped while she was out)
        const since = arrivedAt(st, f.cast.id, f.p.id), at = messages[msgIdx]?._i;
        if (!entering.has(pk) && Number.isFinite(at) && Number.isFinite(since) && at < since) { rejected.push({ what, reason: 'before they came into the scene' }); continue; }
        const key = `knows:${pk}`;
        if (undoneFrom(st, key, quote)) { rejected.push({ what, reason: 'undone before from this line' }); continue; }
        if ((count.get(pk) || 0) >= LEARNS_PER_TURN) { rejected.push({ what, reason: `at most ${LEARNS_PER_TURN} new facts per turn` }); continue; }
        count.set(pk, (count.get(pk) || 0) + 1);
        const how = HOW.includes(low(c?.how)) ? low(c.how) : 'saw';
        changes.push({ kind: 'cast', key, col: f.cast.id, person: f.p.id, field: 'knows', add: { id: newId('k'), fact, how, quote }, quote, msgIdx, reason: clip(c.reason, 300) || null, confidence: confOf(c.confidence) });
    }
    return { changes, rejected };
}

// ── applying, undo, rewind ──────────────────────────────────────────────────

const slot = (st, castId, personId) => (((st.cast ||= {})[castId] ||= {})[personId] ||= {});

/** Apply checked cast changes at message `i` (logged; Undo / rewind through collections-pure's log). */
export function applyCastChanges(board, st, changes, i, meta = {}) {
    const next = clone(st);
    next.log = arr(next.log);
    const at = Math.floor(i || 0);
    for (const ch of changes) {
        const id = newId('n');
        const s = slot(next, ch.col, ch.person);
        const entry = { id, i: at, key: ch.key || `${ch.field}:${ch.col}:${ch.person}`, kind: 'cast', col: ch.col, person: ch.person, field: ch.field,
            quote: ch.quote ?? null, reason: ch.reason ?? null, confidence: ch.confidence ?? null, who: ch.who || meta.who || 'auto', at: meta.at || new Date().toISOString() };
        if (ch.field === 'knows') {
            const add = { ...ch.add, i: at };
            s.knows = [...arr(s.knows), add];
            entry.add = add;
        } else {
            const cast = board?.trackers?.find(t => t.id === ch.col);
            const p = personOf(cast, ch.person);
            // `from` as the chat had it (undefined = still the board's) — so an Undo puts back exactly that
            entry.from = clone(s[ch.field]);
            if (ch.field === 'plans' && !Array.isArray(entry.from) && p) entry.fromBoard = true;
            const to = ch.field === 'thoughts' ? (ch.to ? { text: ch.to.text, i: at } : undefined) : clone(ch.to);
            if (to === undefined) delete s[ch.field]; else s[ch.field] = to;
            entry.to = clone(to);
            if (ch.ended?.length) entry.ended = ch.ended;
            if (ch.arrive) entry.arrive = ch.arrive;
            if (ch.added?.length) entry.added = ch.added;
        }
        next.log.push(entry);
        ch.logId = id;
    }
    capLog(next);
    return next;
}

/** Undo / rewind one logged cast change (called from collections-pure's revert). */
export function revertCast(st, e) {
    const s = slot(st, e.col, e.person);
    if (e.field === 'knows') { s.knows = arr(s.knows).filter(k => k.id !== e.add?.id); if (!s.knows.length) delete s.knows; return; }
    if (e.from === undefined || e.from === null && e.field !== 'here') delete s[e.field]; else s[e.field] = clone(e.from);
}

/** Set something by hand (Miinthe, the board window or the Story tab): one logged change, Undo like any other. */
export function handChange(board, st, castId, personId, field, to, i) {
    const cast = board?.trackers?.find(t => t.id === castId), p = personOf(cast, personId);
    if (!p) return st;
    const now = personNow(st, cast, p);
    const ch = field === 'knows' ? { field, add: { id: newId('k'), fact: clip(to?.fact, 200), how: HOW.includes(to?.how) ? to.how : 'told', quote: null } }
        : { field, from: now[field], to };
    return applyCastChanges(board, st, [{ ...ch, kind: 'cast', col: castId, person: personId, who: 'hand' }], i, { who: 'hand' });
}

// ── appearing (step 2, 2026-10-13): at their places, and when a plan sends them looking ──

/**
 * A person's "Appears" setting: 'off' · 'places' (they may turn up where they are often found) · 'plans' (that, and they
 * come looking for you when a plan says so — the default). `odds`: 1 in N at their places, once per visit (default 3).
 */
export const appearsOf = p => (['off', 'places', 'plans'].includes(p?.appears) ? p.appears : 'plans');
export const oddsOf = p => (Number.isFinite(Number(p?.odds)) && Number(p.odds) >= 1 ? Math.round(Number(p.odds)) : 3);

/** The visit to a place tracker's current spot: the message its newest move was logged at (-1: since the start). */
const visitOf = (st, placeTrackerId) => Math.max(-1, ...arr(st?.log).filter(e => e.kind === 'place' && e.col === placeTrackerId).map(e => Number(e.i)));

/**
 * Who may turn up now, at one of their places: away, "Appears" not off, the scene at (or inside) one of their places,
 * and not rolled yet for this visit. `rand()` → [0, 1). Returns changes for applyCastChanges: a `rolled` note for each
 * roll (so a visit rolls once; a delete rolls it back) and, for a hit, `here` → true with `arrive: 'place'`.
 */
export function appearAtPlaces(board, st, rand = Math.random) {
    const changes = [];
    for (const cast of runningCasts(board, st)) {
        for (const p of arr(cast.people)) {
            if (appearsOf(p) === 'off' || !arr(p.hangouts).length) continue;
            const now = personNow(st, cast, p);
            if (now.here || now.muted) continue;
            const raw = st?.cast?.[cast.id]?.[p.id] || {};
            const rolled = arr(raw.rolled);
            for (const h of p.hangouts) {
                const pt = trackerOf(board, h.place);
                if (!pt || pt.kind !== 'place' || runOf(st, pt) != null) continue;
                if (!chainOf(pt, hereOf(st, pt)).some(x => x.id === h.at)) continue;
                const key = `${h.place}:${h.at}:${visitOf(st, h.place)}`;
                if (rolled.includes(key)) continue;
                const n = oddsOf(p), hit = rand() < 1 / n, where = placeOf(pt, h.at)?.name ?? '?';
                changes.push({ kind: 'cast', col: cast.id, person: p.id, field: 'rolled', from: raw.rolled, to: [...rolled, key].slice(-12), who: 'roll', reason: `${where}: 1 in ${n} — ${hit ? 'turns up' : 'not this time'}` });
                if (hit) changes.push({ kind: 'cast', col: cast.id, person: p.id, field: 'here', from: false, to: true, who: 'appears', arrive: 'place', reason: `turns up at ${where} (1 in ${n})` });
                break;   // one roll per person per turn
            }
        }
    }
    return changes;
}

/** The director's line on how readily someone speaks up — from their "When they speak". */
export function speakHint(p) {
    const s = ['call', 'suggest', 'self', 'mine'].includes(p?.speaks) ? p.speaks : 'suggest';
    return s === 'self' ? 'Speaks up by themselves: they take a turn every round while here ("speak": true).'
        : s === 'call' || s === 'mine' ? 'Speaks only when the author calls them in: "speak": false.'
            : 'Speaks up when it matters to them: "speak": true when they are spoken to, touched by what happened, or a plan says it is time.';
}

/** Away people the director may send looking for you: "Appears" = plans, with a plan or a want to act on. */
export function awayCandidates(board, st, nowI = null) {
    const out = [];
    for (const cast of runningCasts(board, st)) {
        if (cast.director === false) continue;
        for (const p of arr(cast.people)) {
            const now = personNow(st, cast, p);
            // not someone who only just left (live 2026-10-14: Kettle rolled out, and the same turn sent her straight back)
            const left = leftAt(st, cast, p);
            if (Number.isFinite(nowI) && left != null && nowI - left < MIN_AWAY) continue;
            if (!now.here && !now.muted && appearsOf(p) === 'plans' && (now.plans.length || now.wants)) out.push({ cast, p, now });
        }
    }
    return out;
}

/**
 * The writer's line for people who turned up this turn (by a roll at their place, or a plan) — for one reply, like
 * JUST HAPPENED: "JUST ARRIVED: Gerry — bring them into the scene now (they came looking for you)."
 */
export function arrivalLines(board, st, since) {
    return arr(st?.log).filter(e => e.kind === 'cast' && e.field === 'here' && e.to === true && e.arrive && e.i >= since).map(e => {
        const p = personOf(arr(board?.trackers).find(t => t.id === e.col), e.person);
        return p ? `JUST ARRIVED: ${p.name} — bring them into the scene now${e.arrive === 'plan' ? ' (they came looking for a reason of their own)' : ' (they are often found here)'}.` : null;
    }).filter(Boolean);
}

// ── the off-screen log (step 4, 2026-10-13 — Miinthe: "How about a NPC off screen log or sumthin?") ──

/** Away at least this many messages before coming back = worth an off-screen entry. */
export const MIN_AWAY = 4;
/** Off-screen entries kept per person (the Cast tab shows them; the writer gets the newest once). */
export const OFFSCREEN_KEPT = 10;
/** Facts they may pick up off-screen per entry. */
export const OFFSCREEN_LEARNS = 2;

const ownLog = (st, castId, personId) => arr(st?.log).filter(e => e.kind === 'cast' && e.col === castId && e.person === personId);

/**
 * Someone just back after being away a while, still owed an off-screen entry: { left, back } (message indexes), or null.
 * Back = their newest "here → yes"; left = the "here → no" before it; away ≥ MIN_AWAY messages; no entry written since.
 */
export function backFrom(st, cast, p) {
    if (!personNow(st, cast, p).here) return null;
    const own = ownLog(st, cast.id, p.id);
    const back = own.filter(e => e.field === 'here' && e.to === true).at(-1);
    if (!back) return null;
    const left = own.filter(e => e.field === 'here' && e.to === false && Number(e.i) <= Number(back.i) && own.indexOf(e) < own.indexOf(back)).at(-1);
    if (!left || Number(back.i) - Number(left.i) < MIN_AWAY) return null;
    if (own.some(e => e.field === 'offscreen' && Number(e.i) >= Number(back.i))) return null;
    return { left: Number(left.i), back: Number(back.i) };
}
/** When they last left the scene (message index), or null if they were never here. */
export function leftAt(st, cast, p) {
    const e = ownLog(st, cast.id, p.id).filter(x => x.field === 'here' && x.to === false).at(-1);
    return e ? Number(e.i) : null;
}

/**
 * An off-screen entry → changes: the entry ({ from, to, text }) added to their log, and what they found out meanwhile
 * (no quote — it happened off-screen; marked so), at most OFFSCREEN_LEARNS, nothing they already know.
 */
export function offscreenChanges(st, cast, p, { did, learned = [] } = {}, from = null, to = null, who = 'director') {
    const text = clip(did, 400);
    if (!text) return [];
    const now = personNow(st, cast, p);
    const raw = st?.cast?.[cast.id]?.[p.id] || {};
    const out = [{ kind: 'cast', col: cast.id, person: p.id, field: 'offscreen', from: raw.offscreen, to: [...arr(raw.offscreen), { text, ...(Number.isFinite(from) ? { from } : {}), ...(Number.isFinite(to) ? { to } : {}) }].slice(-OFFSCREEN_KEPT), who, reason: 'while away' }];
    let n = 0;
    for (const x of arr(learned)) {
        const fact = clip(x?.fact, 200);
        if (!fact || n >= OFFSCREEN_LEARNS || low(x?.kind) === 'everyday' || now.knows.some(k => sameText(k.fact, fact))) continue;
        n++;
        out.push({ kind: 'cast', col: cast.id, person: p.id, field: 'knows', key: `knows:${cast.id}:${p.id}`, add: { id: newId('k'), fact, how: HOW.includes(low(x?.how)) ? low(x.how) : 'found', offscreen: true }, quote: null, who, reason: 'found out while away' });
    }
    return out;
}

/** The writer's line for the one reply after an off-screen entry: "KETTLE, while away: searched the kitchen; found nothing." */
export function offscreenLines(board, st, since) {
    return arr(st?.log).filter(e => e.kind === 'cast' && e.field === 'offscreen' && e.i >= since).map(e => {
        const p = personOf(arr(board?.trackers).find(t => t.id === e.col), e.person), last = arr(e.to).at(-1);
        return p && last?.text ? `${p.name.toUpperCase()}, while away: ${last.text.replace(/[.\s]+$/, '')}. (The story may show traces of it.)` : null;
    }).filter(Boolean);
}

/** "What have they been up to?" for someone away, asked by Miinthe — the director's prompt for one person. */
export const OFFSCREEN_SYSTEM = `You keep the off-screen lives of a roleplay's side characters. The person below is away from the scene; their life goes on. Say what they have been doing since they left, true to who they are, what they want and plan, and the story so far — small, concrete, nothing that contradicts what happened in the scene. Answer with JSON only: {"did": "two or three short clauses, e.g. searched the kitchen drawers; found nothing; is more suspicious now", "learned": [{"fact": "...", "how": "saw", "heard", "told" or "found", "kind": "secret", "clue", "promise", "lie", "feelings", "danger", "plan" or "everyday"}] (usually [])}`;
export const OFFSCREEN_SCHEMA = { name: 'cast_offscreen', strict: false, value: { type: 'object', properties: { did: { type: 'string' }, learned: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, how: { type: 'string', enum: HOW }, kind: { type: 'string', enum: FACT_KINDS } }, required: ['fact', 'how'] } } }, required: ['did'] } };
export function offscreenUser(st, cast, p, messages, { cardText = () => '', boardLines = [] } = {}) {
    const now = personNow(st, cast, p), left = leftAt(st, cast, p);
    const lines = [`## ${p.name}${left != null ? ` — away since message #${left}` : ' — away'}`];
    const card = clip(cardText(p), 1500);
    if (card) lines.push(`Who they are: ${card}`);
    lines.push(`Wants: ${now.wants || '(not set)'}`, `Plans: ${now.plans.map(x => x.text).join(' · ') || '(none)'}`, `Knows: ${now.knows.slice(-12).map(k => k.fact).join('; ') || '(nothing special)'}`);
    const before = arr(st?.cast?.[cast.id]?.[p.id]?.offscreen).slice(-3);
    if (before.length) lines.push(`Earlier off-screen: ${before.map(x => x.text).join(' / ')}`);
    if (arr(boardLines).length) lines.push('', 'WHERE THE STORY STANDS', ...boardLines);
    lines.push('', 'NEWEST MESSAGES IN THE SCENE (oldest first)');
    for (const m of arr(messages)) lines.push(`${m.name || 'Someone'}: ${String(m.mes || '').trim()}`);
    return lines.join('\n');
}
export function parseOffscreen(text) {
    const raw = String(text ?? '').trim();
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) { try { const v = JSON.parse(t); if (v && typeof v.did === 'string') return { did: v.did, learned: arr(v.learned) }; } catch { /* next */ } }
    return null;
}

// ── the director: plans, wants, thoughts of the people in the scene ─────────

export const DIRECTOR_SYSTEM = `You are the director of a roleplay's side characters. The author plays with one main character; the people below live in the same story and have their own minds. After the newest messages, update the inner life of every person listed as IN THE SCENE.

For each of them:
- "thoughts": one or two sentences of what they privately think right now, in their own voice. Never shown to anyone in the story.
- "plans": their intentions — at most ${MAX_PLANS} open ones. An intention, not a script: "if he asks about the letter, change the subject", "hide the broken lock before the party". Write each as a short instruction about them, never with "I" or "me" ("praise the guard loudly so Miinthe looks at him instead", not "…instead of me"). Keep a plan that still fits (give its id; you may reword it). Mark one the story finished as "done", one it moved past or that no longer fits as "dropped". Add a new one ("new", id null) only when the story gives them a reason. Never drag the story back to an old plan.
- Plans use only what that person KNOWS (their list below) and what they saw happen in the scene — never what they could not know.
- "wants": their deep goal. Leave it null unless the story reached a real turning point for them; then give the new one.
- "learned": what they found out in the NEWEST messages — only what they plainly saw, overheard, were told or discovered themselves while there, about the story's world and the people in it, and only what MATTERS — a secret, a clue, a promise, a lie, something someone did that changes things between people. Never everyday actions ("she made tea", "he came in", "she sat down"), never the conversation itself, never what is already in their "Knows". Most turns: []. Each: {"fact": one short sentence from their view ("the guard took the key from the drawer"), "how": "saw", "heard", "told" or "found", "kind": "secret", "clue", "promise", "lie", "feelings", "danger", "plan" or "everyday" (be honest — ordinary doings are "everyday"), "quote": the line that shows it, copied WORD FOR WORD from the messages}. Usually [].
- "leave": true if they would now walk out of the scene of their own accord — a plan takes them elsewhere, they are upset, bored or done here. They will say so in their own message before they go; never make anyone vanish. "leaveWhy": a few words why (or null). Most turns: false.
- "speak": true if they would want to say something themselves right after the next reply — a plan says it's time, they are spoken to, something touches them; else false. "speakWhy": a few words why (or null).
- "left": if the newest messages plainly show them leaving the scene, the line that shows it, copied WORD FOR WORD; otherwise null. Then give no plans or thoughts for the scene they left.
- "why": a few words on what in the newest messages changed something (or "nothing new").

People listed under AWAY are not in the scene, but their lives go on off-screen: they live nearby and know where to find the others. For each, answer in "away": {"person", "comes": true or false, "why": a few words}. "comes": true when their plan or what they want would bring them here now — the plan is pressing ("today", "at once"), or the moment is an opening for it (a quiet moment, someone alone). Nobody needs to send for them. A plan that can wait, waits. When someone comes, also give "did": two or three short clauses of what they did before coming (true to their plans).

Answer with JSON only: {"people": [{"person": "...", "thoughts": "...", "plans": [{"id": "..." or null, "text": "...", "status": "keep" | "new" | "done" | "dropped"}], "wants": null, "learned": [], "left": null, "speak": false, "speakWhy": null, "leave": false, "leaveWhy": null, "why": "..."}], "away": [{"person": "...", "comes": false, "why": "...", "did": null}]}`;

export const DIRECTOR_SCHEMA = {
    name: 'cast_director',
    strict: false,
    value: { type: 'object', properties: { people: { type: 'array', items: { type: 'object', properties: {
        person: { type: 'string' }, thoughts: { type: 'string' },
        plans: { type: 'array', items: { type: 'object', properties: { id: { type: ['string', 'null'] }, text: { type: 'string' }, status: { type: 'string', enum: ['keep', 'new', 'done', 'dropped'] } }, required: ['text', 'status'] } },
        wants: { type: ['string', 'null'] }, why: { type: 'string' },
        left: { type: ['string', 'null'] }, speak: { type: 'boolean' }, speakWhy: { type: ['string', 'null'] }, leave: { type: 'boolean' }, leaveWhy: { type: ['string', 'null'] },
        learned: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, how: { type: 'string', enum: HOW }, kind: { type: 'string', enum: FACT_KINDS }, quote: { type: 'string' } }, required: ['fact', 'how', 'kind', 'quote'] } },
    }, required: ['person', 'thoughts', 'plans', 'speak'] } },
    away: { type: 'array', items: { type: 'object', properties: { person: { type: 'string' }, comes: { type: 'boolean' }, why: { type: ['string', 'null'] }, did: { type: ['string', 'null'] } }, required: ['person', 'comes'] } } }, required: ['people'] },
};

/**
 * The director's user message. `cardText(p)` → the character card's description (+ personality), `boardLines` → the
 * board as the writer sees it, `messages` → the newest messages ({ name, mes }).
 */
export function directorUser(board, st, messages, { cardText = () => '', boardLines = [], placeName = () => null, nowI = null } = {}) {
    const here = presentPeople(board, st), away = awayCandidates(board, st, nowI);
    if (!here.length && !away.length) return '';
    const lines = [here.length ? 'IN THE SCENE' : 'IN THE SCENE: none of these people'];
    for (const { cast, p, now } of here) {
        lines.push('', `## ${p.name}`);
        const card = clip(cardText(p), 1500);
        if (card) lines.push(`Who they are: ${card}`);
        const haunts = arr(p.hangouts).map(h => placeName(h)).filter(Boolean);
        if (haunts.length) lines.push(`Often found at: ${haunts.join(', ')}`);
        // how readily they speak up (the author's setting) — "steps in by themselves" was far too shy (live 2026-10-14)
        lines.push(speakHint(p));
        lines.push(`Wants: ${now.wants || '(not set — leave it null)'}`);
        lines.push(`Plans: ${now.plans.length ? now.plans.map(x => `[${x.id}] ${x.text}`).join(' · ') : '(none yet)'}`);
        lines.push(`Knows: ${now.knows.length ? now.knows.slice(-12).map(k => `${k.fact} (${HOW_WORDS[k.how] || k.how})`).join('; ') : '(nothing special yet)'}`);
        if (now.thoughts) lines.push(`Last thought: ${now.thoughts.text}`);
        const off = arr(st?.cast?.[cast.id]?.[p.id]?.offscreen).slice(-2);
        if (off.length) lines.push(`Off-screen before: ${off.map(x => x.text).join(' / ')}`);

    }
    if (away.length) {
        lines.push('', 'AWAY (not in the scene — answer for them in "away" only)');
        for (const { p, now } of away) {
            const haunts = arr(p.hangouts).map(h => placeName(h)).filter(Boolean);
            lines.push(`- ${p.name}: wants ${now.wants || '(not set)'}; plans: ${now.plans.map(x => x.text).join(' · ') || '(none)'}${haunts.length ? `; often found at ${haunts.join(', ')}` : ''}`);
        }
    }
    const others = runningCasts(board, st).flatMap(c => arr(c.people).filter(p => !personNow(st, c, p).here && !away.some(a => a.p.id === p.id)).map(p => p.name));
    if (others.length) lines.push('', `Not in the scene (leave them out): ${others.join(', ')}`);
    if (arr(boardLines).length) lines.push('', 'WHERE THE STORY STANDS', ...boardLines);
    lines.push('', 'NEWEST MESSAGES (oldest first)');
    for (const m of arr(messages)) lines.push(`${m.name || (m.is_user ? 'User' : 'Character')}: ${String(m.mes || '').trim()}`);
    return lines.join('\n');
}

/** Read the director's answer (plain JSON, fenced, or the first {...} block). */
export function parseDirector(text) {
    const raw = String(text ?? '').trim();
    const tries = [raw];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) tries.push(fence[1]);
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries) { try { const v = JSON.parse(t); if (Array.isArray(v?.people)) return v.people; } catch { /* next */ } }
    return [];
}

/** The whole answer: { people, away } (each [] when absent or unreadable). */
export function parseDirectorAll(text) {
    const raw = String(text ?? '').trim();
    const tries = [raw];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) tries.push(fence[1]);
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries) { try { const v = JSON.parse(t); if (Array.isArray(v?.people) || Array.isArray(v?.away)) return { people: arr(v.people), away: arr(v.away) }; } catch { /* next */ } }
    return { people: [], away: [] };
}

/** The director's "away" answers → arrivals for people a plan sends looking (at most one a turn). */
export function validateComes(away, board, st, nowI = null) {
    const cands = awayCandidates(board, st, nowI);
    for (const d of arr(away)) {
        if (d?.comes !== true) continue;
        const f = cands.find(x => low(x.p.name) === low(d?.person)) || cands.find(x => low(x.p.name).split(/\s+/)[0] === low(d?.person).split(/\s+/)[0]);
        if (!f) continue;
        const come = { kind: 'cast', col: f.cast.id, person: f.p.id, field: 'here', from: false, to: true, who: 'director', arrive: 'plan', reason: clip(d?.why, 200) || 'comes looking' };
        return [come, ...(d?.did ? offscreenChanges(st, f.cast, f.p, { did: d.did }, leftAt(st, f.cast, f.p), null) : [])];
    }
    return [];
}

/**
 * The director's answer → changes for people in the scene: thoughts (every turn), plans (when the list changed: what was
 * added, what ended and how), wants (rarely), and what they learned (checked like the helper's: a word-for-word quote
 * from `messages`, nothing already known, at most three a turn). Untrusted: unknown people, people not in the scene and
 * empty texts are dropped.
 */
export function validateDirector(people, board, st, messages = []) {
    const changes = [], rejected = [], wishes = [], leaves = [];   // wishes: who wants to speak after the reply; leaves: who wants to walk out (they say so first)
    const here = presentPeople(board, st);
    const done = new Set();
    for (const d of arr(people)) {
        const f = here.find(x => low(x.p.name) === low(d?.person)) || here.find(x => low(x.p.name).split(/\s+/)[0] === low(d?.person).split(/\s+/)[0]);
        if (!f) { rejected.push({ what: String(d?.person ?? '?'), reason: 'not in the scene' }); continue; }
        if (done.has(f.p.id)) continue;
        done.add(f.p.id);
        const { cast, p, now } = f;
        const base = { kind: 'cast', col: cast.id, person: p.id, reason: clip(d?.why, 200) || null, who: 'director' };
        const thought = clip(d?.thoughts, 400);
        if (thought && thought !== now.thoughts?.text) changes.push({ ...base, field: 'thoughts', from: now.thoughts, to: { text: thought } });
        if (Array.isArray(d?.plans)) {
            const byId = new Map(now.plans.map(x => [x.id, x]));
            const reworded = new Map(), added = [], ended = [];
            for (const x of d.plans) {
                const text = clip(x?.text, 240), status = low(x?.status);
                const old = x?.id ? byId.get(String(x.id)) : null;
                if (old && (reworded.has(old.id) || ended.some(e => e.id === old.id))) continue;
                if (status === 'done' || status === 'dropped') { if (old) ended.push({ id: old.id, text: old.text, status }); continue; }
                if (!text) continue;
                if (old) reworded.set(old.id, text);
                else added.push(text);
            }
            // in their old order (a plan the director didn't mention stays as it was), then the new ones while there is room
            const list = now.plans.filter(x => !ended.some(e => e.id === x.id)).map(x => (reworded.has(x.id) ? { ...x, text: reworded.get(x.id) } : x));
            const fresh = [];
            for (const text of added) if (list.length + fresh.length < MAX_PLANS && ![...list, ...fresh].some(y => sameText(y.text, text))) fresh.push({ id: newId('p'), text });
            list.push(...fresh);
            ended.forEach(e => delete e.id);
            const same = list.length === now.plans.length && list.every((x, k) => x.id === now.plans[k].id && x.text === now.plans[k].text);
            if (!same) changes.push({ ...base, field: 'plans', from: now.plans, to: list, ...(fresh.length ? { added: fresh.map(x => x.text) } : {}), ...(ended.length ? { ended } : {}) });
        }
        const wants = typeof d?.wants === 'string' ? clip(d.wants, 300) : '';
        if (wants && !sameText(wants, now.wants)) changes.push({ ...base, field: 'wants', from: now.wants, to: wants });
        const goneAlready = typeof d?.left === 'string' && d.left.trim();
        if (d?.speak === true && !goneAlready) wishes.push({ cast: cast.id, person: p.id, why: clip(d?.speakWhy, 160) || null });
        // walking out of their own accord (Miinthe, 2026-10-14: "if a NPC wants to walk away they should say so in their reply") — not "call only" people
        if (d?.leave === true && !goneAlready && p.speaks !== 'call' && p.speaks !== 'mine') leaves.push({ cast: cast.id, person: p.id, why: clip(d?.leaveWhy, 160) || null });
        // they left (a second chance after the story helper — it missed a plain exit in one of four live turns, 2026-10-13)
        if (typeof d?.left === 'string' && d.left.trim()) {
            const k = validateCastChanges([{ person: p.name, here: false, quote: d.left, reason: clip(d?.why, 200), confidence: null }], [], board, st, messages);
            changes.push(...k.changes.map(c => ({ ...c, who: 'director' })));
            rejected.push(...k.rejected);
        }
        const learned = arr(d?.learned).filter(x => low(x?.kind) !== 'everyday');
        if (arr(d?.learned).length > learned.length) rejected.push({ what: `${p.name}: ${arr(d.learned).length - learned.length} everyday fact(s)`, reason: 'everyday — not worth knowing' });
        if (learned.length) {
            const k = validateCastChanges([], learned.map(x => ({ person: p.name, fact: x?.fact, how: x?.how, quote: x?.quote, reason: clip(d?.why, 200), confidence: null })), board, st, messages);
            changes.push(...k.changes.map(c => ({ ...c, who: 'director' })));
            rejected.push(...k.rejected);
        }
    }
    return { changes, rejected, wishes, leaves };
}

// ── what the writer and the judge get ───────────────────────────────────────

/**
 * The writer's lines: who is in the scene; per person their plans ("acts on this, never says it outright") and what they
 * know. Never thoughts or wants.
 */
export function castLines(board, st) {
    const here = presentPeople(board, st);
    if (!here.length) return [];
    const out = [`IN THE SCENE: ${here.map(x => x.p.name).join(', ')}`];
    for (const { p, now } of here) {
        const name = p.name.toUpperCase();
        if (now.plans.length) out.push(`${name} (acts on this, never says it outright): ${now.plans.map(x => x.text.replace(/[.\s]+$/, '')).join('; ')}.`);
        if (now.knows.length) out.push(`${name} knows: ${now.knows.slice(-KNOWS_TOLD).map(k => `${k.fact.replace(/[.\s]+$/, '')} (${HOW_WORDS[k.how] || k.how})`).join('; ')}. Anything else, ${p.name} doesn't know.`);
        // step 3: someone who speaks in their own messages isn't voiced by the writer (live 2026-10-13: asked a question,
        // the main character answered AS Kettle). "Call only" people stay the writer's to voice until called.
        if (p.speaks !== 'call') out.push(`${p.name}'s lines come in ${p.name}'s own messages — never write them; what ${p.name} does may be mentioned in passing.`);
    }
    return out;
}

/** The judge's line: only who is in the scene. */
export function castJudgeLines(board, st) {
    const here = presentPeople(board, st);
    return here.length ? [`IN THE SCENE: ${here.map(x => x.p.name).join(', ')}`] : [];
}

/** Entries of people in the scene, pinned while they are here (a cast with "pin while here" on; not judge entries). */
export function castPins(board, st) {
    const out = [];
    for (const { cast, p } of presentPeople(board, st)) {
        if (cast.pinHere === false) continue;
        for (const title of arr(p.entries)) if ((p.kinds || {})[title] !== 'judge') out.push(title);
    }
    return out;
}

/** Names for DeepLore's "Characters present" filter (a cast with "sets Characters present" on), or null. */
export function presentNames(board, st) {
    const casts = runningCasts(board, st).filter(c => c.setsPresent === true);
    if (!casts.length) return null;
    return casts.flatMap(c => arr(c.people).filter(p => personNow(st, c, p).here).map(p => p.name));
}

// ── notices ────────────────────────────────────────────────────────────────

/** The notice text: "Kettle comes into the scene", "Kettle now knows: … (saw it)", "Kettle — new plan: …". `hidden`: no details. */
export function describeCastChange(board, ch) {
    const cast = arr(board?.trackers).find(t => t.id === ch.col), p = personOf(cast, ch.person);
    const n = p?.name ?? 'Someone';
    if (ch.field === 'here' && ch.to && ch.arrive === 'place') return `${n} ${ch.reason || 'turns up'}`;
    if (ch.field === 'here' && ch.to && ch.arrive === 'plan') return `${n} comes looking for you${p?.hidden ? '' : ch.reason ? ` — ${ch.reason}` : ''}`;
    if (ch.field === 'here') return `${n} ${ch.to ? 'comes into the scene' : 'leaves the scene'}`;
    if (ch.field === 'muted') return ch.to ? `${n} is muted: quiet until you bring them in` : `${n} is unmuted`;
    if (p?.hidden) return ch.field === 'offscreen' ? `${n} was busy while away (hidden)` : ch.field === 'knows' ? `${n} learned something (hidden)` : ch.field === 'plans' ? `${n}'s plans changed (hidden)` : ch.field === 'wants' ? `${n} wants something new (hidden)` : `${n} (hidden)`;
    if (ch.field === 'knows') return `${n} now knows: ${ch.add?.fact} (${HOW_WORDS[ch.add?.how] || ch.add?.how})`;
    if (ch.field === 'plans') {
        const parts = [...arr(ch.added).map(t => `new plan: ${t}`), ...arr(ch.ended).map(e => `${e.status === 'done' ? 'done' : 'dropped'}: ${e.text}`)];
        return `${n} — ${parts.length ? parts.join(' · ') : 'plans reworded'}`;
    }
    if (ch.field === 'wants') return `${n} now wants: ${ch.to}`;
    if (ch.field === 'thoughts') return `${n} thinks: ${ch.to?.text ?? ''}`;
    if (ch.field === 'offscreen') return `${n}, while away: ${arr(ch.to).at(-1)?.text ?? ''}`;
    return n;
}

// ── did they just walk out? (2026-10-14 — Miinthe: "spoon didn't leave even though in the reply it did") ──
/**
 * Right after an NPC's own message (written by the AI or by Miinthe), one short question: does it show them leaving the
 * scene? A yes needs the line that shows it, word for word from that message. Their goodbye then counts at once,
 * not one message later.
 */
export const EXIT_SYSTEM = `You read one message from a roleplay and answer one question: does it show the speaker leaving the scene — walking out, going to another room or outside, being gone by the end of it? Only a plain exit counts; announcing they will leave later, or turning away while staying, does not. Answer with JSON only: {"leaves": true or false, "quote": "the words that show it, copied WORD FOR WORD from the message" or null}`;
export const EXIT_SCHEMA = { name: 'cast_exit', strict: false, value: { type: 'object', properties: { leaves: { type: 'boolean' }, quote: { type: ['string', 'null'] } }, required: ['leaves'] } };
export const exitUser = (name, text) => `SPEAKER: ${name}\n\nMESSAGE:\n${String(text ?? '').trim()}`;
/**
 * Right after someone left: does the next message stop them, or bring them back? (Miinthe, 2026-10-14: "Unless Toaster is like
 * stopping spoon … then her in the scene status could be restored".) A yes needs the words that show it.
 */
export const RETURN_SYSTEM = `Someone has just left the scene of a roleplay. You read the next message and answer one question: does it stop them from leaving, or bring them back into the scene — held back, called back and returning, pulled back in? Mentioning them, or watching them go, does not count. Answer with JSON only: {"back": true or false, "quote": "the words that show it, copied WORD FOR WORD from the message" or null}`;
export const RETURN_SCHEMA = { name: 'cast_return', strict: false, value: { type: 'object', properties: { back: { type: 'boolean' }, quote: { type: ['string', 'null'] } }, required: ['back'] } };
export const returnUser = (name, speaker, text) => `WHO JUST LEFT: ${name}\nTHE NEXT MESSAGE, BY ${speaker}:\n${String(text ?? '').trim()}`;

/** The answer → the quote that shows them leaving (or, with key 'back', coming back), or null. */
export function exitFrom(answer, text, key = 'leaves') {
    let v = null;
    const raw = String(answer ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) { try { v = JSON.parse(t); break; } catch { /* next */ } }
    if (v?.[key] !== true) return null;
    const quote = String(v.quote ?? '').trim();
    return quote && findQuoteMatch(quote, [{ mes: String(text ?? '') }]) !== -1 ? quote : null;
}
