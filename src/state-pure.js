/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — state and dates in play (storyboard stage 3, round 4).
 * Pure rules on the v2 board and chat state; tested in test/state.test.mjs.
 * Design: `8 storyboard design.md` §12 (state) and `6 merge roadmap.md` §4 G+.
 *
 * A STATE TRACKER holds fields — a CYCLE (time of day, weekdays, seasons; "each round adds a
 * day"), the DAY (a number) and CHOICES (weather, mood) — and a CALENDAR of due dates.
 *
 * RULES
 *  - The helper reports a field's new value only when the newest messages plainly say so
 *    ("the next morning", "rain starts drumming on the window", "three days later"), with a
 *    word-for-word quote. Time never runs backwards: the day only grows; a cycle that comes
 *    round again (Night → Morning) adds a day, unless the same answer already moved the day.
 *  - DUE DATES (Miinthe: "the due date is meant to have the AI not skip time over it and also
 *    keeps the urgency"): the writer is told "Coming up — don't skip past: Party at the harbor
 *    (in 1 day)". If the story jumps past one anyway, the jump is recorded as the story says
 *    and a notice says which date was skipped.
 *  - The story can ADD dates ("In two days there's a huge party at the harbor") when the board
 *    allows it — on their own or after asking (board setting). Miinthe: several are fine. Dates the
 *    story adds belong to THIS chat (state.states[id].dates); the board's own dates are the
 *    same in every chat.
 *  - Every change is logged by message (state.log): Undo, and a delete rolls it back.
 */
import { runOf, stateNow, fieldOf, fieldValue, capLog } from './board-model-pure.js';
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';

const low = s => String(s ?? '').trim().toLowerCase();
const arr = v => (Array.isArray(v) ? v : []);
const clone = o => JSON.parse(JSON.stringify(o));
const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);

export const stateTrackersOf = board => arr(board?.trackers).filter(t => t.kind === 'state');
export const runningStates = (board, st) => stateTrackersOf(board).filter(t => runOf(st, t) == null);
const dayFieldOf = t => arr(t.fields).find(f => f.type === 'day') || null;

/** The board's dates and the ones the story added in this chat, soonest first. */
export function datesOf(t, st) {
    return [...arr(t.dates), ...arr(stateNow(st, t).dates)].sort((a, b) => a.due - b.due);
}
/** "in 2 days" / "today" / "passed" */
export function dueText(d, day) {
    const n = d.due - day;
    return n < 0 ? 'passed' : n === 0 ? 'today' : `in ${n} day${n > 1 ? 's' : ''}`;
}
/** "Day 3 · Afternoon · Raining" */
export function nowLine(t, st) {
    const now = stateNow(st, t);
    return [...arr(t.fields)].sort((a, b) => (b.type === 'day') - (a.type === 'day'))
        .map(f => (f.type === 'day' ? `Day ${now.day}` : fieldValue(st, t, f))).join(' · ');
}

// ── what the helper is told ─────────────────────────────────────────────────

export function stateHelperSection(board, st) {
    const ts = runningStates(board, st);
    if (!ts.length) return '';
    const lines = ['', 'STATE (time, weather … — report "state" changes; new appointments in "dates")'];
    for (const t of ts) {
        const now = stateNow(st, t);
        const fields = t.fields.map(f => (f.type === 'day' ? `"${f.name}" (the day number, now ${now.day})`
            : `"${f.name}" (${f.type === 'cycle' ? 'goes round' : 'one of'}: ${f.values.map(v => `"${v}"`).join(', ')}; now "${fieldValue(st, t, f)}")`));
        lines.push(`- ${t.name}: ${nowLine(t, st)}. Fields: ${fields.join(', ')}`);
        const up = datesOf(t, st).filter(d => d.due >= now.day);
        if (up.length) lines.push(`  Calendar: ${up.map(d => `"${d.name}" on Day ${d.due}`).join(', ')}`);
        if (t.datesGrow) lines.push('  New appointments with a day may be added (report them in "dates").');
    }
    return lines.join('\n');
}

export const STATE_HELPER_RULES = `- STATE: report a field's new value in "state" — {"tracker", "field", "value", "quote", "reason", "confidence"} — only when the newest messages plainly say so ("the next morning", "rain starts", "three days later"). For a listed value use it exactly; for the day give the new day number or "+N". Time never goes back. A plain arrangement with a day ("in two days there's a party", "the trial is on Friday … that's in 3 days") goes into "dates" — {"tracker", "name", "in_days" (a number), "quote", "reason", "confidence"} — only where new appointments may be added.`;

export const STATE_SCHEMA_PART = {
    state: { type: 'array', items: { type: 'object', properties: {
        tracker: { type: 'string' }, field: { type: 'string' }, value: { type: ['string', 'number'] },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['tracker', 'field', 'value', 'quote', 'reason', 'confidence'] } },
    dates: { type: 'array', items: { type: 'object', properties: {
        tracker: { type: 'string' }, name: { type: 'string' }, in_days: { type: 'number' },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['tracker', 'name', 'in_days', 'quote', 'reason', 'confidence'] } },
};

// ── checking ────────────────────────────────────────────────────────────────

/**
 * The helper's `state` and `dates` → safe changes:
 *   { kind: 'state', key, col, field, from, to, dayFrom, dayTo, quote, … , skipped?: [date names] }
 *   { kind: 'date', key, col, date: { id, name, due, by: 'ai', q }, ask: bool, quote, … }
 */
export function validateStateChanges(stateList, dateList, board, st, messages) {
    const rejected = [], changes = [];
    const ts = runningStates(board, st);
    const findT = name => ts.find(x => low(x.name) === low(name)) || (ts.length === 1 && !name ? ts[0] : null);
    const quoteOf = (c, what, key) => {
        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); return null; }
        const lastI = Math.max(-1, ...arr(st?.log).filter(e => e.key === key).map(e => e.i));
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastI) { rejected.push({ what, reason: 'older than its last change' }); return null; }
        if (arr(st?.undone).some(u => u.key === key && sameText(u.quote, quote))) { rejected.push({ what, reason: 'undone before from this line' }); return null; }
        return { quote, msgIdx };
    };
    const meta = c => ({ reason: String(c?.reason ?? '').trim().slice(0, 300) || null, confidence: ['high', 'medium', 'low'].includes(low(c?.confidence)) ? low(c.confidence) : null });

    // per tracker: the day it ends at after this answer (explicit day changes first)
    const dayAfter = new Map();
    const items = arr(stateList).map(c => ({ c, t: findT(c?.tracker) }));
    const isDayItem = ({ c, t }) => t && fieldOf(t, dayFieldOf(t)?.id) && (low(c?.field) === low(dayFieldOf(t)?.name) || low(c?.field) === 'day');
    for (const x of [...items.filter(isDayItem), ...items.filter(x => !isDayItem(x))]) {
        const { c, t } = x;
        const what = `${c?.tracker ?? '?'}: ${c?.field ?? '?'}`;
        if (!t) { rejected.push({ what, reason: 'no running state tracker by that name' }); continue; }
        const now = stateNow(st, t);
        const cur = dayAfter.has(t.id) ? dayAfter.get(t.id) : now.day;
        if (isDayItem(x)) {
            // "4", "+2" — and the way models also write it: "Day 4", "day +2" (cloud bug hunt, 2026-10-04)
            const f = dayFieldOf(t), raw = String(c?.value ?? '').trim().replace(/^day\s*/i, '');
            const to = /^\+\s*\d+$/.test(raw) ? cur + Number(raw.replace(/[+\s]/g, '')) : Math.round(Number(raw));
            if (!Number.isFinite(to)) { rejected.push({ what, reason: `"${raw}" is not a day` }); continue; }
            if (to < cur) { rejected.push({ what, reason: 'time does not go back' }); continue; }
            if (to === cur) { rejected.push({ what, reason: 'no change' }); continue; }
            const key = `state:${t.id}:${f.id}`;
            const q = quoteOf(c, what, key); if (!q) continue;
            const skipped = datesOf(t, st).filter(d => d.due > cur && d.due < to).map(d => d.name);
            changes.push({ kind: 'state', key, col: t.id, field: f.id, from: undefined, to: undefined, dayFrom: cur, dayTo: to, quote: q.quote, msgIdx: q.msgIdx, ...meta(c), ...(skipped.length ? { skipped } : {}) });
            dayAfter.set(t.id, to);
            continue;
        }
        const f = arr(t.fields).find(y => y.type !== 'day' && (low(y.name) === low(c?.field) || low(y.id) === low(c?.field)));
        if (!f) { rejected.push({ what, reason: 'not one of its fields' }); continue; }
        const val = f.values.find(v => low(v) === low(c?.value));
        if (!val) { rejected.push({ what, reason: `"${c?.value}" is not one of its values` }); continue; }
        const from = fieldValue(st, t, f);
        if (from === val) { rejected.push({ what, reason: 'no change' }); continue; }
        const key = `state:${t.id}:${f.id}`;
        const q = quoteOf(c, what, key); if (!q) continue;
        // a cycle coming round again (Night → Morning) is the next day — unless the day already moved in this answer
        let dayTo = cur;
        if (f.type === 'cycle' && f.addsDay && dayFieldOf(t) && f.values.indexOf(val) < f.values.indexOf(from) && !dayAfter.has(t.id)) dayTo = cur + 1;
        const skipped = datesOf(t, st).filter(d => d.due > cur && d.due < dayTo).map(d => d.name);
        changes.push({ kind: 'state', key, col: t.id, field: f.id, from, to: val, dayFrom: cur, dayTo, quote: q.quote, msgIdx: q.msgIdx, ...meta(c), ...(skipped.length ? { skipped } : {}) });
        if (dayTo !== cur) dayAfter.set(t.id, dayTo);
    }

    for (const c of arr(dateList)) {
        const what = `${c?.tracker ?? '?'}: date ${c?.name ?? '?'}`;
        const t = findT(c?.tracker);
        if (!t) { rejected.push({ what, reason: 'no running state tracker by that name' }); continue; }
        if (!t.datesGrow) { rejected.push({ what, reason: 'this calendar takes no new dates' }); continue; }
        const name = String(c?.name ?? '').trim().slice(0, 80);
        const n = Math.round(Number(c?.in_days));
        if (!name || !Number.isFinite(n) || n < 0) { rejected.push({ what, reason: 'needs a name and a number of days' }); continue; }
        const base = dayAfter.has(t.id) ? dayAfter.get(t.id) : stateNow(st, t).day;
        if (datesOf(t, st).some(d => low(d.name) === low(name) && d.due >= base)) { rejected.push({ what, reason: 'already on the calendar' }); continue; }
        const key = `date:${t.id}:${low(name)}`;
        const q = quoteOf(c, what, key); if (!q) continue;
        const id = `d${low(name).replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${base + n}`;
        changes.push({ kind: 'date', key, col: t.id, date: { id, name, due: base + n, by: 'ai', q: q.quote }, ask: t.datesAsk === 'ask', quote: q.quote, msgIdx: q.msgIdx, ...meta(c) });
    }
    return { changes, rejected };
}

// ── applying ────────────────────────────────────────────────────────────────

/** Apply checked changes at message `i` (logged; Undo / rewind via collections-pure's log). Dates with `ask` are left out — the caller asks first. */
export function applyStateChanges(board, st, changes, i, meta = {}) {
    const next = clone(st);
    next.log = arr(next.log);
    for (const ch of changes) {
        if (ch.kind === 'date' && ch.ask) continue;
        const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const sv = (next.states[ch.col] ||= { day: 1, vals: {} });
        const entry = { id, i: Math.floor(i || 0), key: ch.key, kind: ch.kind, col: ch.col, quote: ch.quote, reason: ch.reason, confidence: ch.confidence, who: meta.who || 'auto', at: meta.at || new Date().toISOString() };
        if (ch.kind === 'state') {
            if (ch.to !== undefined) { sv.vals = { ...(sv.vals || {}), [ch.field]: ch.to }; }
            Object.assign(entry, { field: ch.field, from: ch.from, to: ch.to, dayFrom: sv.day, dayTo: ch.dayTo });
            sv.day = ch.dayTo;
        } else {
            sv.dates = [...arr(sv.dates), ch.date];
            Object.assign(entry, { date: ch.date.id });
        }
        next.log.push(entry);
        ch.logId = id;
    }
    capLog(next);
    return next;
}

/** Undo / rewind one logged state or date change (called from collections-pure's revert). */
export function revertState(st, e) {
    const sv = st.states[e.col];
    if (!sv) return;
    if (e.kind === 'date') { sv.dates = arr(sv.dates).filter(d => d.id !== e.date); if (!sv.dates.length) delete sv.dates; return; }
    sv.day = e.dayFrom;
    if (e.to !== undefined) {
        if (e.from === undefined) delete sv.vals[e.field]; else sv.vals = { ...(sv.vals || {}), [e.field]: e.from };
    }
}

/** The notice for a change. */
export function describeStateChange(board, ch) {
    const t = arr(board.trackers).find(x => x.id === ch.col);
    if (ch.kind === 'date') return `${t?.name ?? 'Calendar'}: new date — ${ch.date.name} on Day ${ch.date.due}`;
    const f = fieldOf(t, ch.field);
    const parts = [];
    if (ch.to !== undefined) parts.push(`${f?.name ?? ch.field}: ${ch.from ?? '—'} → ${ch.to}`);
    if (ch.dayTo !== ch.dayFrom) parts.push(`Day ${ch.dayFrom} → Day ${ch.dayTo}`);
    return `${t?.name ?? 'State'}: ${parts.join(', ')}${ch.skipped ? ` — skipped past ${ch.skipped.join(', ')}` : ''}`;
}

// ── what the writer and the judge get ───────────────────────────────────────

/** "WORLD: Day 3 · Afternoon · Raining" and "COMING UP — don't skip past: Party at the harbor (in 1 day)". */
export function stateLines(board, st) {
    const out = [];
    for (const t of runningStates(board, st)) {
        out.push(`${t.name.toUpperCase()}: ${nowLine(t, st)}`);
        const day = stateNow(st, t).day;
        const up = datesOf(t, st).filter(d => d.due >= day);
        if (up.length) out.push(`COMING UP — don't skip past: ${up.map(d => `${d.name} (${dueText(d, day)})`).join(', ')}`);
    }
    return out;
}
