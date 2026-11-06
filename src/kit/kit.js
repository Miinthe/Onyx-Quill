/**
 * Overhaul step 1 (2026-10-15) — DeepLore's shared parts, built once and used everywhere (the side panel, the bar,
 * settings, the board, Mero's window). Looks: kit.css. Colors: theme.js. Icons: icons.js. Picker lists: pickers-pure.js.
 *
 *   button · iconButton · moreButton · chip · seg · toggle · setting · fold · row     — the small pieces
 *   openMenu                                                                        — ⋯ menus
 *   openWindow · ask                                                                — popup windows
 *   removeWithCare                                                                  — removing, the agreed way
 *   notify                                                                          — small notices, with Undo
 *   tilesEditor                                                                     — steps / places / states as mini tiles
 *   iconField · openIconPicker · colorField · openColorPicker                       — the two pickers
 *   meroSuggestion · markByMero                                                     — Mero ☆'s parts
 *
 * Every builder makes elements in `doc` (default: this page), so the same code serves SillyTavern's page and the
 * windows that live in an iframe. Nothing here saves anything: callers get the values through their callbacks.
 */
import { icon } from './icons.js';
import { placeBox } from './place-pure.js';   // inside the visible part, keyboard or not (2026-11-06)
import { searchEmoji, SWATCHES, normalHex } from './pickers-pure.js';

export { icon };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(doc, tag, cls, html) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}
/** Put a Node, a string of text, or nothing into `parent`. */
function put(parent, content) {
    if (content == null || content === false) return;
    if (Array.isArray(content)) { content.forEach(c => put(parent, c)); return; }
    if (typeof content === 'string') parent.append(parent.ownerDocument.createTextNode(content));
    else parent.append(content);
}

// ── settings the kit reads (the caller wires them to DeepLore's saved settings) ──
const memory = {};
const prefs = {
    get: k => memory[k],
    set: (k, v) => { memory[k] = v; },
    /** Settings → Edit → "Ask before removing": when on, every removal asks. */
    alwaysAsk: () => false,
};
/** configureKit({ get, set, alwaysAsk }) — where "Don't ask me again" is remembered. */
export function configureKit(p = {}) { Object.assign(prefs, p); }

// ── small pieces ────────────────────────────────────────────────────────────

/** A button. kind: 'primary' | 'mero' | 'mero-line' | 'danger' | 'quiet' | ''. */
export function button({ label = '', icon: ic, kind = '', title, onClick, disabled = false, doc = document } = {}) {
    const b = el(doc, 'button', 'dk-btn' + (kind ? ' dk-' + kind : ''), (ic ? icon(ic) : '') + (label ? `<span>${esc(label)}</span>` : ''));
    b.type = 'button';
    if (title) b.title = title;
    if (!label && title) b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/** A square icon-only button (headers, rows). `title` is required: it is what a screen reader and a hover say. */
export function iconButton({ icon: ic, title, onClick, on = false, doc = document } = {}) {
    const b = el(doc, 'button', 'dk-ib' + (on ? ' on' : ''), icon(ic));
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/** ⋯ — opens a menu. `items` is a list or a function that returns one (built fresh on every open). */
export function moreButton(items, { title = 'More', icon: ic = 'more', doc = document } = {}) {
    const b = iconButton({ icon: ic, title, doc });
    b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', e => {
        e.stopPropagation();
        if (b.getAttribute('aria-expanded') === 'true') { b._dkClose?.(); return; }
        b._dkClose = openMenu(b, typeof items === 'function' ? items() : items, { onClose: () => b.setAttribute('aria-expanded', 'false') });
        b.setAttribute('aria-expanded', 'true');
    });
    return b;
}

/** A round chip. `onRemove` adds a small ✕ (keys as chips). */
export function chip({ label, on, count, title, onClick, onRemove, doc = document } = {}) {
    const c = el(doc, 'span', 'dk-chip');
    c.setAttribute('role', 'button'); c.tabIndex = 0;
    if (on !== undefined) c.setAttribute('aria-pressed', String(!!on));
    if (title) c.title = title;
    c.append(doc.createTextNode(label));
    if (count !== undefined) c.append(el(doc, 'span', 'dk-n', esc(count)));
    if (onClick) {
        c.addEventListener('click', e => { if (!e.target.closest('.dk-x')) onClick(e); });
        c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } });
    }
    if (onRemove) {
        const x = el(doc, 'button', 'dk-x', '×');
        x.type = 'button'; x.title = `Remove ${label}`; x.setAttribute('aria-label', `Remove ${label}`);
        x.addEventListener('click', e => { e.stopPropagation(); onRemove(e); });
        c.append(x);
    }
    return c;
}

/** One choice out of a few, side by side. options: [[value, label], …]. */
export function seg({ options, value, onChange, label, doc = document } = {}) {
    const s = el(doc, 'div', 'dk-seg');
    s.setAttribute('role', 'group'); if (label) s.setAttribute('aria-label', label);
    const draw = v => s.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
    for (const [v, l] of options) {
        const b = el(doc, 'button', '', esc(l)); b.type = 'button'; b.dataset.v = String(v);
        b.addEventListener('click', () => { draw(v); onChange?.(v); });
        s.append(b);
    }
    draw(value);
    s.setValue = draw;
    return s;
}

/** An on/off switch. */
export function toggle({ checked = false, label, onChange, disabled = false, doc = document } = {}) {
    const t = el(doc, 'button', 'dk-switch');
    t.type = 'button'; t.setAttribute('role', 'switch'); t.setAttribute('aria-checked', String(!!checked));
    if (label) t.setAttribute('aria-label', label);
    t.disabled = !!disabled;
    t.addEventListener('click', () => {
        const v = t.getAttribute('aria-checked') !== 'true';
        t.setAttribute('aria-checked', String(v));
        onChange?.(v);
    });
    t.setChecked = v => t.setAttribute('aria-checked', String(!!v));
    return t;
}

/** A setting: a title (and a line of help) on the left, its control on the right. */
export function setting({ title, help, control, doc = document } = {}) {
    const r = el(doc, 'label', 'dk-set', `<span>${esc(title)}${help ? `<small>${esc(help)}</small>` : ''}</span>`);
    put(r, control);
    if (control?.getAttribute && !control.getAttribute('aria-label')) control.setAttribute('aria-label', title);
    return r;
}

/** A fold: a header line that opens and closes what is under it. Remembers nothing itself — `onToggle(open)`. */
export function fold({ title, summary, count, open = false, body, onToggle, doc = document } = {}) {
    const f = el(doc, 'section', 'dk-fold' + (open ? ' open' : ''));
    const h = el(doc, 'button', 'dk-fh',
        `<span class="dk-ft">${esc(title)}</span><span class="dk-sum">${esc(summary ?? '')}</span>${count !== undefined ? `<span class="dk-n">${esc(count)}</span>` : ''}${icon('chev', 'dk-chev')}`);
    h.type = 'button'; h.setAttribute('aria-expanded', String(open));
    const b = el(doc, 'div', 'dk-fb');
    put(b, body);
    const setOpen = v => { f.classList.toggle('open', v); h.setAttribute('aria-expanded', String(v)); };
    h.addEventListener('click', () => { const v = !f.classList.contains('open'); setOpen(v); onToggle?.(v); });
    f.append(h, b);
    Object.assign(f, { setOpen, body: b, setSummary: t => { h.querySelector('.dk-sum').textContent = t; } });
    return f;
}

/** A list row: lead (emoji/dot/icon markup), title, a second line, and things at the end (Nodes). */
export function row({ lead, title, sub, end, selected, onClick, doc = document } = {}) {
    const r = el(doc, 'div', 'dk-row' + (onClick ? ' dk-pick' : '') + (selected ? ' sel' : ''));
    if (lead !== undefined) r.append(el(doc, 'span', 'dk-lead', lead));
    const m = el(doc, 'span', 'dk-main');
    m.append(el(doc, 'span', 'dk-t', esc(title)));
    if (sub) m.append(el(doc, 'span', 'dk-s', esc(sub)));
    r.append(m);
    if (end) { const e = el(doc, 'span', 'dk-end'); put(e, end); r.append(e); }
    if (onClick) {
        r.tabIndex = 0; r.setAttribute('role', 'button');
        r.addEventListener('click', e => { if (!e.target.closest('button, a, input, .dk-chip')) onClick(e); });
        r.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); onClick(e); } });
    }
    return r;
}

// ── placing a floating box next to what opened it ──────────────────────────

function placeNear(box, anchor) {
    const win = box.ownerDocument.defaultView, r = anchor.getBoundingClientRect(), vv = win.visualViewport;
    // the part you can see (a phone's keyboard shrinks and shifts it), not the whole page
    const view = vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: win.innerWidth, h: win.innerHeight };
    const p = placeBox(r, box.offsetWidth, box.offsetHeight, view);
    box.style.left = p.left + 'px';
    box.style.top = p.top + 'px';
    if (p.maxHeight != null) { box.style.maxHeight = p.maxHeight + 'px'; box.style.overflowY = 'auto'; }
}

/** Close `box` on Escape, on a press outside it (and outside `anchor`), or when `close()` is called. */
function dismissable(box, anchor, onClose) {
    const doc = box.ownerDocument;
    let done = false;
    const close = ({ refocus = false } = {}) => {
        if (done) return; done = true;
        doc.removeEventListener('pointerdown', outside, true);
        doc.removeEventListener('keydown', key, true);
        box.remove();
        if (refocus) anchor?.focus?.();
        onClose?.();
    };
    const outside = e => { if (!box.contains(e.target) && !anchor?.contains?.(e.target)) close(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close({ refocus: true }); } };
    setTimeout(() => doc.addEventListener('pointerdown', outside, true));
    doc.addEventListener('keydown', key, true);
    return close;
}

// ── ⋯ menus ─────────────────────────────────────────────────────────────────

/**
 * Open a menu by `anchor`. items: { label, sub, title (hover), icon, emoji, onClick, danger, mero, checked, disabled }, 'sep',
 * or { heading }. Arrow keys move, Enter picks, Escape closes. Returns close().
 */
export function openMenu(anchor, items, { onClose } = {}) {
    const doc = anchor.ownerDocument;
    doc.querySelectorAll('.dk-menu').forEach(m => m._dkClose?.());
    const m = el(doc, 'div', 'dk-menu');
    m.setAttribute('role', 'menu');
    for (const it of items.filter(Boolean)) {
        if (it === 'sep') { m.append(el(doc, 'div', 'dk-msep')); continue; }
        if (it.heading) { m.append(el(doc, 'div', 'dk-mlab', esc(it.heading))); continue; }
        const b = el(doc, 'button', 'dk-mi' + (it.danger ? ' dk-danger' : '') + (it.mero ? ' dk-mero' : ''),
            (it.icon ? icon(it.icon) : it.emoji ? `<span class="dk-memo">${esc(it.emoji)}</span>` : '') +
            `<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>`);
        b.type = 'button';
        b.setAttribute('role', it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
        if (it.checked !== undefined) b.setAttribute('aria-checked', String(!!it.checked));
        b.disabled = !!it.disabled;
        if (it.title) b.title = it.title;
        b.addEventListener('click', e => { close(); it.onClick?.(e); });
        m.append(b);
    }
    doc.body.append(m);
    placeNear(m, anchor);
    const close = dismissable(m, anchor, onClose);
    m._dkClose = close;
    const list = () => [...m.querySelectorAll('.dk-mi:not([disabled])')];
    m.addEventListener('keydown', e => {
        const l = list(), i = l.indexOf(doc.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); l[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); l[l.length - 1]?.focus(); }
        else if (e.key === 'Tab') close();
    });
    list()[0]?.focus({ preventScroll: true });
    return close;
}

// ── popup windows ───────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A popup window over everything: title, a body that scrolls, and a footer that stays in view.
 * size: '' | 'small' | 'wide'. headExtra: Nodes before the ✕ (a Back button, a ⧉). On a phone it is a sheet.
 * Returns { win, body, foot, head, close, setTitle }. `onClose` runs however it closes.
 */
export function openWindow({ title, body, foot, size = '', headExtra, onClose, closeOnScrim = true, label, doc = document } = {}) {
    const back = doc.activeElement;
    const scrim = el(doc, 'div', 'dk-scrim');
    const win = el(doc, 'div', 'dk-win' + (size ? ' dk-' + size : ''));
    win.setAttribute('role', 'dialog'); win.setAttribute('aria-modal', 'true');
    const head = el(doc, 'div', 'dk-whead');
    const h = el(doc, 'h2'); h.textContent = title ?? ''; h.id = 'dk-w' + Math.random().toString(36).slice(2, 8);
    win.setAttribute('aria-labelledby', h.id);
    if (label) win.setAttribute('aria-label', label);
    head.append(h);
    put(head, headExtra);
    head.append(iconButton({ icon: 'close', title: 'Close', onClick: () => close(), doc }));
    const b = el(doc, 'div', 'dk-wbody'); put(b, body);
    const f = el(doc, 'div', 'dk-wfoot'); put(f, foot);
    win.append(head, b);
    if (foot) win.append(f);
    scrim.append(win);
    doc.body.append(scrim);

    let done = false;
    function close() {
        if (done) return; done = true;
        doc.removeEventListener('keydown', key, true);
        scrim.remove();
        if (back?.isConnected) back.focus?.({ preventScroll: true });
        onClose?.();
    }
    function key(e) {
        if (!scrim.isConnected || [...doc.querySelectorAll('.dk-scrim')].pop() !== scrim) return;   // only the top window
        if (doc.querySelector('dialog[open]')?.contains?.(e.target) || e.target?.closest?.('dialog[open]')) return;   // a SillyTavern popup opened from this window handles its own keys
        if (e.key === 'Escape' && !doc.querySelector('.dk-menu, .dk-epick, .dk-swpick')) { e.stopPropagation(); e.preventDefault(); close(); }
        if (e.key === 'Tab') {   // keep the keyboard inside the window
            const l = [...win.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
            if (!l.length) return;
            if (e.shiftKey && doc.activeElement === l[0]) { e.preventDefault(); l[l.length - 1].focus(); }
            else if (!e.shiftKey && doc.activeElement === l[l.length - 1]) { e.preventDefault(); l[0].focus(); }
        }
    }
    doc.addEventListener('keydown', key, true);
    if (closeOnScrim) scrim.addEventListener('pointerdown', e => { if (e.target === scrim) close(); });
    (b.querySelector('[autofocus]') || b.querySelector(FOCUSABLE) || f.querySelector(FOCUSABLE) || win.querySelector(FOCUSABLE))?.focus({ preventScroll: true });
    return { win, body: b, foot: f, head, close, setTitle: t => { h.textContent = t; } };
}

/**
 * Ask a yes/no question in a small window. → Promise<boolean>.
 * dontAskKey: shows "Don't ask me again"; when ticked, the answer yes is remembered under that key.
 */
export function ask({ title, text, yes = 'Yes', no = 'Cancel', danger = false, dontAskKey, doc = document } = {}) {
    return new Promise(resolve => {
        let answer = false;
        const body = el(doc, 'div');
        if (text) body.append(el(doc, 'p', '', esc(text)));
        body.firstChild && (body.firstChild.style.margin = '0');
        let box;
        if (dontAskKey) {
            const l = el(doc, 'label', 'dk-ask-again', '<input type="checkbox"><span>Don’t ask me again</span>');
            box = l.querySelector('input');
            body.append(l);
        }
        const noB = button({ label: no, doc, onClick: () => w.close() });
        const yesB = button({ label: yes, kind: danger ? 'danger' : 'primary', doc, onClick: () => {
            answer = true;
            if (box?.checked) prefs.set('dk-noask:' + dontAskKey, true);
            w.close();
        } });
        const w = openWindow({ title, body, foot: [noB, yesB], size: 'small', doc, onClose: () => resolve(answer) });
        yesB.focus();
    });
}

/**
 * Remove something the agreed way (Miinthe, 2026-10-15): small things go at once with Undo; big ones ask first,
 * with "Don't ask me again"; with the setting "Ask before removing" on, everything asks.
 * { name, big, askKey, text, remove(), undo() } → Promise<boolean> (removed or not).
 */
export async function removeWithCare({ name, big = false, askKey, text, remove, undo, doc = document } = {}) {
    const always = !!prefs.alwaysAsk();
    const key = askKey || 'remove';
    if (always || (big && !prefs.get('dk-noask:' + key))) {
        const ok = await ask({ title: `Remove ${name}?`, text, yes: 'Remove', danger: true, dontAskKey: always ? undefined : key, doc });
        if (!ok) return false;
    }
    await remove?.();
    notify({ text: `Removed ${name}.`, undo, doc });
    return true;
}

// ── notices ─────────────────────────────────────────────────────────────────

/**
 * A small notice at the bottom. tone: '' | 'good' | 'wait' | 'bad' | 'mero'. With `undo`, an Undo button
 * (it stays a little longer). `actions`: more buttons, [{ label, onClick(button, close) }]. Returns close().
 */
export function notify({ text, title, tone = '', undo, actions, timeout, doc = document } = {}) {
    let stack = doc.querySelector('.dk-notices');
    if (!stack) { stack = el(doc, 'div', 'dk-notices'); stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); doc.body.append(stack); }
    const n = el(doc, 'div', 'dk-notice' + (tone ? ' dk-' + tone : ''));
    const s = el(doc, 'span'); if (title) s.append(el(doc, 'b', '', esc(title))); s.append(doc.createTextNode(text));
    n.append(s);
    let timer;
    const close = () => { clearTimeout(timer); n.remove(); if (!stack.children.length) stack.remove(); };
    if (undo) n.append(button({ label: 'Undo', kind: 'quiet', doc, onClick: async () => { close(); await undo(); } }));
    // more buttons beside Undo: [{ label, onClick(btn, close) }] — the notice stays open; onClick closes it if it wants
    for (const a of actions || []) { const b = button({ label: a.label, kind: 'quiet', doc, onClick: () => a.onClick(b, close) }); n.append(b); }
    n.append(iconButton({ icon: 'close', title: 'Dismiss', doc, onClick: close }));
    stack.append(n);
    while (stack.children.length > 3) stack.firstChild.remove();
    // above SillyTavern's message box, however tall it has grown (found 2026-11-03: a three-line message pushed the box
    // up and the notice sat over the text it was talking about) — the CSS rule only knows the box's usual height
    const form = doc.getElementById('send_form');
    // — as a variable only the base rule reads: with a window open the notices go to the top (kit.css), and an inline
    // top put them back over the window's text box (bug hunt 2026-11-03)
    if (form) { const top = form.getBoundingClientRect().top; if (top > 80) stack.style.setProperty('--dk-notice-top', `${Math.round(top - 8)}px`); else stack.style.removeProperty('--dk-notice-top'); }
    const wait = timeout ?? (undo ? 8000 : 4500);
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, wait); };
    // a mouse over it holds it; a touch does not (a tap never "leaves", so the notice stayed for good — Miinthe, 2026-11-03:
    // "cannot be clicked off"); a tap anywhere on it but its buttons closes it
    n.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') clearTimeout(timer); });
    n.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') arm(); });
    n.addEventListener('click', e => { if (!e.target.closest('button')) close(); });
    n.addEventListener('focusin', () => clearTimeout(timer));
    arm();
    return close;
}

/**
 * An Undo that belongs to one chat: `fn` runs only while that chat is still open. `chatNow()` says which chat is open
 * (it is read now, and again on the click). Another chat open → nothing is changed and `onOther()` runs (by default a
 * notice that says so). Hunt 2 (2026-11-03): a pin / block, a tracker's pause, a Cast "left the scene" or a removed
 * tracker undone from the next chat wrote the first chat's state into the other one.
 */
export function chatOnly(fn, chatNow, onOther = () => notify({ text: 'That happened in another chat: open that chat to undo it.', tone: 'wait' })) {
    const cid = chatNow();
    return (...a) => {
        if (chatNow() !== cid) { onOther(); return undefined; }
        return fn(...a);
    };
}

// ── mini tiles ──────────────────────────────────────────────────────────────

/**
 * Steps / places / states as mini tiles (Add window decision, 2026-10-15): + to add, Enter for the next one,
 * drag to reorder, double-click to rename, click for Earlier / Later / Rename / Remove.
 * { items: [names], color, noun: 'step', numbered, onChange(names) } → element (with .getItems()).
 */
export function tilesEditor({ items = [], color, noun = 'step', numbered = true, onChange, doc = document } = {}) {
    let list = [...items], sel = -1, editing = null;   // editing: index being renamed, or 'new'
    const wrap = el(doc, 'div', 'dk-tiles');
    wrap.setAttribute('role', 'list'); wrap.setAttribute('aria-label', `${noun}s`);
    if (color) wrap.style.setProperty('--dk-tc', color);
    const changed = () => onChange?.([...list]);

    function draw(focus) {
        wrap.textContent = '';
        list.forEach((name, i) => {
            if (i) wrap.append(el(doc, 'span', 'dk-tj'));
            if (editing === i) { wrap.append(input(name, i)); return; }
            const t = el(doc, 'button', 'dk-tile' + (i === sel ? ' on' : ''), `${numbered ? `<span class="dk-tn">${i + 1}</span>` : ''}<span class="dk-tt">${esc(name)}</span>`);
            t.type = 'button'; t.dataset.i = i; t.title = name; t.setAttribute('role', 'listitem');
            t.setAttribute('aria-label', `${noun} ${i + 1}: ${name}`);
            t.addEventListener('click', () => { if (t._dkDragged) return; sel = sel === i ? -1 : i; draw(i); });
            t.addEventListener('dblclick', () => { editing = i; sel = -1; draw(); });
            t.addEventListener('pointerdown', e => drag(e, t, i));
            wrap.append(t);
        });
        if (list.length) wrap.append(el(doc, 'span', 'dk-tj'));
        if (editing === 'new') wrap.append(input('', 'new'));
        else {
            const add = el(doc, 'button', 'dk-tile dk-tadd', `+ ${esc(noun)}`);
            add.type = 'button'; add.title = `Add a ${noun}`;
            add.addEventListener('click', () => { editing = 'new'; sel = -1; draw(); });
            wrap.append(add);
        }
        if (sel >= 0 && sel < list.length) wrap.append(bar(sel));
        if (focus !== undefined) wrap.querySelector(`.dk-tile[data-i="${focus}"]`)?.focus({ preventScroll: true });
        else if (editing !== null) wrap.querySelector('input')?.focus();
    }

    function input(value, at) {
        const inp = el(doc, 'input', 'dk-tile dk-tin');
        inp.value = value; inp.placeholder = at === 'new' ? `New ${noun}` : ''; inp.setAttribute('aria-label', at === 'new' ? `New ${noun}` : `Rename ${noun}`);
        let left = false;
        const commit = next => {
            if (left) return; left = true;
            const v = inp.value.trim();
            if (at === 'new') { if (v) { list.push(v); changed(); } editing = v && next ? 'new' : null; }
            else { if (v && v !== list[at]) { list[at] = v; changed(); } editing = null; }
            draw(at === 'new' || editing === 'new' ? undefined : at);
        };
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); left = true; editing = null; draw(at === 'new' ? undefined : at); }
        });
        inp.addEventListener('blur', () => commit(false));
        return inp;
    }

    function move(i, d) {
        const j = i + d; if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]]; sel = j; changed(); draw(j);
    }

    function bar(i) {
        const b = el(doc, 'div', 'dk-tbar');
        b.append(el(doc, 'b', '', esc(list[i])));
        b.append(button({ label: 'Earlier', doc, disabled: i === 0, onClick: () => move(i, -1) }));
        b.append(button({ label: 'Later', doc, disabled: i === list.length - 1, onClick: () => move(i, 1) }));
        b.append(button({ label: 'Rename', doc, onClick: () => { editing = i; sel = -1; draw(); } }));
        b.append(button({ label: 'Remove', kind: 'danger', doc, onClick: () => {
            const name = list[i], before = [...list];
            removeWithCare({ name: `“${name}”`, doc,
                remove: () => { list.splice(i, 1); sel = -1; changed(); draw(); },
                undo: () => { list = before; changed(); draw(); } });
        } }));
        return b;
    }

    // drag to reorder: pointer events, so it works with a finger too
    function drag(e, tile, from) {
        if (e.button !== 0) return;
        const x0 = e.clientX, y0 = e.clientY;
        let on = false, to = null, after = false;
        tile._dkDragged = false;
        const mv = ev => {
            if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
            if (!on) { on = true; tile.classList.add('dk-dragging'); tile.setPointerCapture?.(ev.pointerId); }
            ev.preventDefault();
            wrap.querySelectorAll('.dk-drop-before, .dk-drop-after').forEach(t => t.classList.remove('dk-drop-before', 'dk-drop-after'));
            const hit = doc.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.dk-tile[data-i]');
            if (!hit || hit === tile) { to = null; return; }
            const r = hit.getBoundingClientRect();
            to = +hit.dataset.i; after = ev.clientX > r.left + r.width / 2;
            hit.classList.add(after ? 'dk-drop-after' : 'dk-drop-before');
        };
        const up = () => {
            doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up);
            if (!on) return;
            tile._dkDragged = true; setTimeout(() => { tile._dkDragged = false; });
            if (to === null) { draw(); return; }
            let at = to + (after ? 1 : 0);
            const [it] = list.splice(from, 1);
            if (from < at) at--;
            list.splice(at, 0, it); sel = -1; changed(); draw(at);
        };
        doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
    }

    draw();
    wrap.getItems = () => [...list];
    wrap.setItems = v => { list = [...v]; sel = -1; editing = null; draw(); };
    return wrap;
}

// ── icon picker ─────────────────────────────────────────────────────────────

/** Open the icon picker by `anchor`. onPick(emoji) — '' means "back to the default icon". */
export function openIconPicker(anchor, { value = '', onPick, doc = anchor.ownerDocument } = {}) {
    doc.querySelectorAll('.dk-epick, .dk-swpick').forEach(b => b._dkClose?.());
    const box = el(doc, 'div', 'dk-epick',
        '<div class="dk-ehead"><input type="search" placeholder="Search… (heart, key, rain)" aria-label="Search icons"></div><div class="dk-ebody"></div>');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Pick an icon');
    box.querySelector('.dk-ehead').append(button({ label: 'Default', title: 'Back to the default icon', doc, onClick: () => pick('') }));
    const body = box.querySelector('.dk-ebody'), q = box.querySelector('input');
    const pick = e => { close(); onPick?.(e); anchor.focus?.({ preventScroll: true }); };
    const draw = () => {
        const groups = searchEmoji(q.value);
        body.innerHTML = groups.length
            ? groups.map(([g, l]) => `<h5>${esc(g)}</h5><div class="dk-egrid">${l.map(x => `<button type="button" class="${x.e === value ? 'on' : ''}" data-e="${esc(x.e)}" title="${esc(x.w.split(' ').slice(0, 2).join(' '))}" aria-label="${esc(x.w.split(' ')[0])}">${x.e}</button>`).join('')}</div>`).join('')
            : '<div class="dk-enone">Nothing here. Type or paste any emoji straight into the field instead.</div>';
        body.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => pick(b.dataset.e)));
    };
    q.addEventListener('input', draw);
    draw();
    doc.body.append(box);
    placeNear(box, anchor);
    const close = dismissable(box, anchor);
    box._dkClose = close;
    if (!doc.defaultView.matchMedia?.('(pointer: coarse)').matches) q.focus(); else body.querySelector('button')?.focus({ preventScroll: true });
    return close;
}

/**
 * An icon field: shows the emoji; a click opens the picker; typing or pasting any emoji still works (as on the
 * board today). onChange(emoji).
 */
export function iconField({ value = '', label = 'Icon', onChange, doc = document } = {}) {
    const inp = el(doc, 'input', 'dk-iconfield');
    inp.value = value; inp.setAttribute('aria-label', label); inp.maxLength = 8; inp.autocomplete = 'off';
    inp.style.textAlign = 'center';
    // a mouse press opens the picker without first showing a caret in the field (board micro fix, 2026-10-04)
    inp.addEventListener('mousedown', e => { if (e.button === 0) e.preventDefault(); });
    inp.addEventListener('click', () => openIconPicker(inp, { value: inp.value, doc, onPick: e => { inp.value = e; onChange?.(e); } }));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => onChange?.(inp.value.trim()));
    return inp;
}

// ── color picker ────────────────────────────────────────────────────────────

/** Open the 14 colors by `anchor`, then "Custom…". onPick('#rrggbb'). onCustom() opens the system picker. */
export function openColorPicker(anchor, { value = '', onPick, onCustom, doc = anchor.ownerDocument } = {}) {
    doc.querySelectorAll('.dk-epick, .dk-swpick').forEach(b => b._dkClose?.());
    const cur = normalHex(value);
    const box = el(doc, 'div', 'dk-swpick',
        `<div class="dk-swgrid">${SWATCHES.map(([c, n]) => `<button type="button" data-c="${c}" title="${n}" aria-label="${n}" class="${c === cur ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div><div class="dk-swfoot"></div>`);
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Pick a color');
    box.querySelector('.dk-swfoot').append(button({ label: 'Custom…', doc, onClick: () => { close(); onCustom?.(); } }));
    box.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { close(); onPick?.(b.dataset.c); anchor.focus?.({ preventScroll: true }); }));
    const grid = [...box.querySelectorAll('[data-c]')];
    box.addEventListener('keydown', e => {
        const i = grid.indexOf(doc.activeElement); if (i < 0) return;
        const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
        if (d) { e.preventDefault(); grid[Math.max(0, Math.min(grid.length - 1, i + d))].focus(); }
    });
    doc.body.append(box);
    placeNear(box, anchor);
    const close = dismissable(box, anchor);
    box._dkClose = close;
    (box.querySelector('.on') || grid[0]).focus({ preventScroll: true });
    return close;
}

/** A color field: a round well; a click opens the 14 colors, "Custom…" any color. onChange('#rrggbb'). */
export function colorField({ value = '', label = 'Color', onChange, doc = document } = {}) {
    const wrap = el(doc, 'span');
    wrap.style.cssText = 'position:relative;display:inline-block;line-height:0';
    const b = el(doc, 'button', 'dk-colorfield', '<i></i>');
    b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    const native = el(doc, 'input');
    native.type = 'color'; native.tabIndex = -1; native.setAttribute('aria-hidden', 'true');
    native.style.cssText = 'position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0';
    const set = (c, fire) => {
        const h = normalHex(c); wrap.dataset.value = h;
        b.style.setProperty('--dk-wc', h || 'transparent'); if (h) native.value = h;
        if (fire) onChange?.(h);
    };
    native.addEventListener('input', () => set(native.value, false));
    native.addEventListener('change', () => set(native.value, true));
    b.addEventListener('click', () => openColorPicker(b, { value: wrap.dataset.value, doc, onPick: c => set(c, true),
        onCustom: () => { try { native.showPicker(); } catch { native.click(); } } }));
    wrap.append(b, native);
    set(value, false);
    wrap.getValue = () => wrap.dataset.value;
    wrap.setValue = c => set(c, false);
    return wrap;
}

// ── Mero ☆ ─────────────────────────────────────────────────────────────────

/**
 * Mero's suggestion box: "Mero ☆", what she suggests, and buttons. actions: [{ label, kind, onClick }];
 * default: Use it / Not now. The box removes itself after a click unless onClick returns false.
 */
export function meroSuggestion({ text, who = 'Mero ☆', actions, onUse, onDismiss, doc = document } = {}) {
    const s = el(doc, 'div', 'dk-sugg');
    s.append(el(doc, 'span', 'dk-who', esc(who)), el(doc, 'span', 'dk-what', esc(text)));
    const a = el(doc, 'span', 'dk-acts');
    const list = actions || [{ label: 'Use it', kind: 'mero', onClick: onUse }, { label: 'Not now', kind: 'quiet', onClick: onDismiss }];
    for (const x of list) a.append(button({ label: x.label, kind: x.kind || '', doc, onClick: async e => { if ((await x.onClick?.(e)) !== false) s.remove(); } }));
    s.append(a);
    return s;
}

/** Show a field as filled by Mero (pink) until someone changes it. */
export function markByMero(field) {
    field.classList.add('dk-by-mero');
    field.title = field.title || 'Filled in by Mero ☆. Stays pink until you change it.';
    const off = () => { field.classList.remove('dk-by-mero'); field.removeEventListener('input', off); };
    field.addEventListener('input', off);
}
