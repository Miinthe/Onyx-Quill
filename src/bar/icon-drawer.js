/**
 * The floating icon drawer: SillyTavern glue (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/Kj4iETYq5q3pXYrTWEj2nq).
 * Rules: icon-drawer-pure.js (tested).
 *
 * A low tab on top of DeepLore's bar (left end) holds other extensions' floating icons; tapped, they open in a row
 * above the bar. The originals stay where their extension put them, only invisible (class dle-docked), so their own
 * code keeps working: a tap on the copy is passed on as that extension expects it — the pointer itself (CarrotKernel's
 * 🥕 listens to pointerdown / pointerup and captures the pointer), then mouse events and a click for the rest. A hold
 * (or right-click) passes on a right-click, for the extension's own options menu.
 */
import { openExtraRow, closeExtraRow } from './extra-row.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../../../script.js';
import { getSettings } from '../../settings.js';
import { drawerActive, looksFloating, iconKey, iconName, badgeOf, tabBadge, docked } from './icon-drawer-pure.js';
import * as K from '../kit/kit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// SillyTavern's own parts and DeepLore's: never "floating icons"
const OURS = '#top-bar, #top-settings-holder, #sheld, #form_sheld, #movingDivs, #toast-container, .popup, dialog, #bg1, #bg_custom, #dle-bar, #deeplore-panel, .dk, [id^="dle-"], [class*="dle-"], [id^="deeplore"]';

let found = new Map();     // key → element (every floating icon on the page, docked or not)
let box = null, open = false, observer = null, timer = null;

const bar = () => document.getElementById('dle-bar');
const isPhone = () => !!bar()?.classList.contains('phone') || matchMedia('(max-width: 1000px)').matches;
// no bar (switched off, or not drawn yet): the icons stay where they are — docked with no tab they were unreachable (bug hunt 2026-11-03)
const active = () => getSettings().barShow !== false && !!bar() && drawerActive(getSettings().iconDrawer, isPhone());
const offList = () => (Array.isArray(getSettings().iconDrawerOff) ? getSettings().iconDrawerOff : []);

function infoOf(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
        position: cs.position, onBody: el.parentElement === document.body, display: cs.display,
        // a docked one is hidden by us: judge it as it was
        visibility: el.classList.contains('dle-docked') ? 'visible' : cs.visibility, opacity: el.classList.contains('dle-docked') ? 1 : cs.opacity,
        w: r.width, h: r.height, cursor: cs.cursor, role: el.getAttribute('role') || '', tag: el.tagName,
        // <body> itself carries DeepLore's classes (dle-bar-on …): only a match below it counts
        ours: el === document.body || ((o => !!o && o !== document.body)(el.closest(OURS))),
    };
}
const keyOf = el => iconKey({ id: el.id, cls: [...el.classList].filter(c => c !== 'dle-docked').join(' '), title: el.getAttribute('title') || '' });
const nameOf = el => iconName({ title: el.getAttribute('title') || '', label: el.getAttribute('aria-label') || '', id: el.id, cls: [...el.classList].filter(c => c !== 'dle-docked').join(' ') });
const badge = el => badgeOf([...el.attributes].map(a => [a.name, a.value]), [...el.querySelectorAll('[class*="badge" i], [class*="count" i]')].map(x => x.textContent));

/** Look for floating icons: <body>'s children and their children (extensions put them there). */
function scan() {
    const next = new Map();
    for (const top of document.body.children) {
        for (const el of [top, ...top.children]) {
            if (!(el instanceof HTMLElement)) continue;
            const k = keyOf(el);
            if (!k || next.has(k)) continue;
            if (el.classList.contains('dle-docked') || looksFloating(infoOf(el))) next.set(k, el);
        }
    }
    found = next;
}

/** Dock or free each icon, then draw the tab. */
function apply() {
    scan();
    const on = active(), keep = new Set(on ? docked([...found.keys()], offList()) : []);
    for (const [k, el] of found) el.classList.toggle('dle-docked', keep.has(k));
    // anything docked before that isn't wanted any more goes back
    document.querySelectorAll('.dle-docked').forEach(el => { if (!keep.has(keyOf(el))) el.classList.remove('dle-docked'); });
    draw([...keep].map(k => found.get(k)).filter(Boolean));
}

function draw(els) {
    const b = bar();
    if (!b) return;
    b.classList.toggle('dle-has-drawer', !!els.length);
    if (!els.length) { box?.remove(); box = null; if (open) closeExtraRow('fid'); open = false; b.classList.remove('dle-fid-open'); return; }
    if (!box || box.parentElement !== b) {
        box?.remove();
        box = document.createElement('div');
        box.className = 'dle-idrawer';
        b.appendChild(box);
    }
    const num = tabBadge(els.map(badge));
    // the bar's own button size (Miinthe, 2026-11-03: "the floating icons in the FID are too large"); the name is the tooltip
    const icons = els.map((el, i) => {
        const n = badge(el), clone = el.cloneNode(true);
        clone.removeAttribute('id'); clone.removeAttribute('style'); clone.className = '';
        const inner = clone.innerHTML.trim() ? clone.innerHTML : '🧩';
        return `<button type="button" class="dle-db dle-idr-it" data-i="${i}" title="${esc(nameOf(el))} · hold for its options" aria-label="${esc(nameOf(el))}"><span class="dle-idr-ic">${inner}</span>${n ? `<span class="dle-idr-badge">${esc(n)}</span>` : ''}</button>`;
    }).join('');
    const html = `<button type="button" class="dle-idr-tab" data-xrow="fid" aria-expanded="${open}" aria-label="Floating icons: ${els.length}" title="Floating icons (${els.length})"><span class="dle-idr-chev">${open ? '▼' : '▲'}</span>${num ? `<span class="dle-idr-badge">${esc(num)}</span>` : ''}</button>`;
    if (box.innerHTML !== html) { box.innerHTML = html; box.querySelector('.dle-idr-tab').onclick = () => { open = !open; apply(); }; }
    b.classList.toggle('dle-fid-open', open);
    // open: an extra bar on top of the bar, above the tab (Miinthe, 2026-11-03: "for the FID it should be an extra bar")
    if (!open) { closeExtraRow('fid'); return; }
    // right on the bar, in the same place as the Quick Reply row (Miinthe, 2026-11-03: "there is still a gap in the FID"); the
    // tab steps aside while it is open, and ▼ at the row's end closes it (a tap elsewhere or Esc too)
    const full = icons + '<span class="dle-xsp"></span><button type="button" class="dle-db small dle-idr-close" title="Close" aria-label="Close the floating icons">▼</button>';
    openExtraRow('fid', row => { if (row.innerHTML !== full) { row.innerHTML = full; wire(row, els); row.querySelector('.dle-idr-close').onclick = () => close(); } }, { onClose: () => { if (open) { open = false; apply(); } } });
}

function wire(root, els) {
    root.querySelectorAll('.dle-idr-it').forEach(btn => {
        const el = els[Number(btn.dataset.i)];
        let hold = null, held = false, captured = false;
        const at = e => ({ bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary });
        const menu = e => {
            held = true; clearTimeout(hold);
            // the original holds the pointer: take it back, or letting go would also count as a tap (bug hunt 2026-11-03:
            // a hold opened TunnelVision's panel as well as its menu)
            if (captured) { try { el.releasePointerCapture(e.pointerId); } catch { /* not held */ } el.dispatchEvent(new PointerEvent('pointercancel', at(e))); }
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
            close();
        };
        btn.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            held = false;
            // the pointer itself goes to the original (it may capture it, as the 🥕 does)
            el.dispatchEvent(new PointerEvent('pointerdown', at(e)));
            captured = (() => { try { return el.hasPointerCapture(e.pointerId); } catch { return false; } })();
            hold = setTimeout(() => menu(e), 550);
            if (captured) {
                // the original now gets the real pointerup itself; the row closes once it's let go
                const done = () => { clearTimeout(hold); captured = false; if (!held) close(); };
                el.addEventListener('pointerup', done, { once: true });
                el.addEventListener('pointercancel', done, { once: true });
            } else el.dispatchEvent(new MouseEvent('mousedown', at(e)));
        });
        btn.addEventListener('pointerup', e => {
            clearTimeout(hold);
            if (held || captured) return;
            el.dispatchEvent(new PointerEvent('pointerup', at(e)));
            el.dispatchEvent(new MouseEvent('mouseup', at(e)));
            el.dispatchEvent(new MouseEvent('click', at(e)));
            close();
        });
        btn.addEventListener('pointercancel', () => clearTimeout(hold));
        btn.addEventListener('contextmenu', e => { e.preventDefault(); if (!held) menu(e); });
    });
}

function close() { if (!open) return; open = false; closeExtraRow('fid'); apply(); }

/** Settings › Interface › The bar › "Choose icons…": every floating icon found, each with a switch. */
export function openDrawerPicker() {
    scan();
    const body = document.createElement('div');
    body.className = 'dle-idr-pick';
    const s = getSettings();
    if (!found.size) body.innerHTML = '<p>No floating icons here right now.</p>';
    for (const [k, el] of found) {
        const on = !offList().includes(k);
        const t = K.toggle({ checked: on, label: nameOf(el), onChange: v => {
            const off = new Set(offList()); if (v) off.delete(k); else off.add(k);
            s.iconDrawerOff = [...off]; saveSettingsDebounced(); apply();
        } });
        body.appendChild(K.setting({ title: nameOf(el), control: t }));
    }
    const p = document.createElement('p'); p.className = 'dk-hint'; p.textContent = 'Switched off: it floats where it was before.'; body.appendChild(p);
    K.openWindow({ title: 'Icons in the drawer', body, size: 'small' });
}

/** Re-check now (a setting changed). */
export const refreshDrawer = () => apply();

export function initIconDrawer() {
    // a tap anywhere else closes the row: extra-row.js
    // new icons are added to <body>; a docked icon's number changes on the icon itself
    observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 250); });
    observer.observe(document.body, { childList: true });
    const watchBadges = () => { for (const el of document.querySelectorAll('.dle-docked')) if (!el.__dleWatched) { el.__dleWatched = true; new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 250); }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true }); } };
    setInterval(() => { apply(); watchBadges(); }, 5000);   // extensions add their icons late; the bar can be rebuilt
    try { eventSource.on(event_types.SETTINGS_UPDATED, () => setTimeout(apply, 300)); eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(apply, 600)); } catch { /* noop */ }
    window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
    setTimeout(() => { apply(); watchBadges(); }, 1500);
}
