/**
 * Overhaul round 2a (2026-10-15) — the DeepLore bar above the message box. Rules: bar-pure.js. Looks: frame.css.
 *
 * PC:    📖 · side panel (dot / envelope) · starred Quick Replies · all Quick Replies │ Re-evaluate · Simple send · Draft
 * Phone: 📖 · side panel · Quick Replies · ⋯ (the special buttons); the last two take over the row (‹ back), and a
 *        handle on top pulls the row taller for more rows (Miinthe: "I hate being unnecessarily limited").
 * While DeepLore works on a reply its status line (index.js, the old toast) sits in the bar, with Cancel.
 * While the reply waits for Miinthe's answer a small bubble says so above the bar.
 *
 * Quick Replies are SillyTavern's own (the Quick Reply extension's sets); a star puts one on the bar. While at least
 * one is starred, SillyTavern's own Quick Reply row is hidden (her design: the bar takes its place).
 */
import { saveSettingsDebounced, eventSource, event_types } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { getSettings } from '../../settings.js';
import { requestsHere, replyWaits, onRequestsChanged } from '../requests.js';
import { panelButton, toggleHot, isHot, hotButtons, qrTitle, draftStep } from './bar-pure.js';
import * as K from '../kit/kit.js';

const I = K.icon;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let bar = null;
let mode = 'home';          // phone: 'home' | 'qr' | 'sp'
let takeH = 38;             // phone: the taken-over row's height (pull the handle)
let onReq = false, preTab = null;   // locked panel: the envelope went to Mero's requests, from this tab

// ── the side panel ──────────────────────────────────────────────────────────

const panelEl = () => document.getElementById('deeplore-panel');
const panelOpen = () => !!panelEl()?.classList.contains('openDrawer');
const locked = () => !!panelEl()?.classList.contains('pinnedOpen');
const phone = () => !!panelEl()?.classList.contains('dle-mobile');
const toggleEl = () => document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle');
const activeTab = () => panelEl()?.querySelector('.dle-tab.active')?.dataset.tab || null;
function togglePanel() { toggleEl()?.click(); }
function openPanel() { if (!panelOpen()) togglePanel(); }

function pressPanel() {
    const s = panelButton(state());
    if (s.action === 'requests') {
        if (locked()) { preTab = activeTab(); onReq = true; }
        window.__dleOpenRequests?.();
    } else if (s.action === 'back') {
        onReq = false;
        document.getElementById(`dle-tab-${preTab && preTab !== 'mero' ? preTab : 'story'}`)?.click();
    } else if (s.action === 'close') {
        if (!locked()) togglePanel();
    } else openPanel();
    setTimeout(draw, 60);
}

function state() {
    let waiting = 0, hold = false;
    try { waiting = requestsHere().waiting.length; hold = replyWaits(); } catch { /* requests not ready yet */ }
    return { open: panelOpen(), locked: locked(), phone: phone(), waiting, hold, onRequests: onReq && activeTab() === 'mero', left: getSettings().drawerSide === 'left' };
}

// ── SillyTavern's Quick Replies ─────────────────────────────────────────────

function qrApi() { return globalThis.quickReplyApi || null; }
/** The sets to offer: the ones switched on (for everything or this chat); if none are, all sets. */
function qrSets() {
    const api = qrApi();
    if (!api) return [];
    const pick = list => (list || []).map(x => x?.set).filter(Boolean);
    let sets = [...pick(api.settings?.config?.setList), ...pick(api.settings?.chatConfig?.setList)];
    if (!sets.length) { try { sets = api.listSets().map(n => api.getSetByName(n)).filter(Boolean); } catch { sets = []; } }
    const seen = new Set();
    return sets.filter(s => !seen.has(s.name) && seen.add(s.name))
        .map(s => ({ name: s.name, qrs: (s.qrList || []).filter(q => !q.isHidden && q.label).map(q => ({ label: q.label, title: q.title, message: q.message })) }))
        .filter(s => s.qrs.length);
}
async function runQr(set, label) {
    closePop();
    try { await qrApi()?.executeQuickReply(set, label); } catch (err) { K.notify({ text: `That quick reply did not run: ${err?.message || err}`, tone: 'bad' }); }
}
function star(q) {
    const s = getSettings();
    s.barHot = toggleHot(s.barHot, q);
    saveSettingsDebounced();
    draw();
}

// ── the special buttons ─────────────────────────────────────────────────────

const box = () => document.getElementById('send_textarea');
function setBox(v) {
    const t = box(); if (!t) return;
    t.value = v;
    t.dispatchEvent(new Event('input', { bubbles: true }));
}
async function simpleSend() {
    if (!box()?.value.trim()) { K.notify({ title: 'Simple send', text: 'Type something first.' }); return; }
    // the same as Guided Generations' simple send
    try { await getContext().executeSlashCommandsWithOptions('/send {{input}} | /setinput'); } catch (err) { K.notify({ text: `Simple send did not work: ${err?.message || err}`, tone: 'bad' }); }
}
/**
 * The draft lives in its own small file on the server (user files), read fresh on every press — not in the settings:
 * SillyTavern saves all settings at once from whichever window saves last, so a second window or device brought a
 * draft back after it was put back (found 2026-10-18 with two windows open). The old settings value moves over once.
 */
const DRAFT_FILE = 'deeplore-reply-draft.json';
let draftText = null;   // what the dot shows (null: not read yet)
async function readDraft() {
    try {
        const r = await fetch(`/user/files/${DRAFT_FILE}`, { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); draftText = typeof j?.text === 'string' ? j.text : ''; return draftText; }
        if (r.status !== 404) throw new Error(`the server said ${r.status}`);
    } catch (err) { console.warn('[DLE] draft: could not read it:', err?.message || err); return draftText ?? (getSettings().barDraft || ''); }
    // no file yet: the draft kept in the settings before (once)
    const old = getSettings().barDraft || '';
    if (await writeDraft(old)) { getSettings().barDraft = ''; saveSettingsDebounced(); }
    return draftText;
}
async function writeDraft(text) {
    try {
        const data = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ text, at: new Date().toISOString() }))));
        const r = await fetch('/api/files/upload', { method: 'POST', headers: getContext().getRequestHeaders(), body: JSON.stringify({ name: DRAFT_FILE, data }) });
        if (!r.ok) throw new Error(`the server said ${r.status}`);
        draftText = text; return true;
    } catch (err) { console.warn('[DLE] draft: could not save it:', err?.message || err); return false; }
}
async function draft() {
    const step = draftStep({ box: box()?.value || '', draft: await readDraft() });
    if (step.ask && !(await K.ask({ title: 'Swap them?', text: 'The draft goes into the message box, and what is there now is kept as the draft.', yes: 'Swap' }))) return;
    if (step.draft !== draftText && !(await writeDraft(step.draft))) { K.notify({ title: 'Draft', text: 'The draft could not be saved — nothing was changed.', tone: 'bad' }); return; }
    setBox(step.box);
    K.notify({ title: 'Draft', text: step.say });
    draw();
}
const refreshDraft = async () => { const before = draftText; await readDraft(); if (draftText !== before) draw(); };
async function reevaluate() {
    const { reEvaluate } = await import('../reevaluate.js');
    await reEvaluate();
}

// ── the DeepLore menu (📖) ──────────────────────────────────────────────────

function bookItems() {
    return [
        { heading: 'DeepLore' },
        locked() ? { label: 'The side panel is locked open', icon: 'lock', sub: 'unlock it in its header', disabled: true }
            : { label: panelOpen() ? 'Close the side panel' : 'Open the side panel', icon: getSettings().drawerSide === 'left' ? 'panelL' : 'panel', onClick: togglePanel },
        { label: 'Open the board', icon: 'board', onClick: async () => { const { openBoardWindow } = await import('../board-window.js'); openBoardWindow(); } },
        // overhaul (2026-10-17): the board's entries window, opened on its own (one copy of it — board/board.html EW)
        { label: 'Write a new entry…', icon: 'newentry', title: 'A new entry for your vault, filed where Settings › New entries says. Mero can draft it.', onClick: async () => { const { openBoardWindow } = await import('../board-window.js'); openBoardWindow({ entry: true }); } },
        { label: 'Move an entry…', icon: 'folder', onClick: () => openEntryMover() },
        'sep',
        { label: 'Setup and settings', icon: 'settings', onClick: async () => { const { openSettingsPopup } = await import('../ui/settings-ui.js'); openSettingsPopup?.(); } },
    ];
}

/** Move an entry…: pick the entry (newest first, or search), then the folder (today's mover, with its safety checks). */
async function openEntryMover() {
    const { vaultIndex } = await import('../state.js');
    const all = [...(vaultIndex || [])];
    const search = document.createElement('input');
    search.className = 'dk-field'; search.type = 'search'; search.placeholder = 'Search entries…'; search.setAttribute('aria-label', 'Search entries');
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-height:120px';
    const draw = () => {
        const t = search.value.trim().toLowerCase();
        const hits = all.filter(e => !t || String(e.title).toLowerCase().includes(t) || String(e.folderPath || '').toLowerCase().includes(t))
            .sort((a, b) => (b.mtime || b.modified || 0) - (a.mtime || a.modified || 0) || String(a.title).localeCompare(String(b.title)))
            .slice(0, 60);
        list.textContent = '';
        if (!hits.length) { list.append(Object.assign(document.createElement('p'), { className: 'dk-hint', textContent: t ? 'No entry matches.' : 'No entries indexed yet.' })); return; }
        for (const e of hits) list.append(K.row({ lead: '📄', title: e.title, sub: e.folderPath || '(vault root)', onClick: async () => { w.close(); const { moveEntryFlow } = await import('../drawer/drawer-events.js'); moveEntryFlow(e); } }));
    };
    search.addEventListener('input', draw);
    draw();
    const w = K.openWindow({ title: 'Move an entry', body: [search, list], size: 'small' });
}

// ── drawing ─────────────────────────────────────────────────────────────────

function db(id, ic, title, extra = '', cls = '') {
    return `<button type="button" class="dle-db${cls}" data-b="${id}" title="${esc(title)}" aria-label="${esc(title)}">${I(ic)}${extra}</button>`;
}
function qrBtn(q) {
    return `<button type="button" class="dle-qr" data-qr-set="${esc(q.set)}" data-qr="${esc(q.label)}" title="${esc(qrTitle(q))}">${esc(q.label)}</button>`;
}

let queued = false;
/** Redraw soon (many changes can arrive at once). */
function soon() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); }

function draw() {
    if (!bar) return;
    const st = state(), pb = panelButton(st), s = getSettings();
    const sets = qrSets(), hot = hotButtons(s.barHot, sets);
    document.body.classList.toggle('dle-bar-has-hot', hot.length > 0 && s.barHideStQr !== false);
    const dot = pb.dot ? `<span class="dle-dot${pb.dot === 'hold' ? ' hold' : ''}"></span>` : '';
    const pCls = (pb.pressed ? ' on' : '') + (pb.icon === 'mail' ? ' env' + (pb.dot ? ' ' + pb.dot : '') : '') + (st.hold && !pb.pressed ? ' wiggle' : '');
    const book = db('book', 'book', 'DeepLore menu');
    const panelB = db('panel', pb.icon, pb.title, dot, pCls);
    const draftDot = draftText ? '<span class="dle-dot draft"></span>' : '';
    const specials = db('reev', 'reev', 'Re-evaluate and swipe: undo what the newest reply changed, ask again') +
        db('ssend', 'ssend', 'Simple send: post as your message, no reply') +
        db('draft', 'draft', draftText ? 'Put the draft back' : 'Keep as a draft (follows you to other devices)', draftDot);
    const allQr = sets.map(x => x.qrs.map(q => qrBtn({ ...q, set: x.name })).join('')).join('<span class="dle-vsep"></span>');
    let row;
    if (phone() && mode !== 'home') {
        const inner = mode === 'qr' ? (allQr || '<span class="dk-hint" title="Make them in SillyTavern’s Quick Reply settings">No Quick Replies yet.</span>') + db('stars', 'pinI', 'Choose which ones sit on the bar on a PC', '', ' small') : specials;
        row = `<div class="dle-grab" data-b="grab" title="Pull up for more room"></div>${db('back', 'back', 'Back')}<div class="dle-take${takeH > 46 ? ' wrapped' : ''}" style="height:${takeH}px">${inner}</div>`;
    } else if (phone()) {
        row = book + panelB + db('qrs', 'qr', 'Quick replies') + db('sp', 'more', 'More: re-evaluate, simple send, draft', draftDot);
    } else {
        row = book + panelB + `<div class="dle-hot">${hot.map(qrBtn).join('')}</div>` + db('qrs', 'qr', 'All quick replies', '', '') + '<span class="dle-vsep"></span>' + specials;
    }
    const main = bar.querySelector('.dle-bar-main');
    if (main.innerHTML !== row) main.innerHTML = row;   // unchanged → keep focus and hover where they are
    bar.classList.toggle('phone', phone());
    const bub = bar.querySelector('.dle-bar-bubble');
    bub.hidden = !st.hold;
}

// ── the Quick Reply drawer (PC: a pop-up above the bar; phone: a window, for choosing the stars) ──

let popClose = null;
function closePop() { popClose?.(); popClose = null; }
function qrDrawerBody() {
    const s = getSettings(), sets = qrSets();
    const body = document.createElement('div');
    body.className = 'dle-qrsets';
    if (!qrApi()) { body.innerHTML = '<p class="dk-hint">SillyTavern’s Quick Reply extension is not loaded.</p>'; return body; }
    if (!sets.length) { body.innerHTML = '<p class="dk-hint" title="Make a set in SillyTavern’s Quick Reply settings; it shows up here">No Quick Replies yet.</p>'; return body; }
    for (const set of sets) {
        const h = document.createElement('h4'); h.className = 'dk-label'; h.textContent = set.name;
        const g = document.createElement('div'); g.className = 'dle-qrgrid';
        for (const q of set.qrs) {
            const on = isHot(s.barHot, { set: set.name, label: q.label });
            const d = document.createElement('div'); d.className = 'dle-dq';
            d.innerHTML = `<button type="button" class="run" title="${esc(qrTitle(q))}">${esc(q.label)}</button><button type="button" class="star${on ? ' on' : ''}" title="${on ? 'Take off the bar' : 'Put on the bar'}" aria-label="${on ? 'Take off the bar' : 'Put on the bar'}" aria-pressed="${on}">${on ? '★' : '☆'}</button>`;
            d.querySelector('.run').onclick = () => runQr(set.name, q.label);
            d.querySelector('.star').onclick = () => { star({ set: set.name, label: q.label }); const nb = qrDrawerBody(); body.replaceWith(nb); };
            g.append(d);
        }
        body.append(h, g);
    }
    return body;
}
function openQrDrawer(anchor) {
    if (popClose) { closePop(); return; }
    if (phone()) { K.openWindow({ title: 'Quick replies on the bar', body: [Object.assign(document.createElement('p'), { className: 'dk-hint', textContent: '☆ puts one on the bar on a PC.' }), qrDrawerBody()] }); return; }
    const pop = document.createElement('div');
    pop.className = 'dle-bar-pop dk';
    const head = document.createElement('div'); head.className = 'dle-pophead';
    head.innerHTML = '<h3>Quick replies</h3><span class="dk-hint">☆ puts one on the bar</span>';
    head.append(K.iconButton({ icon: 'close', title: 'Close', onClick: closePop }));
    pop.append(head, qrDrawerBody());
    bar.append(pop);
    const out = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); anchor.focus(); } };
    setTimeout(() => document.addEventListener('pointerdown', out, true));
    document.addEventListener('keydown', key, true);
    anchor.classList.add('on');
    popClose = () => { pop.remove(); anchor.classList.remove('on'); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key, true); };
}

// ── wiring ──────────────────────────────────────────────────────────────────

function onClick(e) {
    const q = e.target.closest('[data-qr]');
    if (q) { runQr(q.dataset.qrSet, q.dataset.qr); return; }
    const b = e.target.closest('[data-b]');
    if (!b) return;
    switch (b.dataset.b) {
        case 'book': K.openMenu(b, bookItems()); break;
        case 'panel': pressPanel(); break;
        case 'qrs': if (phone()) { mode = 'qr'; draw(); } else openQrDrawer(b); break;
        case 'stars': openQrDrawer(b); break;
        case 'sp': mode = 'sp'; draw(); break;
        case 'back': mode = 'home'; draw(); break;
        case 'reev': reevaluate(); break;
        case 'ssend': simpleSend(); break;
        case 'draft': draft(); break;
    }
}
function onGrab(e) {
    const g = e.target.closest('[data-b="grab"]');
    if (!g) return;
    const y0 = e.clientY, h0 = takeH, t = bar.querySelector('.dle-take');
    g.setPointerCapture?.(e.pointerId);
    const mv = m => { takeH = Math.max(38, Math.min(220, h0 + (y0 - m.clientY))); t.style.height = takeH + 'px'; t.classList.toggle('wrapped', takeH > 46); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); if (takeH < 60) takeH = 38; draw(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
}

/** Put the bar above the message box (again, if SillyTavern rebuilt the form). */
function mount() {
    const form = document.getElementById('send_form');
    if (!form) return false;
    // Settings › Interface › The bar: switched off → no bar (DeepLore's working line goes back above the message box)
    if (getSettings().barShow === false) { bar?.remove(); document.body.classList.remove('dle-bar-on', 'dle-bar-has-hot'); return true; }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'dle-bar';
        bar.className = 'dle-bar dk';
        bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'DeepLore bar');
        bar.innerHTML = '<button type="button" class="dle-bar-bubble" hidden>⏸ Waiting for your answer</button><div class="dle-bar-main"></div><div id="dle-bar-work"></div>';
        bar.addEventListener('click', onClick);
        bar.addEventListener('pointerdown', onGrab);
        bar.querySelector('.dle-bar-bubble').addEventListener('click', () => window.__dleOpenRequests?.());
    }
    if (bar.parentElement !== form) form.prepend(bar);
    document.body.classList.add('dle-bar-on');
    draw();
    return true;
}

/** Wire once (index.js init). */
export function initBar() {
    if (!mount()) { setTimeout(initBar, 1000); return; }
    onRequestsChanged(soon);
    const later = () => setTimeout(() => { mount(); }, 300);
    try {
        eventSource.on(event_types.CHAT_CHANGED, later);
        eventSource.on(event_types.SETTINGS_UPDATED, later);
    } catch { /* noop */ }
    // the panel opening, closing, locking, switching tabs, moving sides → redraw the side-panel button
    const p = panelEl();
    if (p) new MutationObserver(() => { if (!p.querySelector('.dle-tab[data-tab="mero"].active')) onReq = false; soon(); })
        .observe(p, { attributes: true, attributeFilter: ['class'], subtree: true });
    // Quick Reply sets can change in SillyTavern's settings at any time; they're read fresh when the drawer opens,
    // and the starred row is redrawn when the window regains focus
    window.addEventListener('focus', soon);
    // the draft: read on start, and again whenever this window comes back (another device may have kept or used it)
    refreshDraft();
    window.addEventListener('focus', refreshDraft);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDraft(); });
}

/** For index.js's working line: where it should sit. */
export const barWorkSlot = () => document.getElementById('dle-bar-work');
export { draw as drawBar };
