/**
 * The slop guard: SillyTavern glue (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/ByQff64nfdyDB4acfqYm7N).
 * Rules: slop-pure.js (tested).
 *
 * - After each new reply: count what the writer keeps reusing (no AI) → one card from Mero in her requests:
 *   Ban it · Use it less · It's fine.
 * - Her phrase list (in Mero's window, next to her notes) → the 🚫 lines of the author's notes (mero.js sink).
 * - In the chat: a wavy underline under a listed phrase; tapped: Rewrite this line · It's fine here.
 * - Select any text in a message → ✎ Rewrite: Polish · Shorten · Longer · Your own… One small call with Mero's AI,
 *   a before/after to Keep or Cancel. Only the selected words change; an empty answer changes nothing.
 */
import { chat, chat_metadata, eventSource, event_types, saveSettingsDebounced, updateMessageBlock, saveChatDebounced, name1, name2 } from '../../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../../extensions.js';
import { resolveConnectionConfig } from '../settings.js';
import { callAI } from './ai/ai.js';
import { addRequest, requestsHere, onAnswer } from './requests.js';
import { meroWhere, addWriterSink } from './mero.js';
import { SLOP_KEY, WINDOW, asSlop, phrasesHere, fineHere, repeats, writerLines, toUnderline, rewritePrompt, cleanRewrite, locate, sentenceAround, REWRITES, normText, usedIn, phraseRe } from './slop-pure.js';
import * as K from './kit/kit.js';

const OK_KEY = 'deeplore_slop_ok';   // chat_metadata: ["<message>|<phrase>"] — "It's fine here" for one reply
const listeners = new Set();
export const onSlopChanged = cb => { listeners.add(cb); return () => listeners.delete(cb); };
const changed = () => { for (const cb of listeners) { try { cb(); } catch { /* noop */ } } underlineSoon(); };

// ── the store (the same object always: a change never lands on a copy) ──────
const tidy = new WeakSet();
function storeW() {
    let s = extension_settings[SLOP_KEY];
    if (!s || !tidy.has(s)) { s = extension_settings[SLOP_KEY] = asSlop(s); tidy.add(s); }
    return s;
}
const store = () => (extension_settings[SLOP_KEY] ? storeW() : asSlop(null));
const save = () => { saveSettingsDebounced(); changed(); };
const where = () => { const w = meroWhere(); return { charKey: w.charKey, board: w.board, character: w.character }; };

/** The AI's replies in this chat, oldest first: [{ i, text }]. */
const replies = () => (chat || []).map((m, i) => ({ i, m })).filter(x => x.m && !x.m.is_user && !x.m.is_system).map(x => ({ i: x.i, text: String(x.m.mes || '') }));

// ── for Mero's window ────────────────────────────────────────────────────────

/** The phrase list as her window shows it: what applies here, how often the writer used each lately, what's fine. */
export function slopList() {
    const w = where(), recent = replies().slice(-WINDOW).map(r => r.text);
    const count = t => recent.filter(x => usedIn(x, t)).length;
    return {
        where: { board: w.board, charKey: w.charKey, character: w.character },
        phrases: phrasesHere(store(), w).map(p => ({ ...p, n: count(p.t) })),
        fine: fineHere(store(), w),
        writer: writerLines(phrasesHere(store(), w), recent).map(l => l.text),
    };
}
const scopeOf = sc => { const w = where(); return sc === 'board' && w.board ? { sc, k: w.board, kn: w.board } : sc === 'char' && w.charKey ? { sc, k: w.charKey, kn: w.character || w.charKey } : { sc: 'all', k: '', kn: '' }; };

/** Add a phrase (typed in, or from Mero's card). m: 'ban' | 'less'; sc: 'all' | 'board' | 'char'. */
export function addPhrase(t, { m = 'ban', sc = 'all', src = 'mine' } = {}) {
    const s = storeW(), p = asSlop({ phrases: [{ t, m, src, ...scopeOf(sc), at: new Date().toISOString() }] }).phrases[0];
    if (!p) return false;
    s.phrases = s.phrases.filter(x => !(x.t === p.t && x.sc === p.sc && x.k === p.k));
    s.phrases.push(p);
    s.fine = s.fine.filter(f => f.t !== p.t);
    save(); return true;
}
export function updatePhrase(id, patch) {
    const s = storeW(), p = s.phrases.find(x => x.id === id); if (!p) return;
    if (patch.m) p.m = patch.m === 'less' ? 'less' : 'ban';
    if (patch.sc) Object.assign(p, scopeOf(patch.sc));
    save();
}
export function removePhrase(id) { const s = storeW(); s.phrases = s.phrases.filter(x => x.id !== id); save(); }
export function markFine(t, sc = 'all') { const s = storeW(); const f = asSlop({ fine: [{ t, ...scopeOf(sc) }] }).fine[0]; if (f && !s.fine.some(x => x.t === f.t && x.k === f.k)) s.fine.push(f); save(); }
export function unFine(t) { const s = storeW(); s.fine = s.fine.filter(f => f.t !== normText(t)); save(); }

// ── learning: after each new reply ───────────────────────────────────────────

function learn() {
    const w = where();
    if (requestsHere().waiting.some(r => r.kind === 'slop')) return;   // one question at a time
    const s = store();
    const skip = [...phrasesHere(s, w).map(p => p.t), ...fineHere(s, w).map(f => f.t), ...s.asked];
    const hit = repeats(replies().map(r => r.text), { names: [name1, name2, w.character].filter(Boolean), skip })[0];
    if (!hit) return;
    const sw = storeW(); sw.asked = [...sw.asked, hit.t].slice(-300); saveSettingsDebounced();
    addRequest({ id: `slop:${Date.now().toString(36)}`, from: 'mero', kind: 'slop', t: hit.t, n: hit.n,
        title: `“${hit.t}” showed up ${hit.n}× in the last ${Math.min(WINDOW, replies().length)} replies. Add it to your list?`,
        made: { i: (chat || []).length - 1 } });
}

// ── what the writer gets ─────────────────────────────────────────────────────

function forWriter(type) {
    const w = where();
    let list = replies();
    if (type === 'swipe' && list.length && list[list.length - 1].i === (chat || []).length - 1) list = list.slice(0, -1);   // the reply being redone
    return writerLines(phrasesHere(store(), w), list.slice(-WINDOW).map(r => r.text));
}

// ── underlines in the chat ───────────────────────────────────────────────────

const okHere = () => (Array.isArray(chat_metadata?.[OK_KEY]) ? chat_metadata[OK_KEY] : []);
let ulTimer = null;
function underlineSoon() { clearTimeout(ulTimer); ulTimer = setTimeout(underline, 150); }

function unwrap(root) { root.querySelectorAll('span.dle-slop').forEach(sp => sp.replaceWith(...sp.childNodes)); root.normalize(); }

function underline() {
    const ph = phrasesHere(store(), where());
    const rs = replies(), byI = new Map(rs.map((r, k) => [r.i, k]));
    const ok = new Set(okHere());
    for (const el of document.querySelectorAll('#chat .mes[mesid]')) {
        const i = Number(el.getAttribute('mesid')), text = el.querySelector('.mes_text');
        if (!text) continue;
        unwrap(text);
        if (!ph.length || !byI.has(i)) continue;
        const k = byI.get(i);
        const marks = toUnderline(rs[k].text, ph, rs.slice(Math.max(0, k - 5), k).map(r => r.text)).filter(p => !ok.has(`${i}|${p.t}`));
        for (const p of marks) wrapAll(text, p, i);
    }
}

function wrapAll(root, p, i) {
    const re = phraseRe(p.t, 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement?.closest('code, pre, .dle-slop') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const s = node.nodeValue; re.lastIndex = 0;
        const ms = [...s.matchAll(re)]; if (!ms.length) continue;
        const frag = document.createDocumentFragment(); let at = 0;
        for (const m of ms) {
            frag.append(s.slice(at, m.index));
            const sp = document.createElement('span');
            sp.className = 'dle-slop' + (p.m === 'less' ? ' less' : ''); sp.dataset.t = p.t; sp.dataset.i = String(i);
            sp.title = p.m === 'less' ? 'Use less: it came back too soon. Tap for options.' : 'On your phrase list. Tap for options.';
            sp.textContent = m[0]; frag.append(sp); at = m.index + m[0].length;
        }
        frag.append(s.slice(at)); node.replaceWith(frag);
    }
}

function onSlopTap(e) {
    const sp = e.target.closest?.('span.dle-slop'); if (!sp) return;
    e.preventDefault(); e.stopPropagation();
    const i = Number(sp.dataset.i), t = sp.dataset.t, p = phrasesHere(store(), where()).find(x => x.t === t);
    K.openMenu(sp, [
        { heading: `“${t}” · ${p?.m === 'less' ? 'use less' : 'banned'}` },
        { label: 'Rewrite this line', icon: 'draft', onClick: () => { const r = sentenceAround(chat[i]?.mes, t); if (r) rewrite(i, r, 'slop', { phrase: t }); else K.notify({ text: 'Couldn’t find that line in the message.', tone: 'wait' }); } },
        { label: 'It’s fine here', sub: 'no underline in this reply', onClick: () => { chat_metadata[OK_KEY] = [...okHere(), `${i}|${t}`].slice(-500); saveMetadataDebounced(); underlineSoon(); } },
    ]);
}

// ── rewriting a passage ──────────────────────────────────────────────────────

let rewriting = false;
/** Rewrite chat[i].mes between start and end. what: polish · shorten · longer · own · slop. */
async function rewrite(i, { start, end }, what, extra = {}) {
    const m = chat?.[i]; if (!m || rewriting) return;
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) { K.notify({ text: 'Rewriting uses Mero’s AI: pick one in Settings › AI & connections › Mero.', tone: 'wait', timeout: 8000 }); return; }
    const src = String(m.mes || ''), passage = src.slice(start, end);
    const avoid = phrasesHere(store(), where()).filter(p => p.m === 'ban').map(p => p.t);
    const { system, user } = rewritePrompt(what, passage, { before: src.slice(0, start), after: src.slice(end), avoid, ...extra });
    rewriting = true;
    const wait = K.notify({ text: 'Rewriting…', timeout: 60000 });
    let out = '';
    try {
        const r = await callAI(system, user, { ...conn, maxTokens: Math.min(Number(conn.maxTokens) || 800, Math.max(200, passage.length)), caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
        out = cleanRewrite(r?.text, passage);
    } catch (err) { console.warn('[Onyx Quill] rewrite failed:', err?.message || err); }
    finally { rewriting = false; wait?.(); }
    if (!out) { K.notify({ text: 'No rewrite came back. Nothing was changed.', tone: 'wait' }); return; }
    const body = document.createElement('div');
    body.className = 'dle-rw';
    body.innerHTML = '<div class="dle-rw-was"></div><div class="dle-rw-now" contenteditable="plaintext-only" spellcheck="true"></div><p class="dk-hint">You can still edit the new text before keeping it.</p>';
    body.querySelector('.dle-rw-was').textContent = passage;
    body.querySelector('.dle-rw-now').textContent = out;
    const keep = K.button({ label: 'Keep', kind: 'primary', onClick: () => {
        const now = body.querySelector('.dle-rw-now').innerText.trim();
        w.close();
        if (!now) return;
        const cur = String(chat[i]?.mes || '');
        if (cur.slice(start, end) !== passage) { K.notify({ text: 'The message changed meanwhile. Nothing was replaced.', tone: 'wait' }); return; }
        chat[i].mes = cur.slice(0, start) + now + cur.slice(end);
        if (Array.isArray(chat[i].swipes) && Number.isInteger(chat[i].swipe_id)) chat[i].swipes[chat[i].swipe_id] = chat[i].mes;
        updateMessageBlock(i, chat[i]);
        saveChatDebounced();
        underlineSoon();
    } });
    const cancel = K.button({ label: 'Cancel', onClick: () => w.close() });
    const w = K.openWindow({ title: what === 'slop' ? 'Rewrite this line' : `Rewrite: ${REWRITES[what] || 'your instruction'}`, body, foot: [cancel, keep], size: 'small' });
}

// ── ✎ on a selection ─────────────────────────────────────────────────────────

let chipEl = null, picked = null;
function hideChip() { chipEl?.remove(); chipEl = null; }
function onSelection() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (!chipEl?.matches(':hover')) { hideChip(); picked = null; } return; }
    const r = sel.getRangeAt(0);
    const a = r.startContainer.parentElement?.closest('.mes_text'), b = r.endContainer.parentElement?.closest('.mes_text');
    if (!a || a !== b || a.closest('.mes')?.querySelector('.edit_textarea')) { hideChip(); return; }
    const text = sel.toString().trim();
    if (text.length < 3) { hideChip(); return; }
    picked = { i: Number(a.closest('.mes').getAttribute('mesid')), text };
    const rect = r.getBoundingClientRect();
    if (!chipEl) {
        chipEl = document.createElement('button');
        chipEl.type = 'button'; chipEl.className = 'dk dle-rw-chip'; chipEl.textContent = '✎ Rewrite';
        chipEl.addEventListener('pointerdown', e => e.preventDefault());   // keep the selection
        chipEl.addEventListener('click', () => openRewriteMenu(chipEl));
        document.body.appendChild(chipEl);
    }
    chipEl.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - 40, innerWidth - 100)) + 'px';
    chipEl.style.top = Math.max(8, rect.top - 38) + 'px';
}
function openRewriteMenu(anchor) {
    const p = picked; if (!p) return;
    const at = locate(chat?.[p.i]?.mes, p.text);
    const go = (what, extra) => { hideChip(); document.getSelection()?.removeAllRanges(); if (at) rewrite(p.i, at, what, extra); else K.notify({ text: 'Couldn’t match that selection to the message’s text (it appears twice, or crosses formatting). Select a little less and try again.', tone: 'wait', timeout: 8000 }); };
    K.openMenu(anchor, [
        { heading: 'Rewrite the selection' },
        { label: REWRITES.polish, onClick: () => go('polish') },
        { label: REWRITES.shorten, onClick: () => go('shorten') },
        { label: REWRITES.longer, onClick: () => go('longer') },
        { label: REWRITES.own, sub: 'e.g. “no repeated words”', onClick: () => askOwn(ins => go('own', { instruction: ins })) },
    ]);
}
function askOwn(then) {
    const body = document.createElement('div');
    body.innerHTML = '<textarea class="dk-field" rows="3" placeholder="What should change? e.g. colder, fewer words"></textarea>';
    const ta = body.querySelector('textarea');
    const ok = K.button({ label: 'Rewrite', kind: 'primary', onClick: () => { const v = ta.value.trim(); w.close(); if (v) then(v); } });
    const w = K.openWindow({ title: 'Your own instruction', body, foot: [K.button({ label: 'Cancel', onClick: () => w.close() }), ok], size: 'small' });
    setTimeout(() => ta.focus(), 50);
}

// ── wiring ───────────────────────────────────────────────────────────────────

export function initSlop() {
    addWriterSink(forWriter);
    onAnswer('slop', (r, choice) => {
        if (choice === 'ban' || choice === 'less') return addPhrase(r.t, { m: choice, src: 'learned' }) || true;
        if (choice === 'fine') { markFine(r.t); return true; }
        return false;
    });
    try {
        eventSource.on(event_types.MESSAGE_RECEIVED, (_id, type) => { if (type !== 'swipe' && type !== 'quiet' && type !== 'impersonate') setTimeout(learn, 400); underlineSoon(); });
        for (const ev of [event_types.CHARACTER_MESSAGE_RENDERED, event_types.CHAT_CHANGED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED, event_types.MESSAGE_DELETED, event_types.MORE_MESSAGES_LOADED]) if (ev) eventSource.on(ev, underlineSoon);
    } catch { /* noop */ }
    document.addEventListener('click', onSlopTap, true);
    let selT = null;
    document.addEventListener('selectionchange', () => { clearTimeout(selT); selT = setTimeout(onSelection, 250); });
    document.addEventListener('scroll', hideChip, true);
    underlineSoon();
}
