/**
 * Guided swipe and Compare swipes: SillyTavern glue (Miinthe, 2026-11-02). Rules: guided-swipe-pure.js (tested).
 * Both sit in DeepLore's 📖 on a reply (reply-menu.js). The direction reaches the writer as a 🧭 among the author's
 * notes (mero.js writer sink), only while a swipe of that reply is written. Swipes go through SillyTavern's own swipe.
 */
import { chat, chat_metadata, eventSource, event_types } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { addWriterSink, addNote } from './mero.js';
import { GUIDE_KEY, asGuide, guideActive, guideLines, setGuide, tagSwipe, clearGuide, swipesOf } from './guided-swipe-pure.js';
import * as K from './kit/kit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const guide = () => asGuide(chat_metadata?.[GUIDE_KEY]);
function put(g) { chat_metadata[GUIDE_KEY] = g; saveMetadataDebounced(); drawChip(); }
const last = () => (chat || []).length - 1;

/** A new swipe of the newest reply, the SillyTavern way. */
async function newSwipe(i) {
    const ctx = getContext(), msg = chat?.[i];
    if (ctx.swipe?.to) await ctx.swipe.to(null, 'right', { forceMesId: i, forceSwipeId: Array.isArray(msg?.swipes) ? msg.swipes.length : 1 });
    else await ctx.swipe?.right?.();
}

/** 📖 → Guided swipe…: what should change, then a new swipe with it. */
export function openGuide(i = last()) {
    if (i !== last() || chat?.[i]?.is_user) { K.notify({ text: 'Guided swipe works on the newest reply.', tone: 'wait' }); return; }
    const g = guide();
    const body = document.createElement('div');
    body.innerHTML = '<textarea class="dk-field" rows="3" placeholder="What should change? e.g. less flowery, he’s colder here, fewer words"></textarea><p class="dk-hint">It stays for every swipe of this reply, and clears itself when you send your next message.</p>';
    const ta = body.querySelector('textarea');
    ta.value = guideActive(g, i) ? g.text : '';
    const go = K.button({ label: 'Swipe', kind: 'primary', onClick: async () => {
        const text = ta.value.trim(); w.close();
        if (!text) return;
        put(setGuide(guide(), text, i));
        await newSwipe(i);
    } });
    const w = K.openWindow({ title: '🧭 Guided swipe', body, foot: [K.button({ label: 'Cancel', onClick: () => w.close() }), go], size: 'small' });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
    setTimeout(() => ta.focus(), 50);
}

/** 📖 → Compare swipes: every swipe of the message, the direction each was written with; pick one. */
export function compareSwipes(i) {
    const msg = chat?.[i]; if (!msg) return;
    const list = swipesOf(msg, guide(), i);
    if (list.length < 2) { K.notify({ text: 'This message has only one swipe.', tone: 'wait' }); return; }
    const body = document.createElement('div');
    body.className = 'dle-cmp';
    body.innerHTML = list.map(s => `<div class="dle-cmp-one${s.showing ? ' on' : ''}"><div class="dle-cmp-top"><b>Swipe ${s.k + 1}</b>${s.showing ? '<span class="dk-hint">showing</span>' : ''}${s.tag ? `<span class="dle-cmp-tag" title="${esc(s.tag)}">🧭 ${esc(s.tag.length > 40 ? s.tag.slice(0, 40) + '…' : s.tag)}</span>` : ''}</div><div class="dle-cmp-text">${esc(s.text)}</div>${s.showing ? '' : `<div><button type="button" class="dk-btn dk-primary" data-use="${s.k}">Use this one</button></div>`}</div>`).join('');
    const w = K.openWindow({ title: 'Compare swipes', body, size: 'wide', foot: [K.button({ label: 'Close', onClick: () => w.close() })] });
    body.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
        const k = Number(b.dataset.use), cur = Number(chat[i]?.swipe_id ?? 0); w.close();
        const ctx = getContext();
        if (ctx.swipe?.to) await ctx.swipe.to(null, k > cur ? 'right' : 'left', { forceMesId: i, forceSwipeId: k });
    });
}

// ── the bar's 🧭 button holds the direction (Miinthe, 2026-11-02: "store the guide info in that icon instead" — the chip
// above the message box sat under the floating icon drawer). bar.js draws the button from chat_metadata itself. ──

/** The bar redraws its button (lit, with the direction as its tooltip) whenever the direction changes. */
function drawChip() {
    document.getElementById('dle-guide-chip')?.remove();   // the old chip, if a page still has one
    try { window.dispatchEvent(new Event('dle-guide')); } catch { /* noop */ }
}

/** The bar's button: no direction yet → "What should change?"; a direction in force → what to do with it. */
export function guideClick(anchor) {
    const g = guide(), i = last();
    if (!guideActive(g, i)) { openGuide(i); return; }
    K.openMenu(anchor, [
        { label: `🧭 ${g.text.length > 60 ? g.text.slice(0, 60) + '…' : g.text}`, sub: 'the direction for this reply’s swipes', disabled: true },
        'sep',
        { label: 'Swipe again with it', icon: 'refresh', onClick: () => newSwipe(i) },
        { label: 'Change the direction…', icon: 'edit', onClick: () => openGuide(i) },
        { label: 'Keep it as a 🧭 note', icon: 'keep', sub: 'stays until you switch it off', onClick: () => {
            const n = addNote({ kind: 'steer', text: g.text, story: true, last: 'pinned', scope: 'chat', on: true });
            put(clearGuide(guide()));
            K.notify({ text: n ? 'Kept as a 🧭 note in Mero’s notes. It stays until you switch it off.' : 'Couldn’t keep it as a note.', tone: n ? 'good' : 'wait' });
        } },
        { label: 'Drop it', icon: 'close', sub: 'new swipes as usual', onClick: () => { put(clearGuide(guide())); K.notify({ text: 'Direction dropped. New swipes are written as usual.' }); } },
    ]);
}

export function initGuidedSwipe() {
    addWriterSink(type => guideLines(guide(), type, last()));
    try {
        eventSource.on(event_types.MESSAGE_RECEIVED, (id, type) => {
            if (type === 'swipe') { const g = guide(), i = Number(id); const t = tagSwipe(g, i, chat?.[i]?.swipe_id); if (t !== g) put(t); }
            drawChip();
        });
        eventSource.on(event_types.MESSAGE_SENT, () => {
            const g = guide();
            if (g.text) { put(clearGuide(g)); K.notify({ text: 'You answered, so the swipe direction cleared itself.' }); }
        });
        for (const ev of [event_types.CHAT_CHANGED, event_types.MESSAGE_DELETED, event_types.MESSAGE_SWIPED]) if (ev) eventSource.on(ev, () => setTimeout(drawChip, 100));
    } catch { /* noop */ }
    drawChip();
}
