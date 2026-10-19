/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — what the writer gets from entries linked on the board (storyboard
 * stage 3, round "what the writer gets"). Pure; tested in test/board-links.test.mjs. Glue: board-live.js.
 *
 * Entry kinds — decided with Miinthe 2026-10-03 (`6 merge roadmap.md` §4 G+), stored on the board's link:
 *   ⚖ judge     only the tracker helper reads it — what counts as reaching that step / taking that
 *               branch. NEVER reaches the writer, wherever it is linked on the board.
 *   🧭 guidance  to the writer as behaviour ("they're married: {{char}} acts like this") — while the
 *               story is there, its text goes into the story-state block as GUIDANCE, not as lore.
 *   📄 context   to the writer as facts — ordinary lore, available while the story is there; DeepLore's
 *               AI search picks it when it fits; 📌 pinned = always given while there.
 * "There" = the tracker is running (not waiting, paused, abandoned or blocked) and stands at that
 * step (a detour: and that detour is set; a branch: that branch was taken).
 * Links on items and places keep their own rules (collections-pure.js, places-pure.js) — except that a
 * judge link anywhere keeps the entry from the writer.
 */
import { isActive, isMeter, bandOfValue, counterValue } from './board-model-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const low = s => String(s ?? '').trim().toLowerCase();
const kindOf = (o, title) => (o?.kinds || {})[title] || 'context';

/** Every entry linked on a step, a detour or a fork branch: { t, step, detour?, branch?, title, kind, pin }. */
export function stepLinks(board) {
    const out = [];
    for (const t of arr(board?.trackers)) {
        // a meter's bands carry entries too: there while the meter is in that band (meters, 2026-10-12)
        if (isMeter(t)) { for (const b of t.meter.bands) for (const title of arr(b.entries)) out.push({ t, band: b, title, kind: kindOf(b, title), pin: (b.pins || {})[title] === true }); continue; }
        if (t.kind !== 'steps') continue;
        for (const s of arr(t.steps)) {
            const add = (o, extra) => { for (const title of arr(o?.entries)) out.push({ t, step: s, ...extra, title, kind: kindOf(o, title), pin: (o?.pins || {})[title] === true }); };
            add(s, {});
            for (const d of arr(s.detours)) add(d, { detour: d });
            for (const b of arr(s.fork?.branches)) add(b, { branch: b });
        }
    }
    return out;
}

/** Every judge link on the board — steps, detours, branches, items, places, a collection's or place tracker's rules. */
export function judgeTitles(board) {
    const out = new Set();
    const scan = o => { for (const title of arr(o?.entries)) if (kindOf(o, title) === 'judge') out.add(low(title)); };
    for (const t of arr(board?.trackers)) {
        scan(t.keep);
        for (const s of arr(t.steps)) { scan(s); arr(s.detours).forEach(scan); arr(s.fork?.branches).forEach(scan); }
        arr(t.items).forEach(scan);
        arr(t.places).forEach(scan);
        arr(t.meter?.bands).forEach(scan);
    }
    return out;
}

/** Is a step / detour / branch link "there" right now? */
export function linkHere(board, st, l) {
    if (!isActive(board, st, l.t)) return false;
    if (l.band) return bandOfValue(l.t, counterValue(st, l.t))?.id === l.band.id;
    const p = st?.trackers?.[l.t.id] || {};
    if (l.branch) return (p.forks || {})[l.step.id] === l.branch.id;
    if (p.at !== l.step.id) return false;
    return l.detour ? p.aside === l.detour.id : true;
}

/**
 * The writer's entries: a judge-linked entry never; an entry linked (context or guidance) on steps,
 * detours or branches only while one of its links is there — and a guidance entry not as lore at all
 * (it comes as GUIDANCE). Entries pinned in the chat by Miinthe stay.
 */
export function filterByBoardLinks(entries, board, st, isPinned = () => false) {
    const judge = judgeTitles(board);
    const owners = new Map();
    for (const l of stepLinks(board)) {
        if (l.kind === 'judge') continue;
        const k = low(l.title);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k).push(l);
    }
    if (!judge.size && !owners.size) return entries;
    return arr(entries).filter(e => {
        if (isPinned(e)) return true;
        const k = low(e?.title);
        const own = owners.get(k);
        if (!own) return !judge.has(k);
        return own.some(l => l.kind === 'context' && linkHere(board, st, l));
    });
}

/** Context entries pinned (📌) on a link that is there now — always given while there. */
export function boardLinkPins(board, st) {
    return [...new Set(stepLinks(board).filter(l => l.kind === 'context' && l.pin && linkHere(board, st, l)).map(l => l.title))];
}

const where = l => `${l.t.name}: ${l.band ? l.band.name : l.branch ? `${l.step.name} → ${l.branch.name}` : l.detour ? `${l.step.name} (${l.detour.name})` : l.step.name}`;
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s);

/** GUIDANCE lines for the writer: each guidance entry there now, with its text (whitespace folded, ~800 characters). */
export function guidanceLines(board, st, contentOf = () => '') {
    const seen = new Set(), out = [];
    for (const l of stepLinks(board)) {
        if (l.kind !== 'guidance' || seen.has(low(l.title)) || !linkHere(board, st, l)) continue;
        seen.add(low(l.title));
        const text = String(contentOf(l.title) || '').replace(/\s+/g, ' ').trim();
        if (text) out.push(`GUIDANCE (${where(l)}): ${clip(text, 800)}`);
    }
    return out;
}

/**
 * For the tracker helper: per running step tracker, the judge rules of the step it could move to next
 * (and of each way of a fork it waits at), and the detours of the step it is at. `judgeText(title)`
 * returns an entry's text. Empty when there is nothing to say.
 */
const JUDGE_CLIP = 2200;   // her longest Dragon rung note is ~2000 characters
export function stepJudgeSection(board, st, judgeText = () => '') {
    const lines = [];
    const rule = (o) => arr(o?.entries).filter(title => kindOf(o, title) === 'judge').map(title => String(judgeText(title) || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps' || !isActive(board, st, t)) continue;
        const at = st?.trackers?.[t.id]?.at;
        const k = t.steps.findIndex(s => s.id === at);
        if (k < 0) continue;
        const cur = t.steps[k];
        const open = arr(cur.fork?.branches).length && !(st.trackers[t.id].forks || {})[cur.id];
        // LOCAL PATCH (Miinthe, 2026-10-19): judge text up to 2200 characters (her Dragon rung notes run long), and a
        // detour's own judge entries reach the helper too (before, only its name did — Nuisance was set on a cheeky greeting)
        if (open) for (const b of cur.fork.branches) { const r = rule(b); if (r) lines.push(`- ${t.name}, way "${b.name}" after ${cur.name}: ${clip(r, JUDGE_CLIP)}`); }
        const next = !open && t.steps[k + 1];
        if (next) { const r = rule(next); if (r) lines.push(`- ${t.name} → ${next.name}: ${clip(r, JUDGE_CLIP)}`); }
        const det = arr(cur.detours);
        if (det.length) lines.push(`- ${t.name} at ${cur.name}: possible detours (aside) — ${det.map(d => `"${d.name}"`).join(', ')}`);
        for (const d of det) { const r = rule(d); if (r) lines.push(`- ${t.name}, aside "${d.name}" (set or clear it): ${clip(r, JUDGE_CLIP)}`); }
    }
    return lines.length ? ['', 'STEP RULES (what counts as reaching a step — only move when the messages plainly meet it)', ...lines].join('\n') : '';
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-19) — steering, when the board's switch is on: per running step tracker, the step it is heading
 * toward, told to the writer gently. Miinthe: "non intruding, just kind of letting my rp model know the next step, but also not
 * to be dumb and just rush into it". Never at an open fork (that would pick a way); never for an ended tracker.
 */
export function steerLines(board, st) {
    if (board?.steer !== true) return [];
    const out = [];
    for (const t of arr(board?.trackers)) {
        if (t.kind !== 'steps' || !isActive(board, st, t)) continue;
        const k = t.steps.findIndex(s => s.id === st?.trackers?.[t.id]?.at);
        if (k < 0 || k >= t.steps.length - 1) continue;
        const cur = t.steps[k];
        if (arr(cur.fork?.branches).length && !(st.trackers[t.id].forks || {})[cur.id]) continue;
        out.push(`HEADING TOWARD (${t.name}): ${t.steps[k + 1].name} — where this line is going next. Let the story drift that way only when it has earned it; it may take many replies. Don't rush it, announce it, or jump to it; this reply simply continues the scene.`);
    }
    return out;
}
