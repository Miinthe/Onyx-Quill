/**
 * Panel tabs (Miinthe, 2026-11-03; mock-up https://claude.ai/artifact/2rcyY7N1UDEvsMcWG1KLEK v6): DeepLore's side panel,
 * My notes and World each sit on the left or the right; the ones open on a side are tabs in a strip at the BOTTOM of
 * that side ("on the bottom we usually have free real estate while the top is already busy"), on a PC, with two or
 * more on a side — a panel alone on its side has no strip and moves sides from its header's lock. One shows, the
 * others wait behind it.
 *
 * Click a tab: it shows. ✕: it closes. Right-click: lock / unlock, move to the other side, close. Drag it across:
 * it moves (remembered per panel). My notes and World take the exact place and size of the side panel on their side
 * (or the same rule when it isn't there), so the three look like one set. Phones: nothing here — one panel at a time
 * over the chat, as before.
 *
 * Nothing here opens, closes or locks a panel its own way: it presses the panel's own controls (the side panel's
 * lock and close, My notes' and World's own functions), so every check they make still runs.
 */
import { saveSettingsDebounced } from '../../../../../../script.js';
import { getSettings } from '../../settings.js';
import * as K from '../kit/kit.js';
import { PANELS, NAMES, ICONS, COLORS, otherSide, sidesFrom, tabsBySide, shownTab, nextOpened, dropSide } from './dock-pure.js';
import { notesOpen, openNotes, close as closeNotes, setNotesLocked, refitNotes } from '../notes.js';
import { worldOpen, openWorld, closeWorld, worldHere, setWorldLocked, refitWorld } from '../world/world.js';
import { setPanelSide } from '../drawer/drawer-frame.js';

const I = K.icon;
const CSS = new URL('./dock.css', import.meta.url).href;

// ── the three panels, through their own controls ────────────────────────────

const dlEl = () => document.getElementById('deeplore-panel');
const A = {
    dl: {
        el: dlEl,
        open: () => !!dlEl()?.classList.contains('openDrawer'),
        show: () => { if (!A.dl.open()) document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle')?.click(); },
        close: () => {
            const p = dlEl(); if (!p) return;
            if (p.classList.contains('pinnedOpen')) p.querySelector('.dle-lock')?.click();   // closing clears the lock
            if (A.dl.open()) p.querySelector('#dle-drawer-close')?.click();
        },
        locked: () => !!dlEl()?.classList.contains('pinnedOpen'),
        lock: on => { if (A.dl.locked() !== on) dlEl()?.querySelector('.dle-lock')?.click(); },
        side: s => { setPanelSide(s); },
    },
    notes: {
        el: () => document.querySelector('.dle-notes'),
        open: () => notesOpen(),
        show: () => { if (!notesOpen()) openNotes(); },
        close: () => closeNotes(),
        locked: () => getSettings().notesLocked === true,
        lock: on => setNotesLocked(on),
        side: s => { getSettings().notesSide = s; saveSettingsDebounced(); refitNotes(); },
    },
    world: {
        el: () => document.querySelector('.dle-world'),
        open: () => worldOpen(),
        show: () => { if (!worldOpen() && worldHere()) openWorld(); },
        close: () => closeWorld(),
        locked: () => getSettings().worldLocked === true,
        lock: on => setWorldLocked(on),
        side: s => { getSettings().worldSide = s; saveSettingsDebounced(); refitWorld(); },
    },
};

/** A PC (the tabs) — not a phone and not a phone-narrow window (World and My notes go full screen there). */
export function dockOn() {
    const p = dlEl();
    if (p?.classList.contains('dle-mobile')) return false;
    return !window.matchMedia?.('(max-width: 700px)').matches;
}

// ── state ───────────────────────────────────────────────────────────────────

let opened = [], shown = { left: null, right: null }, wasOpen = {}, lastTabs = { left: [], right: [] }, lastSides = sidesFrom({});

/** Is this panel open but waiting behind another tab? (the bar's buttons bring it to the front instead of closing it) */
export function dockBehind(id) { return dockOn() && A[id]?.open() && shown[lastSides[id]] !== id; }
/** Bring an open panel to the front of its side. */
export function dockShow(id) { const s = lastSides[id]; if (!s) return; shown[s] = id; apply(); }
/** Open a panel (to the front of its side), optionally locked. */
export function dockOpen(id, { lock = false } = {}) {
    const a = A[id]; if (!a) return;
    if (!a.open()) a.show();
    if (lock) a.lock(true);
    setTimeout(() => { if (a.open()) dockShow(id); }, 0);
}

function sync() {
    if (!dockOn()) { teardown(); return; }
    tornDown = false;
    // World used to take the side opposite the side panel, always: with tabs each panel keeps the side it was put on, so
    // World's side is written down once (where it is now) — moving the side panel no longer drags World along
    const st = getSettings();
    if (st.worldSide !== 'left' && st.worldSide !== 'right') { st.worldSide = sidesFrom(st).world; saveSettingsDebounced(); }
    const open = Object.fromEntries(PANELS.map(id => [id, !!A[id].open()]));
    const fresh = PANELS.filter(id => open[id] && !wasOpen[id]);
    wasOpen = open;
    opened = nextOpened(opened, open);
    lastSides = sidesFrom(getSettings());
    lastTabs = tabsBySide(open, lastSides, opened);
    for (const s of ['left', 'right']) shown[s] = shownTab(lastTabs[s], shown[s], fresh);
    apply();
}
let queued = false;
const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); };

// ── drawing ─────────────────────────────────────────────────────────────────

/** Change a class only when it differs — every change wakes the watchers (and a class change here woke this very
 *  code again: an endless redraw, found 2026-11-03 on a phone). */
const setCls = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };

function apply() {
    if (!dockOn()) return;
    setCls(document.body, 'dle-dock-on', true);
    frameVars();
    for (const id of PANELS) {
        const el = A[id].el(); if (!el) continue;
        const side = lastSides[id], open = A[id].open();
        setCls(el, 'dle-dock-behind', open && shown[side] !== id);
        if (id !== 'dl') {
            setCls(el, 'dle-dock-panel', true);
            setCls(el, 'dle-dock-left', side === 'left');
            setCls(el, 'dle-dock-right', side === 'right');
            place(el, side);
        }
        // the strip only with two or more on a side (Miinthe: one panel alone moves sides from its header's lock instead)
        strip(el, open && lastTabs[side].length > 1 ? lastTabs[side] : [], side);
    }
}

/** My notes / World: the side panel's own place and size when it is open on that side; else the same rule it uses. */
function rectFor(side) {
    const p = dlEl();
    if (p && A.dl.open() && lastSides.dl === side) {
        const r = p.getBoundingClientRect();
        if (r.width > 50) return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    // under SillyTavern's top bar, where its side panels (and DeepLore's) start
    const top = Math.round(document.getElementById('top-settings-holder')?.getBoundingClientRect().bottom || 0) || 50;
    const sh = document.getElementById('sheld')?.getBoundingClientRect();
    const room = sh ? Math.floor(side === 'left' ? sh.left : window.innerWidth - sh.right) : 0;
    const width = room >= 300 ? room : Math.min(380, Math.round(window.innerWidth * 0.9));
    return { left: side === 'left' ? 0 : window.innerWidth - width, top, width, height: window.innerHeight - top };
}
const setVar = (st, k, v) => { if (st.getPropertyValue(k) !== v) st.setProperty(k, v); };
/** The side panel's own frame (the theme's tint, blur and top line), so My notes and World wear the same. */
function frameVars() {
    const p = dlEl(); if (!p) return;
    const c = getComputedStyle(p), r = document.documentElement.style;
    setVar(r, '--dle-dock-bg', c.backgroundColor);
    setVar(r, '--dle-dock-blur', c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : 'none');
    setVar(r, '--dle-dock-top', c.borderTopWidth !== '0px' && c.borderTopStyle !== 'none' ? `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}` : '1px solid var(--SmartThemeBorderColor)');
}
function place(el, side) {
    const r = rectFor(side);
    const want = { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`, right: 'auto', bottom: 'auto' };
    for (const [k, v] of Object.entries(want)) if (el.style[k] !== v) el.style[k] = v;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function strip(el, list, side) {
    let row = el.querySelector(':scope > .dle-dock-tabs');
    if (!list.length) { row?.remove(); return; }
    if (!row) { row = document.createElement('div'); row.className = 'dle-dock-tabs dk'; row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', `Panels on the ${side}`); el.append(row); }
    else if (row !== el.lastElementChild) el.append(row);   // stays the last thing in the panel
    // the lock on each tab shows what is locked in the row (Miinthe: "I like it when multiple tabs are in the row to see what
    // is locked and what not"); a panel alone on its side has no strip, so no second lock under its header's
    const html = list.map(id => {
        const on = id === shown[side], lk = A[id].locked();
        const ic = id === 'dl' ? (side === 'left' ? 'panelL' : 'panel') : ICONS[id];
        return `<div class="dle-dt${on ? ' on' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-dt="${id}" style="--tc:${COLORS[id]}" title="${esc(NAMES[id])} — click: show · drag to the other side · right-click: lock, move, close">${I(ic)}<span class="nm">${esc(NAMES[id])}</span>${lk ? `<span class="lk" title="Locked open">${I('lock')}</span>` : ''}<button type="button" class="x" data-dtx="${id}" title="Close ${esc(NAMES[id])}" aria-label="Close ${esc(NAMES[id])}">${I('close')}</button></div>`;
    }).join('');
    if (row._dleHtml !== html) { row.innerHTML = html; row._dleHtml = html; }   // innerHTML reads SVG back differently: compare the built string
}

let tornDown = true;
function teardown() {
    if (tornDown) return;
    tornDown = true;
    document.body.classList.remove('dle-dock-on');
    for (const id of PANELS) {
        const el = A[id].el(); if (!el) continue;
        for (const c of ['dle-dock-behind', 'dle-dock-panel', 'dle-dock-left', 'dle-dock-right']) setCls(el, c, false);
        el.querySelector(':scope > .dle-dock-tabs')?.remove();
        if (id !== 'dl') for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) el.style[k] = '';
    }
}

// ── moving a panel ──────────────────────────────────────────────────────────

export function dockMove(id, side) {
    const a = A[id]; if (!a || lastSides[id] === side) return;
    a.side(side);
    shown[side] = id;
    sync();
    // the side panel may slide over: place the others again once it has settled
    setTimeout(sync, 350);
}

// ── the strip's clicks, right-clicks and drags ──────────────────────────────

let drag = null, justDragged = false;
function onClick(e) {
    // something asked for one of the side panel's own tabs (Mero's banner, her requests, a pitch notice, Browse …): the
    // side panel comes to the front if it waits behind another tab (bug hunt 2026-11-03 — it switched tab out of sight)
    if (e.target.closest?.('#deeplore-panel .dle-tab') && dockBehind('dl')) dockShow('dl');
    const x = e.target.closest?.('[data-dtx]');
    if (x && x.closest('.dle-dock-tabs')) { e.preventDefault(); e.stopPropagation(); A[x.dataset.dtx]?.close(); soon(); return; }
    const t = e.target.closest?.('.dle-dock-tabs [data-dt]');
    if (!t || justDragged) return;
    dockShow(t.dataset.dt);
}
// the header's lock, right-click: lock / unlock and move to the other side (Miinthe: a panel alone on its side has no tab,
// "the … header lock symbol to switch sides")
const HEAD_LOCK = { dl: '#deeplore-panel .dle-ph .dle-lock', notes: '.dle-notes .dle-nt-head [data-lock]', world: '.dle-world .dle-wd-head [data-lock]' };
function onHeadLock(e) {
    if (!dockOn()) return false;
    const id = PANELS.find(k => e.target.closest?.(HEAD_LOCK[k]));
    if (!id) return false;
    e.preventDefault();
    const a = A[id], to = otherSide(lastSides[id]), b = e.target.closest(HEAD_LOCK[id]);
    K.openMenu(b, [
        a.locked() ? { label: 'Unlock', icon: 'unlock', onClick: () => { a.lock(false); soon(); } } : { label: 'Lock open', icon: 'lock', onClick: () => { a.lock(true); soon(); } },
        { label: `Move to the ${to}`, icon: to === 'left' ? 'panelL' : 'panel', sub: 'remembered', onClick: () => dockMove(id, to) },
    ]);
    return true;
}
function onMenu(e) {
    if (onHeadLock(e)) return;
    const t = e.target.closest?.('.dle-dock-tabs [data-dt]');
    if (!t) return;
    e.preventDefault();
    const id = t.dataset.dt, a = A[id], to = otherSide(lastSides[id]);
    const row = () => [...(lastTabs[lastSides[id]] || [])];
    K.openMenu(t, [
        a.locked() ? { label: 'Unlock', icon: 'unlock', onClick: () => { a.lock(false); soon(); } } : { label: 'Lock open', icon: 'lock', onClick: () => { a.lock(true); soon(); } },
        { label: `Move to the ${to}`, icon: to === 'left' ? 'panelL' : 'panel', sub: 'remembered', onClick: () => dockMove(id, to) },
        { label: `Close ${NAMES[id]}`, icon: 'close', onClick: () => { a.close(); soon(); } },
        'sep',
        // the whole row (Miinthe: "add lock all, unlock all and close all to the right click tab menu")
        { label: 'Lock all', icon: 'lock', sub: `the tabs on the ${lastSides[id]}`, onClick: () => { row().forEach(k => A[k].lock(true)); soon(); } },
        { label: 'Unlock all', icon: 'unlock', sub: `the tabs on the ${lastSides[id]}`, onClick: () => { row().forEach(k => A[k].lock(false)); soon(); } },
        { label: 'Close all', icon: 'close', sub: `the tabs on the ${lastSides[id]}`, onClick: () => { row().forEach(k => A[k].close()); soon(); } },
    ]);
}
function onDown(e) {
    const t = e.target.closest?.('.dle-dock-tabs [data-dt]');
    if (!t || e.button !== 0 || e.target.closest('[data-dtx]')) return;
    drag = { id: t.dataset.dt, el: t, x0: e.clientX, y0: e.clientY, ghost: null, zone: null, to: otherSide(lastSides[t.dataset.dt]) };
}
function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost?.remove(); d.zone?.remove(); d.el?.classList.remove('dragging');
}
function onMove(e) {
    if (!drag) return;
    if (e.buttons === 0) { endDrag(); return; }   // the release got lost (another window, a touch screen): no move
    if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
        drag.ghost = drag.el.cloneNode(true);
        drag.ghost.classList.add('dk', 'dle-dt-ghost'); drag.ghost.style.width = `${drag.el.offsetWidth}px`;
        document.body.append(drag.ghost);   // on <body>: inside a panel, its blur would pin "fixed" to the panel
        drag.el.classList.add('dragging');
        const r = rectFor(drag.to);
        drag.zone = document.createElement('div');
        drag.zone.className = 'dle-dock-drop dk';
        drag.zone.textContent = `Drop here: ${drag.to} side`;
        Object.assign(drag.zone.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.append(drag.zone);
    }
    drag.ghost.style.left = `${e.clientX - 40}px`; drag.ghost.style.top = `${e.clientY - 18}px`;
    drag.zone.classList.toggle('hot', dropSide(e.clientX, window.innerWidth) === drag.to);
}
function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.ghost) return;
    d.ghost.remove(); d.zone.remove(); d.el.classList.remove('dragging');
    justDragged = true; setTimeout(() => { justDragged = false; }, 0);
    if (dropSide(e.clientX, window.innerWidth) === d.to) dockMove(d.id, d.to);
}

// ── wiring ──────────────────────────────────────────────────────────────────

let wired = false;
/** Wire once (index.js init, after the side panel, My notes and World). */
export function initDock() {
    if (wired) return;
    wired = true;
    if (!document.querySelector('link[data-dk="dock"]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; l.dataset.dk = 'dock'; document.head.append(l);
    }
    window.addEventListener('dle-notes', soon);
    window.addEventListener('dle-world', soon);
    window.addEventListener('resize', soon);
    const watchDl = () => { const p = dlEl(); if (!p) return false; new MutationObserver(soon).observe(p, { attributes: true, attributeFilter: ['class', 'style'] }); return true; };
    if (!watchDl()) setTimeout(watchDl, 2000);
    // SillyTavern's chat width (and the locked side panel making room) changes the space beside the chat
    try {
        new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['style'] });
    } catch { /* noop */ }
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
    sync();
}
