/**
 * World layer, stage 4 — Chatter, News and People in the world panel (Miinthe, 2026-10-19; mock-up v5, design §2c–2f).
 *
 * Chatter: the feed — posts from the Cast, the main character, the story's voices and regulars; likes ("Kettle, Spoon and
 * 23 others like this"), comments; filters All · News · The Cast; {{user}} (or whoever she writes as) posts, likes,
 * comments, and someone usually answers. News: articles (posts with a title) and the world stories they tell, phase by
 * phase over story days; she can start one ("twenty sheep stolen overnight"). People: everyone, with their dials,
 * interests, quirks, muted — edited on the board's World tab (one home).
 *
 * The feed moves with the "how alive" mix (world.js → feedTick, one call per tick); muted people never post.
 */
import { getContext } from '../../../../../extensions.js';
import { resolveConnectionConfig } from '../../settings.js';
import { callAI } from '../ai/ai.js';
import { live } from '../board-live.js';
import { icon as I } from '../kit/icons.js';
import * as K from '../kit/kit.js';
import { addRecord, neverTalk } from './world-pure.js';
import { USER, MAIN, peopleOf, storyClock, stampText, newMessage } from './messages-pure.js';
import { personNow } from '../cast-pure.js';
import {
    posters, postsOf, commentCount, newPost, updatePost, toggleLike, addComment, addPostVersion, showPostVersion, editPost, removePost, mergeTaught, discretion, editComment, removeComment, likesLine, feedView, runningStories, storiesOf, normStory,
    feedPrompt, parseFeed, FEED_SCHEMA, newsPrompt, parseNews, NEWS_SCHEMA, richText, mentionsIn, reactPrompt, parseReact, REACT_SCHEMA, storyPrompt, parseStory, STORY_SCHEMA, storyToTell, tellsStory, relevantOld, pulsePrompt, parsePulse, PULSE_SCHEMA,
} from './feed-pure.js';
import { RUMOR, NEWS, normRumor, KIND_WORDS, newsAccount, rumorName, accountCard } from './rumor-pure.js';
import { tellQuoted, ungive, regive } from './rumors.js';
import { groupsForPulse } from './groups.js';
import { askComment, asRowHtml, handleAsClick, currentMe, nameOfKey as nameOf, avatarOf as avatar, roleOfKey as roleOf, mainInfo, cardText, charText, writeAgain } from './messages.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lastI = () => (getContext()?.chat?.length ?? 0) - 1;
const clockNow = () => { const L = live(); return L ? storyClock(L.board, L.state) : null; };
const stampNow = () => { const c = clockNow(); return c ? { day: c.day, part: c.part || '' } : { msg: Math.max(0, lastI()) }; };

let H = null;
export function hookFeed(h) { H = h; }
const peeked = new Set(), behind = new Set();   // stage 5: 👁 who posted · ◌ what's behind it (open, per post, this session)
let editingPost = null, editingC = null, rewriting = new Set();   // ✎ a post (its id) / a comment ({ post, c }); ↻ running
let filter = 'all', commenting = null, artOpen = null, reacting = new Set(), feedBusy = false, startOpen = false, newsOpen = false, writingNews = false;

/** Everyone who can post, as the feed's calls need them. */
export function everyone(w) {
    const L = live(); if (!L) return [];
    const m = mainInfo();
    const cast = peopleOf(L.board, L.state).map(x => ({ key: x.key, name: x.p.name, about: cardText(x.p) }));
    const all = posters({ main: m ? { name: m.name, about: charText(m.ch, m.name) } : null, cast, voices: w.voices, people: w.people, userName: nameOf(USER) });
    // no newspaper voice on the board: the story's news account reports (rumor-pure.js newsAccount)
    return all.some(p => p.kind === 'voice') ? all : [...all, newsAccount(w)];
}
/** A person's discretion line for a prompt (who they never gossip about, "gossips: never"), '' when none. */
export function discretionOf(w, key) { try { return discretion(everyone(w).find(p => p.key === key)); } catch { return ''; } }
/** Everyone's discretion line at once (key → line) — for a round that asks about several people. */
export function discretionMap(w) {
    const m = new Map();
    try { for (const p of everyone(w)) { const d = discretion(p); if (d) m.set(p.key, d); } } catch { /* no board */ }
    return m;
}
// the news and rumor accounts are voices, not characters (Miinthe, E7: "news and story people are the same"); the chip and the
// People heading say "Characters" (Miinthe, 2026-11-02: "what does 'story people' even mean?")
const kindOf = (w, key) => (key === USER ? 'user' : key === MAIN ? 'main' : String(key).startsWith('v:') || key === RUMOR || key === NEWS ? 'voice' : 'cast');

// ── Chatter ─────────────────────────────────────────────────────────────────

export function renderChatter(body, w) {
    const letters = w.look === 'letters', me = currentMe();
    const list = feedView(H.store(), filter, k => kindOf(w, k));
    let h = asRowHtml() + `<div class="dle-wd-feed"><div class="dle-wd-fchips">${[['all', 'All'], ['news', 'News'], ['rumor', '◌ Rumors'], ['cast', 'Posts']].map(([v, l]) => `<button type="button" class="dk-chip${filter === v ? ' on' : ''}" data-ff="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}</div>`;
    h += `<div class="dle-wd-postbox"><button type="button" class="dk-ib" data-photo title="Attach a photo (described)" aria-label="Attach a photo">📷</button><textarea class="dk-field" rows="1" data-post-ta data-tagbox placeholder="${letters ? 'Pin a note to the board as' : 'Post as'} ${esc(nameOf(me))}…" aria-label="New post"></textarea><button type="button" class="dk-btn dk-primary" data-post>${letters ? 'Pin it' : 'Post'}</button></div>`;
    if (feedBusy) h += '<div class="dle-wd-hint">The world is posting…</div>';
    if (!list.length) h += `<div class="dle-wd-empty"><b>${letters ? 'Nothing pinned to the board yet.' : 'No chatter yet.'}</b><span>Posts come as the story moves (your "how alive" mix on the board). Post something yourself, and someone may answer.</span></div>`;
    for (const p of list) h += postHtml(p, w, letters, me);
    body.innerHTML = h + '</div>';
    body.classList.toggle('letters', letters);
    if (commenting) body.querySelector(`[data-cin="${commenting}"]`)?.focus();
}
/** Everyone who can be @-tagged (and whose @Name is highlighted). */
/** The rumor account as someone who can be tagged and answer in the comments (Miinthe, 2026-10-19: "the whispers cannot be mentioned with at"). */
const rumorPerson = w => ({ key: RUMOR, name: rumorName(w), kind: 'voice', about: accountCard(rumorName(w), w.look), quirks: '', g: 3, m: 3, p: 3, interests: ['anything juicy'], muted: false });
export const tagPeople = w => [...everyone(w), ...(w.sections.feed ? [rumorPerson(w)] : [])].map(p => ({ key: p.key, name: p.name }));
function postHtml(p, w, letters, me) {
    const st = p.story ? normStory(storiesOf(H.store()).find(s => s.id === p.story)) : null;
    const liked = (p.likes || []).includes(me), ed = editingPost === p.id, nv = (p.alts || []).length;
    return `<article class="dle-wd-post${p.news ? ' news' : ''}" data-post-id="${esc(p.id)}">${avatar(p.by)}
      <div class="ph"><b>${esc(nameOf(p.by))}</b><small>${esc([roleOf(p.by), p.stamp ? stampText(p.stamp) : ''].filter(Boolean).join(' · '))}</small>${rumorHead(p)}<button type="button" class="pmore" data-pmore="${esc(p.id)}" title="Write again, edit, delete, ask Mero" aria-label="More">${I('more')}</button>${st ? `<button type="button" class="stag" data-story-open="${esc(p.id)}">${esc(st.title)}</button>` : ''}</div>
      ${ed ? editBox(p) : `${p.news && p.title ? `<div class="pt">${esc(p.title)}</div>` : ''}<div class="px">${richText(p.text, tagPeople(w))}</div>`}
      <div class="pf"><button type="button" class="${liked ? 'on' : ''}" data-like="${esc(p.id)}" aria-pressed="${liked}">${I('heart')}${letters ? 'Nod' : 'Like'}</button><button type="button" data-cm="${esc(p.id)}">${I('talks')}Comment${p.comments?.length ? ` (${p.comments.length})` : ''}</button>${p.rumor ? `<button type="button" class="${behind.has(p.id) ? 'on' : ''}" data-behind="${esc(p.id)}" aria-expanded="${behind.has(p.id)}">◌ What's behind it?</button>` : ''}${reacting.has(p.id) || rewriting.has(p.id) ? `<span class="dots" aria-label="${rewriting.has(p.id) ? 'writing it again' : 'someone is answering'}"><i></i><i></i><i></i></span>` : ''}${nv > 1 ? `<span class="pv"><button type="button" data-pv="-1" data-pid="${esc(p.id)}" title="Previous version" aria-label="Previous version">${I('left')}</button>${(p.s || 0) + 1}/${nv}<button type="button" data-pv="1" data-pid="${esc(p.id)}" title="Next version" aria-label="Next version">${I('right')}</button></span>` : ''}</div>
      ${p.rumor && behind.has(p.id) ? rumorInfo(p) : ''}
      ${likesLine(p, nameOf, letters) ? `<div class="likes">${esc(likesLine(p, nameOf, letters))}</div>` : ''}
      ${p.comments?.length || commenting === p.id ? `<div class="cmts">${(p.comments || []).map(c => (editingC?.post === p.id && editingC.c === c.id ? `<div class="cmt cin cedit"><textarea class="dk-field" data-cedit rows="${Math.min(8, Math.max(2, Math.ceil(String(c.text).length / 45)))}" aria-label="Edit the comment">${esc(c.text)}</textarea><div class="pe-btns"><button type="button" class="dk-btn dk-primary" data-csave>Save</button><button type="button" class="dk-btn" data-cx>Cancel</button></div></div>` : `<div class="cmt"><b>${esc(nameOf(c.by))}</b> ${richText(c.text, tagPeople(w))}<button type="button" class="cmore" data-cmore="${esc(c.id)}" data-pid="${esc(p.id)}" title="Edit, delete" aria-label="Comment options">${I('more')}</button></div>`)).join('')}${commenting === p.id ? `<div class="cin"><input class="dk-field" data-tagbox data-cin="${esc(p.id)}" placeholder="Comment as ${esc(nameOf(me))}…" aria-label="Comment"><button type="button" class="dk-btn" data-csend="${esc(p.id)}">Send</button></div>` : ''}</div>` : ''}
    </article>`;
}

/** A rumor's header: the ◌ tag, and 👁 who posted (through the account) — only she sees it; the poster knows anyway. */
function rumorHead(p) {
    if (!p.rumor) return '';
    const r = normRumor(p.rumor), hid = p.by === RUMOR && r.who;
    return '<span class="rtag" title="A rumor going around">◌ Rumor</span>' + (hid ? `<button type="button" class="peek${peeked.has(p.id) ? ' on' : ''}" data-peekpost="${esc(p.id)}" title="Who posted this? Only you see it; the poster knows anyway">👁 ${peeked.has(p.id) ? 'Posted by ' + esc(nameOf(r.who)) : 'Who posted?'}</button>` : '');
}
/** ◌ What's behind it: true / twisted / made up, where it started, who heard it so far, how it changed when retold. */
function rumorInfo(p) {
    const r = normRumor(p.rumor);
    return `<div class="rinfo"><b>${esc(KIND_WORDS[r.kind])}${r.truth ? ':' : ''}</b> ${esc(r.truth)}${r.from ? `<br>Started from: ${esc(r.from)}.` : ''}<br>Heard it so far: ${r.heard.length ? esc(r.heard.map(nameOf).join(', ')) : 'nobody yet'}.${r.drift.length ? `<br>How it changed: ${r.drift.map(d => `${esc(nameOf(d.by))} told it as "${esc(d.text)}"`).join(' · ')}` : ''}</div>`;
}

/** ✎ in place: the headline (news) and the text, keeping every line break. */
const editBox = p => `<div class="pedit">${p.news ? `<input class="dk-field" data-pe-title value="${esc(p.title || '')}" aria-label="Headline">` : ''}<textarea class="dk-field" data-pe-text rows="${Math.min(14, Math.max(3, String(p.text).split('\n').length + 1))}" aria-label="Edit the post">${esc(p.text)}</textarea><div class="pe-btns"><button type="button" class="dk-btn dk-primary" data-pe-save="${esc(p.id)}">Save</button><button type="button" class="dk-btn" data-pe-x>Cancel</button></div></div>`;

// ── News ────────────────────────────────────────────────────────────────────

export function renderNews(body, w) {
    const letters = w.look === 'letters';
    // news: articles, and every post that tells a world story (a story told only in chatter still shows here)
    const news = postsOf(H.store()).filter(p => p.news || p.story).sort((a, b) => b.n - a.n);
    if (artOpen) {
        const a = news.find(p => p.id === artOpen) || postsOf(H.store()).find(p => p.id === artOpen);
        if (a) {
            const st = a.story ? normStory(storiesOf(H.store()).find(s => s.id === a.story)) : null;
            body.innerHTML = `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-art-back title="All news" aria-label="All news">${I('back')}</button>${avatar(a.by)}<span class="who"><b>${esc(nameOf(a.by))}</b><small>${a.stamp ? esc(stampText(a.stamp)) : ''}${(a.alts || []).length > 1 ? ` · version ${(a.s || 0) + 1}/${a.alts.length} <button type="button" class="vbtn" data-pv="-1" data-pid="${esc(a.id)}" aria-label="Previous version">‹</button><button type="button" class="vbtn" data-pv="1" data-pid="${esc(a.id)}" aria-label="Next version">›</button>` : ''}</small></span>${rewriting.has(a.id) ? '<span class="dots" aria-label="writing it again"><i></i><i></i><i></i></span>' : ''}<button type="button" class="dk-ib" data-pmore="${esc(a.id)}" title="Write again, edit, delete" aria-label="More">${I('more')}</button></div>
              <div class="dle-wd-art${letters ? ' letters' : ''}">${editingPost === a.id ? editBox(a) : `<h3>${esc(a.title || nameOf(a.by))}</h3><div class="ab">${esc(a.text).replace(/\n/g, '<br>')}</div>`}
              ${st ? `<div class="devs"><span class="dk-label">A world story: ${esc(st.title)}</span>${st.phases.map((ph, k) => (k < st.at ? `<div class="dev"><span>${k + 1}</span><div>${esc(ph)}</div></div>` : '')).join('')}${st.done ? '<div class="dev next"><span>✓</span><div>The story is told.</div></div>' : '<div class="dev next"><span>…</span><div>More to come as story time passes.</div></div>'}${st.done ? '' : `<button type="button" class="dk-btn" data-story-end="${esc(st.id)}">End this story</button>`}</div>` : ''}</div>`;
            return;
        }
        artOpen = null;
    }
    let h = (letters ? '<div class="dle-wd-masthead">The Gazette</div>' : '') + `<div class="dle-wd-news">`;
    h += startOpen ? `<div class="dle-wd-start"><input class="dk-field" data-seed placeholder="Something that happens in town, e.g. twenty sheep stolen overnight" aria-label="A world story"><button type="button" class="dk-btn dk-primary" data-start-go>Start</button><button type="button" class="dk-btn" data-start-x>Cancel</button></div>`
        : newsOpen ? `<div class="dle-wd-start"><input class="dk-field" data-news-idea placeholder="Your idea — or leave it empty and be surprised. Add a statement if you like: ${esc(nameOf(USER))} says: …" aria-label="News idea"><button type="button" class="dk-btn dk-primary" data-news-go>Write it</button><button type="button" class="dk-btn" data-news-x>Cancel</button></div>`
        : '<div class="dle-wd-newsbtns"><button type="button" class="dle-wd-addstory" data-news>✍️ Write news</button><button type="button" class="dle-wd-addstory" data-start>+ Start a world story</button></div>';
    if (writingNews) h += '<div class="dle-wd-hint">Writing the news…</div>';
    const running = runningStories(H.store());
    if (running.length) h += `<div class="dle-wd-hint">Running: ${running.map(s => esc(s.title)).join(' · ')}</div>`;
    if (!news.length) h += `<div class="dle-wd-empty"><b>No news yet.</b><span>${letters ? 'The Gazette' : 'The news'} reports as the story moves: ordinary life, and world stories over several days. A story voice (a newspaper) on the board writes most of it.</span></div>`;
    for (const a of news) {
        const st = a.story ? normStory(storiesOf(H.store()).find(s => s.id === a.story)) : null;
        h += `<button type="button" class="dle-wd-art-row" data-art="${esc(a.id)}"><span class="hl">${esc(a.title || a.text.slice(0, 80))}</span><small>${esc(nameOf(a.by))}${a.stamp ? ' · ' + esc(stampText(a.stamp)) : ''}${st ? ` · <span class="stag">${esc(st.title)}</span>` : ''}</small><span class="pv">${esc(a.text.slice(0, 160))}</span></button>`;
    }
    body.innerHTML = h + '</div>';
    body.querySelector('[data-seed], [data-news-idea]')?.focus();
}

// ── People ──────────────────────────────────────────────────────────────────

const dots = n => (n === 0 ? 'never' : '●●●'.slice(0, n) + `<span class="off">${'●●●'.slice(0, 3 - n)}</span>`);
export function renderPeople(body, w) {
    const ppl = everyone(w);
    const grp = (title, list) => (list.length ? `<div class="dle-wd-lgh">${title}</div>` + list.map(p => `<div class="dle-wd-prow">${avatar(p.key)}<b>${esc(p.name)}${p.muted ? ' <span title="Muted">🔇</span>' : ''}</b>
      <small class="hab"><span>Gossips ${dots(p.g)}</span> · <span>Messages ${dots(p.m)}</span> · <span>Posts ${dots(p.p)}</span></small>
      <small class="ab">${esc([p.interests.join(' · '), p.quirks].filter(Boolean).join(' — ') || p.about || '')}</small></div>`).join('') : '');
    // order (Miinthe, 2026-10-26: "'regulars' are in an awkward place"): the story's people, then the regulars (people of the place),
    // then the voices and accounts — the rumor account under its own heading, not passing for a story voice
    body.innerHTML = `<div class="dle-wd-ppl">${grp('Characters', ppl.filter(p => p.kind === 'main' || p.kind === 'cast'))}${grp('Regulars', ppl.filter(p => p.kind === 'regular'))}${grp('Story voices', ppl.filter(p => p.kind === 'voice'))}${w.sections.feed ? `<div class="dle-wd-lgh">Rumor account</div><div class="dle-wd-prow">${avatar(RUMOR)}<b>${esc(nameOf(RUMOR))}</b><small class="ab">The story's rumor account: anyone can post or send a tip without a name. Its name is set on the board.</small></div>` : ''}
      <div class="dle-wd-hint">Passers-by stay nameless: they make the numbers ("and 23 others like this").</div>
      <button type="button" class="dk-btn" data-board-people>Edit people on the board</button></div>`;
}

// ── acting ──────────────────────────────────────────────────────────────────

export function onFeedClick(e, body, w) {
    if (handleAsClick(e)) return true;
    const q = s => e.target.closest(s);
    if (q('[data-ff]')) { filter = q('[data-ff]').dataset.ff; H.render(); return true; }
    if (q('[data-post]')) { post(body, w); return true; }
    if (q('[data-photo]')) { const ta = body.querySelector('[data-post-ta]'); if (ta) insertPhoto(ta); return true; }
    if (q('[data-like]')) { const id = q('[data-like]').dataset.like; H.save(updatePost(H.store(), id, p => toggleLike(p, currentMe()))); H.render(); return true; }
    if (q('[data-cm]')) { const id = q('[data-cm]').dataset.cm; commenting = commenting === id ? null : id; H.render(); return true; }
    if (q('[data-csend]')) { comment(body, w, q('[data-csend]').dataset.csend); return true; }
    if (q('[data-story-open]')) { artOpen = q('[data-story-open]').dataset.storyOpen; H.goto('news'); return true; }
    if (q('[data-art]')) { artOpen = q('[data-art]').dataset.art; H.render(); return true; }
    if (q('[data-art-back]')) { artOpen = null; H.render(); return true; }
    if (q('[data-start]')) { startOpen = true; newsOpen = false; H.render(); return true; }
    if (q('[data-news]')) { newsOpen = true; startOpen = false; H.render(); return true; }
    if (q('[data-news-x]')) { newsOpen = false; H.render(); return true; }
    if (q('[data-news-go]')) { writeNews(body, w); return true; }
    if (q('[data-start-x]')) { startOpen = false; H.render(); return true; }
    if (q('[data-start-go]')) { startStory(body, w); return true; }
    if (q('[data-story-end]')) { endStory(q('[data-story-end]').dataset.storyEnd); return true; }
    if (q('[data-peekpost]')) { const id = q('[data-peekpost]').dataset.peekpost; if (peeked.has(id)) peeked.delete(id); else peeked.add(id); H.render(); return true; }
    if (q('[data-behind]')) { const id = q('[data-behind]').dataset.behind; if (behind.has(id)) behind.delete(id); else behind.add(id); H.render(); return true; }
    if (q('[data-pmore]')) { postMenu(q('[data-pmore]'), w); return true; }
    if (q('[data-cmore]')) { const b = q('[data-cmore]'); commentMenu(b, b.dataset.pid, b.dataset.cmore); return true; }
    if (q('[data-pv]')) { const b = q('[data-pv]'); H.save(updatePost(H.store(), b.dataset.pid, p => showPostVersion(p, Number(b.dataset.pv)))); H.render(); return true; }
    if (q('[data-pe-save]')) {
        const id = q('[data-pe-save]').dataset.peSave, text = (body.querySelector('[data-pe-text]')?.value || '').trim(), t = body.querySelector('[data-pe-title]');
        if (text) H.save(updatePost(H.store(), id, p => editPost(p, { title: t ? t.value.trim() : null, text })));
        editingPost = null; H.render(); return true;
    }
    if (q('[data-pe-x]')) { editingPost = null; H.render(); return true; }
    if (q('[data-csave]')) { saveComment(body); return true; }
    if (q('[data-cx]')) { editingC = null; H.render(); return true; }
    if (q('[data-board-people]')) { import('../board-window.js').then(m => m.openBoardWindow({ view: 'world' })).catch(() => {}); return true; }
    return false;
}
export function onFeedKey(e, body, w) {
    if (e.target.matches?.('[data-cedit]') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveComment(body); return true; }
    if (e.target.matches?.('[data-cedit]') && e.key === 'Escape') { editingC = null; H.render(); return true; }
    if (e.target.matches?.('[data-cin]') && e.key === 'Enter') { e.preventDefault(); comment(body, w, e.target.dataset.cin); return true; }
    if (e.target.matches?.('[data-seed]') && e.key === 'Enter') { e.preventDefault(); startStory(body, w); return true; }
    if (e.target.matches?.('[data-news-idea]') && e.key === 'Enter') { e.preventDefault(); writeNews(body, w); return true; }
    return false;
}

/** 📷: a described photo, "[photo: …]", with the cursor where the description goes. */
export function insertPhoto(ta) {
    const v = ta.value, at = ta.selectionStart ?? v.length, pre = v.slice(0, at), ins = (pre && !/\s$/.test(pre) ? '\n' : '') + '[photo: ';
    ta.value = pre + ins + ']' + v.slice(at);
    const c = pre.length + ins.length; ta.focus(); ta.setSelectionRange(c, c);
}
function post(body, w) {
    const ta = body.querySelector('[data-post-ta]'), text = (ta?.value || '').trim();
    if (!text) return;
    const st = H.store(), by = currentMe();
    const p = { ...newPost({ store: st, by, text, stamp: stampNow(), id: newId('p') }), mine: true, ...(by === RUMOR ? { rumor: { kind: '', truth: '', from: `Posted by ${nameOf(USER)}`, who: USER, heard: [] } } : {}) };
    H.save(addRecord(st, p, Math.max(0, lastI())));
    ta.value = '';
    H.render();
    react(w, p.id, null);
}
function comment(body, w, id) {
    const inp = body.querySelector(`[data-cin="${id}"]`), text = (inp?.value || '').trim();
    if (!text) return;
    H.save(updatePost(H.store(), id, p => addComment(p, { id: newId('c'), by: currentMe(), text })));
    commenting = null; H.render();
    react(w, id, text);
}

/** ⋯ on a post or news item: write it again (not on hers), edit, delete (with Undo). */
function postMenu(anchor, w) {
    const id = anchor.dataset.pmore, p = postsOf(H.store()).find(x => x.id === id);
    if (!p) return;
    K.openMenu(anchor, [
        p.mine ? null : { label: 'Write it again', icon: 'refresh', sub: 'another version; ‹ › to flip back', disabled: rewriting.has(id), onClick: () => again(w, p) },
        { label: 'Ask Mero about this', icon: 'mero', onClick: () => { const it = window.__dleWorldItem?.('p:' + id); if (it) window.__dleAskMero?.(it); } },
        { label: 'Edit', icon: 'edit', onClick: () => { editingPost = id; H.render(); setTimeout(() => document.querySelector('.dle-world [data-pe-text]')?.focus(), 0); } },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
            const at = H.store().records.findIndex(r => r.kind === 'post' && r.id === id), rec = H.store().records[at];
            H.save(removePost(H.store(), id)); if (artOpen === id) artOpen = null; H.render();
            // a deleted rumor is unheard again: what people learned from it goes too (back with Undo)
            const heard = rec?.rumor?.undo || null; if (heard) ungive(heard);
            if (rec?.taught) ungive(rec.taught);   // quoted people, readers who noticed it: they don't know it any more
            K.notify({ title: 'World', text: p.news ? 'News item deleted.' : 'Post deleted.', undo: H.here(() => { const base = { ...rec, taught: undefined }, back = heard ? { ...base, rumor: { ...rec.rumor, undo: regive(rec) } } : base, s = H.store(); H.save({ ...s, records: [...s.records.slice(0, at), back, ...s.records.slice(at)] }); H.render(); }) });
        } },
    ]);
}
async function again(w, p) {
    rewriting.add(p.id); H.render();
    const cid = H.chat();
    try {
        const v = await writeAgain(w, p);
        if (H.chat() !== cid) return;   // another chat opened meanwhile (hunt 2: a branch has the same post and got the rewrite)
        if (v) H.save(updatePost(H.store(), p.id, x => addPostVersion(x, v)));
        else K.notify({ title: 'World', text: 'Nothing came back. Try again.', tone: 'warn' });
    } catch (err) { K.notify({ title: 'World', text: `It couldn't be written again: ${err?.message || err}`, tone: 'warn' }); }
    finally { rewriting.delete(p.id); H.render(); }
}
/** ⋯ on a comment: edit, delete (with Undo). */
function commentMenu(anchor, pid, cid) {
    K.openMenu(anchor, [
        { label: 'Edit', icon: 'edit', onClick: () => { editingC = { post: pid, c: cid }; H.render(); setTimeout(() => document.querySelector('.dle-world [data-cedit]')?.focus(), 0); } },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
            const before = postsOf(H.store()).find(x => x.id === pid)?.comments || [];
            H.save(updatePost(H.store(), pid, p => removeComment(p, cid))); H.render();
            K.notify({ title: 'World', text: 'Comment deleted.', undo: H.here(() => { H.save(updatePost(H.store(), pid, () => ({ comments: before }))); H.render(); }) });
        } },
    ]);
}
function saveComment(body) {
    const text = (body.querySelector('[data-cedit]')?.value || '').trim();
    if (text && editingC) H.save(updatePost(H.store(), editingC.post, p => editComment(p, editingC.c, text)));
    editingC = null; H.render();
}

/** Someone usually answers a post or comment by {{user}} (or whoever she writes as): 0–2 comments, a few likes, a crowd. */
async function react(w, postId, commentText) {
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId || w.paused) return;
    const me = currentMe(), p0 = postsOf(H.store()).find(p => p.id === postId);
    if (!p0) return;
    reacting.add(postId); H.render();
    const cid = H.chat(), stay = () => H.chat() === cid;
    try {
        let ppl = [...everyone(w), ...(w.sections.feed ? [rumorPerson(w)] : [])].filter(x => x.key !== me && !x.muted && !neverTalk(w, x.key, me) && !neverTalk(w, x.key, p0.by));
        // tagged people answer (Miinthe: fake @-tagging); the rumor account only joins in when tagged
        const tags = mentionsIn(commentText || p0.text, ppl);
        if (!tags.includes(RUMOR)) ppl = ppl.filter(x => x.key !== RUMOR);
        const tagged = tags.map(k => ppl.find(x => x.key === k)?.name).filter(Boolean);
        const count = commentCount();
        const pr = reactPrompt({ count, authorName: nameOf(me), post: { ...p0, byName: nameOf(p0.by), comments: (p0.comments || []).map(c => ({ ...c, byName: nameOf(c.by) })) }, comment: commentText || '', people: ppl, look: w.look, tagged });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'world', skipThrottle: true, jsonSchema: REACT_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        const a = parseReact(r?.text, ppl);
        // the count is kept, not only asked for (Miinthe: "both have gotten 4 comments … some varieties"): tagged people first, then the rest up to it
        const tagFirst = [...a.comments.filter(c => tags.includes(c.who.key)), ...a.comments.filter(c => !tags.includes(c.who.key))];
        a.comments = tagFirst.slice(0, Math.max(count, tagFirst.filter(c => tags.includes(c.who.key)).length));
        // not instant, and one comment at a time (Miinthe: "multiple comments on a post should also have a small delay between each other")
        await new Promise(res => setTimeout(res, 1500));
        if (!stay()) return;
        H.save(updatePost(H.store(), postId, p => ({ likes: [...new Set([...(p.likes || []), ...a.likes])], crowd: (Number(p.crowd) || 0) + a.crowd })));
        H.render();
        for (const [n, c] of a.comments.entries()) {
            if (n) await new Promise(res => setTimeout(res, 2000 + Math.random() * 3000));
            if (!stay()) return;
            H.save(updatePost(H.store(), postId, p => addComment(p, { id: newId('c'), by: c.who.key, text: c.text, auto: true })));
            H.render();
        }
    } catch (err) { console.warn('[DLE] world: reactions failed', err?.message || err); }
    finally { reacting.delete(postId); H.changed(); H.render(); }
}

async function startStory(body, w) {
    const seed = (body.querySelector('[data-seed]')?.value || '').trim();
    if (!seed) return;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: 'The world needs an AI connection to plan a story: Settings › AI & connections › World.', tone: 'warn' }); return; }
    startOpen = false; H.render();
    const cid = H.chat();
    try {
        const pr = storyPrompt({ seed, look: w.look });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: 500, caller: 'world', skipThrottle: true, jsonSchema: STORY_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.8 });
        if (H.chat() !== cid) return;
        const s = parseStory(r?.text, seed);
        if (!s) { K.notify({ title: 'World', text: 'The story came back unreadable. Try again.', tone: 'warn' }); return; }
        H.save(addRecord(H.store(), { kind: 'wstory', id: newId('s'), ...s, at: 0, by: 'you' }, Math.max(0, lastI())));
        K.notify({ title: 'World', text: `"${s.title}" is planned in ${s.phases.length} part${s.phases.length === 1 ? '' : 's'}; the news tells it as the story moves.`, tone: 'good' });
        feedTick(w, 'a world story was just started', { force: true });
    } catch (err) { K.notify({ title: 'World', text: `The story couldn't be planned: ${err?.message || err}`, tone: 'warn' }); }
    finally { H.render(); }
}
/** One news item now: from her idea, or a world-aware surprise (one call; a voice writes it if there is one). */
async function writeNews(body, w) {
    const idea = (body.querySelector('[data-news-idea]')?.value || '').trim();
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: 'The world needs an AI connection to write news: Settings › AI & connections › World.', tone: 'warn' }); return; }
    const ppl = everyone(w).filter(p => !p.muted);
    if (!ppl.length) return;
    newsOpen = false; writingNews = true; H.render();
    const cid = H.chat();
    try {
        const c = clockNow();
        const pr = newsPrompt({ userName: nameOf(USER), idea, people: ppl, recent: postsOf(H.store()).slice(-8).map(p => ({ by: nameOf(p.by), text: p.title || p.text })), stories: runningStories(H.store()), look: w.look, when: c ? stampText({ day: c.day, part: c.part }) : '', min: w.alive.movesMin, max: w.alive.movesMax });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 300 + 200 * w.alive.movesMax), caller: 'world', skipThrottle: true, jsonSchema: NEWS_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.95 });
        if (H.chat() !== cid) return;
        const a = parseNews(r?.text, ppl);
        if (!a) { K.notify({ title: 'World', text: 'The news came back unreadable. Try again.', tone: 'warn' }); return; }
        const p = newPost({ store: H.store(), by: a.who.key, text: a.text, title: a.title, news: true, stamp: stampNow(), id: newId('p'), crowd: Math.round(6 + Math.random() * 25), auto: true });
        H.save(addRecord(H.store(), p, Math.max(0, lastI())));
        if (a.quoted?.length) { const u = tellQuoted(a.quoted, nameOf(a.who.key), a.title || a.text); if (u) H.save(updatePost(H.store(), p.id, x => ({ taught: mergeTaught(x.taught, u) }))); }   // a story person quoted knows it (undone when the post goes)
        if (a.askUser) askComment(w, p);   // {{user}} was involved: the reporter texts for a comment
        artOpen = p.id;
    } catch (err) { K.notify({ title: 'World', text: `No news: ${err?.message || err}`, tone: 'warn' }); }
    finally { writingNews = false; H.render(); }
}
function endStory(id) {
    H.save({ ...H.store(), records: H.store().records.map(r => (r.kind === 'wstory' && r.id === id ? { ...r, at: (r.phases || []).length } : r)) });
    H.render();
}

// ── the feed's tick ─────────────────────────────────────────────────────────

/**
 * One call: what gets posted now (posts, comments on recent posts, the next phase of a running world story, maybe a new
 * small story). Called with the messages' tick (same reasons, world.js) and when she starts a story. Everything is `auto`.
 */
export async function feedTick(w, reason, { force = false } = {}) {
    // a story started while the feed is busy: told right after, not dropped (Miinthe, E4: two started, one showed up)
    if (feedBusy && force) { feedAgain = [w, reason]; return; }
    if (!H || !w || feedBusy || (w.paused && !force) || (!w.sections.feed && !w.sections.news)) return;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) return;
    const ppl = everyone(w).filter(p => !p.muted);
    if (!ppl.length) return;
    feedBusy = true; H.render();
    const cid = H.chat();
    try {
        const { recent, old } = feedContext(8);
        const stories = runningStories(H.store());
        const c = clockNow();
        // the world starts a story by itself only when none is running (one at a time; hers count too)
        const focus = storyToTell(stories);
        const pr = feedPrompt({ userName: nameOf(USER), people: ppl, recent, old, stories: focus ? [focus] : [], reason, look: w.look, when: c ? stampText({ day: c.day, part: c.part }) : '', newStoryOk: stories.length === 0 && !force });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 1400), caller: 'world', skipThrottle: true, jsonSchema: FEED_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.95 });
        if (window.__dleWorldDebug) console.log('[DLE] world feed', reason, r?.text);
        if (H.chat() !== cid) return;
        const a = parseFeed(r?.text, ppl);
        let st = H.store();
        const i = Math.max(0, lastI()), stamp = stampNow();
        let newStoryId = null;
        if (a.newStory) { newStoryId = newId('s'); st = addRecord(st, { kind: 'wstory', id: newStoryId, title: a.newStory.title, seed: a.newStory.title, phases: a.newStory.phases, at: 0, auto: true }, i); }
        const made = [], quoted = [], asks = [];
        for (const p of a.posts) {
            const story = p.story && storiesOf(st).some(s => s.id === p.story) ? p.story : (newStoryId && !made.some(x => x.story === newStoryId) ? newStoryId : null);
            // no likes or crowd given (live, the AI left them out): a modest crowd, bigger for busy posters and voices
            const crowd = p.crowd || p.likes.length ? p.crowd : Math.round((p.who.kind === 'voice' ? 6 : 2) + Math.random() * (p.who.p || 2) * 5);
            const rec = newPost({ store: st, by: p.who.key, text: p.text, title: p.title, news: !!p.title, story, stamp, id: newId('p'), crowd, auto: true });
            rec.likes = p.likes;
            st = addRecord(st, rec, i); made.push(rec);
            if (rec.news && p.quoted?.length) quoted.push([p.quoted, nameOf(p.who.key), rec.title || rec.text, rec.id]);
            if (rec.news && p.askUser) asks.push(rec);
        }
        // the story due this tick, told in a post the AI forgot to tag: that post tells it
        if (focus && !made.some(m => m.story === focus.id)) {
            const m = made.find(x => !x.story && tellsStory(x, focus));
            if (m) { st = updatePost(st, m.id, () => ({ story: focus.id })); m.story = focus.id; }
        }
        // phases told: the stories move on (one told in a post counts, said or not; a new story's first phase once posted)
        const told = new Set([...a.told.filter(id => made.some(m => m.story === id)), ...made.map(m => m.story).filter(Boolean)]);
        st = { ...st, records: st.records.map(r => (r.kind === 'wstory' && told.has(r.id) ? { ...r, at: Math.min((r.phases || []).length, (Number(r.at) || 0) + 1), toldAt: i } : r)) };
        // comments: on a recent post (#n), or a new one (0 = the first new post, -1 the second …)
        for (const c of a.comments) {
            // a recent post by its #number; 0 / -1 / -2 = the new ones — and a number that matches no recent post read as a new one (live: "1" for the first new post)
            const target = c.post >= 1 ? ([...recent, ...old].some(x => x.n === c.post) ? postsOf(st).find(p => p.n === c.post) : made[c.post - 1]) : made[-c.post];
            if (target && talksOk(w, c.who.key, target, c.text)) st = updatePost(st, target.id, p => addComment(p, { id: newId('c'), by: c.who.key, text: c.text, auto: true }));
        }
        H.save(st);
        for (const [keys, outlet, head, pid] of quoted) { const u = tellQuoted(keys, outlet, head); if (u) H.save(updatePost(H.store(), pid, x => ({ taught: mergeTaught(x.taught, u) }))); }
        for (const rec of asks.slice(0, 1)) askComment(w, rec);   // after the save: the knowledge is logged on the live state
    } catch (err) { console.warn('[DLE] world: feed failed', err?.message || err); }
    finally {
        feedBusy = false; H.changed(); H.render();
        if (feedAgain) { const [w2, r2] = feedAgain; feedAgain = null; if (H.chat() === cid) feedTick(w2, r2, { force: true }); }
    }
}
let feedAgain = null;

/**
 * What the feed's calls see: the recent posts with their comments (so people answer each other), and up to two older
 * posts that fit what's going on in the main story now (Miinthe: "pick up an old post when it became relevant again").
 */
function feedContext(n) {
    const view = p => ({ n: p.n, by: nameOf(p.by), text: p.title ? `${p.title}: ${p.text}` : p.text, comments: (p.comments || []).map(c => ({ by: nameOf(c.by), text: c.text })) });
    const all = postsOf(H.store()).slice().sort((a, b) => a.n - b.n), recent = all.slice(-n);
    const now = (getContext()?.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string').slice(-2).map(m => m.mes).join('\n');
    const old = relevantOld(H.store(), now, { skip: recent.map(p => p.n) });
    return { recent: recent.map(view), old: old.map(view) };
}

/**
 * After every main reply (Miinthe, 2026-10-19: "we can allow the world 0-4 movements per main reply … they don't even have
 * to be big"): one small call — a post, comments answering posts and each other or digging up an older post, and now
 * and then a private text between two of the story's people who know each other (answered later by the threads'
 * rules). Skipped when the tick already ran for this reply, when paused, or when the mix's switch is off.
 */
export async function pulse(w) {
    if (!H || !w || feedBusy || w.paused || !w.alive.pulse || !w.alive.movesMax || (!w.sections.feed && !w.sections.msgs)) return;
    const li = lastI();
    if (li < 0 || H.store().records.some(r => (r.kind === 'tick' || r.kind === 'pulse') && r.i === li)) return;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) return;
    const L = live(); if (!L) return;
    const ppl = everyone(w).filter(p => !p.muted);
    // who may text whom: the story's people (the Cast and the main character), never muted, never a voice or a regular
    const m0 = mainInfo();
    const texters = [...(m0 ? [{ key: MAIN, name: m0.name, knows: H.store().records.filter(r => r.kind === 'mknow').map(r => r.fact), plans: [], wants: '' }] : []),
        ...peopleOf(L.board, L.state).map(x => { const now = personNow(L.state, x.cast, x.p); return { key: x.key, name: x.p.name, knows: now.knows.map(k => k.fact), plans: now.plans.map(p => p.text), wants: now.wants || '' }; })]
        .filter(t => !w.people?.[t.key]?.muted);
    const msgs = H.store().records.filter(r => r.kind === 'msg');
    // two-person conversations only (hunt 2: group lines were listed as "Kettle ↔ Kitchen crew")
    const open = [...new Set(msgs.filter(m => !m.group && m.from !== USER && m.to !== USER && !m.answered && li - m.i <= 8).map(m => `${nameOf(m.from)} ↔ ${nameOf(m.to)}`))];
    feedBusy = true;
    const cid = H.chat();
    try {
        const { recent, old } = feedContext(6), c = clockNow();
        const story = (getContext()?.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string').slice(-2).map(m => `${m.name}: ${m.mes}`);
        const gs = groupsForPulse(w).map(g => ({ ...g, keys: g.members, members: g.members.map(nameOf) }));
        const pr = pulsePrompt({ userName: nameOf(USER), people: ppl, recent, old, texters, open, story, groups: gs, feed: !!w.sections.feed, msgs: !!w.sections.msgs, look: w.look, when: c ? stampText({ day: c.day, part: c.part }) : '', min: w.alive.movesMin, max: w.alive.movesMax });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 300 + 200 * w.alive.movesMax), caller: 'world', skipThrottle: true, jsonSchema: PULSE_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.95 });
        if (window.__dleWorldDebug) console.log('[DLE] world pulse', r?.text);
        if (H.chat() !== cid || lastI() < li) return;
        const moves = parsePulse(r?.text, ppl, texters, w.alive.movesMax, gs);
        let st = H.store();
        const stamp = stampNow(), i = Math.max(0, li);
        st = addRecord(st, { kind: 'pulse', id: newId('pu'), moves: moves.length, auto: true }, i);
        const known = new Set([...recent, ...old].map(p => p.n));
        for (const mv of moves) {
            if (mv.kind === 'post' && w.sections.feed) {
                const rec = newPost({ store: st, by: mv.who.key, text: mv.text, stamp, id: newId('p'), crowd: Math.round(1 + Math.random() * (mv.who.p || 2) * 4), auto: true });
                st = addRecord(st, rec, i);
            } else if (mv.kind === 'comment' && w.sections.feed && known.has(mv.post)) {
                const target = postsOf(st).find(p => p.n === mv.post);
                // a discussion, not a pile-on: at most 8 of the world's own comments under one post
                if (target && (target.comments || []).filter(x => x.auto).length < 8 && talksOk(w, mv.who.key, target, mv.text)) st = updatePost(st, target.id, p => addComment(p, { id: newId('c'), by: mv.who.key, text: mv.text, auto: true }));
            } else if (mv.kind === 'group' && w.sections.msgs) {
                // a member writes in a group chat by themselves (Miinthe's mock-up, note 8)
                st = addRecord(st, { ...newMessage({ store: st, from: mv.who.key, to: 'g:' + mv.group.id, text: mv.text, clock: c, i, look: w.look, id: newId('w') }), conv: 'g:' + mv.group.id, group: mv.group.id, alts: [mv.text], s: 0, auto: true }, i);
            } else if (mv.kind === 'text' && w.sections.msgs && !neverTalk(w, mv.from.key, mv.to.key) && !open.includes(`${mv.from.name} ↔ ${mv.to.name}`) && !open.includes(`${mv.to.name} ↔ ${mv.from.name}`)) {
                st = addRecord(st, { ...newMessage({ store: st, from: mv.from.key, to: mv.to.key, text: mv.text, clock: c, i, look: w.look, id: newId('w') }), alts: [mv.text], s: 0, auto: true }, i);
            }
        }
        H.save(st);
    } catch (err) { console.warn('[DLE] world: the small moves failed', err?.message || err); }
    finally { feedBusy = false; H.changed(); H.render(); }
}

/** Someone may answer this post (and whoever their comment @-tags): not when they never talk to each other (the board's rule). */
function talksOk(w, who, post, text) {
    if (neverTalk(w, who, post.by)) return false;
    return !mentionsIn(text, tagPeople(w)).some(k => neverTalk(w, who, k));
}

export function resetFeedView() { editingPost = null; editingC = null; commenting = null; artOpen = null; startOpen = false; }
