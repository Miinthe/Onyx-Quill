/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — story trackers that follow the story.
 *
 * Pure rules; no SillyTavern (tested in test/autotrack.test.mjs). The wiring lives in
 * src/autotrack.js. Design: `6 merge roadmap.md` §4 A+.
 *
 * Just before each reply, a helper model reads the newest messages and says, per
 * tracker, whether the story PLAINLY changed it — and quotes the line that shows it.
 * A move is applied only when:
 *   - the tracker and the step exist,
 *   - the tracker's direction allows it ("forward only" trackers never move back by
 *     themselves — Miinthe can always move them back by hand),
 *   - the quote really appears in the messages the helper was shown (quote-match-pure),
 *   - Miinthe has not already undone that same move from that same line.
 * Every applied move is shown with its quote and an Undo.
 */
import { pendingFork, forkInTheWay } from './forks-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): forks
import { HELPER_RULES as COLLECTION_RULES, HELPER_SCHEMA_PARTS as COLLECTION_SCHEMA } from './collections-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): collections
import { PLACES_HELPER_RULES, PLACES_SCHEMA_PART } from './places-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): places
import { STATE_HELPER_RULES, STATE_SCHEMA_PART } from './state-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-05): state + dates
import { METERS_HELPER_RULES, METERS_SCHEMA_PART } from './meters-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-12): meters
import { CAST_HELPER_RULES, CAST_SCHEMA_PART } from './cast-pure.js';   // LOCAL PATCH (Miinthe, 2026-10-13): the Cast
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';
import { MOMENT_RULES, MOMENT_SCHEMA_PART } from './world/alive-pure.js';   // the world layer, stage 2 (2026-10-19): big / quiet moments

export const DIRECTIONS = ['both', 'forward'];
export const directionOf = t => (t?.direction === 'forward' ? 'forward' : 'both');

/**
 * Skipping (Miinthe, 2026-10-03): by default a tracker moves ONE step at a time, in
 * either direction — a ladder goes Friends → Sweethearts → Married, never Friends →
 * Married. A tracker can be allowed to skip (a plot with time jumps). The helper is
 * NOT told this rule: it reports what the story says, and the code refuses a jump,
 * so a refusal is visible to Miinthe instead of being quietly turned into one step.
 */
export const canSkip = t => t?.skip === true;

/** How many recent messages the helper reads (newest last). */
export const AUTOTRACK_WINDOW = 3;

/** The JSON shape the helper must answer in (callAI jsonSchema). */
export const AUTOTRACK_SCHEMA = {
    name: 'tracker_changes',
    strict: false,
    value: {
        type: 'object',
        properties: {
            changes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        tracker: { type: 'string' },
                        step: { type: ['string', 'null'] },
                        aside: { type: ['string', 'null'] },
                        branch: { type: ['string', 'null'] },
                        quote: { type: 'string' },
                        reason: { type: 'string' },
                        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                        recheck: { type: ['integer', 'null'] },     // Mero's 📬 (2026-10-05): when unsure, look again after N messages
                        recheckWhy: { type: ['string', 'null'] },
                    },
                    // step is required (null when only the aside changes): without its
                    // thinking, DeepSeek otherwise sometimes names only the tracker + quote.
                    required: ['tracker', 'step', 'quote', 'reason', 'confidence'],
                },
            },
        },
        required: ['changes'],
    },
};

export const AUTOTRACK_SYSTEM_PROMPT = `You keep story trackers in sync with a roleplay. Each tracker is an ordered list of steps with one current step, and may have an "aside" (a temporary detour beside the step).

Report a change ONLY when the newest messages PLAINLY state it — something that happened or was said, not a hint, a mood, a wish or a possibility. "I'm your new neighbour" plainly makes two strangers neighbours. "I feel close to you" does not change anything.

Rules:
- Only use steps from the tracker's list, spelled exactly as listed. Report the step the messages plainly state, even if it is several steps away.
- A tracker marked "forward only" may only move to a later step.
- A tracker may WAIT AT A FORK: the story goes one of the listed ways after its current step. Set "branch" to that way's name (spelled exactly as listed) only when the newest messages plainly show which way it went; leave "step" null then. Until a branch is reported, a tracker waiting at a fork does not move past that step.
- Set "aside" to a short label when the story plainly starts a detour beside the step; set it to "" when the detour plainly ends. Leave "aside" out (or null) otherwise.
- For every change, "quote" must be copied WORD FOR WORD from the messages — at least a few words, no paraphrase.
- For every change, give "reason": one short sentence saying why the quote makes that change (e.g. "a kiss plainly makes them sweethearts"), and "confidence": high, medium or low.
- When confidence is not high, also give "recheck": after how many messages it would be worth looking at it again (1, 3, 5 or 10), and "recheckWhy": a few words why.
- If nothing plainly changed, answer {"changes": []}. That is the usual answer.

Answer with JSON only: {"changes": [{"tracker": "...", "step": "..." or null, "aside": "..." or null, "branch": "..." or null, "quote": "...", "reason": "...", "confidence": "high"}]}`;

// LOCAL PATCH (Miinthe, 2026-10-05): with collections on the board, the helper also reports
// item and money changes (collections-pure.js) — same message, same call.
/**
 * The system prompt. `withCollections` / `withPlaces` add those rules and answer parts
 * (a boolean first argument means collections only — the round-2 form).
 */
export function autoTrackSystemPrompt(opts) {
    const o = typeof opts === 'object' && opts ? opts : { collections: !!opts };
    const rules = [o.collections ? COLLECTION_RULES : '', o.places ? PLACES_HELPER_RULES : '', o.state ? STATE_HELPER_RULES : '', o.meters ? METERS_HELPER_RULES : '', o.cast ? CAST_HELPER_RULES : '', o.world ? MOMENT_RULES : ''].filter(Boolean);
    if (!rules.length) return AUTOTRACK_SYSTEM_PROMPT;
    const parts = [o.collections ? '"items": [...], "money": [...]' : '', o.places ? '"places": [...]' : '', o.state ? '"state": [...], "dates": [...]' : '', o.meters ? '"meters": [...]' : '', o.cast ? '"people": [...]' : '', o.world ? '"moment": "normal"' : ''].filter(Boolean).join(', ');
    return AUTOTRACK_SYSTEM_PROMPT
        .replace('\nAnswer with JSON only:', `\n${rules.join('\n')}\n\nAnswer with JSON only:`)
        .replace('"confidence": "high"}]}', `"confidence": "high"}], ${parts}}. Leave out a part (or give []) when nothing changed there`);
}
/** The answer's JSON schema, with the parts for collections / places. */
export function autoTrackSchema(opts) {
    const o = typeof opts === 'object' && opts ? opts : { collections: !!opts };
    if (!o.collections && !o.places && !o.state && !o.meters && !o.cast && !o.world) return AUTOTRACK_SCHEMA;
    return { ...AUTOTRACK_SCHEMA, value: { ...AUTOTRACK_SCHEMA.value, properties: { ...AUTOTRACK_SCHEMA.value.properties, ...(o.collections ? COLLECTION_SCHEMA : {}), ...(o.places ? PLACES_SCHEMA_PART : {}), ...(o.state ? STATE_SCHEMA_PART : {}), ...(o.meters ? METERS_SCHEMA_PART : {}), ...(o.cast ? CAST_SCHEMA_PART : {}), ...(o.world ? MOMENT_SCHEMA_PART : {}) } } };
}

/** The user message: the trackers as they stand (plus the collections section), then the recent messages. */
export function buildAutoTrackUser(trackers, messages, extraSection = '') {
    const lines = ['TRACKERS'];
    for (const t of trackers) {
        const cur = t.steps[Math.min(Math.max(t.index, 0), t.steps.length - 1)];
        lines.push(`- ${t.name} (${directionOf(t) === 'forward' ? 'forward only' : 'can move both ways'}): current step "${cur}"${t.aside ? `, aside "${t.aside}"` : ''}. Steps in order: ${t.steps.map(s => `"${s}"`).join(', ')}`);
        const pend = pendingFork(t);
        if (pend && pend.fork.by !== 'roll') lines.push(`  WAITS AT A FORK after "${pend.step}" — the story goes one of these ways: ${pend.fork.branches.map(b => `"${b.name}"`).join(', ')}`);
    }
    if (extraSection) lines.push(extraSection);
    lines.push('', 'NEWEST MESSAGES (oldest first)');
    for (const m of messages) lines.push(`${m.name || (m.is_user ? 'User' : 'Character')}: ${String(m.mes || '').trim()}`);
    return lines.join('\n');
}

const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);

/**
 * Turn the helper's answer into moves that are safe to apply.
 *
 * @param {Array} changes - the helper's `changes` array (untrusted)
 * @param {Array} trackers - current trackers
 * @param {Array<{mes}>} messages - exactly the messages the helper was shown
 * @returns {{ moves: Array<{name, fromIndex, toIndex, fromAside, toAside, quote}>, rejected: Array<{tracker, reason}> }}
 */
export function validateChanges(changes, trackers, messages, unmetNeedsOf = () => []) {
    const rejected = [];
    // Per tracker, the candidate quoted from the NEWEST message wins. The helper
    // reads a few messages and sometimes re-reports an older change next to the
    // new one ("strangers again" from a fight two messages ago, beside "let's be
    // neighbours again" now); taking the first one would let the old line win.
    const best = new Map();   // tracker name → { move, msgIdx }
    for (const c of (Array.isArray(changes) ? changes : [])) {
        const name = String(c?.tracker ?? '').trim();
        const t = trackers.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (!t) { rejected.push({ tracker: name, reason: 'unknown tracker' }); continue; }

        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ tracker: t.name, reason: 'quote not found in the messages' }); continue; }
        // A line from before the tracker's last move (by hand or by itself) is history,
        // not news: it must not move the tracker again (Miinthe's test, 2026-10-03 — a hand
        // move back to Friends was undone next turn by an older "we are sweethearts").
        // engine on v2, step 7: the read view carries it from the v2 log (`lastMoveAt`); else the list's own history
        const lastMove = Number.isFinite(t.lastMoveAt) ? t.lastMoveAt : Math.max(-1, ...(t.journal || []).map(e => (Number.isFinite(e?.i) ? e.i : -1)));
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastMove) { rejected.push({ tracker: t.name, reason: 'older than its last move' }); continue; }
        // LOCAL PATCH (Miinthe, 2026-10-19): the reply that answers the message a move was made on is the same moment
        // retold, not news — in her Dragon test the Ladder went Known Envoy → Liked Envoy on Corvin's reply restating
        // the "weeks pass" line that had just moved it. The next real development can still move it.
        const mv = messages.find(m => m?._i === lastMove), nx = messages.find(m => m?._i === lastMove + 1);
        if (Number.isFinite(at) && at === lastMove + 1 && mv?.is_user === true && nx?.is_user === false) { rejected.push({ tracker: t.name, reason: 'the reply to its last move (the same moment)' }); continue; }

        const fromIndex = Math.min(Math.max(t.index, 0), t.steps.length - 1);
        // a fork's branch (forks-pure.js): only while the tracker waits at that fork
        if (typeof c.branch === 'string' && c.branch.trim()) {
            const pend = pendingFork(t);
            if (!pend || pend.fork.by === 'roll') { rejected.push({ tracker: t.name, reason: 'not waiting at a fork' }); continue; }
            const br = pend.fork.branches.find(b => b.name.toLowerCase() === c.branch.trim().toLowerCase());
            if (!br) { rejected.push({ tracker: t.name, reason: `"${c.branch}" is not a branch after ${pend.step}` }); continue; }
            const prevB = best.get(t.name);
            if (prevB && prevB.msgIdx > msgIdx) { rejected.push({ tracker: t.name, reason: 'an older line than another change for it' }); continue; }
            const reasonB = String(c?.reason ?? '').trim().slice(0, 300) || null;
            const confB = ['high', 'medium', 'low'].includes(String(c?.confidence).toLowerCase()) ? String(c.confidence).toLowerCase() : null;
            best.set(t.name, { t, msgIdx, move: { name: t.name, fromIndex, toIndex: fromIndex, fromAside: t.aside || null, toAside: t.aside || null, branch: br.name, step: pend.step, quote, reason: reasonB, confidence: confB, ...recheckOf(c), at: messages[msgIdx]?._i } });
            continue;
        }
        let toIndex = fromIndex;
        if (typeof c.step === 'string' && c.step.trim()) {
            const k = t.steps.findIndex(s => s.toLowerCase() === c.step.trim().toLowerCase());
            if (k === -1) { rejected.push({ tracker: t.name, reason: `"${c.step}" is not one of its steps` }); continue; }
            toIndex = k;
        }

        const fromAside = t.aside || null;
        // a detour belongs to its step (Miinthe, 2026-10-05): moving to another step ends it, unless the same
        // change sets one there (the same entry can sit on a detour of each step where it fits)
        let toAside = toIndex !== fromIndex ? null : fromAside;
        if (typeof c.aside === 'string') toAside = c.aside.trim() || null;

        // LOCAL PATCH (Miinthe, 2026-10-19): a detour marked "only once" the story has already been in is never set again by the helper
        const low = x => String(x ?? '').trim().toLowerCase();
        if (toAside && low(toAside) !== low(fromAside) && (t.onceAsides || []).some(n => low(n) === low(toAside)) && (t.journal || []).some(e => low(e?.aside) === low(toAside))) { rejected.push({ tracker: t.name, reason: `${toAside} only once — the story has already been there` }); continue; }
        const prev = best.get(t.name);
        if (prev && prev.msgIdx > msgIdx) { rejected.push({ tracker: t.name, reason: 'an older line than another change for it' }); continue; }
        if (prev) rejected.push({ tracker: t.name, reason: 'superseded by a change from a newer line' });
        const reason = String(c?.reason ?? '').trim().slice(0, 300) || null;
        const confidence = ['high', 'medium', 'low'].includes(String(c?.confidence).toLowerCase()) ? String(c.confidence).toLowerCase() : null;
        best.set(t.name, { t, msgIdx, move: { name: t.name, fromIndex, toIndex, fromAside, toAside, quote, reason, confidence, ...recheckOf(c), at: messages[msgIdx]?._i } });
    }

    const moves = [];
    // an undone move stays undone; one put off ("re-check in N", Mero's 📬) only until that message
    const nowI = Math.max(-1, ...messages.map(m => (Number.isFinite(m?._i) ? m._i : -1)));
    const stillUndone = u => !Number.isFinite(u?.until) || u.until > nowI;
    for (const { t, move } of best.values()) {
        if (move.branch) {
            const undoneB = (t.undone || []).some(u => stillUndone(u) && sameText(u.quote, move.quote) && u.branch === move.branch);
            if (undoneB) { rejected.push({ tracker: t.name, reason: 'undone before from this line' }); continue; }
            moves.push(move);
            continue;
        }
        if (move.toIndex > move.fromIndex) {
            const fork = forkInTheWay(t, move.fromIndex, move.toIndex);
            if (fork) { rejected.push({ tracker: t.name, reason: 'waits at a fork', fork: { at: fork, to: t.steps[move.toIndex], quote: move.quote, why: move.reason } }); continue; }
        }
        if (move.toIndex < move.fromIndex && directionOf(t) === 'forward') { rejected.push({ tracker: t.name, reason: 'forward only' }); continue; }
        if (Math.abs(move.toIndex - move.fromIndex) > 1 && !canSkip(t)) {
            rejected.push({ tracker: t.name, reason: 'skips steps', skipped: { from: t.steps[move.fromIndex], to: t.steps[move.toIndex], between: t.steps.slice(Math.min(move.fromIndex, move.toIndex) + 1, Math.max(move.fromIndex, move.toIndex)), quote: move.quote, why: move.reason } });
            continue;
        }
        if (move.toIndex === move.fromIndex && move.toAside === move.fromAside) { rejected.push({ tracker: t.name, reason: 'no change' }); continue; }
        if (move.toIndex !== move.fromIndex) {
            const unmet = unmetNeedsOf(t, move.toIndex);
            if (unmet.length) { rejected.push({ tracker: t.name, reason: 'needs', needs: { to: t.steps[move.toIndex], from: t.steps[move.fromIndex], unmet, quote: move.quote, why: move.reason } }); continue; }
        }
        const undone = (t.undone || []).some(u => stillUndone(u) && sameText(u.quote, move.quote) && u.toIndex === move.toIndex && (u.toAside || null) === move.toAside);
        if (undone) { rejected.push({ tracker: t.name, reason: 'undone before from this line' }); continue; }
        moves.push(move);
    }
    return { moves, rejected };
}

/**
 * Read the helper's answer: plain JSON, JSON inside a ``` fence, or the first {...}
 * block in surrounding text. Anything unreadable means "no changes".
 * @returns {Array} the `changes` array (possibly empty)
 */
export function parseHelperAnswer(text) {
    const raw = String(text ?? '').trim();
    const tries = [raw];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) tries.push(fence[1]);
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries) {
        try {
            const v = JSON.parse(t);
            if (Array.isArray(v?.changes)) return v.changes;
            if (Array.isArray(v)) return v;
        } catch { /* try the next form */ }
    }
    return [];
}

/**
 * The Cast's older two-list form ("cast" + "learns", 2026-10-13 morning) under the names models invented for it
 * ("cast_presence", "cast_learns") or nested as {"cast": {"presence": [...], "learns": [...]}} — still read, in case an
 * answer comes back that way; the helper is asked for one "people" list now (cast-pure.js CAST_HELPER_RULES).
 */
function castAliases(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const out = { ...v };
    const pick = (...keys) => keys.map(k => v[k]).find(Array.isArray);
    if (v.cast && typeof v.cast === 'object' && !Array.isArray(v.cast)) { out.cast = Array.isArray(v.cast.presence) ? v.cast.presence : Array.isArray(v.cast.cast) ? v.cast.cast : []; if (!Array.isArray(out.learns) && Array.isArray(v.cast.learns)) out.learns = v.cast.learns; }
    if (!Array.isArray(out.cast)) { const c = pick('cast_presence', 'presence', 'castPresence'); if (c) out.cast = c; }
    if (!Array.isArray(out.learns)) { const l = pick('cast_learns', 'castLearns', 'learned', 'knowledge'); if (l) out.learns = l; }
    if (!Array.isArray(out.cast)) delete out.cast;
    return out;
}

/** The whole answer: tracker changes plus collection items and money (each [] when absent or unreadable). */
export function parseHelperAnswerAll(text) {
    const raw = String(text ?? '').trim();
    const tries = [raw];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) tries.push(fence[1]);
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries) {
        try {
            const v = castAliases(JSON.parse(t));
            if (v && typeof v === 'object' && !Array.isArray(v) && ['changes', 'items', 'money', 'places', 'state', 'dates', 'meters', 'people', 'cast', 'learns'].some(k => Array.isArray(v[k]))) {
                const a = k => (Array.isArray(v[k]) ? v[k] : []);
                return { changes: a('changes'), items: a('items'), money: a('money'), places: a('places'), state: a('state'), dates: a('dates'), meters: a('meters'), people: a('people'), cast: a('cast'), learns: a('learns') };
            }
            if (Array.isArray(v)) return { changes: v, items: [], money: [], places: [], state: [], dates: [], meters: [], people: [], cast: [], learns: [] };
        } catch { /* try the next form */ }
    }
    return { changes: [], items: [], money: [], places: [], state: [], dates: [], meters: [], people: [], cast: [], learns: [] };
}

/** "a kiss plainly makes them sweethearts (high)" — the reason as DeepLore shows the judge's. */
export function describeReason(m) {
    if (!m?.reason) return '';
    return m.confidence ? `${m.reason} (${m.confidence})` : m.reason;
}

/** The notice text for an applied move. */
export function describeMove(t, m) {
    const step = i => t.steps[i];
    const parts = [];
    if (m.toIndex !== m.fromIndex) parts.push(`${step(m.fromIndex)} → ${step(m.toIndex)}`);
    if (m.toAside !== m.fromAside) parts.push(m.toAside ? `detour: ${m.toAside}` : `detour ended${m.fromAside ? ` (${m.fromAside})` : ''}`);
    return `${t.name}: ${parts.join(', ')}`;
}

/** The helper's "look again after N messages" (1 / 3 / 5 / 10 — the nearest), with its few words why. */
function recheckOf(c) {
    const n = Math.round(Number(c?.recheck));
    if (!Number.isFinite(n) || n <= 0) return {};
    const near = [1, 3, 5, 10].reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    const why = String(c?.recheckWhy ?? '').trim().slice(0, 160);
    return { recheck: near, ...(why ? { recheckWhy: why } : {}) };
}

/** Remember an undone move so the same line does not re-apply it (last 20 kept); `until`: only until that message. */
export function rememberUndo(undone, m, until = null) {
    const list = Array.isArray(undone) ? undone.slice() : [];
    list.push({ quote: m.quote, toIndex: m.toIndex, toAside: m.toAside || null, ...(m.branch ? { branch: m.branch } : {}), ...(Number.isFinite(until) ? { until, ...(Number.isFinite(m.at) ? { at: m.at } : {}) } : {}) });
    return list.slice(-20);
}
