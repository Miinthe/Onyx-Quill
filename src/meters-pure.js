/**
 * LOCAL PATCH (Miinthe, 2026-10-12) — meters in play (`14 meters and flags design.md`; Miinthe's five calls ✔ 2026-10-05).
 * Pure rules on the v2 board and chat state; tested in test/meters.test.mjs. Glue: autotrack.js, board-live.js.
 *
 * A METER is a counter the helper watches (trust, tension, suspicion, debt — something gradual).
 *
 * RULES
 *  - Sizes, not numbers: the helper reports gain or loss and its size — slight / clear / big — with a
 *    word-for-word quote. The board turns the size into points set per meter. Models are good at the
 *    direction of a change and bad at its size; this keeps the size out of their hands (no inflation).
 *  - "What counts" is Miinthe's judge entry on the meter (its `keep`), in her words — the helper reads it.
 *  - Limits: one change per meter per turn, at most `cap` points; never below min / above max; a band with
 *    lines into it ("Trust can only reach Devoted once Relationship reaches Married") is not entered until they
 *    hold — the meter stops just below it and the notice says why.
 *  - Drift (off by default): after `every` messages without a change, the meter moves one slight step back
 *    toward its resting value.
 *  - The writer is told the BAND, never the number: "TRUST (Kettle → you): Trusting, rising".
 *  - Entries on a band exist only while the meter is in that band (board-links-pure.js); a band change is a
 *    big moment (Mero's glow, mero-glow-pure.js).
 *  - Every change is logged by message (state.log, kind 'meter'): Undo, and a delete rolls it back.
 */
import { runOf, isMeter, bandOfValue, bandById, counterValue, holds, condText, capLog } from './board-model-pure.js';
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';

const low = s => String(s ?? '').trim().toLowerCase();
const arr = v => (Array.isArray(v) ? v : []);
const clone = o => JSON.parse(JSON.stringify(o));
const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);

export const SIZE_WORDS = ['slight', 'clear', 'big'];
/** How long a change keeps a meter "rising" / "falling" for the writer (messages). */
export const TREND_SPAN = 10;

export const metersOf = board => arr(board?.trackers).filter(isMeter);
export const runningMeters = (board, st) => metersOf(board).filter(t => runOf(st, t) == null);
export const meterValue = (st, t) => counterValue(st, t);
export const bandNow = (st, t) => bandOfValue(t, meterValue(st, t));
const lo = t => (t.min != null ? t.min : -Infinity);
const hi = t => (t.max != null ? t.max : Infinity);

/** 'rising' / 'falling' / 'steady' — the newest logged change of this meter within the last TREND_SPAN messages. */
export function trendOf(st, t, nowI = null) {
    const own = arr(st?.log).filter(e => e.kind === 'meter' && e.col === t.id);
    const last = own.at(-1);
    if (!last) return 'steady';
    const now = Number.isFinite(nowI) ? nowI : Math.max(...arr(st?.log).map(e => Number(e.i) || 0));
    if (now - last.i > TREND_SPAN) return 'steady';
    return last.to > last.from ? 'rising' : last.to < last.from ? 'falling' : 'steady';
}

/** "TRUST (Kettle → you): Trusting, rising" — the writer's and the judge's line. */
export function meterLine(t, st, nowI = null) {
    const who = t.meter.who && t.meter.who !== 'two-ended' ? ` (${t.meter.who})` : '';
    return `${t.name.toUpperCase()}${who}: ${bandNow(st, t)?.name ?? '?'}, ${trendOf(st, t, nowI)}`;
}

/** The writer's / judge's lines for every running meter. */
export function meterLines(board, st, nowI = null) {
    return runningMeters(board, st).map(t => meterLine(t, st, nowI));
}

// ── what the helper is told ─────────────────────────────────────────────────

const judgeOf = (t, judgeText) => arr(t.keep?.entries).filter(title => (t.keep?.kinds || {})[title] === 'judge')
    .map(title => String(judgeText(title) || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s);

export function metersHelperSection(board, st, { judgeText = () => '' } = {}) {
    const ts = runningMeters(board, st);
    if (!ts.length) return '';
    const lines = ['', 'METERS (gradual — report "meters" changes: gain or loss, and how big)'];
    for (const t of ts) {
        const b = bandNow(st, t), bands = t.meter.bands;
        const k = bands.indexOf(b);
        const near = [bands[k - 1] && `below: "${bands[k - 1].name}"`, bands[k + 1] && `above: "${bands[k + 1].name}"`].filter(Boolean).join(', ');
        lines.push(`- ${t.name}${t.meter.who && t.meter.who !== 'two-ended' ? ` (${t.meter.who})` : ''}: now "${b?.name ?? '?'}"${near ? ` (${near})` : ''}`);
        const rule = judgeOf(t, judgeText);
        if (rule) lines.push(`  What counts: ${clip(rule, 600)}`);
    }
    return lines.join('\n');
}

export const METERS_HELPER_RULES = `- METERS: report a change in "meters" — {"tracker", "change": "gain" or "loss", "size": "slight", "clear" or "big", "quote", "reason", "confidence"} — only when the newest messages plainly show something that shifts it, judged by its "What counts" when given. Size: slight = a small sign, clear = an unmistakable act or word, big = a turning point (a broken promise, a sacrifice, a confession). Politeness, small talk and moods count for nothing. At most one change per meter; most turns have none.`;

export const METERS_SCHEMA_PART = {
    meters: { type: 'array', items: { type: 'object', properties: {
        tracker: { type: 'string' }, change: { type: 'string', enum: ['gain', 'loss'] }, size: { type: 'string', enum: SIZE_WORDS },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['tracker', 'change', 'size', 'quote', 'reason', 'confidence'] } },
};

// ── checking ────────────────────────────────────────────────────────────────

/**
 * Where a meter may go from `from` by `delta`: clamped to min / max and stopped below a band whose lines into it
 * don't hold. Returns { to, held: { band, why } | null }.
 */
export function landing(board, st, t, from, delta) {
    let to = Math.max(lo(t), Math.min(hi(t), from + delta));
    let held = null;
    if (to > from) {
        // every band entered on the way up must be open
        for (const b of t.meter.bands) {
            if (b.from <= from || b.from > to) continue;
            const shut = arr(b.needs).filter(c => !holds(board, st, c));
            if (shut.length) { to = b.from - 1; held = { band: b.name, why: shut.map(c => condText(board, c)).join(' and ') }; break; }
        }
        if (to < from) to = from;   // already above the closed band's start (it was entered before the line closed)
    }
    return { to, held };
}

/**
 * The helper's `meters` → safe changes:
 *   { kind: 'meter', key, col, from, to, dir, size, points, bandFrom, bandTo, held?, quote, msgIdx, reason, confidence }
 */
export function validateMeterChanges(list, board, st, messages) {
    const rejected = [], changes = [];
    const ts = runningMeters(board, st);
    const done = new Set();
    for (const c of arr(list)) {
        const what = `${c?.tracker ?? '?'}: ${c?.change ?? '?'} ${c?.size ?? ''}`.trim();
        const t = ts.find(x => low(x.name) === low(c?.tracker)) || (ts.length === 1 && !c?.tracker ? ts[0] : null);
        if (!t) { rejected.push({ what, reason: 'no running meter by that name' }); continue; }
        if (done.has(t.id)) { rejected.push({ what, reason: 'one change per meter per turn' }); continue; }
        const dir = low(c?.change), size = low(c?.size);
        if (!['gain', 'loss'].includes(dir)) { rejected.push({ what, reason: 'change must be gain or loss' }); continue; }
        if (!SIZE_WORDS.includes(size)) { rejected.push({ what, reason: 'size must be slight, clear or big' }); continue; }
        const key = `meter:${t.id}`;
        const quote = String(c?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); continue; }
        const lastI = Math.max(-1, ...arr(st?.log).filter(e => e.key === key).map(e => e.i));
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastI) { rejected.push({ what, reason: 'older than its last change' }); continue; }
        if (arr(st?.undone).some(u => u.key === key && sameText(u.quote, quote))) { rejected.push({ what, reason: 'undone before from this line' }); continue; }
        const points = Math.min(t.meter.sizes[size], t.meter.cap);
        const from = meterValue(st, t);
        const { to, held } = landing(board, st, t, from, dir === 'gain' ? points : -points);
        if (to === from) { rejected.push({ what, reason: held ? 'held below a closed band' : 'already at its limit', ...(held ? { held, quote } : {}) }); continue; }
        done.add(t.id);
        changes.push({ kind: 'meter', key, col: t.id, from, to, dir, size, points, bandFrom: bandOfValue(t, from)?.id, bandTo: bandOfValue(t, to)?.id, ...(held ? { held } : {}),
            quote, msgIdx, reason: String(c?.reason ?? '').trim().slice(0, 300) || null, confidence: ['high', 'medium', 'low'].includes(low(c?.confidence)) ? low(c.confidence) : null });
    }
    return { changes, rejected };
}

// ── applying ────────────────────────────────────────────────────────────────

/** Apply checked changes at message `i` (logged; Undo / rewind through collections-pure's log). */
export function applyMeterChanges(board, st, changes, i, meta = {}) {
    const next = clone(st);
    next.log = arr(next.log);
    next.counters ||= {};
    for (const ch of changes) {
        const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        next.counters[ch.col] = ch.to;
        next.log.push({ id, i: Math.floor(i || 0), key: ch.key, kind: 'meter', col: ch.col, from: ch.from, to: ch.to, ...(ch.dir ? { dir: ch.dir, size: ch.size } : {}),
            bandFrom: ch.bandFrom, bandTo: ch.bandTo, ...(ch.held ? { held: ch.held } : {}), quote: ch.quote ?? null, reason: ch.reason ?? null, confidence: ch.confidence ?? null,
            who: ch.who || meta.who || 'auto', at: meta.at || new Date().toISOString() });
        ch.logId = id;
    }
    capLog(next);
    return next;
}

/** Undo / rewind one logged meter change (called from collections-pure's revert). */
export function revertMeter(st, e) {
    st.counters ||= {};
    st.counters[e.col] = e.from;
}

/**
 * Drift: a meter with drift on, untouched for `every` messages (since its last logged change, or since `since`),
 * moves one slight step toward its resting value. Returns the changes (apply them with applyMeterChanges).
 */
export function driftChanges(board, st, nowI, since = 0) {
    const out = [];
    for (const t of runningMeters(board, st)) {
        const m = t.meter;
        if (!m.drift) continue;
        const v = meterValue(st, t);
        if (v === m.rest) continue;
        const last = Math.max(since, ...arr(st?.log).filter(e => e.kind === 'meter' && e.col === t.id).map(e => Number(e.i) || 0));
        if (nowI - last < m.every) continue;
        const step = Math.min(m.sizes.slight, Math.abs(v - m.rest));
        const to = v > m.rest ? v - step : v + step;
        out.push({ kind: 'meter', key: `meter:${t.id}`, col: t.id, from: v, to, bandFrom: bandOfValue(t, v)?.id, bandTo: bandOfValue(t, to)?.id, who: 'drift',
            reason: `drifts back toward ${m.rest} after ${nowI - last} quiet messages` });
    }
    return out;
}

/** The notice for a change: "Trust: +5 → 49 (Neutral)" — "Trust: Neutral → Trusting" when it crosses into another band. */
export function describeMeterChange(board, ch) {
    const t = arr(board.trackers).find(x => x.id === ch.col);
    if (!t) return 'Meter';
    const d = ch.to - ch.from;
    const bf = bandById(t, ch.bandFrom), bt = bandById(t, ch.bandTo);
    const crossed = bf && bt && bf.id !== bt.id;
    const amount = `${d > 0 ? '+' : '−'}${Math.abs(d)} → ${ch.to}`;
    const size = ch.size ? ` (${ch.size} ${ch.dir})` : ch.who === 'drift' ? ' (drifting back)' : '';
    return `${t.name}: ${crossed ? `${bf.name} → ${bt.name}, ` : ''}${amount}${crossed ? '' : ` · ${bt?.name ?? ''}`}${size}${ch.held ? ` — held below ${ch.held.band}: only once ${ch.held.why}` : ''}`;
}

/** Did this change cross into another band? (a big moment) */
export const crossesBand = e => e?.kind === 'meter' && e.bandFrom && e.bandTo && e.bandFrom !== e.bandTo;
