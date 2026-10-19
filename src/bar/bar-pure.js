/**
 * Overhaul round 2a (2026-10-15) — the DeepLore bar's rules, without the page. Tested in test/bar.test.mjs.
 *
 * The bar sits above the message box (where Guided Generations put its bar). Miinthe's design, 2026-10-04 to 10-15
 * (roadmap §D, side panel + bar mock-up v13):
 *   📖 the DeepLore menu · the side-panel button · her starred Quick Replies · all Quick Replies ·
 *   Re-evaluate and swipe · Simple send · Keep as a draft. On a phone only five buttons; the Quick Replies and the
 *   special buttons take over the bar's row when tapped (‹ goes back).
 *
 * The side-panel button carries Mero's signal (no separate mailbox):
 *   unlocked → a dot while Mero has something (amber, and a wiggle now and then, while the reply waits for an answer);
 *              pressed then, it opens straight to her requests; otherwise it opens or closes the panel.
 *   locked   → the button IS the envelope: it goes to her requests and, pressed again, back where the panel was.
 *              (A locked panel that is closed — e.g. right after a reload — gets the ordinary button, to open it.)
 */

/**
 * What the side-panel button shows and does.
 * { open, locked, phone, waiting (count), hold (the reply waits), glow (Mero wants to talk), onRequests (the panel shows her requests) }
 * → { icon: 'panel'|'panelL'|'mail', dot: ''|'req'|'hold'|'mero', pressed, title, action: 'open'|'close'|'requests'|'back' }
 * Requests are orange, Mero wanting to talk is her pink (Miinthe, 2026-10-19: "request is an orange dot, lets make the mero dot her pink").
 */
export function panelButton({ open = false, locked = false, phone = false, waiting = 0, hold = false, glow = false, onRequests = false, left = false } = {}) {
    const lockedHere = locked && !phone;   // no lock on a phone (the panel slides over the chat there)
    const has = waiting > 0 || hold;
    const dot = hold ? 'hold' : has ? 'req' : glow ? 'mero' : '';
    const mailTitle = hold ? 'The reply waits for your answer: open Mero’s requests'
        : `Mero has ${waiting} ${waiting === 1 ? 'thing' : 'things'} for you: open her requests`;
    if (lockedHere && open) {
        if (onRequests) return { icon: 'mail', dot, pressed: true, title: 'Back to where the side panel was', action: 'back' };
        return { icon: 'mail', dot, pressed: false, title: has ? mailTitle : 'Mero’s requests (nothing new). The side panel is locked open', action: 'requests' };
    }
    const icon = left ? 'panelL' : 'panel';
    if (open) return { icon, dot, pressed: true, title: 'Close the side panel', action: 'close' };
    if (has) return { icon, dot, pressed: false, title: mailTitle, action: 'requests' };
    return { icon, dot, pressed: false, title: glow ? 'Open the side panel: Mero wants to talk' : 'Open the side panel', action: 'open' };
}

// ── starred Quick Replies ───────────────────────────────────────────────────

const key = q => `${q.set}\u0000${q.label}`;
/** Clean a stored star list: [{ set, label }], no doubles, nothing empty. */
export function normalHot(list) {
    const seen = new Set(), out = [];
    for (const q of Array.isArray(list) ? list : []) {
        if (!q || typeof q.set !== 'string' || typeof q.label !== 'string' || !q.set || !q.label) continue;
        if (seen.has(key(q))) continue;
        seen.add(key(q)); out.push({ set: q.set, label: q.label });
    }
    return out;
}
export const isHot = (list, q) => normalHot(list).some(x => key(x) === key(q));
/** Star or unstar one Quick Reply (a new star goes to the end of the bar). */
export function toggleHot(list, q) {
    const l = normalHot(list);
    return isHot(l, q) ? l.filter(x => key(x) !== key(q)) : [...l, { set: q.set, label: q.label }];
}
/** Move one star a step earlier (by -1) or later (by 1) on the bar (Miinthe, 2026-10-19: "rearrange the order"). */
export function moveHot(list, q, by) {
    const l = normalHot(list), i = l.findIndex(x => key(x) === key(q)), j = i + by;
    if (i < 0 || j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
}
/**
 * The starred ones that still exist, in her order, with what the bar needs to draw them.
 * sets: [{ name, qrs: [{ label, title, message }] }] (SillyTavern's sets). A star whose set or button is gone
 * is skipped (and kept, in case the set comes back).
 */
export function hotButtons(list, sets) {
    const by = new Map();
    for (const s of sets || []) for (const q of s.qrs || []) by.set(key({ set: s.name, label: q.label }), { set: s.name, ...q });
    return normalHot(list).map(q => by.get(key(q))).filter(Boolean);
}

/** A Quick Reply's hover text: its title, else the start of its message. */
export function qrTitle(q) {
    const t = String(q?.title || '').trim();
    if (t) return t;
    const m = String(q?.message || '').replace(/\s+/g, ' ').trim();
    return m.length > 80 ? m.slice(0, 79) + '…' : m || String(q?.label || '');
}

// ── the draft ───────────────────────────────────────────────────────────────

/**
 * Keep as a draft / put it back. { box: text in the message box, draft: the kept draft }
 * → { box, draft, say, ask } — `ask`: true when the box has other text: they swap, so nothing you typed is lost
 * (Miinthe 2026-10-18: putting the draft back used to replace what was in the box).
 */
export function draftStep({ box = '', draft = '' } = {}) {
    const b = String(box), d = String(draft);
    if (d) {
        if (b.trim() && b !== d) return { box: d, draft: b, ask: true, say: 'Swapped: the draft is in the message box, and what you had typed is kept as the draft.' };
        return { box: d, draft: '', ask: false, say: 'The draft is back in the message box.' };
    }
    if (!b.trim()) return { box: b, draft: '', ask: false, say: 'Type a reply first, then keep it as a draft. It waits here, on any device.' };
    return { box: '', draft: b, ask: false, say: 'Kept as a draft. Press the same button to put it back, here or on another device.' };
}
