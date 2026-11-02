/**
 * World layer, stage 0 (Miinthe, 2026-10-19; design: docs/storyboard/19 world layer design.md, mock-up v5).
 *
 * The world panel: its own side panel on the side opposite DeepLore's, with a rail like Mero's (Chatter · News ·
 * Messages · People, the board's World tab at the bottom). It shows up only in chats whose board has the world layer
 * switched on (the board's World tab); off → no bar button, no panel, no AI calls.
 *
 * Also here: the per-chat world store (chat_metadata.deeplore_world). Everything the world writes is tagged with its
 * message, so a delete takes it back and a swipe at that message replaces it. Stage 0 writes nothing yet; the store
 * and its rollback are wired now so every later stage gets them for free.
 */
import { chat_metadata, eventSource, event_types } from '../../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../../extensions.js';
import { getSettings } from '../../settings.js';
import { live, onLiveChanged, setWorldPaused } from '../board-live.js';
import { onTrackersChanged, notifyTrackersView } from '../trackers.js';
import { regenDeleteNow } from '../regen.js';
import { icon as I } from '../kit/icons.js';
import * as K from '../kit/kit.js';
import { worldOf, railSections, sectionTitle, openingSection, panelSide, normStore, pruneTo, freshPosts, markSeen } from './world-pure.js';
import { hookMessages, renderMessages, onMessagesClick, onMessagesKey, unreadMessages, deliverLetters, resetMessagesView, mainWriterLines, maybeTick, firePlans, continueThreads, fireAsks, onMessagesInput, nameOfKey } from './messages.js';
import { hookRumors, rumorTick, openRumorFrom } from './rumors.js';
import { hookFeed, renderChatter, renderNews, renderPeople, onFeedClick, onFeedKey, feedTick, resetFeedView, tagPeople, pulse } from './feed.js';
import { queueRunning } from '../cast-queue.js';
import { waitForIdle } from '../cast-voice.js';
import { tagQuery, tagMatches, runningStories } from './feed-pure.js';
import { REASON_WORDS } from './alive-pure.js';
import { worldDigest, worldNewsLine, normRumor, KIND_WORDS } from './rumor-pure.js';
import { setWorldSink } from '../mero.js';

const CSS = new URL('./world.css', import.meta.url).href;
const STORE_KEY = 'deeplore_world';
const RAIL_ICON = { feed: 'chatter', news: 'news', msgs: 'phone', people: 'people' };

// ── this chat's world ───────────────────────────────────────────────────────

/** The world settings of this chat's board, or null when the world layer is off here. */
export function worldHere() {
    try { return worldOf(live()?.board); } catch { return null; }
}

/** This chat's world store (read fresh each time: chat_metadata changes with the chat). */
export function worldStore() { return normStore(chat_metadata?.[STORE_KEY]); }
function saveStore(s) {
    if (!chat_metadata) return;
    if (!s.records.length && !chat_metadata[STORE_KEY]) return;   // nothing written yet → leave the chat's metadata alone
    chat_metadata[STORE_KEY] = s;
    saveMetadataDebounced();
}
/**
 * Which chat this is. Everything that waits (an AI call, a paced answer, an Undo on a notice) checks it before writing:
 * a chat opened meanwhile must never get the other chat's answer, knowledge or undo (bug hunt 2026-10-19).
 */
const chatNow = () => getContext()?.chatId ?? null;
/** `fn` for an Undo button: does nothing (says so) once another chat is open. */
function sameChat(fn) {
    const cid = chatNow();
    return (...a) => {
        if (chatNow() !== cid) { K.notify({ title: 'World', text: 'That happened in another chat: open that chat to undo it.', tone: 'warn' }); return undefined; }
        return fn(...a);
    };
}
const hooks = { store: worldStore, save: saveStore, render: () => render(), changed: () => changed(), chat: chatNow, here: sameChat };
hookMessages(hooks);
hookRumors(hooks);
hookFeed({ ...hooks, goto: sec => { section = sec; render(); } });
/** A tick for messages, then — with the same reason — for the feed (stage 4). */
async function tick(w, trigger, moment = null) {
    const reason = await maybeTick(w, trigger, moment);
    if (!reason) return;
    await feedTick(w, (REASON_WORDS[reason] || 'time has passed').replace('{{user}}', 'the player'));
    // stage 5: then the rumors — a reply (or a big moment in it) may start one from the scene; word of mouth goes on
    rumorTick(w, { scene: trigger === 'reply' || trigger === 'moment' });
}
const lastIndex = () => (getContext()?.chat?.length ?? 0) - 1;
/**
 * A delete, or a branch opening: keep only what belongs to the messages that are still there (going back in the story).
 * Swipes and regenerates of the main reply never touch the world (Miinthe, 2026-10-19: "cut the connection between the
 * world and regen and give [the world's] posts and whatnot their own regen") — each post, news item and message has its
 * own ↻ / ✎ / 🗑 instead.
 */
function prune() {
    const s = worldStore(), last = lastIndex();
    if (regenDeleteNow()) return;
    if (s.records.some(r => r.i > last)) saveStore(pruneTo(s, last));
}

/** Lines for the main writer's story block: what the main character knows from messages (index.js). */
export function worldWriterLines() {
    try {
        const w = worldHere(); if (!w) return [];
        const news = w.sections.news || w.sections.feed ? worldNewsLine(worldStore(), lastIndex(), w.sections.feed ? { heardBy: 'main', name: getContext()?.name2 || '' } : {}) : '';
        return [...mainWriterLines(), news].filter(Boolean);
    } catch { return []; }
}

/** How many messages are waiting for {{user}} (the bar's dot, the rail's dot, the opening section). */
export function unreadCount() { try { return worldHere() ? unreadMessages() : 0; } catch { return 0; } }
/** The globe's dots, in order: 'msg' (green), 'rumor' (orange), 'news' (blue) — what came in since she last looked. */
export function worldDots() {
    try {
        const w = worldHere(); if (!w) return [];
        const f = freshPosts(worldStore());
        return [unreadMessages() ? 'msg' : '', w.sections.feed && f.rumor ? 'rumor' : '', w.sections.news && f.news ? 'news' : ''].filter(Boolean);
    } catch { return []; }
}

// ── the panel ───────────────────────────────────────────────────────────────

let win = null, section = null, stackWatch = null, sideWatch = null;
export const worldOpen = () => !!win;
function changed() { window.dispatchEvent(new CustomEvent('dle-world')); }

const phone = () => !!document.getElementById('deeplore-panel')?.classList.contains('dle-mobile') || window.matchMedia?.('(max-width: 700px)').matches;
const drawerSide = () => (document.getElementById('deeplore-panel')?.classList.contains('dle-left') ? 'left' : getSettings().drawerSide === 'left' ? 'left' : 'right');

export function openWorld() {
    const w = worldHere();
    if (win || !w) return;
    if (!document.querySelector('link[data-dk="world"]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; l.dataset.dk = 'world'; document.head.append(l);
    }
    section = openingSection(w, { unread: unreadCount() });
    deliverLetters(w);
    firePlans(w);
    tick(w, 'open');   // catch up when opened (if the mix says so and enough happened since)
    win = document.createElement('section');
    win.className = 'dle-world dk';
    win.setAttribute('aria-label', 'World');
    win.innerHTML = '<div class="dle-wd-main"><div class="dle-wd-head"><h2><span class="g"></span><span class="t"></span></h2></div><div class="dle-wd-body"></div></div><nav class="dle-wd-rail" aria-label="World sections"></nav>';
    win.querySelector('.dle-wd-head').append(K.iconButton({ icon: 'close', title: 'Close', onClick: () => closeWorld() }));
    win.addEventListener('click', onClick);
    // @-tagging (Miinthe, 2026-10-19): typing @ in any writing box suggests the matching names
    win.addEventListener('input', e => { if (e.target.matches?.('[data-tagbox]')) tagSuggest(e.target); });
    win.addEventListener('change', e => onMessagesInput(e));   // Start a talk: who and to whom
    win.addEventListener('input', e => { if (e.target.matches?.('[data-talk-about]')) onMessagesInput(e); });
    win.addEventListener('focusout', e => { if (e.target.matches?.('[data-tagbox]')) setTimeout(() => { if (!win?.contains(document.activeElement) || !document.activeElement?.matches?.('[data-tagbox], .dle-wd-tagmenu button')) closeTags(); }, 150); });
    // the @-tag list by keyboard too (found live: Enter left "@Whis" half-typed): ↑↓ choose, Enter / Tab take it, Esc closes
    win.addEventListener('keydown', e => {
        const menu = tagBox && e.target === tagBox && win.querySelector('.dle-wd-tagmenu'); if (!menu) return;
        const opts = [...menu.querySelectorAll('[data-tagpick]')]; if (!opts.length) return;
        let k = Math.max(0, opts.findIndex(o => o.classList.contains('on')));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); k = (k + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, n) => o.classList.toggle('on', n === k)); }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pickTag(opts[k].dataset.tagpick); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeTags(); }
    }, true);
    win.addEventListener('keydown', e => { const b = win.querySelector('.dle-wd-body'); if (section === 'msgs') onMessagesKey(e, b, worldHere()); else onFeedKey(e, b, worldHere()); });
    // the same layer as My notes: over DeepLore's side panel, under SillyTavern's own panels while one is open
    (document.getElementById('top-settings-holder') || document.body).append(win);
    watch(); fit(); render();
    changed();
}

export function closeWorld() {
    if (!win) return;
    stackWatch?.disconnect(); stackWatch = null;
    sideWatch?.disconnect(); sideWatch = null;
    win.remove(); win = null;
    changed();
}
export function toggleWorld() { if (win) closeWorld(); else openWorld(); }

function render() {
    if (!win) return;
    const w = worldHere();
    if (!w) { closeWorld(); return; }
    const shown = railSections(w);
    if (!shown.includes(section)) section = shown[0];
    const head = win.querySelector('.dle-wd-head');
    head.querySelector('.g').innerHTML = I(section === 'msgs' && w.look === 'letters' ? 'mail' : RAIL_ICON[section]);
    head.querySelector('.t').textContent = sectionTitle(section, w.look);
    // looking at News or Chatter: what is there counts as seen (the globe's dots)
    const seen = (section === 'news' || section === 'feed') ? markSeen(worldStore(), section) : null;
    if (seen) { saveStore(seen); setTimeout(changed, 0); }
    const dots = worldDots();
    const rail = win.querySelector('.dle-wd-rail');
    const railHtml = shown.map(k => {
        const ic = k === 'msgs' && w.look === 'letters' ? 'mail' : RAIL_ICON[k], t = sectionTitle(k, w.look);
        const dot = k === 'msgs' && unreadCount() ? '<span class="rdot"></span>' : k === 'feed' && dots.includes('rumor') ? '<span class="rdot rumor"></span>' : k === 'news' && dots.includes('news') ? '<span class="rdot news"></span>' : '';
        return `<button type="button" class="ri" data-sec="${k}" aria-pressed="${k === section}" title="${t}" aria-label="${t}">${I(ic)}${dot}</button>`;
    }).join('') + '<span class="sp"></span>' + `<button type="button" class="ri" data-wpause aria-pressed="${!!w.paused}" title="${w.paused ? 'Paused: nothing new comes in. Wake the world' : 'Pause the world'}" aria-label="${w.paused ? 'Wake the world' : 'Pause the world'}">${I(w.paused ? 'play' : 'pause')}</button>` + '<button type="button" class="ri" data-board title="World settings (the board\'s World tab)" aria-label="World settings">' + I('settings') + '</button>';
    if (rail.innerHTML !== railHtml) rail.innerHTML = railHtml;
    const body = win.querySelector('.dle-wd-body');
    // a redraw while typing (the world posting in the background) keeps the box, its text, cursor and the @ list (Miinthe's tags test)
    // an edit in progress (a message, a post, a comment) survives the redraw too, focused or not (bug hunt 2026-10-19)
    // (only into the same box: same message / post, same original text — another Edit opened meanwhile starts fresh)
    const boxKey = el => `${el.closest('[data-mid]')?.dataset.mid || el.closest('[data-post-id]')?.dataset.postId || el.closest('[data-art]')?.dataset.art || ''}|${el.defaultValue}`;
    const edits = ['[data-edit-ta]', '[data-pe-text]', '[data-pe-title]', '[data-cedit]'].map(q => { const el = body.querySelector(q); return el ? [q, el.value, boxKey(el)] : null; }).filter(Boolean);
    // the post being read stays where it is when something new comes in above it (Miinthe, F6: "the feed jumps down")
    const anchor = (section === 'feed' || section === 'news') && body.scrollTop > 0 ? (() => {
        const top = body.getBoundingClientRect().top;
        const el = [...body.querySelectorAll('[data-post-id], [data-art]')].find(x => x.getBoundingClientRect().bottom > top);
        return el ? { sel: el.dataset.postId ? `[data-post-id="${window.CSS.escape(el.dataset.postId)}"]` : `[data-art="${window.CSS.escape(el.dataset.art)}"]`, off: el.getBoundingClientRect().top - top, sec: section } : null;
    })() : null;
    const ae = document.activeElement, keepSel = ae && body.contains(ae) && ae.matches?.('[data-post-ta], [data-cin], [data-cmp], [data-seed], [data-news-idea], [data-meet-in]')
        ? { sel: ae.matches('[data-cin]') ? `[data-cin="${ae.dataset.cin}"]` : ['data-post-ta', 'data-cmp', 'data-seed', 'data-news-idea', 'data-meet-in'].map(a => `[${a}]`).find(q => ae.matches(q)), value: ae.value, a: ae.selectionStart, b: ae.selectionEnd, tags: tagBox === ae } : null;
    if (section === 'msgs') {
        // keep what is being typed when the panel redraws (an answer arriving, a dot changing)
        const ta = body.querySelector('[data-cmp]'), typed = ta?.value || '', had = !!ta, focus = ta && document.activeElement === ta;
        renderMessages(body, w);
        const ta2 = body.querySelector('[data-cmp]');
        if (had && ta2 && typed) ta2.value = typed;
        if (focus && ta2) ta2.focus();
    } else if (section === 'feed') { const ta = body.querySelector('[data-post-ta]'), typed = ta?.value || ''; renderChatter(body, w); if (typed) { const t2 = body.querySelector('[data-post-ta]'); if (t2) t2.value = typed; } }
    else if (section === 'news') renderNews(body, w);
    else if (section === 'people') renderPeople(body, w);
    else body.innerHTML = emptyState(section, w);
    body.classList.toggle('msgs', section === 'msgs');
    for (const [q, v, k] of edits) { const el = body.querySelector(q); if (el && boxKey(el) === k && el.value !== v) el.value = v; }
    if (anchor && anchor.sec === section) { const el = body.querySelector(anchor.sel); if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - anchor.off; }
    if (keepSel?.sel) {
        const el = body.querySelector(keepSel.sel);
        if (el) { if (el.value !== keepSel.value) el.value = keepSel.value; el.focus(); try { el.setSelectionRange(keepSel.a, keepSel.b); } catch { /* noop */ } if (keepSel.tags) tagBox = el; }
    }
}

/** Stage 0: every section says plainly what is coming, in the story's look. */
function emptyState(k, w) {
    const letters = w.look === 'letters';
    const text = {
        feed: [letters ? 'Nothing pinned to the board yet.' : 'No chatter yet.', 'Posts, comments and rumors from the people of this story will show up here once the world is running.'],
        news: ['No news yet.', `${letters ? 'The Gazette' : 'The news'} will report on the world here: ordinary life, and stories that run over several days.`],
        msgs: [letters ? 'No letters yet.' : 'No messages yet.', `${letters ? 'Letters' : 'Messages'} to and from the people of this story come next, in the first stage of the build.`],
        people: ['The people of this story.', 'The Cast, the story\'s own voices and the regulars will be listed here, with how much each gossips, writes and posts.'],
    }[k];
    return `<div class="dle-wd-empty"><b>${text[0]}</b><span>${text[1]}</span></div>`;
}

let tagBox = null;
function closeTags() { win?.querySelector('.dle-wd-tagmenu')?.remove(); tagBox = null; }
function tagSuggest(el) {
    const w = worldHere(); if (!w) return;
    const at = el.selectionStart ?? el.value.length, tq = tagQuery(el.value.slice(0, at));
    const list = tq ? tagMatches(tq.q, tagPeople(w)) : [];
    if (!list.length) { closeTags(); return; }
    let menu = win.querySelector('.dle-wd-tagmenu');
    if (!menu) { menu = document.createElement('div'); menu.className = 'dle-wd-tagmenu'; menu.setAttribute('role', 'listbox'); win.append(menu); }
    tagBox = el;
    menu.innerHTML = list.map((p, n) => `<button type="button" role="option" class="${n ? '' : 'on'}" data-tagpick="${p.name.replace(/"/g, '&quot;')}">@${p.name.replace(/</g, '&lt;')}</button>`).join('');
    const r = el.getBoundingClientRect(), wr = win.getBoundingClientRect();
    menu.style.left = Math.max(6, r.left - wr.left) + 'px';
    menu.style.top = Math.max(6, r.top - wr.top - menu.offsetHeight - 4) + 'px';
}
function pickTag(name) {
    const el = tagBox; if (!el) return;
    const at = el.selectionStart ?? el.value.length, tq = tagQuery(el.value.slice(0, at)); if (!tq) return;
    el.value = el.value.slice(0, tq.from) + '@' + name + ' ' + el.value.slice(at);
    const c = tq.from + name.length + 2; el.focus(); el.setSelectionRange(c, c);
    closeTags();
}

function onClick(e) {
    const tp = e.target.closest('[data-tagpick]'); if (tp) { pickTag(tp.dataset.tagpick); return; }
    const r = e.target.closest('[data-sec]');
    if (r) { if (section === r.dataset.sec && section === 'msgs') resetMessagesView(); section = r.dataset.sec; render(); return; }
    if (section === 'msgs' && e.target.closest('.dle-wd-body') && onMessagesClick(e, win.querySelector('.dle-wd-body'), worldHere())) return;
    if (section !== 'msgs' && e.target.closest('.dle-wd-body') && onFeedClick(e, win.querySelector('.dle-wd-body'), worldHere(), section)) return;
    if (e.target.closest('[data-wpause]')) {
        const w = worldHere();
        if (w && setWorldPaused(!w.paused)) { K.notify({ title: 'World', text: w.paused ? 'The world is awake again.' : 'The world is paused: nothing new comes in until you wake it.' }); notifyTrackersView(); }
        return;
    }
    if (e.target.closest('[data-board]')) {
        import('../board-window.js').then(m => m.openBoardWindow({ view: 'world' })).catch(err => console.warn('[DLE] world: board window', err));
    }
}

// ── where it sits ───────────────────────────────────────────────────────────

function stack() {
    if (!win) return;
    const st = win.parentElement?.querySelector('.drawer-content.openDrawer:not(#deeplore-panel)');
    win.style.zIndex = st ? '999' : '1001';   // SillyTavern's panels and DeepLore's side panel are 1000
}
function watch() {
    const h = win.parentElement;
    stack();
    if (h && h !== document.body) {
        stackWatch = new MutationObserver(stack);
        stackWatch.observe(h, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
    // DeepLore's side panel moved left or right → the world panel takes the other side
    const p = document.getElementById('deeplore-panel');
    if (p) { sideWatch = new MutationObserver(fit); sideWatch.observe(p, { attributes: true, attributeFilter: ['class'] }); }
}
/** The side opposite DeepLore's panel; PC: ends just above the message box, phone: the whole screen under the top bar. */
function fit() {
    if (!win) return;
    const ph = phone();
    win.classList.toggle('phone', ph);
    win.classList.toggle('left', panelSide(drawerSide()) === 'left');
    win.classList.toggle('right', panelSide(drawerSide()) === 'right');
    // room beside the chat (SillyTavern's chat column, #sheld) → docked like DeepLore's side panel; else a floating card
    const sh = document.getElementById('sheld')?.getBoundingClientRect();
    const room = sh ? (panelSide(drawerSide()) === 'left' ? sh.left : window.innerWidth - sh.right) : 0;
    const docked = !ph && room >= 300;
    win.classList.toggle('docked', docked);
    const f = document.getElementById('send_form');
    win.style.bottom = !ph && !docked && f ? `${Math.max(12, window.innerHeight - f.getBoundingClientRect().top + 8)}px` : '';
}
window.addEventListener('resize', () => fit());

// ── wiring ──────────────────────────────────────────────────────────────────

/** Wire once (index.js init). */
/**
 * For Mero (Miinthe, 2026-10-19): a short summary of this chat's world, and what her 📎 picker offers — posts, news, rumors
 * (with what's behind them) and conversations. Nothing while the world layer is off here.
 */
function worldForMero() {
    const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
    const slug = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'x';
    const items = () => {
        if (!worldHere()) return [];
        const recs = worldStore().records;
        const posts = recs.filter(r => r.kind === 'post').sort((a, b) => b.n - a.n).map(p => {
            const r = p.rumor ? normRumor(p.rumor) : null, what = r ? 'Rumor' : p.news ? 'News' : 'Post';
            return { group: 'World', tagGroup: r ? 'Rumors' : p.news ? 'News' : 'Posts', tag: `${r ? 'rumor' : p.news ? 'news' : 'post'}-${p.n}`, id: 'p:' + p.id, label: `${what} by ${nameOfKey(p.by)}: ${clip(p.title || p.text, 60)}`,
                text: `${nameOfKey(p.by)}${p.title ? ` — ${p.title}` : ''}: ${p.text}${r ? `\n(${KIND_WORDS[r.kind]}${r.truth ? ': ' + r.truth : ''}${r.who ? `; really posted by ${nameOfKey(r.who)}` : ''}; heard by ${r.heard.map(nameOfKey).join(', ') || 'nobody yet'})` : ''}${(p.comments || []).length ? '\nComments:\n' + p.comments.map(c => `- ${nameOfKey(c.by)}: ${c.text}`).join('\n') : ''}` };
        });
        const convs = new Map();
        for (const m of recs.filter(r => r.kind === 'msg').sort((a, b) => a.n - b.n)) convs.set(m.conv, [...(convs.get(m.conv) || []), m]);
        const talks = [...convs.entries()].map(([conv, ms]) => {
            // a group chat: by its name
            const g = ms[0]?.group ? recs.find(r => r.kind === 'group' && r.id === ms[0].group) : null;
            if (ms[0]?.group) return { group: 'World', tagGroup: 'World messages', tag: `group-${slug(g?.name || 'group')}`, id: 'c:' + conv, label: `Group: ${g?.name || 'a group'}${g ? ` (${g.members.map(nameOfKey).join(', ')})` : ''}`, text: ms.slice(-14).map(m => `${nameOfKey(m.from)}: ${Array.isArray(m.alts) ? m.alts[m.s || 0] : m.text}`).join('\n') };
            const [a, b] = String(conv).split('|'); return { group: 'World', tagGroup: 'World messages', tag: `messages-${slug(nameOfKey(a))}-${slug(nameOfKey(b))}`, id: 'c:' + conv, label: `Messages: ${nameOfKey(a)} ↔ ${nameOfKey(b)}`, text: ms.slice(-14).map(m => `${nameOfKey(m.from)}: ${Array.isArray(m.alts) ? m.alts[m.s || 0] : m.text}`).join('\n') }; });
        return [...posts, ...talks];
    };
    const byId = id => items().find(x => x.id === id) || null;
    window.__dleWorldItem = byId;   // "Ask Mero about this" on a post or a conversation (feed.js, messages.js)
    return {
        digest: () => (worldHere() ? worldDigest(worldStore(), nameOfKey, { stories: runningStories(worldStore()) }) : ''),
        items,
        /** 📎 picking (Miinthe, 2026-10-19: "click add context and then click the actual thing"): what in the world panel was clicked. */
        pick: el => {
            if (!worldHere() || !el?.closest?.('.dle-world')) return null;
            const post = el.closest('[data-post-id]') || el.closest('[data-art]');
            if (post) return byId('p:' + (post.dataset.postId || post.dataset.art));
            const peek = el.closest('[data-peek]'); if (peek) return byId('c:' + peek.dataset.peek);
            const bub = el.closest('.bw')?.querySelector('[data-mid]') || el.closest('[data-mid]') || (el.closest('.dle-wd-cvh') && el.closest('.dle-world')?.querySelector('.dle-wd-thread [data-mid]'));
            if (bub) { const m = worldStore().records.find(r => r.kind === 'msg' && r.id === bub.dataset.mid); return m ? byId('c:' + m.conv) : null; }
            return null;
        },
    };
}

/**
 * Once the story has moved (a reply, or a whole Cast round): the world's own follow-ups, one after the other — a thread
 * between others answered, 0–4 small moves, the rumor account's check with a witness. They wait until nothing is being
 * written in the main chat, so with a local model they never slow her own replies down.
 */
let replyTimer = null;
function afterReply() {
    clearTimeout(replyTimer);
    replyTimer = setTimeout(async () => {
        const cid = chatNow();
        for (let k = 0; k < 40 && (queueRunning() || !(await waitForIdle(3000))); k++) await new Promise(r => setTimeout(r, 3000));
        if (chatNow() !== cid) return;
        const w = worldHere(); if (!w) return;
        try { await continueThreads(w); await pulse(w); await fireAsks(w); } catch (err) { console.warn('[DLE] world: after the reply', err?.message || err); }
    }, 4000);
}

export function initWorld() {
    setWorldSink(worldForMero());
    // the reply menu's "Start a rumor from this…" (reply-menu.js asks through these, no import loop)
    window.__dleWorldRumorsOn = () => !!worldHere()?.sections?.feed;
    window.__dleWorldRumorFrom = n => { const w = worldHere(); if (w) openRumorFrom(n, w); };
    // the board saved (someone unmuted): what waited for them is answered now
    const refresh = () => { const w = worldHere(); if (w) deliverLetters(w); if (win) { fit(); render(); } changed(); };
    onTrackersChanged(refresh);   // the board was saved: switched on or off, look, sections
    // a step, a place or someone's presence set by hand (or by the helper): planned messages may be due now
    let planTimer = null;
    onLiveChanged(() => { clearTimeout(planTimer); planTimer = setTimeout(() => firePlans(worldHere()), 800); });
    // the story helper read the newest messages as a big or a quiet moment (autotrack.js, only when the mix wants it)
    window.addEventListener('dle-world-moment', e => { const w = worldHere(); if (w) tick(w, 'moment', e.detail?.moment); });
    try {
        eventSource.on(event_types.CHAT_CHANGED, () => { prune(); resetMessagesView(); resetFeedView(); setTimeout(() => { const w = worldHere(); deliverLetters(w); firePlans(w); refresh(); }, 300); });
        // the story moved on (a new reply; maybe a new story day): letters arrive and get answered
        eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(() => { const w = worldHere(); if (w) { deliverLetters(w); firePlans(w); tick(w, 'reply'); refresh(); afterReply(); } }, 1500));
        eventSource.on(event_types.MESSAGE_DELETED, prune);
    } catch { /* noop */ }
}
