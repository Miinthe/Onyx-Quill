/**
 * My notes (Miinthe, 2026-10-18; mock-up v3 https://claude.ai/artifact/WDdJMENvdrKPW4QufaoRLJ) — the window. Rules: notes-pure.js.
 *
 * A small window over the chat, opened from the bar (PC: floats on the right; phone: the whole screen). It never
 * blocks the chat: the message box stays usable while it is open. Never sent to the AI — nothing here is read by
 * the prompt code.
 *
 * Stored in its own user file on the server (like the bar's draft), not in the settings: SillyTavern saves all
 * settings at once from whichever window saves last, and notes must not come back or vanish that way. The file is
 * read fresh each time the window opens; if it can't be read, the window says so and changes nothing (so a bad
 * read never overwrites her notes with an empty list).
 */
import { chat_metadata, eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
import { getSettings } from '../settings.js';
import { currentCharacter } from './characters.js';
import { BOARD_KEY, resolveBoardName } from './storyboard-pure.js';
import { boardStore } from './board-store.js';
import {
    SCOPES, SCOPE_WORDS, normNotes, newId, groupsHere, searchNotes, whereText, moveTo, preview, intoBox,
    placeName, isHere, notebookPages, noteToHtml, notebookToText,
} from './notes-pure.js';
import * as K from './kit/kit.js';

const I = K.icon;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILE = 'deeplore-my-notes.json';
const CSS = new URL('./notes.css', import.meta.url).href;
const SC = { chat: 'var(--dk-l5)', story: 'var(--dk-l3)', char: 'var(--dk-l1)', all: 'var(--dk-good)' };

let data = normNotes(null);
let readOk = false;         // false: the file could not be read — show it, change nothing
let win = null;             // the window element while open
let open = null;            // the note being edited
let importing = null;       // the Notebook import list while picking
let libOpen = false, query = '', sort = 'new', delSure = false;
/** The Everywhere folder stays as she left it (Miinthe, 2026-10-19: "It should remember which folder I had open"). */
function rememberLib() { const s = getSettings(); if (s.notesLibOpen !== libOpen) { s.notesLibOpen = libOpen; saveSettingsDebounced(); } }

// ── the file ────────────────────────────────────────────────────────────────

async function readFile() {
    try {
        const r = await fetch(`/user/files/${FILE}`, { cache: 'no-store' });
        if (r.status === 404) { data = normNotes(null); readOk = true; return; }
        if (!r.ok) throw new Error(`the server said ${r.status}`);
        data = normNotes(await r.json());
        readOk = true;
    } catch (err) {
        readOk = false;
        console.warn('[DLE] My notes: could not read them:', err?.message || err);
    }
}
let saveTimer = null, saving = Promise.resolve();
function save(now = false) {
    if (!readOk) return;
    clearTimeout(saveTimer);
    const go = () => { saving = saving.then(writeFile); return saving; };
    if (now) return go();
    saveTimer = setTimeout(go, 500);
}
async function writeFile() {
    try {
        const json = JSON.stringify({ v: 1, notes: data.notes, imported: data.imported, at: new Date().toISOString() });
        const bytes = new TextEncoder().encode(json);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const r = await fetch('/api/files/upload', { method: 'POST', headers: getContext().getRequestHeaders(), body: JSON.stringify({ name: FILE, data: btoa(bin) }) });
        if (!r.ok) throw new Error(`the server said ${r.status}`);
    } catch (err) {
        K.notify({ title: 'My notes', text: `Your last change could not be saved: ${err?.message || err}. Keep the window open and try again.`, tone: 'bad' });
    }
}

// ── where we are ────────────────────────────────────────────────────────────

function where() {
    const ctx = getContext();
    const chat = ctx?.getCurrentChatId?.() || '';
    const c = chat ? currentCharacter() : null;
    const b = chat ? chat_metadata?.[BOARD_KEY] || '' : '';
    let story = '';
    try { story = b ? resolveBoardName(boardStore(), b) || b : ''; } catch { story = b; }
    return { chat, chatName: chat, story, char: c?.key || '', charName: c?.name || '' };
}
function resolver() {
    let st = null;
    try { st = boardStore(); } catch { /* no boards */ }
    return k => (st ? resolveBoardName(st, k) : null) || k;
}

// ── drawing ─────────────────────────────────────────────────────────────────

const left = () => getSettings().notesSide === 'left';
const phone = () => !!document.getElementById('deeplore-panel')?.classList.contains('dle-mobile') || window.matchMedia?.('(max-width: 700px)').matches;

function card(n, showFrom, here) {
    return `<div class="dle-nt-card" style="--sc:${SC[n.s]}" data-open="${esc(n.id)}" role="button" tabindex="0">` +
        `<span class="t">${n.pin ? '<span class="pin" title="Pinned">★</span>' : ''}${esc(n.t || 'Untitled')}</span>` +
        `<span class="acts"><button type="button" class="dk-ib" data-put="${esc(n.id)}" title="Put in reply box" aria-label="Put in reply box">${I('import')}</button>` +
        `<button type="button" class="dk-ib" data-copy="${esc(n.id)}" title="Copy" aria-label="Copy">${I('copy')}</button></span>` +
        `<span class="p">${esc(preview(n.b)) || '<i>empty</i>'}</span>` +
        (showFrom ? `<span class="from">${esc(whereText(n))}${n.s === 'all' || here(n) ? '' : ' · not here'}</span>` : '') +
        '</div>';
}
function group(s, w, list) {
    const empty = { chat: 'No notes for this chat yet. Tap + to add one.', story: 'No notes for this story yet.', char: 'No notes for this character yet.' }[s];
    const name = placeName(w, s);
    return `<div class="dle-nt-grp"><div class="gh"><span class="sw" style="background:${SC[s]}"></span>${SCOPE_WORDS[s]}` +
        ` <span class="where">${esc(name)}</span><span class="n">${list.length}</span></div>` +
        (list.length ? list.map(n => card(n)).join('') : `<div class="empty">${empty}</div>`) + '</div>';
}

function listView() {
    const w = where(), resolve = resolver();
    if (query) {
        const found = searchNotes(data.notes, query, w, { resolve });
        return `<div class="dle-nt-grp"><div class="gh">Found in all your notes<span class="n">${found.length}</span></div>` +
            (found.length ? found.map(n => card(n, true, x => isHere(x, w, resolve))).join('') : `<div class="empty">Nothing matches “${esc(query)}”.</div>`) + '</div>';
    }
    const g = groupsHere(data.notes, w, { resolve, sort });
    let h = '';
    if (!w.chat) h += '<p class="dk-hint">No chat is open, so only your library shows.</p>';
    else {
        h += group('chat', w, g.chat);
        if (w.story) h += group('story', w, g.story);
        if (w.char) h += group('char', w, g.char);
    }
    const shown = libOpen ? g.all : g.all.filter(n => n.pin);
    h += `<div class="dle-nt-grp lib"><div class="gh"><span class="sw" style="background:${SC.all}"></span>Everywhere <span class="where">your library</span>` +
        `<button type="button" class="fold" data-lib aria-expanded="${libOpen}" title="${libOpen ? 'Fold' : 'Show all'}">${g.all.length} ${I('chev')}</button></div>` +
        (shown.length ? shown.map(n => card(n)).join('') : (libOpen ? '<div class="empty">Nothing in your library yet. Notes set to “Everywhere” land here.</div>' : '')) + '</div>';
    return h;
}

function editorView(n) {
    const w = where();
    const here = isHere(n, w, resolver());
    const seg = SCOPES.map(s => {
        const k = s === 'all' ? 'x' : (s === 'chat' ? w.chat : s === 'story' ? w.story : w.char);
        const on = n.s === s && (s === 'all' || here);
        const sub = s === 'all' ? 'every chat' : (placeName(w, s) || { chat: 'no chat open', story: 'no storyboard here', char: 'no character here' }[s]);
        return `<button type="button" style="--sc:${SC[s]}" class="${on ? 'on' : ''}" data-s="${s}"${k ? '' : ' disabled'}><i class="sw"></i><span><b>${SCOPE_WORDS[s]}</b><small>${esc(sub)}</small></span></button>`;
    }).join('');
    return '<div class="dle-nt-ed">' +
        `<button type="button" class="back" data-back>${I('back')}All notes</button>` +
        `<input class="dk-field tt" data-title value="${esc(n.t)}" placeholder="Title" aria-label="Title">` +
        '<div class="tools">' +
        '<button type="button" class="dk-ib" data-fmt="bold" title="Bold" aria-label="Bold"><b>B</b></button>' +
        '<button type="button" class="dk-ib" data-fmt="italic" title="Italic" aria-label="Italic"><i>I</i></button>' +
        '<button type="button" class="dk-ib" data-fmt="heading" title="Heading" aria-label="Heading"><b>H</b></button>' +
        '<button type="button" class="dk-ib" data-fmt="list" title="List" aria-label="List">•</button><span class="gap"></span>' +
        `<button type="button" class="dk-ib${n.pin ? ' on' : ''}" data-pin title="${n.pin ? 'Unpin' : 'Pin to the top'}" aria-label="Pin" aria-pressed="${n.pin}">★</button></div>` +
        `<div class="dk-field bb" data-body contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-ph="Write your note…">${noteToHtml(n.b)}</div>` +
        '<span class="dk-label">Shows in</span>' +
        `<div class="seg">${seg}</div>` +
        `<p class="dk-hint">${n.s !== 'all' && !here ? `Lives in ${esc(whereText(n))}. Pick one above to move it here.` : 'Never sent to the AI, wherever it shows.'}</p>` +
        '<div class="btns">' +
        `<button type="button" class="dk-btn dk-primary" data-put="${esc(n.id)}">${I('import')}<span>Put in reply box</span></button>` +
        `<button type="button" class="dk-btn" data-copy="${esc(n.id)}">${I('copy')}<span>Copy</span></button>` +
        `<button type="button" class="dk-btn dk-danger${delSure ? ' sure' : ''}" data-del>${I('trash')}<span>${delSure ? 'Tap again to delete' : 'Delete'}</span></button>` +
        '</div></div>';
}

function importView() {
    const w = where(), n = importing.filter(x => x.on).length;
    if (!importing.length) return `<div class="dle-nt-ed"><button type="button" class="back" data-back>${I('back')}Back</button><p class="dk-hint">Your Notebook has no pages to bring over.</p></div>`;
    return '<div class="dle-nt-ed">' +
        `<button type="button" class="back" data-back>${I('back')}Cancel</button>` +
        `<div><b class="ih">Bring over Notebook notes</b><p class="dk-hint">Your Notebook has ${importing.length} page${importing.length === 1 ? '' : 's'}. Pick the ones to copy and where each shows. The Notebook keeps its own copy. Colors and fonts are not kept; bold, italic, headings and lists are.</p></div>` +
        importing.map((x, i) => `<div class="dle-nt-imp${x.on ? '' : ' off'}" style="--sc:${SC[x.s]}">` +
            `<label class="ihead"><input type="checkbox" data-ion="${i}"${x.on ? ' checked' : ''}><b>${esc(x.t)}</b></label>` +
            `<div class="ip">${esc(preview(x.b, 220)) || '<i>empty</i>'}</div>` +
            `<div class="iscope">${SCOPES.map(s => {
                const ok = s === 'all' || placeName(w, s);
                return `<button type="button" class="${x.s === s ? 'on' : ''}" style="--sc:${SC[s]}" data-i="${i}" data-is="${s}"${x.on && ok ? '' : ' disabled'}>${SCOPE_WORDS[s]}</button>`;
            }).join('')}</div></div>`).join('') +
        `<p class="dk-hint">“This chat”, “This story” and “This character” mean the chat open now${w.chat ? ` (${esc(w.chat)})` : ''}.</p>` +
        `<div class="btns"><button type="button" class="dk-btn dk-primary" data-impgo${n ? '' : ' disabled'}>${I('import')}<span>Bring over ${n}</span></button></div></div>`;
}

function render() {
    if (!win) return;
    const body = win.querySelector('.dle-nt-body');
    win.querySelector('.dle-nt-search').hidden = !!(open || importing || !readOk);
    if (!readOk) {
        body.innerHTML = '<div class="dle-nt-ed"><p class="dk-hint">Your notes could not be read from the server, so nothing is shown or changed. Close the window and open it again in a moment.</p></div>';
        return;
    }
    const top = body.scrollTop;
    body.innerHTML = open ? editorView(open) : importing ? importView() : listView();
    body.classList.toggle('editing', !!open);   // one page: only the note itself scrolls (notes.css)
    const s = getSettings(), id = open?.id || '';
    if ((s.notesLastOpen || '') !== id) { s.notesLastOpen = id; saveSettingsDebounced(); }   // reopening comes back here
    body.scrollTop = open || importing ? 0 : top;
}

// ── actions ─────────────────────────────────────────────────────────────────

const find = id => data.notes.find(n => n.id === id);
function put(n) {
    const t = document.getElementById('send_textarea');
    if (!t) return;
    t.value = intoBox(t.value, n.b);
    t.dispatchEvent(new Event('input', { bubbles: true }));
    if (phone()) close();
    t.focus({ preventScroll: true });
    K.notify({ title: 'My notes', text: 'Put in your reply box.', tone: 'good', timeout: 2500 });
}
async function copy(n) {
    try { await navigator.clipboard.writeText(n.b); K.notify({ title: 'My notes', text: 'Copied.', timeout: 2000 }); }
    catch { K.notify({ title: 'My notes', text: 'Copying is not allowed here. Open the note and select the text instead.', tone: 'bad' }); }
}
/** Leaving the editor: a note left completely empty is not kept. */
function leaveEditor() {
    if (open && !open.t.trim() && !open.b.trim()) { data.notes = data.notes.filter(n => n !== open); save(); }
    open = null; delSure = false;
}
function touch(n) { n.at = Date.now(); save(); }

function onClick(e) {
    const t = e.target;
    const p = t.closest('[data-put]'), c = t.closest('[data-copy]');
    if (p) { e.stopPropagation(); const n = find(p.dataset.put); if (n) put(n); return; }
    if (c) { e.stopPropagation(); const n = find(c.dataset.copy); if (n) copy(n); return; }
    if (t.closest('[data-lib]')) { libOpen = !libOpen; rememberLib(); render(); return; }
    if (t.closest('[data-back]')) { leaveEditor(); importing = null; render(); return; }
    const o = t.closest('[data-open]');
    if (o) { open = find(o.dataset.open) || null; query = ''; win.querySelector('.dle-nt-q').value = ''; render(); return; }
    if (!open && !importing) return;
    if (importing) {
        const sb = t.closest('[data-is]');
        if (sb && !sb.disabled) { importing[+sb.dataset.i].s = sb.dataset.is; render(); return; }
        if (t.closest('[data-impgo]')) { bringOver(); return; }
        return;
    }
    const n = open;
    const f = t.closest('[data-fmt]');
    if (f) { format(f.dataset.fmt); return; }
    if (t.closest('[data-pin]')) { n.pin = !n.pin; touch(n); render(); return; }
    const s = t.closest('[data-s]');
    if (s && !s.disabled) {
        const m = moveTo(s.dataset.s, where());
        if (m) { Object.assign(n, m); touch(n); render(); K.notify({ title: 'My notes', text: `Now shows in ${whereText(n)}.`, timeout: 2500 }); }
        return;
    }
    if (t.closest('[data-del]')) {
        if (!delSure) { delSure = true; render(); return; }
        const gone = n, at = data.notes.indexOf(n);
        data.notes = data.notes.filter(x => x !== n);
        open = null; delSure = false; save(); render();
        K.notify({ title: 'My notes', text: `Deleted “${gone.t || 'Untitled'}”.`, undo: () => { data.notes.splice(Math.max(0, at), 0, gone); save(); render(); } });
    }
}
function onInput(e) {
    const t = e.target;
    if (t.matches('.dle-nt-q')) { query = t.value.trim(); render(); return; }
    if (!open) return;
    if (t.matches('[data-title]')) { open.t = t.value; touch(open); }
    if (t.closest('[data-body]')) bodyChanged();
}
/** The editor shows the note formatted; what is kept is text with SillyTavern's marks (notes-pure.js). */
function bodyChanged() {
    const ed = win?.querySelector('[data-body]');
    if (!ed || !open) return;
    open.b = notebookToText(ed.innerHTML);
    touch(open);
}
function format(kind) {
    const ed = win.querySelector('[data-body]');
    const sel = document.getSelection();
    if (!ed.contains(sel?.anchorNode)) {   // the cursor is elsewhere: to the end of the note
        ed.focus();
        const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    }
    if (kind === 'heading') {
        const inH = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest?.('h1,h2,h3,h4,h5,h6');
        document.execCommand('formatBlock', false, inH ? 'div' : 'h3');
    } else document.execCommand({ bold: 'bold', italic: 'italic', list: 'insertUnorderedList' }[kind]);
    bodyChanged();
    markFormats();
}
/** The formatting buttons light up for what is on where the cursor is (Miinthe, 2026-10-19: "what kind of formatting I chose is not indicated"). */
function markFormats() {
    const ed = win?.querySelector('[data-body]');
    if (!ed) return;
    const sel = document.getSelection(), node = sel?.anchorNode, inEd = !!node && ed.contains(node);
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const inH = inEd && !!el?.closest?.('h1,h2,h3,h4,h5,h6');
    const on = {
        // a heading is drawn bold, so there only real bold counts (else B lit up in every heading — Miinthe: "super buggy")
        bold: inEd && (inH ? !!el?.closest?.('b,strong') : document.queryCommandState('bold')),
        italic: inEd && document.queryCommandState('italic'),
        heading: inH,
        list: inEd && !!el?.closest?.('ul,ol'),
    };
    win.querySelectorAll('[data-fmt]').forEach(b => { const v = !!on[b.dataset.fmt]; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
}
document.addEventListener('selectionchange', () => { if (win) markFormats(); });
// Ctrl+B / Ctrl+I and typing change the format without moving the cursor, so no selectionchange comes
document.addEventListener('keyup', e => { if (win && e.target.closest?.('.dle-notes [data-body]')) markFormats(); });
/** Pasted text comes in plain (no colors or fonts from web pages). */
function onPaste(e) {
    if (!e.target.closest?.('[data-body]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
}

function onChange(e) {
    const c = e.target.closest('[data-ion]');
    if (c && importing) { importing[+c.dataset.ion].on = c.checked; render(); }
}
function onKey(e) {
    if (e.key === 'Enter' && e.target.matches('[data-open]')) { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'Escape' && !document.querySelector('.dk-menu')) {
        e.stopPropagation();
        if (open || importing) { leaveEditor(); importing = null; render(); } else if (!locked()) close();
    }
}

function newNote() {
    const w = where();
    const n = { id: newId(), t: '', b: '', ...(moveTo('chat', w) || moveTo('all', w)), pin: false, at: Date.now() };
    data.notes.push(n);
    importing = null; open = n; render();
    win.querySelector('[data-title]')?.focus();
}

function moreItems() {
    return [
        { label: 'Bring over Notebook notes', icon: 'import', sub: 'pick which ones, and where each shows', onClick: startImport },
        phone() ? null : { label: left() ? 'Move to the right' : 'Move to the left', icon: left() ? 'panel' : 'panelL', onClick: () => { getSettings().notesSide = left() ? 'right' : 'left'; saveSettingsDebounced(); fit(); } },
        { label: `Sort: ${sort === 'new' ? 'newest first' : 'A to Z'}`, icon: 'group', sub: 'tap to switch', onClick: () => { sort = sort === 'new' ? 'az' : 'new'; render(); } },
    ].filter(Boolean);
}
function startImport() {
    const pages = extension_settings?.notebook?.pages;
    if (!Array.isArray(pages) || !pages.length) { K.notify({ title: 'My notes', text: 'No Notebook notes found. Is the Notebook extension installed on this account?' }); return; }
    leaveEditor(); query = ''; win.querySelector('.dle-nt-q').value = '';
    importing = notebookPages(pages);
    render();
}
function bringOver() {
    const w = where(), picked = importing.filter(x => x.on);
    const now = Date.now();
    picked.forEach((x, i) => data.notes.push({ id: newId(), t: x.t, b: x.b, ...(moveTo(x.s, w) || moveTo('all', w)), pin: false, at: now - i }));
    data.imported = true;
    importing = null;
    if (picked.some(x => x.s === 'all')) { libOpen = true; rememberLib(); }
    save(true); render();
    K.notify({ title: 'My notes', text: `${picked.length} Notebook note${picked.length === 1 ? '' : 's'} brought over.`, tone: 'good' });
}

// ── the window ──────────────────────────────────────────────────────────────

function changed() { window.dispatchEvent(new CustomEvent('dle-notes')); }

export const notesOpen = () => !!win;

export async function openNotes() {
    if (win) return;
    if (!document.querySelector('link[data-dk="notes"]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; l.dataset.dk = 'notes'; document.head.append(l);
    }
    win = document.createElement('section');
    win.className = 'dle-notes dk' + (phone() ? ' phone' : '');
    win.setAttribute('aria-label', 'My notes');
    win.innerHTML = '<div class="dle-nt-head"><h2>My notes <span class="priv" title="Never sent to the AI">' + I('lock') + 'only you</span></h2></div>' +
        '<div class="dle-nt-search"><input type="search" class="dk-field dle-nt-q" placeholder="Search all your notes" aria-label="Search all your notes"></div>' +
        '<div class="dle-nt-body"><p class="dk-hint">Reading your notes…</p></div>';
    const head = win.querySelector('.dle-nt-head');
    const lockB = K.iconButton({ icon: 'unlock', title: 'Lock open', onClick: () => setLocked(!locked()) });
    lockB.dataset.lock = '';
    head.append(
        K.iconButton({ icon: 'plus', title: 'New note', onClick: () => { if (readOk) newNote(); } }),
        K.moreButton(moreItems),
        lockB,
        K.iconButton({ icon: 'close', title: 'Close', onClick: () => close() }),
    );
    win.addEventListener('click', onClick);
    win.addEventListener('input', onInput);
    win.addEventListener('change', onChange);
    win.addEventListener('keydown', onKey);
    win.addEventListener('paste', onPaste);
    win.addEventListener('mousedown', e => { if (e.target.closest('[data-fmt]')) e.preventDefault(); });   // keep the selection
    // in SillyTavern's top-bar layer, beside its panels and DeepLore's side panel: over the side panel, under SillyTavern's
    // own panels while one is open (Miinthe 2026-10-18: "temp side panels like ai response configuration/characters always
    // is over the notes"). Outside that layer it could only be over all of them or under all of them.
    (document.getElementById('top-settings-holder') || document.body).append(win);
    watchStack(); fit(); drawLock(); keepOpen(true);
    document.addEventListener('pointerdown', outside, true);
    changed();
    await readFile();
    query = ''; importing = null; delSure = false; libOpen = getSettings().notesLibOpen === true;
    // back to the note that was open when the window closed (Miinthe, 2026-10-19: "If I was on this note and close it, I should
    // return to this exact note upon reopening"); on the list when it was closed there
    open = (getSettings().notesLastOpen && find(getSettings().notesLastOpen)) || null;
    render();
}

// ── the lock (Miinthe, 2026-10-18) ──────────────────────────────────────────────
// Unlocked: a click anywhere outside the window closes it. Locked: it stays open whatever you do — other chats,
// SillyTavern's panels (they open over it), a reload — until the bar button or ✕ closes it. The bar button always
// opens and closes it, locked or not.

const locked = () => getSettings().notesLocked === true;
function setLocked(on) {
    getSettings().notesLocked = on;
    keepOpen(!!win);
    drawLock();   // no notice: the lock icon says it (Miinthe: "remove the popup notifications when I lock or unlock")
}
function drawLock() {
    const b = win?.querySelector('[data-lock]');
    if (!b) return;
    const on = locked();
    b.innerHTML = I(on ? 'lock' : 'unlock');
    b.title = on ? 'Unlock (a click outside will close it)' : 'Lock open';
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
}
/** Remember "open while locked", so a reload opens it again. */
function keepOpen(open) {
    const s = getSettings(), v = !!open && locked();
    if (s.notesKeepOpen !== v) { s.notesKeepOpen = v; saveSettingsDebounced(); }
}
function outside(e) {
    if (!win || locked() || win.contains(e.target)) return;
    // the bar button toggles by itself; menus, notices (Undo) and pop-ups opened from the window don't count
    if (e.target.closest?.('#dle-bar [data-b="notes"], .dk-menu, .dk-notices, .dk-scrim, dialog[open]')) return;
    close();
}

let stackWatch = null;
function stack() {
    if (!win) return;
    const st = win.parentElement?.querySelector('.drawer-content.openDrawer:not(#deeplore-panel)');
    win.style.zIndex = st ? '999' : '1001';   // SillyTavern's panels and DeepLore's side panel are 1000
}
function watchStack() {
    const h = win.parentElement;
    stack();
    if (!h || h === document.body) return;
    stackWatch = new MutationObserver(stack);
    stackWatch.observe(h, { attributes: true, attributeFilter: ['class'], subtree: true });
}

/** PC: the whole height (Miinthe, 2026-10-19: "the note panel does not reach all the way down"); phone: the screen under the top bar. */
function fit() {
    if (!win) return;
    win.classList.toggle('phone', phone());
    win.classList.toggle('left', left());
    win.style.bottom = phone() ? '' : '12px';
}
window.addEventListener('resize', () => fit());

export function close() {
    if (!win) return;
    leaveEditor(); importing = null;
    clearTimeout(saveTimer);
    if (readOk) save(true);
    document.removeEventListener('pointerdown', outside, true);
    stackWatch?.disconnect(); stackWatch = null;
    keepOpen(false);
    win.remove(); win = null;
    changed();
}
export function toggleNotes() { if (win) close(); else openNotes(); }

/** Wire once (index.js init): a chat change redraws the window for the new place. */
export function initNotes() {
    // locked and open at the last reload → open again
    const s = getSettings();
    if (s.notesLocked && s.notesKeepOpen && s.notesEnabled !== false) setTimeout(() => { if (!win) openNotes(); }, 1500);
    try {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            if (!win) return;
            delSure = false; render(); fit();   // an open note stays open; its hint says where it lives
        });
    } catch { /* noop */ }
}
