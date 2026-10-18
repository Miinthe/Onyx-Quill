/**
 * Overhaul — the Cast tab's words and moves, pure (src/panel/cast-view.js draws them). Tested in test/cast-view.test.mjs.
 * Mock-up: side panel + bar v13, viewCast().
 */
import { isMine } from '../cast-voice-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; };

/** Your half first, then the AI half — each in its own order (the same rule as cast-voice-pure.js). */
export const halvesOf = q => ({ mine: arr(q).filter(isMine), ai: arr(q).filter(x => !isMine(x)) });

/**
 * Drag to reorder: put item `id` at place `to` (0-based) inside its own half. An AI line never goes above one of yours,
 * so the move stays in the half. Returns the whole round, your half first.
 */
export function moveWithin(q, id, to) {
    const { mine, ai } = halvesOf(q);
    const half = mine.some(x => x.id === id) ? mine : ai.some(x => x.id === id) ? ai : null;
    if (!half) return [...mine, ...ai];
    const k = half.findIndex(x => x.id === id);
    const [it] = half.splice(k, 1);
    half.splice(Math.max(0, Math.min(half.length, Number(to) || 0)), 0, it);
    return [...mine, ...ai];
}

/**
 * Where a dragged row lands: `mids` are the middles (y) of the OTHER rows of its half, top to bottom; `y` is the
 * pointer. Returns the place among them (0 = first).
 */
export function dropIndex(mids, y) {
    let i = 0;
    for (const m of arr(mids)) { if (y > m) i++; else break; }
    return i;
}

/** "You, then Kettle, then Spoon" — or, while the round plays, "Kettle is writing… then Spoon". */
export function roundSummary(names, { running = false, speaking = null, stopping = false } = {}) {
    const n = arr(names).filter(Boolean);
    if (running) {
        const rest = speaking ? n.filter(x => x !== speaking) : n;
        const head = speaking ? `${speaking} is writing…` : 'Playing…';
        if (stopping) return `${head} then it stops`;
        return rest.length ? `${head} then ${rest.join(', then ')}` : head;
    }
    return n.length ? n.join(', then ') : 'Nobody yet';
}

/** "Kettle, Spoon here · Old Fridge away". people: [{ name, here }]. */
export function peopleSummary(people) {
    const here = arr(people).filter(p => p.here).map(p => p.name), away = arr(people).filter(p => !p.here).map(p => p.name);
    return [here.length ? `${here.join(', ')} here` : '', away.length ? `${away.join(', ')} away` : ''].filter(Boolean).join(' · ') || 'Nobody yet';
}

/**
 * The second line under a name in the round (x: a round item).
 * "your message from the chat box" · "the main character replies" · "you write: “…”" · "the AI writes: why".
 */
export function queueSub(x) {
    if (x?.kind === 'you') return 'your message from the chat box';
    if (x?.kind === 'main') return 'the main character replies';
    if (isMine(x)) return `you write: “${clip(x.text, 60)}”`;
    if (x?.exit) return `says goodbye and leaves${x.exit.why ? `: ${x.exit.why}` : ''}`;
    return x?.why ? `the AI writes: ${x.why}` : 'the AI writes';
}

/** A join / leave suggestion in words: "Old Fridge wants to join: the cellar door rattles". */
export function suggestionText(name, w) {
    return `${name} ${w?.leave ? 'wants to leave' : 'wants to join'}${w?.why ? `: ${w.why}` : ''}`;
}

/**
 * The second line under a person: "here · 2 plans · knows 3", or "away · 📜 what they did" (veiled: "away · 📜 while
 * away"). now: personNow(...); off: their off-screen entries; veiled: a hidden person you are not peeking at.
 */
export function personSub(now, off, { veiled = false, speaking = false } = {}) {
    const bits = [now?.here ? 'here' : 'away'];
    const last = arr(off).at(-1);
    if (!now?.here && last) bits.push(`📜 ${veiled ? 'while away' : clip(last.text, 80)}`);
    else {
        const plans = arr(now?.plans).length, knows = arr(now?.knows).length;
        if (veiled) { if (plans || knows) bits.push('hidden'); }
        else {
            if (plans) bits.push(`${plans} plan${plans > 1 ? 's' : ''}`);
            if (knows) bits.push(`knows ${Math.min(knows, 99)}`);
        }
    }
    if (speaking) bits.push('✍️ speaking…');
    return bits.join(' · ');
}

/**
 * A correction to what someone knows (edit the words or how they learned it, or forget it): not a story event, so it
 * is changed in place, not logged — the same way today's ✕ Forget works. Returns a new state, or null (nothing to do).
 * patch: { fact?, how? } or null to forget.
 */
export function fixKnown(st, castId, personId, factId, patch) {
    const s = st?.cast?.[castId]?.[personId];
    if (!s || !Array.isArray(s.knows) || !s.knows.some(k => k.id === factId)) return null;
    const out = structuredClone(st), t = out.cast[castId][personId];
    if (patch == null) { t.knows = t.knows.filter(k => k.id !== factId); return out; }
    const fact = patch.fact != null ? String(patch.fact).trim() : null;
    if (fact === '') { t.knows = t.knows.filter(k => k.id !== factId); return out; }
    t.knows = t.knows.map(k => (k.id === factId ? { ...k, ...(fact ? { fact: clip(fact, 200) } : {}), ...(patch.how ? { how: patch.how } : {}) } : k));
    return out;
}
