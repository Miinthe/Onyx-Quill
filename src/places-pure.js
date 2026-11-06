/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — places in play (storyboard stage 3, round 3).
 * Pure rules on the v2 board and chat state; tested in test/places.test.mjs.
 * Design: `8 storyboard design.md` §12 (places) and `6 merge roadmap.md` §4 G+ ("Places — Miinthe's
 * dream: stop the AI from inventing surroundings").
 *
 * A PLACE TRACKER knows a set of places — some inside others (Counter in Kitchen; in Miinthe's
 * dragon vault `location: [palace-yard, golden-city]`, spot then parent) and some next to each
 * other (related → nearby) — and exactly one HERE per chat.
 *
 * RULES
 *  - The helper reports a new "here" only when the newest messages PLAINLY put the scene there
 *    (with a word-for-word quote) — talking about a place or planning to go does not move it.
 *    The place tracker's judge entries (e.g. "Judge · Where the scene is") are its rules.
 *    With no spot established, the parent will do ("somewhere in the kitchen").
 *  - HERE sets DeepLore's own location filter (`deeplore_context.location`, what
 *    /oq-set-location does by hand) to the place's id — so entries with `location:` for
 *    other spots drop out (unless the board says not to: `setsLocation: false`).
 *  - Entries on a place, by their role:  'place' (or no role) — the place itself: pinned while
 *    the scene is here · 'only' — exist only while the scene is here · 'often' — Miinthe's Gerry the
 *    Caterpillar: available anywhere, named as "often found here" while the scene is here.
 *  - Writer and judge are told: PLACE: Counter (in Kitchen) · NEARBY, NOT HERE: Pantry ·
 *    KNOWN PLACES, NOT HERE: Cellar, Garden — so nothing else gets invented as present.
 *  - Every move is logged by message (state.log, kind 'place'): Undo, and a delete rolls it back.
 */
import { runOf, hereOf, chainOf, placeOf, capLog } from './board-model-pure.js';
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';

const low = s => String(s ?? '').trim().toLowerCase();
const arr = v => (Array.isArray(v) ? v : []);
const clone = o => JSON.parse(JSON.stringify(o));

export const placeTrackersOf = board => arr(board?.trackers).filter(t => t.kind === 'place' && t.places.length);
export const runningPlaces = (board, st) => placeTrackersOf(board).filter(t => runOf(st, t) == null);

/** "Counter (in Kitchen)" */
export function placeLabel(t, id) {
    const ch = chainOf(t, id);
    return ch.length ? `${ch[0].name}${ch[1] ? ` (in ${ch[1].name})` : ''}` : '?';
}
const roleOf = (p, title) => p.roles?.[title] || 'place';

// ── what the helper is told ─────────────────────────────────────────────────

/**
 * The PLACES part of the helper's message. `judgeText(title)` returns a judge entry's text
 * (the tracker's own rules for when the scene has moved).
 */
export function placesHelperSection(board, st, { judgeText = null } = {}) {
    const ts = runningPlaces(board, st);
    if (!ts.length) return '';
    const lines = ['', 'PLACES (where the scene is — exactly one "here" per place tracker; report "places" changes)'];
    for (const t of ts) {
        const here = hereOf(st, t);
        const list = t.places.map(p => `"${p.name}"${p.parent ? ` (inside ${placeOf(t, p.parent)?.name})` : ''}`).join(', ');
        lines.push(`- ${t.name}: the scene is at "${placeOf(t, here)?.name ?? '?'}". Places: ${list}`);
        const judges = arr(t.keep?.entries).filter(title => t.keep?.kinds?.[title] === 'judge');
        for (const title of judges) {
            const text = judgeText ? String(judgeText(title) || '').replace(/\s+/g, ' ').trim() : '';
            if (text) lines.push(`  How to judge it: ${text.length > 600 ? text.slice(0, 600).replace(/\s\S*$/, '') + '…' : text}`);
        }
    }
    return lines.join('\n');
}

export const PLACES_HELPER_RULES = `- PLACES: report a new place in "places" — {"tracker", "place", "quote", "reason", "confidence"} — only when the newest messages plainly put the scene there (they arrive, they are there now). The scene is where the user's character is: someone else walking off to another place does not move it, and the user's own message saying they go or walk somewhere ("we walk into the kitchen", "and then we move to the garden") does. Talking about a place, remembering it or planning to go there later does not move the scene. Use only listed places, spelled exactly; when the scene is plainly inside a place but no listed spot in it is clear, report the place it is in.`;

export const PLACES_SCHEMA_PART = {
    places: { type: 'array', items: { type: 'object', properties: {
        tracker: { type: 'string' }, place: { type: 'string' },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['tracker', 'place', 'quote', 'reason', 'confidence'] } },
};

// ── checking, applying ──────────────────────────────────────────────────────

const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);

/** The helper's `places` → safe moves: { kind: 'place', key, col: trackerId, from, to, quote, reason, confidence, msgIdx } */
export function validatePlaceChanges(places, board, st, messages) {
    const rejected = [], best = new Map();
    const ts = runningPlaces(board, st);
    for (const c of arr(places)) {
        const what = `${c?.tracker ?? '?'}: ${c?.place ?? '?'}`;
        const t = ts.find(x => low(x.name) === low(c?.tracker)) || (ts.length === 1 && !c?.tracker ? ts[0] : null);
        if (!t) { rejected.push({ what, reason: 'no running place tracker by that name' }); continue; }
        const p = t.places.find(x => low(x.name) === low(c?.place) || low(x.id) === low(c?.place));
        if (!p) { rejected.push({ what, reason: 'not one of its places', unknown: { tracker: t.name, place: String(c?.place ?? '').trim(), quote: c?.quote } }); continue; }
        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); continue; }
        const key = `place:${t.id}`;
        const lastI = Math.max(-1, ...arr(st?.log).filter(e => e.key === key).map(e => e.i));
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastI) { rejected.push({ what, reason: 'older than its last move' }); continue; }
        const from = hereOf(st, t);
        if (from === p.id) { rejected.push({ what, reason: 'no change' }); continue; }
        if (arr(st?.undone).some(u => u.key === key && sameText(u.quote, quote))) { rejected.push({ what, reason: 'undone before from this line' }); continue; }
        const prev = best.get(key);
        if (prev && prev.msgIdx > msgIdx) { rejected.push({ what, reason: 'an older line than another move for it' }); continue; }
        best.set(key, { kind: 'place', key, col: t.id, from, to: p.id, quote,
            reason: String(c?.reason ?? '').trim().slice(0, 300) || null,
            confidence: ['high', 'medium', 'low'].includes(low(c?.confidence)) ? low(c.confidence) : null, msgIdx });
    }
    return { changes: [...best.values()], rejected };
}

/** Apply checked moves at message `i` (logged like collection changes, so Undo / rewind work the same). */
export function applyPlaceChanges(board, st, changes, i, meta = {}) {
    const next = clone(st);
    next.log = arr(next.log);
    for (const ch of changes) {
        const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        next.places[ch.col] = ch.to;
        next.log.push({ id, i: Math.floor(i || 0), key: ch.key, kind: 'place', col: ch.col, from: ch.from, to: ch.to, quote: ch.quote, reason: ch.reason, confidence: ch.confidence, who: meta.who || 'auto', at: meta.at || new Date().toISOString() });
        ch.logId = id;
    }
    capLog(next);
    return next;
}

export function describePlaceChange(board, ch) {
    const t = arr(board.trackers).find(x => x.id === ch.col);
    return `${t?.name ?? 'Place'}: the scene is now at ${placeLabel(t, ch.to)}`;
}

// ── what DeepLore, the writer and the judge get ─────────────────────────────

/** The value for DeepLore's location filter: the id of "here" of the first running place tracker that sets it, or null. */
export function locationValue(board, st) {
    const t = runningPlaces(board, st).find(x => x.setsLocation !== false);
    if (!t) return null;
    // the place's NAME, as entries write it (location: Bayside Shushail) — not its id, which matched nothing and left
    // out every entry with a location (2026-11-06: the demo showed "Location: p1"); a place inside others brings their
    // names too, so a scene at the inn still counts as the district it is in
    const names = chainOf(t, hereOf(st, t)).map(p => String(p.name || '').trim()).filter(Boolean);
    return names.length > 1 ? names : (names[0] || null);
}

/** Entries pinned while the scene is here: the place's own entries (role 'place' or none). */
export function pinnedHere(board, st) {
    const out = [];
    for (const t of runningPlaces(board, st)) {
        if (t.pinHere === false) continue;
        const p = placeOf(t, hereOf(st, t));
        for (const title of arr(p?.entries)) if (roleOf(p, title) === 'place') out.push(title);
    }
    return out;
}

/** Entries marked "only here" exist only while the scene is at their place (or somewhere inside it). Pinned stay. */
export function filterByPlace(entries, board, st, isPinned = () => false) {
    const owners = new Map();
    for (const t of placeTrackersOf(board)) for (const p of t.places) for (const title of arr(p.entries)) {
        if (roleOf(p, title) !== 'only') continue;
        const k = low(title);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k).push({ t, p });
    }
    if (!owners.size) return entries;
    return entries.filter(e => {
        const own = owners.get(low(e?.title));
        if (!own || isPinned(e)) return true;
        return own.some(o => runOf(st, o.t) == null && chainOf(o.t, hereOf(st, o.t)).some(x => x.id === o.p.id));
    });
}

/** Lines for the writer and the judge: here (in what), often found here, nearby but not here, every other known place. */
export function placeLines(board, st) {
    const out = [];
    for (const t of runningPlaces(board, st)) {
        const here = hereOf(st, t), chain = chainOf(t, here), p = chain[0];
        if (!p) continue;
        out.push(`PLACE: ${placeLabel(t, here)}`);
        const often = arr(p.entries).filter(title => roleOf(p, title) === 'often');
        if (often.length) out.push(`OFTEN FOUND HERE: ${often.join(', ')}`);
        const inChain = new Set(chain.map(x => x.id));
        const near = t.nearby === false ? [] : [...new Set(chain.flatMap(x => arr(x.related)))].filter(id => !inChain.has(id)).map(id => placeOf(t, id)).filter(Boolean);
        if (near.length) out.push(`NEARBY, NOT HERE: ${near.map(x => x.name).join(', ')}`);
        // spots inside "here" are not "not here" (the counter is in the kitchen) — cloud bug hunt, 2026-10-04
        const inside = x => chainOf(t, x.id).some(y => y.id === here);
        const rest = t.places.filter(x => !inChain.has(x.id) && !near.includes(x) && !inside(x));
        if (rest.length) out.push(`KNOWN PLACES, NOT HERE: ${rest.map(x => x.name).join(', ')}`);
    }
    return out;
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-19) — the safety net for places. In her Dragon test the helper, busy with the Cast, the world and
 * five trackers, left out its "places" part and the scene stayed put while she walked to the garden and the kitchens. When
 * the helper says nothing for a place tracker, HER OWN newest message may still move the scene: a movement word, then
 * to / into / toward, then one of the tracker's places — in one sentence, and not a plan, a wish or hearsay.
 * Returns changes in the helper's own shape, so they are checked, logged and undoable like any other.
 */
const MOVE = /\b(walk|walks|walked|walking|go|goes|went|going|head|heads|headed|heading|follow|follows|followed|step|steps|stepped|return|returns|returned|hurry|hurries|hurried|run|runs|ran|wander|wanders|wandered|stroll|strolls|strolled|slip|slips|slipped|move|moves|moved|retire|retires|retired|make my way|make our way|makes (?:his|her|their) way|made (?:my|our|his|her|their) way|lead|leads|led)\b/i;
const NOT_NOW = /\b(tomorrow|later today|one day|someday|some day|perhaps|maybe|will|would|could|should|might|want to|wants to|plan|plans|planning|thinking of|if|i'm told|i am told|i hear|i heard|they say)\b/i;
export function placeFromUserMessage(board, st, messages, reported = []) {
    const user = [...arr(messages)].reverse().find(m => m?.is_user);
    if (!user?.mes) return [];
    const out = [];
    const told = new Set(arr(reported).map(r => String(r?.tracker ?? '').trim().toLowerCase()));
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const t of runningPlaces(board, st)) {
        if (told.has(t.name.toLowerCase())) continue;
        const here = hereOf(st, t);
        let best = null;
        for (const sentence of String(user.mes).split(/(?<=[.!?…])\s+|\n+|\*/)) {
            if (!MOVE.test(sentence) || NOT_NOW.test(sentence)) continue;
            for (const p of t.places) {
                const names = [p.name, p.name.replace(/^the\s+/i, '')].filter(Boolean);
                for (const n of names) {
                    const m = sentence.match(new RegExp(`\\b(?:to|into|toward|towards|inside)\\s+(?:the\\s+)?${esc(n)}\\b`, 'i'));
                    if (m && (!best || n.length > best.len)) best = { p, len: n.length, quote: sentence.trim() };
                }
            }
        }
        if (best && best.p.id !== here) out.push({ tracker: t.name, place: best.p.name, quote: best.quote, reason: 'your own message moves the scene there (the helper said nothing about it)', confidence: 'high' });
    }
    return out;
}
