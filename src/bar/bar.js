/**
 * Overhaul round 2a (2026-10-15) — the DeepLore bar above the message box. Rules: bar-pure.js. Looks: frame.css.
 *
 * PC:    📖 · side panel (dot / envelope) · My notes · World · all Quick Replies · starred Quick Replies │ Re-evaluate · Guided swipe · Fix spelling · Simple send · Draft
 *        (Miinthe, 2026-11-03: the "open something" buttons together in a fixed order, the Quick Reply drawer leading its stars;
 *        each action button can be switched off in Settings › Interface › The bar; ⚡ opens all Quick Replies as an
 *        extra row on top of the bar — extra-row.js, shared with the floating icons)
 * Phone: 📖 · side panel · Quick Replies · My notes · ⋯ (the special buttons); the last two take over the row (‹ back), and a
 *        handle on top pulls the row taller for more rows (Miinthe: "I hate being unnecessarily limited").
 * While DeepLore works on a reply its status line (index.js, the old toast) sits in the bar, with Cancel.
 * While the reply waits for Miinthe's answer a small bubble says so above the bar.
 *
 * Quick Replies are SillyTavern's own (the Quick Reply extension's sets); a star puts one on the bar. While at least
 * one is starred, SillyTavern's own Quick Reply row is hidden (her design: the bar takes its place).
 */
import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { getSettings } from '../../settings.js';
import { requestsHere, replyWaits, onRequestsChanged } from '../requests.js';
import { meroGlow, onMeroChanged } from '../mero.js';
import { panelButton, toggleHot, moveHot, isHot, hotButtons, qrTitle, draftStep } from './bar-pure.js';
import * as K from '../kit/kit.js';
import { toggleNotes, toggleNotesLock, notesOpen, close as closeNotes } from '../notes.js';
import { worldHere, worldOpen, toggleWorld, toggleWorldLock, closeWorld, worldDots } from '../world/world.js';
import { dockBehind, dockShow, dockOn } from '../dock/dock.js';
import { asGuide, guideActive, GUIDE_KEY } from '../guided-swipe-pure.js';
import { openExtraRow, closeExtraRow, extraRowOpen, extraRowEl, placeExtraRow } from './extra-row.js';

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
function pressLock() { panelEl()?.querySelector('.dle-lock')?.click(); }

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
    let waiting = 0, hold = false, glow = false;
    try { waiting = requestsHere().waiting.length; hold = replyWaits(); } catch { /* requests not ready yet */ }
    try { glow = meroGlow().glows; } catch { /* no board here */ }
    return { open: panelOpen(), locked: locked(), phone: phone(), waiting, hold, glow, onRequests: onReq && activeTab() === 'mero', left: getSettings().drawerSide === 'left' };
}

// ── SillyTavern's Quick Replies ─────────────────────────────────────────────

function qrApi() { return globalThis.quickReplyApi || null; }
/** The sets to offer: the ones switched on (for everything or this chat); if none are, all sets. */
function qrSets() {
    const api = qrApi();
    if (!api) return [];
    // only the sets SillyTavern shows here: global, this chat's and this character's, each one switched to visible —
    // never every set there is (Miinthe 2026-10-18: the bar listed all of them; the character's were missing as well)
    const pick = list => (list || []).filter(x => x?.set && x.isVisible !== false).map(x => x.set);
    const cfg = api.settings || {};
    const sets = [...pick(cfg.config?.setList), ...pick(cfg.chatConfig?.setList), ...pick(cfg.charConfig?.setList)];
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
// only ever text — for a day the Draft button's on/off switch was stored under this same key (bug hunt 2026-11-03)
const oldDraft = () => { const v = getSettings().barDraft; return typeof v === 'string' ? v : ''; };
let draftText = null;   // what the dot shows (null: not read yet)
async function readDraft() {
    try {
        const r = await fetch(`/user/files/${DRAFT_FILE}`, { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); draftText = typeof j?.text === 'string' ? j.text : ''; return draftText; }
        if (r.status !== 404) throw new Error(`the server said ${r.status}`);
    } catch (err) { console.warn('[DLE] draft: could not read it:', err?.message || err); return draftText ?? oldDraft(); }
    // no file yet: the draft kept in the settings before (once)
    const old = oldDraft();
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
    // no notice when it worked (Miinthe, 2026-10-19: "remove the popup message when saving or retrieve a draft"); a failure still says so
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
        { heading: 'Onyx Quill' },
        ...(locked() ? [] : [{ label: panelOpen() ? 'Close the side panel' : 'Open the side panel', icon: getSettings().drawerSide === 'left' ? 'panelL' : 'panel', onClick: togglePanel }]),
        // one two-way switch (Miinthe, 2026-10-19: "lock / unlock the side panel" from the bar's menu); the header's lock does
        // the same, so this presses it and both stay in step. Not on a phone — the panel can't be locked there.
        ...(phone() ? [] : [locked() ? { label: 'Unlock the side panel', icon: 'unlock', onClick: pressLock }
            : { label: 'Lock the side panel open', icon: 'lock', onClick: () => { openPanel(); pressLock(); } }]),
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

// A redraw while a button is held down swaps the button out, and the tap never becomes a click (Miinthe 2026-10-18: "sometimes
// the icon doesn't react" — the tap itself closes the side panel or another panel, which redraws the bar). So while
// a pointer is down on the bar, a redraw waits until it is let go (and the click has run).
let pressing = false, pendingDraw = false, pressTimer = null;
function pressStart() {
    pressing = true;
    clearTimeout(pressTimer); pressTimer = setTimeout(pressEnd, 3000);   // a lost pointerup never blocks the bar
}
function pressEnd() {
    if (!pressing) return;
    pressing = false; clearTimeout(pressTimer);
    if (pendingDraw) setTimeout(() => { pendingDraw = false; draw(); }, 0);
}

function draw() {
    if (!bar) return;
    if (pressing) { pendingDraw = true; return; }
    const st = state(), pb = panelButton(st), s = getSettings();
    const sets = qrSets(), hot = hotButtons(s.barHot, sets);
    document.body.classList.toggle('dle-bar-has-hot', hot.length > 0 && s.barHideStQr !== false);
    const dot = pb.dot ? `<span class="dle-dot${pb.dot === 'mero' ? '' : ' ' + pb.dot}"></span>` : '';
    const pCls = (pb.pressed ? ' on' : '') + (pb.icon === 'mail' ? ' env' + (pb.dot ? ' ' + pb.dot : '') : '') + (st.hold && !pb.pressed ? ' wiggle' : '');
    const book = db('book', 'book', 'Onyx Quill menu');
    // Settings › Interface › The bar › My notes: off → no button (and an open window closes); the notes stay in their file
    if (s.notesEnabled === false && notesOpen()) closeNotes();
    const rc = st.phone ? '' : ' · right-click: lock / unlock';
    const notesB = s.notesEnabled === false ? '' : db('notes', 'notebook', `My notes (never sent to the AI)${s.notesLocked === true ? ' — locked open' : ''}${rc}`, '', notesOpen() ? ' on' : '');
    // the world layer (2026-10-19): a globe only where this chat's board has it switched on
    const wOn = !!worldHere();
    if (!wOn && worldOpen()) closeWorld();
    const worldB = wOn ? db('world', 'globe', `World: chatter, news, messages, people${rc}`, worldDots().map((k, n) => `<span class="dle-dot world${k === 'msg' ? '' : ' ' + k}"${n ? ` style="right:${4 + n * 7}px"` : ''}></span>`).join(''), worldOpen() ? ' on' : '') : '';
    const panelB = db('panel', pb.icon, pb.title + rc, dot, pCls);
    const draftDot = draftText ? '<span class="dle-dot draft"></span>' : '';
    // 🧭 Guided swipe (Miinthe, 2026-11-02: in the bar after Re-evaluate; the button holds the direction — lit while one is in force)
    const gd = asGuide(chat_metadata?.[GUIDE_KEY]), gOn = guideActive(gd, (getContext()?.chat || []).length - 1);
    const guideB = db('guide', 'wand', gOn ? `Guided swipe — direction: “${gd.text}” (click: swipe again, change, keep or drop it)` : 'Guided swipe: swipe the newest reply with a direction (“less flowery”, “he’s colder here”)', gOn ? '<span class="dle-dot"></span>' : '', gOn ? ' on' : '');
    // each action button can be switched off (Miinthe, 2026-11-03 — Settings › Interface › The bar › Buttons on the bar)
    const showB = k => s[k] !== false;
    const specials = (showB('barReev') ? db('reev', 'reev', 'Re-evaluate and swipe: undo what the newest reply changed, ask again') : '') + (showB('barGuide') ? guideB : '') +
        // ✓ Fix spelling (Miinthe, 2026-11-03): her message box corrected by Mero's AI, with what changed and Undo (spell.js)
        (showB('barSpell') ? db('spell', 'check', 'Fix spelling, with Undo. Right-click (hold on phone): your word list') : '') +
        (showB('barSsend') ? db('ssend', 'ssend', 'Simple send: post as your message, no reply') : '') +
        (showB('barDraftBtn') ? db('draft', 'draft', draftText ? 'Put the draft back' : 'Keep as a draft (follows you to other devices)', draftDot) : '');
    if (mode === 'sp' && !specials) mode = 'home';   // the last action button switched off while ⋯ was open: no empty screen
    const allQr = sets.map(x => x.qrs.map(q => qrBtn({ ...q, set: x.name })).join('')).join('<span class="dle-vsep"></span>');
    let row;
    if (phone() && mode !== 'home') {
        const inner = mode === 'qr' ? (allQr || '<span class="dk-hint" title="Turn sets on in SillyTavern’s Quick Reply settings">No Quick Replies here.</span>') + db('stars', 'pinI', 'Choose which ones sit on the bar on a PC', '', ' small') : specials;
        row = `<div class="dle-grab" data-b="grab" title="Pull up for more room"></div>${db('back', 'back', 'Back')}<div class="dle-take${takeH > 46 ? ' wrapped' : ''}" style="height:${takeH}px">${inner}</div>`;
    } else if (phone()) {
        row = book + panelB + db('qrs', 'qr', 'Quick replies') + notesB + worldB + (specials ? db('sp', 'more', gOn ? `More — a swipe direction is set: “${gd.text}”` : 'More: re-evaluate, guided swipe, fix spelling, simple send, draft', (showB('barDraftBtn') ? draftDot : '') + (gOn && showB('barGuide') ? '<span class="dle-dot" style="right:12px"></span>' : '')) : '');
    } else {
        // the "open something" buttons together, the Quick Reply drawer leading its starred ones (Miinthe, 2026-11-03)
        const qrsB = db('qrs', 'qr', 'All quick replies', '', extraRowOpen('qrs') ? ' on' : '').replace('data-b="qrs"', 'data-b="qrs" data-xrow="qrs"');
        row = book + panelB + notesB + worldB + qrsB + `<div class="dle-hot">${hot.map(qrBtn).join('')}</div>` + (specials ? '<span class="dle-vsep"></span>' + specials : '');
    }
    const main = bar.querySelector('.dle-bar-main');
    if (main.innerHTML !== row) main.innerHTML = row;   // unchanged → keep focus and hover where they are
    // the Quick Reply row follows the bar (sets switched on or off, a phone-sized window has its own takeover row)
    const xr = extraRowEl('qrs');
    if (xr) { if (phone()) closeExtraRow('qrs'); else { fillQrRow(xr); placeExtraRow(); } }
    bar.classList.toggle('phone', phone());
    const bub = bar.querySelector('.dle-bar-bubble');
    bub.hidden = !st.hold;
    // Mero's own banner, like the requests' one (Miinthe, 2026-10-19: "give her a notification banner like request, but make
    // the banner go away when clicked"): opening her talks marks the moment seen, and the glow — and this — go out
    bar.querySelector('.dle-bar-bubble.mero').hidden = !st.glow || st.hold;
}

// ── the Quick Reply drawer (PC: a pop-up above the bar; phone: a window, for choosing the stars) ──

let popClose = null;
function closePop() { popClose?.(); popClose = null; }
const set_ = q => `${q.set} › ${q.label}`;
function qrDrawerBody() {
    const s = getSettings(), sets = qrSets();
    const body = document.createElement('div');
    body.className = 'dle-qrsets';
    if (!qrApi()) { body.innerHTML = '<p class="dk-hint">SillyTavern’s Quick Reply extension is not loaded.</p>'; return body; }
    if (!sets.length) { body.innerHTML = '<p class="dk-hint" title="Turn sets on in SillyTavern’s Quick Reply settings">No Quick Replies here — turn a set on in SillyTavern’s Quick Reply settings.</p>'; return body; }
    // the bar's order, rearranged here (Miinthe, 2026-10-19: "rearrange the button sequence in the bar")
    const hot = hotButtons(s.barHot, sets);
    if (hot.length > 1) {
        const h = document.createElement('h4'); h.className = 'dk-label'; h.textContent = 'On the bar, in this order';
        const g = document.createElement('div'); g.className = 'dle-qrorder';
        hot.forEach((q, n) => {
            const d = document.createElement('div'); d.className = 'dle-dq';
            d.innerHTML = `<button type="button" class="mv" aria-label="Earlier" title="Earlier"${n ? '' : ' disabled'}>‹</button><span class="run" title="${esc(set_(q))}">${esc(q.label)}</span><button type="button" class="mv" aria-label="Later" title="Later"${n < hot.length - 1 ? '' : ' disabled'}>›</button>`;
            const [up, down] = d.querySelectorAll('.mv');
            const move = by => { s.barHot = moveHot(s.barHot, q, by); saveSettingsDebounced(); draw(); const nb = qrDrawerBody(); body.replaceWith(nb); };
            up.onclick = () => move(-1); down.onclick = () => move(1);
            g.append(d);
        });
        body.append(h, g);
    }
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

/**
 * ⚡ on a PC: every Quick Reply as an extra row on top of the bar. 📌 at its end turns the row into the chooser — which
 * ones sit on the bar (☆) and their order — and Done turns it back (Miinthe, 2026-11-03: the old pop-up sat under the chat
 * and was hard to see; one row for both keeps it in one place, in the bar's look).
 */
let qrChoose = false;
function fillQrRow(el) {
    if (qrChoose) {
        if (el.dataset.mode === 'choose') return;   // the chooser updates itself (stars, order)
        el.dataset.mode = 'choose'; el.onclick = null; el.innerHTML = '';
        const head = document.createElement('div'); head.className = 'dle-xhead';
        head.innerHTML = '<b>Quick replies on the bar</b><span class="dk-hint">☆ puts one on the bar · ‹ › its place</span>';
        head.append(K.button({ label: 'Done', kind: 'primary', onClick: () => { qrChoose = false; fillQrRow(el); placeExtraRow(); } }));
        el.append(head, qrDrawerBody());
        return;
    }
    const sets = qrSets();
    const html = !qrApi() ? '<span class="dk-hint">SillyTavern’s Quick Reply extension is not loaded.</span>'
        : !sets.length ? '<span class="dk-hint">No Quick Replies here — turn a set on in SillyTavern’s Quick Reply settings.</span>'
            : sets.map(x => (sets.length > 1 ? `<span class="dle-xset">${esc(x.name)}</span>` : '') + x.qrs.map(q => qrBtn({ ...q, set: x.name })).join('')).join('<span class="dle-vsep"></span>');
    const full = html + '<span class="dle-xsp"></span>' + db('stars', 'pinI', 'Choose which ones sit on the bar, and their order');
    if (el.dataset.mode === 'run' && el.innerHTML === full) return;
    el.dataset.mode = 'run';
    el.innerHTML = full;
    el.onclick = e => {
        const q = e.target.closest('[data-qr]');
        if (q) { closeExtraRow('qrs'); runQr(q.dataset.qrSet, q.dataset.qr); return; }
        if (e.target.closest('[data-b="stars"]')) { qrChoose = true; fillQrRow(el); placeExtraRow(); }
    };
}
function toggleQrRow() {
    if (extraRowOpen('qrs')) { closeExtraRow('qrs'); return; }
    closePop();
    qrChoose = false;
    openExtraRow('qrs', fillQrRow, { onClose: () => { qrChoose = false; soon(); } });
    soon();
}

// ── wiring ──────────────────────────────────────────────────────────────────

let spellHold = null;   // a hold on ✓ opened the word list — the click that ends it doesn't also run the check
const spellWordsOpen = () => !!document.querySelector('.dle-spellwords');
function openSpellWords() { if (!spellWordsOpen()) import('../spell.js').then(m => m.openMyWords()); }
function onClick(e) {
    const q = e.target.closest('[data-qr]');
    if (q) { runQr(q.dataset.qrSet, q.dataset.qr); return; }
    const b = e.target.closest('[data-b]');
    if (!b) return;
    switch (b.dataset.b) {
        case 'book': K.openMenu(b, bookItems()); break;
        // panel tabs (2026-11-03): a panel waiting behind another tab comes to the front instead of closing
        case 'panel': if (dockBehind('dl')) dockShow('dl'); else pressPanel(); break;
        case 'qrs': if (phone()) { mode = 'qr'; draw(); } else toggleQrRow(); break;
        case 'stars': openQrDrawer(b); break;
        case 'sp': mode = 'sp'; draw(); break;
        case 'back': mode = 'home'; draw(); break;
        case 'reev': reevaluate(); break;
        case 'guide': import('../guided-swipe.js').then(m => m.guideClick(b)); break;
        case 'spell': if (spellHold === 'held') { spellHold = null; break; } import('../spell.js').then(m => m.fixSpelling(on => { b.classList.toggle('on', on); b.disabled = on; })); break;
        case 'ssend': simpleSend(); break;
        case 'draft': draft(); break;
        case 'notes': if (dockBehind('notes')) dockShow('notes'); else toggleNotes(); break;
        case 'world': if (dockBehind('world')) dockShow('world'); else toggleWorld(); break;
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
        bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Onyx Quill bar');
        bar.innerHTML = '<button type="button" class="dle-bar-bubble" hidden>⏸ Waiting for your answer</button><button type="button" class="dle-bar-bubble mero" hidden>☆ Mero wants to talk</button><div class="dle-bar-main"></div><div id="dle-bar-work"></div>';
        bar.addEventListener('click', onClick);
        bar.addEventListener('pointerdown', onGrab);
        bar.addEventListener('pointerdown', pressStart, true);
        // ✓ Fix spelling: right-click, or hold it on the phone → her word list (Miinthe, 2026-11-03)
        bar.addEventListener('contextmenu', e => {
            if (e.target.closest('[data-b="spell"]')) { e.preventDefault(); openSpellWords(); return; }
            // right-click on a panel's button locks it open, or unlocks it (Miinthe, 2026-11-03: "right click on the panels
            // should lock them … like on the icon in the action bar"). The same as the 📖 menu's / the header's lock.
            if (!dockOn()) return;   // phones and phone-narrow windows: no locks there
            // only an open panel (Miinthe: "make right click lock only when the panel is open"); a closed one: nothing
            if (e.target.closest('[data-b="panel"]')) { e.preventDefault(); if (panelOpen()) { pressLock(); soon(); } }
            else if (e.target.closest('[data-b="notes"]')) { e.preventDefault(); toggleNotesLock(); soon(); }
            else if (e.target.closest('[data-b="world"]')) { e.preventDefault(); toggleWorldLock(); soon(); }
        });
        bar.addEventListener('pointerdown', e => {
            const b = e.target.closest('[data-b="spell"]');
            if (!b || e.pointerType === 'mouse') return;
            clearTimeout(spellHold);
            spellHold = setTimeout(() => { spellHold = 'held'; openSpellWords(); }, 550);
            const stop = () => { if (spellHold !== 'held') clearTimeout(spellHold); for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.removeEventListener(t, stop); };
            for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, stop);
        });
        for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, pressEnd, true);
        bar.querySelector('.dle-bar-bubble:not(.mero)').addEventListener('click', () => window.__dleOpenRequests?.());
        bar.querySelector('.dle-bar-bubble.mero').addEventListener('click', e => { e.currentTarget.hidden = true; window.__dleOpenMeroTalks?.(); });
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
    onMeroChanged(soon);   // Mero's glow (seen / set aside)
    window.addEventListener('dle-notes', soon);   // My notes opened / closed → the button's pressed look
    window.addEventListener('dle-world', soon);
    window.addEventListener('dle-guide', soon);   // the swipe direction set / dropped → the 🧭 button lit or not   // the world panel opened / closed, or its board changed
    const later = () => setTimeout(() => { mount(); }, 300);
    try {
        eventSource.on(event_types.CHAT_CHANGED, later);
        eventSource.on(event_types.MESSAGE_RECEIVED, soon);   // a reply may bring a big moment (Mero's glow)
        eventSource.on(event_types.MESSAGE_DELETED, soon);
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
