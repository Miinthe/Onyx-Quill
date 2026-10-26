/**
 * World layer, stage 1 — Messages in the world panel (Miinthe, 2026-10-19; mock-up v5, design §2, §2d).
 *
 * Text (phone look) or write letters (letters look) to the people of the story, as {{user}} or as anyone in the Cast.
 * The person answers through the World AI connection, from their card, what they want and plan, and what they know;
 * what they learn from a message joins their Cast knowledge (logged at the main chat's newest message, with Undo), so
 * they know it in the main story too. Letters take story time: they arrive on the next story day (or, on a board
 * without days, after the next exchange), and are answered once they arrive.
 */
import { getContext } from '../../../../../extensions.js';
import { getThumbnailUrl } from '../../../../../../script.js';
import { user_avatar } from '../../../../../personas.js';
import { resolveConnectionConfig } from '../../settings.js';
import { callAI } from '../ai/ai.js';
import { live, saveLiveState, liveWriterLines } from '../board-live.js';
import { applyCastChanges } from '../cast-pure.js';
import { storyLinesFor } from '../cast-voice-pure.js';
import { undoCollections } from '../autotrack.js';
import { icon as I } from '../kit/icons.js';
import * as K from '../kit/kit.js';
import { addRecord, normWorld, neverTalk, togglePin } from './world-pure.js';
import { lastTick, tickReason, tickPrompt, parseTick, TICK_SCHEMA } from './alive-pure.js';
import { duePlans, plannedPrompt } from './planned-pure.js';
import { newPost, richText } from './feed-pure.js';
import { RUMOR, rumorName, accountCard, worldDigest, NEWS, newsName, newsAccount, reporterCard, commentAsk, withComment } from './rumor-pure.js';
import { updatePost } from './feed-pure.js';
import { spreadTip, openAsk } from './rumors.js';
import { hookGroups, groupOpen, groupRows, renderGroup, onGroupClick, onGroupKey, resetGroups, deliverGroups } from './groups.js';
import { groupUnread, groupsOf } from './groups-pure.js';
import {
    USER, MAIN, othersConversations, convThread, mainLearned, mainKnowsLine, peopleOf, personByKey, storyClock, stampText, threadOf, unreadFor, conversationsFor, newMessage, updateMessage,
    pacing, removeMessage, markRead, isPass, nextThread, splitParts, swipeTo, repliesDue, replyPrompt, parseReply, extractPrompt, parseExtract, EXTRACT_SCHEMA, learnedChanges, personNow, textOf, arrivalText, replyWait, waitOver, replyStatus,
    meetupChange, mainPlanLine, leakFacts, leakChanges, withHeaders,
} from './messages-pure.js';
import { discretionOf, discretionMap } from './feed.js';   // who people never gossip about (Miinthe 2026-10-26)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const STORY_WINDOW = 8;

let me = USER, openWith = null, peekConv = null, editing = null, asMenu = false, meetOpen = false, leaking = false, othersOpen = false;
const leakSel = new Set(), leakTo = new Set();
function stopLeak() { leaking = false; leakSel.clear(); leakTo.clear(); }
const busy = new Set();   // conversations whose answer is being written
const typing = new Set();   // …and where the dots show (after Read — pacing)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Hooks from world.js: the store, saving it, redrawing the panel. */
let H = null;
export function hookMessages(h) { H = h; hookGroups(h); }

const ctx = () => getContext();
const lastI = () => (ctx()?.chat?.length ?? 0) - 1;
const userName = () => ctx()?.name1 || 'You';
/** The chat's main character (a one-on-one chat), or null. */
function mainInfo() {
    const c = ctx();
    if (!c || c.groupId) return null;
    const ch = c.characters?.[c.characterId];
    return ch ? { name: ch.name, card: ch.avatar, ch } : null;
}
/** The story's voices and regulars (the board's World tab, stage 4). */
function voicesNow() { try { return normWorld(live()?.board?.world).voices; } catch { return []; } }
const voiceOf = key => (String(key).startsWith('v:') ? voicesNow().find(v => 'v:' + v.id === key) || null : null);
const worldNow = () => { try { return normWorld(live()?.board?.world); } catch { return normWorld(null); } };
function nameOf(key) { if (String(key).startsWith('g:')) return groupsOf(H?.store()).find(g => 'g:' + g.id === key)?.name || 'a group'; if (key === NEWS) return newsName(worldNow()); if (key === RUMOR) return rumorName(worldNow()); if (key === USER) return userName(); if (key === MAIN) return mainInfo()?.name || 'Them'; if (String(key).startsWith('v:')) return voiceOf(key)?.name || 'Someone'; return personByKey(live()?.board, key)?.p?.name || 'Someone'; }
function cardOf(key) { if (key === USER) return ''; if (key === MAIN) return mainInfo()?.card || ''; return personByKey(live()?.board, key)?.p?.card || ''; }
// no role under a person's name (Miinthe, 2026-10-19: "remove: cast, main characters, your persona from anywhere") — only voices,
// regulars and the rumor account say what they are
const roleOf = key => (key === NEWS ? 'the news' : key === RUMOR ? 'the rumor account: no names' : String(key).startsWith('v:') ? (voiceOf(key)?.kind === 'regular' ? 'a regular' : 'a story voice') : '');
const exists = (L, key) => key === USER || key === RUMOR || key === NEWS || (key === MAIN ? !!mainInfo() : String(key).startsWith('v:') ? !!voiceOf(key) : !!personByKey(L.board, key));
function clockNow() { const L = live(); return L ? storyClock(L.board, L.state) : null; }
function avatar(key, cls = 'av') {
    // {{user}}: the persona's own picture (Miinthe, 2026-10-19: "right now it's just a T")
    if (key === USER && user_avatar) return `<span class="${cls}"><img src="${esc(getThumbnailUrl('persona', user_avatar))}" alt="" loading="lazy"></span>`;
    if (key === RUMOR) return `<span class="${cls} init rumor" aria-hidden="true">🤫</span>`;
    if (key === NEWS) return `<span class="${cls} init rumor" aria-hidden="true">📰</span>`;
    const card = cardOf(key);
    if (card) return `<span class="${cls}"><img src="/thumbnail?type=avatar&file=${encodeURIComponent(card)}" alt="" loading="lazy"></span>`;
    return `<span class="${cls} init">${esc((nameOf(key) || '?').slice(0, 1).toUpperCase())}</span>`;
}

/** Waiting messages for {{user}} (the bar's dot, the rail's dot, which section opens). */
export function unreadMessages() {
    if (!H) return 0;
    return unreadFor(H.store(), USER, clockNow(), lastI()) + groupUnread(H.store(), USER);
}

// ── drawing ─────────────────────────────────────────────────────────────────

export function renderMessages(body, w) {
    const L = live();
    if (!L) { body.innerHTML = ''; return; }
    const letters = w.look === 'letters', clock = clockNow(), li = lastI();
    if (!exists(L, me)) me = USER;
    if (openWith && !exists(L, openWith)) openWith = null;
    const asRow = asRowHtml(L);
    if (peekConv) { renderPeek(body, asRow, letters, clock, li); return; }
    if (groupOpen()) { renderGroup(body, w, asRow); return; }
    if (!openWith) {
        const main = mainInfo();
        let list = conversationsFor(H.store(), L.board, L.state, me, clock, li, main ? { name: main.name, card: main.card } : null, { rumor: w.sections.feed, news: H.store().records.some(r => r.kind === 'msg' && (r.from === NEWS || r.to === NEWS)) });
        const others = othersConversations(H.store(), me, clock, li);
        const gr = groupRows(w, me), nOthers = others.length + gr.others.length;
        if (talkForm) { body.innerHTML = asRow + talkFormHtml(w); return; }
        if (!list.length) { body.innerHTML = asRow + '<div class="dle-wd-empty"><b>Nobody to write to yet.</b><span>Add people to the Cast on the board, and they show up here.</span></div>'; return; }
        const pins = H.store().pins || [];
        // pinned first (groups, then people), then the rest — each newest first
        // only conversations that exist (or are pinned) are rows; everyone else is in the + New chat dropdown
        const fresh = list.filter(c => !c.last && !pins.includes(c.key)); list = list.filter(c => c.last || pins.includes(c.key));
        const newChat = fresh.length ? `<select class="dk-field dle-wd-newchat" data-newchat aria-label="${letters ? 'New letter' : 'New chat'}"><option value="">＋ ${letters ? 'New letter to…' : 'New chat with…'}</option>${fresh.map(c => `<option value="${esc(c.key)}">${esc(nameOf(c.key))}</option>`).join('')}</select>` : '';
        const rowOf = c => `<button type="button" class="dle-wd-row${c.unread ? ' unread' : ''}" data-open="${esc(c.key)}">${avatar(c.key)}` +
            `<span class="nm">${pins.includes(c.key) ? '<span class="pin" title="Pinned">★</span>' : ''}${esc(nameOf(c.key))}${w.people?.[c.key]?.muted ? '<span class="muted" title="Muted on the board: never writes to you first">🔇</span>' : ''}</span><span class="tm">${c.last ? esc(stampText(c.last.stamp)) : ''}</span>` +
            `<span class="pv">${c.last ? (c.last.from === me ? esc(nameOf(me)) + ': ' : '') + esc(textOf(c.last)) : `<i>${letters ? 'Write the first letter' : 'Start a conversation'}</i>`}</span>` +
            (c.unread ? '<span class="ud" aria-label="unread"></span>' : '') + '</button>';
        body.innerHTML = asRow + `<div class="dle-wd-list">${newChat}${gr.btn}${gr.pinned}${list.filter(c => pins.includes(c.key)).map(rowOf).join('')}${gr.rest}${list.filter(c => !pins.includes(c.key)).map(rowOf).join('')}<div class="dle-wd-newg"><button type="button" class="dk-btn" data-talk-new title="Two people of the story start talking, now">+ Start a talk between others</button></div>${nOthers ? `<button type="button" class="dle-wd-lgh fold" data-others aria-expanded="${othersOpen}">${I('chev')}<span class="lt">Between others</span><small>${othersOpen ? 'tap one to spy — only you see this' : 'tap to open'}</small><span class="cnt" aria-label="${nOthers} conversation${nOthers === 1 ? '' : 's'}">${nOthers}</span></button>${!othersOpen ? '' : gr.others.map(r => r.html).join('') + others.map(o => `<button type="button" class="dle-wd-row peek" data-peek="${esc(o.conv)}"><span class="av2">${avatar(o.a, 'fa')}${avatar(o.b, 'fa')}</span>` +
            `<span class="nm">${esc(nameOf(o.a))} ↔ ${esc(nameOf(o.b))}</span><span class="tm">${esc(stampText(o.last.stamp))}</span><span class="pv blur" aria-label="hidden until you open it">${esc(textOf(o.last))}</span></button>`).join('')}` : ''}</div>`;
        return;
    }
    // a conversation: everything that arrived for me is read now
    const st0 = H.store(), st1 = markRead(st0, me, openWith, clock, li, new Date().toISOString());
    if (st1 !== st0) { H.save(st1); H.changed(); }
    const th = threadOf(H.store(), me, openWith, clock, li).filter(m => !m.onWay || m.from === me);
    const npcPartner = openWith !== USER;
    let h = `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-back title="All conversations" aria-label="All conversations">${I('back')}</button>${avatar(openWith)}` +
        `<span class="who"><b>${esc(nameOf(openWith))}</b>${roleOf(openWith) || (npcStatus(w, openWith)) ? `<small>${[roleOf(openWith), npcStatus(w, openWith)].filter(Boolean).join(' · ')}</small>` : ''}</span>` +
        pinBtn(openWith) +
        (waiting(th, openWith) ? `<button type="button" class="dk-ib on" data-nudge title="Answer now: they reply right away, whatever their reply time says" aria-label="Answer now">${I('send')}</button>` : '') +
        (npcPartner ? `<button type="button" class="dk-ib" data-meet title="Meet up… (it happens later in the story, when it fits)" aria-label="Meet up">${I('calendar')}</button>` : '') +
        (th.length ? `<button type="button" class="dk-ib" data-askmero="${esc(th[0].conv)}" title="Ask Mero about this conversation" aria-label="Ask Mero about this conversation">${I('mero')}</button>` : '') +
        (th.length ? `<button type="button" class="dk-ib${leaking ? ' on' : ''}" data-leak title="Leak… (pick messages and who hears them)" aria-label="Leak">${I('leak')}</button>` : '') +
        (th.length ? `<button type="button" class="dk-ib" data-clearconv="${esc(th[0].conv)}" title="Clear this conversation: every message, and what anyone learned from it (Undo)" aria-label="Clear this conversation">${I('trash')}</button>` : '') + '</div>';
    if (meetOpen && npcPartner) h += `<div class="dle-wd-meet"><input class="dk-field" data-meet-in placeholder="What, where, when? e.g. the beach, next Wednesday" aria-label="The meet-up"><button type="button" class="dk-btn" data-meet-add>Add to ${esc(nameOf(openWith))}'s plans</button></div>`;
    h += threadHtml(th, { me, other: openWith, letters, peek: false });
    h += leaking ? leakBar() : `<div class="dle-wd-compose"><button type="button" class="dk-ib" data-mphoto title="Attach a photo (described)" aria-label="Attach a photo">📷</button><textarea rows="1" class="dk-field" data-cmp data-tagbox placeholder="${letters ? 'Write a letter to' : 'Message'} ${esc(nameOf(openWith))}${me === USER ? '' : ' as ' + esc(nameOf(me))}…" aria-label="Write"></textarea>` +
        `<button type="button" class="send${letters ? ' seal' : ''}" data-send title="${letters ? 'Seal and send' : 'Send'}">${letters ? I('mail') + 'Send' : I('send')}</button></div>`;
    body.innerHTML = h;
    const t = body.querySelector('.dle-wd-thread'); if (t && !leaking) t.scrollTop = t.scrollHeight;
    if (editing) body.querySelector('[data-edit-ta]')?.focus();
    if (meetOpen) body.querySelector('[data-meet-in]')?.focus();
}

/** The bubbles of a thread: a time header wherever the story time changes (WhatsApp-style), swipes, Read, Edit/Delete — or, leaking, tick boxes. */
/** A group's thread (groups.js): every bubble with its sender, hers on the right, the typing dots while members answer. */
export function threadHtmlFor(th, { me: self, letters = false, typing: dots = false }) {
    const h = threadHtml(th, { me: self, other: null, letters, peek: true, group: true });
    return dots ? h.replace(/<\/div>$/, '<div class="typing" aria-label="writing"><i></i><i></i><i></i></div></div>') : h;
}
function threadHtml(th, { me: self, other, letters, peek, group = false }) {
    const lastMine = th.map(m => m.from).lastIndexOf(self), lastTheirs = th.map(m => m.from).lastIndexOf(other);
    let h = `<div class="dle-wd-thread${letters ? ' letters' : ''}${leaking ? ' leaking' : ''}">`;
    withHeaders(th).forEach(({ header, m }, k) => {
        if (header) h += `<div class="daymark">${esc(header)}</div>`;
        const out = m.from === self, side = out ? 'out' : 'in', ed = editing === m.id, picked = leakSel.has(m.id);
        let txt = richText(textOf(m), tagNames());
        if (letters) txt = `<span class="sal">Dear ${esc(nameOf(m.to))},</span>${txt}<span class="sig">${esc(nameOf(m.from))}</span>`;
        else if (peek && !(group && out)) txt = `<b class="from">${esc(nameOf(m.from))}</b>${txt}`;
        h += `<div class="bw ${side}${picked ? ' picked' : ''}"${leaking ? ` data-pick="${esc(m.id)}" role="checkbox" aria-checked="${picked}" tabindex="0"` : ''}><div class="bub ${side}${ed ? ' edit' : ''}" data-mid="${esc(m.id)}">${ed ? `<textarea class="edit-ta" data-edit-ta aria-label="Edit the message" rows="${Math.min(14, Math.max(2, textOf(m).split('\n').length + 1))}">${esc(textOf(m))}</textarea>` : txt}</div><div class="meta">`;
        if (letters) h += '<span class="seal"></span>';
        if (m.onWay) h += `<span>On its way · arrives ${esc(arrivalText(m.arrives))}</span>`;
        if (m.leaked?.length) h += `<span class="lk">${I('leak')}leaked to ${esc(m.leaked.join(', '))}</span>`;
        if (!leaking && !peek) {
            if (!out && k === lastTheirs && Array.isArray(m.alts)) h += `<span class="swipe"><button type="button" data-sw="-1" title="Previous version">${I('left')}</button>${(m.s || 0) + 1}/${m.alts.length}<button type="button" data-sw="1" title="Another version">${I('right')}</button></span>`;
            if (out && k === lastMine && !letters && other !== USER) h += `<span class="rr">${m.read ? 'Read' : 'Delivered'}</span>`;
            h += `<span class="acts">${ed ? '<button type="button" data-done>Done</button>' : '<button type="button" data-edit>Edit</button>'}<button type="button" data-del>Delete</button></span>`;
        }
        h += '</div></div>';
    });
    if (!peek && typing.has(other + '|' + self)) h += '<div class="typing" aria-label="writing"><i></i><i></i><i></i></div>';
    if (!th.length) h += `<div class="dle-wd-empty"><b>${letters ? 'No letters yet.' : 'No messages yet.'}</b><span>${letters ? 'A letter takes story time: it arrives on the next story day.' : 'Write the first one below.'}</span></div>`;
    return h + '</div>';
}

/** Leaking: who hears the ticked messages (anyone in the Cast and the main character). */
function leakBar() {
    const L = live(), main = mainInfo();
    const who = [...(main ? [MAIN] : []), ...peopleOf(L.board, L.state).map(x => x.key), ...(worldNow().sections.feed ? [RUMOR] : [])];   // stage 5: leak to the rumor account → it spreads it
    return `<div class="dle-wd-leakbar"><span class="lt">${leakSel.size ? `${leakSel.size} picked` : 'Tick the messages to leak'} · <b>who hears it?</b></span>` +
        `<div class="chips">${who.map(k => `<button type="button" class="dk-chip${leakTo.has(k) ? ' on' : ''}" data-leak-to="${esc(k)}" aria-pressed="${leakTo.has(k)}">${avatar(k, 'fa')}${esc(nameOf(k))}</button>`).join('')}</div>` +
        `<div class="btns"><button type="button" class="dk-btn" data-leak-cancel>Cancel</button><button type="button" class="dk-btn dk-primary" data-leak-go${leakSel.size && leakTo.size ? '' : ' disabled'}>${I('leak')}Leak</button></div></div>`;
}

/** "Writing as" — shared by Messages, Chatter and News: {{user}}, the main character, the Cast, the story's voices and regulars. */
export function asRowHtml(L = live()) {
    if (!L) return '';
    if (!exists(L, me)) me = USER;
    return `<div class="dle-wd-as"><span>Writing as</span><button type="button" class="dle-wd-asbtn${me === USER ? '' : ' npc'}" data-as-open aria-haspopup="true">${avatar(me, 'fa')}${esc(nameOf(me))}${I('chev')}</button></div>` +
        (asMenu ? `<div class="dle-wd-asmenu" role="menu">${[USER, ...(mainInfo() ? [MAIN] : []), ...peopleOf(L.board, L.state).map(x => x.key), ...voicesNow().map(v => 'v:' + v.id), RUMOR].map(k => `<button type="button" role="menuitem" data-as="${esc(k)}" class="${k === me ? 'on' : ''}">${avatar(k, 'fa')}<span>${esc(nameOf(k))}${k === RUMOR ? '<small>post a rumor without a name</small>' : roleOf(k) ? `<small>${roleOf(k)}</small>` : ''}</span></button>`).join('')}</div>` : '');
}
/** The Writing-as clicks, for every section. true = handled. */
export function handleAsClick(e) {
    const q = s => e.target.closest(s);
    if (q('[data-as-open]')) { asMenu = !asMenu; H.render(); return true; }
    if (q('[data-as]')) { me = q('[data-as]').dataset.as; asMenu = false; openWith = null; peekConv = null; H.render(); return true; }
    if (asMenu && !q('.dle-wd-asmenu')) { asMenu = false; H.render(); }
    return false;
}
export const currentMe = () => me;
/** Names that are highlighted when @-tagged (the main character, the Cast, voices, regulars). */
function tagNames() { const L = live(); if (!L) return []; const m = mainInfo(); return [...(m ? [{ key: MAIN, name: m.name }] : []), ...peopleOf(L.board, L.state).map(x => ({ key: x.key, name: x.p.name })), ...voicesNow().map(v => ({ key: 'v:' + v.id, name: v.name })), { key: RUMOR, name: nameOf(RUMOR) }, { key: NEWS, name: nameOf(NEWS) }]; }
export const nameOfKey = key => nameOf(key);
export const avatarOf = (key, cls) => avatar(key, cls);
export const roleOfKey = key => roleOf(key);
export { mainInfo, cardText, charText, voicesNow };

// ── acting ──────────────────────────────────────────────────────────────────

export function onMessagesClick(e, body, w) {
    const q = s => e.target.closest(s);
    if (handleAsClick(e)) return true;
    if (onGroupClick(e, body, w)) return true;
    if (q('[data-pin]')) { H.save(togglePin(H.store(), q('[data-pin]').dataset.pin)); H.render(); return true; }
    if (q('[data-talk-new]')) { const ks = talkPeople(); talkForm = { from: ks[0] || '', to: ks[1] || '', about: '' }; H.render(); return true; }
    if (talkForm && q('[data-talk-x]')) { talkForm = null; H.render(); return true; }
    if (talkForm && q('[data-talk-go]')) { startTalk(body, w); return true; }
    if (q('[data-nudge]')) { const m = waiting(threadOf(H.store(), me, openWith, clockNow(), lastI()), openWith); if (m) { H.save(updateMessage(H.store(), m.id, { held: false, read: m.read || new Date().toISOString() })); answer(m, w); } return true; }
    if (q('[data-open]')) { openWith = q('[data-open]').dataset.open; editing = null; meetOpen = false; stopLeak(); H.render(); return true; }
    if (q('[data-others]')) { othersOpen = !othersOpen; H.render(); return true; }
    if (q('[data-peek]')) { peekConv = q('[data-peek]').dataset.peek; stopLeak(); H.render(); return true; }
    if (q('[data-back]')) { openWith = null; peekConv = null; editing = null; meetOpen = false; stopLeak(); H.render(); return true; }
    if (q('[data-send]')) { send(body, w); return true; }
    if (q('[data-mphoto]')) { const ta = body.querySelector('[data-cmp]'); if (ta) { const v = ta.value, at = ta.selectionStart ?? v.length, pre = v.slice(0, at), ins = (pre && !/\s$/.test(pre) ? '\n' : '') + '[photo: '; ta.value = pre + ins + ']' + v.slice(at); const c = pre.length + ins.length; ta.focus(); ta.setSelectionRange(c, c); } return true; }
    if (q('[data-clearconv]')) { clearConv(q('[data-clearconv]').dataset.clearconv); return true; }
    if (q('[data-askmero]')) { const it = window.__dleWorldItem?.('c:' + q('[data-askmero]').dataset.askmero); if (it) window.__dleAskMero?.(it); return true; }
    if (q('[data-meet]')) { meetOpen = !meetOpen; H.render(); return true; }
    if (q('[data-meet-add]')) { const v = body.querySelector('[data-meet-in]')?.value.trim(); if (v) { meetup(openWith, v, nameOf(me)); meetOpen = false; H.render(); } return true; }
    if (q('[data-leak]')) { if (leaking) stopLeak(); else leaking = true; H.render(); return true; }
    if (q('[data-leak-cancel]')) { stopLeak(); H.render(); return true; }
    if (q('[data-leak-to]')) { const k = q('[data-leak-to]').dataset.leakTo; if (leakTo.has(k)) leakTo.delete(k); else leakTo.add(k); H.render(); return true; }
    if (q('[data-leak-go]')) { leak(w); return true; }
    if (leaking && q('[data-pick]')) { const id = q('[data-pick]').dataset.pick; if (leakSel.has(id)) leakSel.delete(id); else leakSel.add(id); H.render(); return true; }
    const mid = q('[data-mid]') ? null : e.target.closest('.bw')?.querySelector('[data-mid]')?.dataset.mid;
    if (q('[data-edit]') && mid) { editing = mid; H.render(); return true; }
    if (q('[data-done]') && mid) {
        // a text box keeps every line break and blank line (Miinthe, 2026-10-19: editing flattened Kettle's message)
        const text = (body.querySelector('[data-edit-ta]')?.value || '').trim();
        if (text) H.save(updateMessage(H.store(), mid, m => (Array.isArray(m.alts) ? { alts: m.alts.map((a, k) => (k === (m.s || 0) ? text : a)) } : { text })));
        editing = null; H.render(); return true;
    }
    if (q('[data-del]') && mid) { del(mid); return true; }
    if (q('[data-sw]') && mid) { swipe(mid, Number(q('[data-sw]').dataset.sw), w); return true; }
    return false;
}
export function onMessagesInput(e) {
    // + New chat / New letter: pick who from the dropdown (Miinthe, 2026-10-19: "add chat -> dropdown list")
    if (e.target.matches?.('[data-newchat]')) { if (e.target.value) { openWith = e.target.value; editing = null; meetOpen = false; stopLeak(); H.render(); } return; }
    if (!talkForm) return;
    if (e.target.matches?.('[data-talk-from]')) { talkForm.from = e.target.value; H.render(); }
    else if (e.target.matches?.('[data-talk-to]')) { talkForm.to = e.target.value; H.render(); }
    else if (e.target.matches?.('[data-talk-about]')) talkForm.about = e.target.value;
}
export function onMessagesKey(e, body, w) {
    if (onGroupKey(e, body, w)) return true;
    if (e.target.matches?.('[data-meet-in]') && e.key === 'Enter') { e.preventDefault(); body.querySelector('[data-meet-add]')?.click(); return true; }
    if (leaking && e.target.matches?.('[data-pick]') && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.target.click(); return true; }
    if (e.target.matches?.('[data-cmp]') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(body, w); return true; }
    return false;
}

function send(body, w) {
    const ta = body.querySelector('[data-cmp]'), text = (ta?.value || '').trim();
    if (!text || !openWith) return;
    const st = H.store(), clock = clockNow(), i = Math.max(0, lastI());
    const m = { ...newMessage({ store: st, from: me, to: openWith, text, clock, i, look: w.look, id: newId('w') }), mine: true };
    H.save(addRecord(st, m, i));
    ta.value = '';
    H.render();
    if (w.look === 'letters') {
        K.notify({ title: 'World', text: `Your letter is on its way. ${nameOf(openWith)} gets it ${m.arrives?.day ? `on Day ${m.arrives.day}` : 'once the story moves on'}.` });
        return;
    }
    if (openWith !== USER && w.people?.[openWith]?.muted) { K.notify({ title: 'World', text: `${nameOf(openWith)} is muted: they'll answer once you unmute them.` }); H.save(updateMessage(H.store(), m.id, { held: true })); return; }
    // reply times (Miinthe: "I'm being left on read for an exchange or two, that's what we also do with letters"): slow, busy
    // in the scene or asleep — it waits; read at once unless asleep
    if (openWith !== USER && w.alive.realReplies !== false && (openWith === MAIN || personByKey(live()?.board, openWith))) {
        const wt = replyWait({ ...nowFor(w, openWith), lastI: lastI() });
        if (wt) { H.save(updateMessage(H.store(), m.id, { held: true, wait: wt, ...(wt.wake ? {} : { read: new Date().toISOString() }) })); H.render(); return; }
    }
    if (openWith !== USER) answer(m, w);
}
/** ☆ / ★ in a conversation's header: pinned conversations stay at the top of Messages. */
export function pinBtn(key) {
    const on = (H.store().pins || []).includes(key);
    return `<button type="button" class="dk-ib${on ? ' on' : ''}" data-pin="${esc(key)}" aria-pressed="${on}" title="${on ? 'Unpin: no longer at the top' : 'Pin: keep this conversation at the top'}" aria-label="${on ? 'Unpin' : 'Pin to the top'}">${on ? '★' : '☆'}</button>`;
}

// ── Start a talk between others (Miinthe, 2026-10-19: "we didn't add a 'trigger exchange' between NPC") ─────────────

let talkForm = null;
/** Who can talk: the main character and the Cast. */
function talkPeople() { const L = live(); if (!L) return []; return [...(mainInfo() ? [MAIN] : []), ...peopleOf(L.board, L.state).map(x => x.key)]; }
function talkFormHtml(w) {
    const ks = talkPeople(), opt = (k, cur) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(nameOf(k))}</option>`;
    const blocked = talkForm.from && talkForm.to && neverTalk(w, talkForm.from, talkForm.to);
    return `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-talk-x title="Cancel" aria-label="Cancel">${I('back')}</button><span class="who"><b>Start a talk between others</b><small>you can spy on it under Between others</small></span></div>
      <div class="dle-wd-gform"><label>Who writes first<select class="dk-field" data-talk-from>${ks.map(k => opt(k, talkForm.from)).join('')}</select></label>
      <label>To<select class="dk-field" data-talk-to>${ks.map(k => opt(k, talkForm.to)).join('')}</select></label>
      <label>About <small>(optional — the AI picks a reason of theirs when it's empty)</small><textarea class="dk-field" rows="2" data-talk-about placeholder="e.g. the tape Spoon saw">${esc(talkForm.about)}</textarea></label>
      ${blocked ? `<div class="warn">${esc(nameOf(talkForm.from))} and ${esc(nameOf(talkForm.to))} never talk to each other (the board says so).</div>` : ''}
      <div class="btns"><button type="button" class="dk-btn dk-primary" data-talk-go ${blocked || talkForm.from === talkForm.to ? 'disabled' : ''}>Start</button><button type="button" class="dk-btn" data-talk-x>Cancel</button></div>
      <div class="hint">${w.look === 'letters' ? 'The letter goes out now; the answer comes when it has arrived.' : 'The first one writes now and the other answers right away; after that it goes on by itself now and then.'}</div></div>`;
}
async function startTalk(body, w) {
    const from = body.querySelector('[data-talk-from]')?.value, to = body.querySelector('[data-talk-to]')?.value, about = (body.querySelector('[data-talk-about]')?.value || '').trim();
    if (!from || !to || from === to) return;
    if (neverTalk(w, from, to)) { K.notify({ title: 'World', text: `${nameOf(from)} and ${nameOf(to)} never talk to each other (the board says so).` }); return; }
    if (w.people?.[from]?.muted || w.people?.[to]?.muted) { K.notify({ title: 'World', text: 'One of them is muted: unmute them on the board first.' }); return; }
    const L = live(), conn = resolveConnectionConfig('world');
    if (!L || conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: 'No AI connection for the world yet. Pick one in Settings › AI & connections › World.', tone: 'warn' }); return; }
    talkForm = null; othersOpen = true; H.render();
    const a = whoIs(L, from), b = whoIs(L, to), clock = clockNow(), cid = H.chat();
    if (!a || !b) return;
    try {
        const p = plannedPrompt({ discretion: discretionOf(w, from), name: a.p.name, card: a.text, now: a.now, toName: b.p.name, note: about || `start a conversation with ${b.p.name} — about something on your mind that has to do with them: a plan, a worry, something you heard, a favor`, look: w.look, when: clock ? stampText({ day: clock.day, part: clock.part }) : '', quirks: quirksOf(w, from) });
        const r = await callAI(p.system, p.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 500), caller: 'world', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        const text = parseReply(r?.text, a.p.name)?.reply || '';
        if (H.chat() !== cid || !text) { if (!text) K.notify({ title: 'World', text: `${a.p.name}'s first message came back empty. Try again.`, tone: 'warn' }); return; }
        const i = Math.max(0, lastI());
        const m = { ...newMessage({ store: H.store(), from, to, text, clock, i, look: w.look, id: newId('w') }), alts: [text], s: 0 };
        H.save(addRecord(H.store(), m, i)); H.render(); H.changed();
        if (w.look !== 'letters') await answer(m, w);   // the other answers now; later turns follow the threads' rules
    } catch (err) { console.warn('[DLE] world: start a talk failed', err?.message || err); }
}

/** Her newest text to `other` still waiting for an answer (left on read, busy, asleep) — the "Answer now" button. Not while muted. */
function waiting(th, other) {
    const m = th.filter(x => x.from !== other && x.to === other).at(-1);
    return m && m.held && !worldNow().people?.[other]?.muted && !th.some(x => x.from === other && x.n > m.n) ? m : null;
}
/** Where someone is now, for reply times: their Messages dial, in the scene (the main character never counts as busy), the clock. */
function nowFor(w, key) {
    const L = live(), x = L && key !== MAIN ? personByKey(L.board, key) : null;
    return { m: Number(w.people?.[key]?.m) || 2, here: x ? personNow(L.state, x.cast, x.p).here === true : false, clock: clockNow() };
}
/** The grey status under a name in a conversation (Miinthe: all four stack): asleep · busy (in the scene) · slow to reply · online. */
function npcStatus(w, key) {
    if (w.alive.realReplies === false || w.look === 'letters' || (key !== MAIN && !personByKey(live()?.board, key))) return '';
    return replyStatus(nowFor(w, key));
}

/** `m.to` answers `m` (texting at once; letters once they arrive). */
async function answer(m, w, { alt = false, slow = false } = {}) {
    const L = live(); if (!L) return;
    // muted: a break from the world — they answer once unmuted (deliverLetters picks it up), never meanwhile
    if (w.people?.[m.to]?.muted) {
        if (!alt) H.save(updateMessage(H.store(), m.id, { held: true }));
        else K.notify({ title: 'World', text: `${nameOf(m.to)} is muted: unmute them on the board's World tab first.` });
        return;
    }
    const main = m.to === MAIN ? mainInfo() : null;
    const who = m.to === NEWS ? { reporter: true, rumor: true, key: NEWS, p: { name: nameOf(NEWS) } } : m.to === RUMOR ? { rumor: true, key: RUMOR, p: { name: nameOf(RUMOR) } } : main ? { main: true, key: MAIN, p: { name: main.name, card: main.card } } : personByKey(L.board, m.to);
    if (!who) { if (!alt) H.save(updateMessage(H.store(), m.id, { answered: true })); return; }   // nobody to answer (a voice, someone gone): never blocks the queue
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) {
        if (!slow) K.notify({ title: 'World', text: 'No AI connection for the world yet. Pick one in Settings › AI & connections › World (or give the story helper one).', tone: 'warn' });
        return;
    }
    const conv = m.to + '|' + m.from, look = w.look;
    if (busy.has(conv)) return;   // the newest of her texts is answered once this answer is done (see finally)
    busy.add(conv);
    const cid = H.chat(), stay = () => H.chat() === cid;   // another chat opened meanwhile → write nothing
    // pacing: Delivered → Read → typing → the answer (texting only; a letter arrives in story time anyway; a swipe types at once)
    const t0 = Date.now(), paced = look !== 'letters' && !alt && !slow, guess = pacing('x'.repeat(120));
    let readAt = t0;
    if (paced) setTimeout(() => { if (!busy.has(conv) || !stay()) return; H.save(updateMessage(H.store(), m.id, { read: new Date().toISOString() })); typing.add(conv); H.render(); }, guess.readMs), readAt = t0 + guess.readMs;
    else if (!slow) { typing.add(conv); }
    H.render();
    try {
        const clock = clockNow(), li = lastI();
        const th = threadOf(H.store(), m.to, m.from, clock, li).filter(x => !x.onWay || x.id === m.id);
        const thread = (alt ? th.slice(0, -1) : th).map(x => ({ who: nameOf(x.from), text: textOf(x), stamp: stampText(x.stamp) }));
        // the main story only for someone in the scene: away, they know what their knowledge list says, nothing more
        // the main character is in the main scene with {{user}}; their knowledge from messages is the world's own list
        // the rumor account knows what goes around (rumors, the feed) — never the main scene
        const now = who.rumor ? { here: false, knows: worldDigest(H.store(), nameOf, { posts: 3, msgs: 0 }).split('\n').filter(l => l.startsWith('- ')).map(l => ({ fact: l.slice(2) })) }
            : who.main ? { here: true, knows: H.store().records.filter(r => r.kind === 'mknow').map(r => ({ fact: r.fact })) } : personNow(L.state, who.cast, who.p);
        const chat = now.here ? (ctx()?.chat || []).filter(x => x && !x.is_system && typeof x.mes === 'string').slice(-STORY_WINDOW).map(x => ({ name: x.name, mes: x.mes })) : [];
        let lines = []; try { lines = storyLinesFor(liveWriterLines()); } catch { /* none */ }
        const p = replyPrompt({ discretion: discretionOf(w, m.to), name: who.p.name, card: who.reporter ? reporterCard(who.p.name, look) : who.rumor ? accountCard(who.p.name, look) : who.main ? charText(main.ch, main.name) : cardText(who.p), now, fromName: nameOf(m.from), userName: userName(), look, thread, story: chat, storyLines: lines, when: clock ? stampText({ day: clock.day, part: clock.part }) : '', mayPass: slow, quirks: quirksOf(w, m.to), feed: publicFeed() });
        const r = await callAI(p.system, p.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'world', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        if (window.__dleWorldDebug) console.log('[DLE] world answer', who.p.name, JSON.stringify({ system: p.system, user: p.user, raw: r?.text }));
        if (!stay()) return;
        if (slow && isPass(r?.text)) {   // they chose not to answer
            H.save(updateMessage(H.store(), m.id, { answered: true, passed: true }));
            const a = m.ask && H.store().records.find(x => x.kind === 'ask' && x.id === m.ask);
            if (a) spreadTip(w, a.tipper, `${a.tip}\n(You checked with someone who was there; they wouldn't say. Post it anyway, unconfirmed.)`, { mayAsk: false });
            return;
        }
        const ans = parseReply(r?.text, who.p.name);
        if (!ans) { K.notify({ title: 'World', text: `${who.p.name}'s answer came back unreadable. Try again.`, tone: 'warn' }); return; }
        if (paced) { const until = readAt + pacing(ans.reply).typingMs; if (Date.now() < until) await sleep(until - Date.now()); }
        if (!stay()) return;
        const st = H.store(), i = Math.max(0, lastI());
        if (alt) {
            H.save(updateMessage(st, m.alt.id, x => { const alts = Array.isArray(x.alts) ? x.alts : [x.text]; return { alts: [...alts, ans.reply], s: alts.length }; }));
        } else {
            // several messages in a row (their quirks): one bubble each, the next after a short typing pause
            const parts = look === 'letters' ? [ans.reply] : (splitParts(ans.reply).length ? splitParts(ans.reply) : [ans.reply]);
            // an answer to her own message (written as anyone) waits for her — the AI never writes her side of it (toMine)
            const back = { ...(slow ? { auto: true } : {}), ...(m.mine ? { toMine: true } : {}) };
            const reply = { ...newMessage({ store: st, from: m.to, to: m.from, text: parts[0], clock, i, look, id: newId('w') }), alts: [parts[0]], s: 0, ...back };
            let s2 = addRecord(st, reply, i);
            s2 = updateMessage(s2, m.id, { read: new Date().toISOString(), answered: true });
            H.save(s2);
            for (const part of parts.slice(1)) {
                if (paced) { H.render(); await sleep(Math.round(pacing(part).typingMs * 0.6)); }
                if (!stay()) return;
                H.save(addRecord(H.store(), { ...newMessage({ store: H.store(), from: m.to, to: m.from, text: part, clock, i, look, id: newId('w') }), alts: [part], s: 0, ...back }, i));
            }
            // the rumor account spreads the tip (a post, mixed with what others know); everyone else: what they learned, a meet-up
            if (who.reporter) giveComment(m);   // a comment for the news: into the article
            else if (who.rumor) {
                // the talk so far with the account, so a follow-up ("ask Spoon, she saw it too") is read as part of the same tip
                const talk = H.store().records.filter(r => r.kind === 'msg' && r.conv === m.conv && r.id !== m.id && r.id !== reply.id && !(Number(r.n) > Number(m.n))).slice(-6).map(r => `${nameOf(r.from)}: ${textOf(r)}`);
                spreadTip(w, m.from, textOf(m), { talk });
            }
            else {
                extract(who, m, parts.join('\n'), conn);   // its own small call, after the answer shows
                // the witness answered the rumor account's check (F1): now it posts, with what they said
                const a = m.ask && H.store().records.find(x => x.kind === 'ask' && x.id === m.ask);
                if (a) spreadTip(w, a.tipper, `${a.tip}\n\nYou checked with someone who was there (never name them). You asked: ${textOf(m)}\nThey answered: ${parts.join(' ')}`, { mayAsk: false });
            }
        }
    } catch (err) {
        console.warn('[DLE] world: answer failed', err);
        K.notify({ title: 'World', text: `${who.p.name} couldn't answer: ${err?.message || err}`, tone: 'warn' });
    } finally {
        busy.delete(conv); typing.delete(conv); H.changed(); H.render();
        // she sent another text while this one was being answered: answer the newest one now (bug hunt: it was dropped)
        if (!alt && !slow && stay() && look !== 'letters') {
            const next = H.store().records.filter(r => r.kind === 'msg' && r.conv === m.conv && r.from === m.from && r.to === m.to && r.mine && !r.answered && r.n > m.n).at(-1);
            if (next) answer(next, w);
        }
    }
}

/**
 * The news asks for a comment (Miinthe, 2026-10-19: "they request a comment over messenger like the board request. That could be
 * fun"): a message from the news account to {{user}}, no AI call. Her answer goes into the article (giveComment).
 */
export function askComment(w, post) {
    if (!H || !post) return;
    const i = Math.max(0, lastI()), clock = clockNow();
    H.save(addRecord(H.store(), { ...newMessage({ store: H.store(), from: NEWS, to: USER, text: commentAsk(nameOf(NEWS), post.title || post.text.slice(0, 80), w.look), clock, i, look: w.look, id: newId('w') }), alts: null, newsAsk: post.id, auto: true }, i));
    H.changed(); H.render();
    K.notify({ title: 'World', text: `${nameOf(NEWS)} would like a comment from ${userName()}: see Messages.` });
}
/** An answer to the news: the newest request it answers gets the words as an update in the article (once). */
function giveComment(m) {
    const ask = H.store().records.filter(r => r.kind === 'msg' && r.from === NEWS && r.to === m.from && r.newsAsk && !r.commented && r.n < m.n).at(-1);
    if (!ask) return;
    H.save(updateMessage(updatePost(H.store(), ask.newsAsk, p => withComment(p, nameOf(m.from), nameOf(NEWS), textOf(m))), ask.id, { commented: true }));
    K.notify({ title: 'World', text: `Your comment is in the article now (${nameOf(NEWS)}).`, tone: 'good' });
}

/** The newest public posts, news and rumors, as one line each (a rumor's real poster stays hidden). */
function publicFeed(n = 6) {
    return H.store().records.filter(r => r.kind === 'post').sort((a, b) => b.n - a.n).slice(0, n).reverse()
        .map(p => `${nameOf(p.by)}${p.rumor ? ' (a rumor)' : p.news ? ' (news)' : ''}: ${p.title ? p.title + ' — ' : ''}${String(p.text || '').replace(/\s+/g, ' ')}`);
}

/** The small second call: what the reader learned from the message, and whether a meet-up was settled. */
async function extract(who, m, reply, conn) {
    const cid = H.chat();
    try {
        const p = extractPrompt({ reader: who.p.name, writer: nameOf(m.from), message: textOf(m), reply });
        const r = await callAI(p.system, p.user, { ...conn, maxTokens: 300, caller: 'world', skipThrottle: true, jsonSchema: EXTRACT_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0 });
        if (window.__dleWorldDebug) console.log('[DLE] world extract', who.p.name, r?.text);
        if (H.chat() !== cid) return;
        const x = parseExtract(r?.text);
        // each on its own: a failing knowledge step must not swallow the meet-up (Miinthe's beach test found no plan)
        if (x.plan) { try { meetup(m.to, x.plan, nameOf(m.from)); } catch (err) { console.warn('[DLE] world: the meet-up failed', err?.message || err); } }
        try { learn(who, x.learned, m); } catch (err) { console.warn('[DLE] world: what they learned failed', err?.message || err); }
    } catch (err) { console.warn('[DLE] world: reading the exchange failed', err?.message || err); }
}

/** What they learned joins their Cast knowledge — logged at the newest main-chat message, Undo on the notice. */
function learn(who, learned, m) {
    if (!learned?.length) return;
    if (who.main) {   // the main character: the world's own list, given to the main writer (worldWriterLines)
        const recs = mainLearned(learned, nameOf(m.from), m.id, newId);
        if (!recs.length) return;
        let st = H.store(); for (const r of recs) st = addRecord(st, r, Math.max(0, lastI()));
        H.save(st);
        const ids = recs.map(r => r.id);
        K.notify({ title: 'World', text: `${who.p.name} now knows: ${recs.map(r => r.fact).join(' · ')}`, tone: 'good', undo: H.here(() => { H.save({ ...H.store(), records: H.store().records.filter(r => !ids.includes(r.id)) }); }) });
        return;
    }
    const L = live(); if (!L) return;
    const changes = learnedChanges(who.cast, who.p, learned, nameOf(m.from), newId);
    if (!changes.length) return;
    const st = applyCastChanges(L.board, L.state, changes, Math.max(0, lastI()), { who: 'world' });
    saveLiveState(st);
    const ids = changes.map(c => c.logId).filter(Boolean);
    H.save(updateMessage(H.store(), m.id, x => ({ logIds: [...(x.logIds || []), ...ids] })));
    K.notify({ title: 'World', text: `${who.p.name} now knows: ${changes.map(c => c.add.fact).join(' · ')}`, tone: 'good', undo: H.here(() => { undoCollections(ids); H.save(updateMessage(H.store(), m.id, x => ({ logIds: (x.logIds || []).filter(id => !ids.includes(id)) }))); }) });
}

/**
 * Clear a whole conversation (Miinthe, 2026-10-19: "deleting chatting / clearing chats with npc"): every message goes, and with
 * it what anyone learned from them — like deleting each one (their knowledge, the Cast director's copies). Undo brings
 * the messages back (not the knowledge, as with one message).
 */
function clearConv(conv) {
    const st = H.store(), ms = st.records.filter(r => r.kind === 'msg' && r.conv === conv);
    if (!ms.length) return;
    const ids = new Set(ms.map(m => m.id));
    const said = ms.flatMap(m => [m.text, ...(Array.isArray(m.alts) ? m.alts : [])]).map(t => String(t || '').trim()).filter(Boolean);
    const echoes = (live()?.state?.log || []).filter(e => e.kind === 'cast' && e.field === 'knows' && typeof e.quote === 'string' && e.quote.trim().length >= 15 && said.some(t => t.includes(e.quote.trim()))).map(e => e.id);
    const undoIds = [...new Set([...ms.flatMap(m => m.logIds || []), ...echoes])];
    if (undoIds.length) undoCollections(undoIds);
    H.save({ ...st, records: st.records.filter(r => !(ids.has(r.id) || (r.kind === 'mknow' && ids.has(r.msg)))) });
    editing = null; leaking = false; H.render(); H.changed();
    K.notify({ title: 'World', text: `Conversation cleared (${ms.length} message${ms.length === 1 ? '' : 's'}).`, undo: H.here(() => { let s2 = H.store(); for (const m of ms) s2 = addRecord(s2, { ...m, logIds: [] }, m.i); H.save(s2); H.render(); H.changed(); }) });
}

function del(id) {
    const st = H.store(), m = st.records.find(r => r.kind === 'msg' && r.id === id);
    if (!m) return;
    // what they learned from it goes with it — also what the Cast's director copied from it in a scene (it quotes the
    // message; found in Miinthe's test: Kettle still knew the sugar-jar secret after the message was deleted)
    const said = [m.text, ...(Array.isArray(m.alts) ? m.alts : [])].map(t => String(t || '').trim()).filter(Boolean);
    const echoes = (live()?.state?.log || []).filter(e => e.kind === 'cast' && e.field === 'knows' && typeof e.quote === 'string' && e.quote.trim().length >= 15 && said.some(t => t.includes(e.quote.trim()))).map(e => e.id);
    const undoIds = [...new Set([...(m.logIds || []), ...echoes])];
    if (undoIds.length) undoCollections(undoIds);
    const gone = st.records.filter(r => r.kind === 'mknow' && r.msg === id);
    let s2 = removeMessage(st, id);
    if (gone.length) s2 = { ...s2, records: s2.records.filter(r => !(r.kind === 'mknow' && r.msg === id)) };
    H.save(s2);
    editing = null; H.render();
    K.notify({ title: 'World', text: 'Message deleted.', undo: H.here(() => { H.save(addRecord(H.store(), { ...m, logIds: [] }, m.i)); H.render(); }) });
}

function swipe(id, dir, w) {
    const m = H.store().records.find(r => r.kind === 'msg' && r.id === id);
    if (!m) return;
    const to = swipeTo(m, dir);
    if (to) { H.save(updateMessage(H.store(), id, to)); H.render(); return; }
    // past the last version: they write another
    const asked = H.store().records.filter(r => r.kind === 'msg' && r.conv === m.conv && r.to === m.from && r.n < m.n).at(-1);
    if (asked) answer({ ...asked, alt: m }, w, { alt: true });
}

/**
 * A meet-up (Miinthe, 2026-10-19: "it should be later on in the story instead of instantly"): it becomes one of their Cast plans,
 * so the director brings them when the time or an opening comes (Cast step 2, "coming looking"); the main character has
 * no plan list — the main writer is told instead (mainWriterLines). Notice with Undo.
 */
function meetup(key, text, withName) {
    const at = Math.max(0, lastI());
    if (key === MAIN) {
        const rec = { kind: 'mplan', id: newId('mp'), text: clipT(text) };
        H.save(addRecord(H.store(), rec, at));
        K.notify({ title: 'World', text: `Planned with ${nameOf(MAIN)}: ${rec.text}. It comes up when the story gets there.`, tone: 'good', undo: H.here(() => H.save({ ...H.store(), records: H.store().records.filter(r => r.id !== rec.id) })) });
        return;
    }
    const L = live(), who = personByKey(L?.board, key);
    if (!who) return;
    const ch = meetupChange(who.cast, who.p, personNow(L.state, who.cast, who.p), text, newId);
    if (!ch) return;
    saveLiveState(applyCastChanges(L.board, L.state, [ch], at, { who: 'world' }));
    K.notify({ title: 'World', text: `${who.p.name} plans: ${ch.to.at(-1).text}. The story brings it up when the time comes.`, tone: 'good', undo: H.here(() => undoCollections([ch.logId])) });
}
const clipT = t => { const s = String(t || '').trim(); return s.length > 160 ? s.slice(0, 159) + '…' : s; };

/** Leak the ticked messages: whoever hears them knows what was in them (overheard; Undo). */
function leak(w) {
    const st = H.store(), msgs = st.records.filter(r => r.kind === 'msg' && leakSel.has(r.id)).sort((x, y) => x.n - y.n);
    if (!msgs.length || !leakTo.size) return;
    const facts = leakFacts(msgs, nameOf), at = Math.max(0, lastI()), L = live();
    const logIds = [], mknow = [];
    let state = L?.state;
    for (const k of leakTo) {
        if (k === RUMOR) { spreadTip(w, me, facts.join('\n'), { leak: true }); continue; }
        if (k === MAIN) { for (const f of facts) mknow.push({ kind: 'mknow', id: newId('k'), fact: f, from: 'a leak' }); continue; }
        const who = personByKey(L?.board, k);
        if (!who || !state) continue;
        const ch = leakChanges(who.cast, who.p, facts, newId);
        state = applyCastChanges(L.board, state, ch, at, { who: 'world' });
        logIds.push(...ch.map(c => c.logId).filter(Boolean));
    }
    if (logIds.length) saveLiveState(state);
    const names = [...leakTo].map(nameOf);
    let s2 = H.store();
    for (const r of mknow) s2 = addRecord(s2, r, at);
    for (const m of msgs) s2 = updateMessage(s2, m.id, x => ({ leaked: [...new Set([...(x.leaked || []), ...names])] }));
    H.save(s2);
    const ids = mknow.map(r => r.id), mids = msgs.map(m => m.id);
    stopLeak(); H.render();
    K.notify({ title: 'World', text: `Leaked to ${names.join(', ')}: ${msgs.length} message${msgs.length === 1 ? '' : 's'}. They know now.`, tone: 'good', undo: H.here(() => {
        if (logIds.length) undoCollections(logIds);
        H.save(mids.reduce((acc, id) => updateMessage(acc, id, x => ({ leaked: (x.leaked || []).filter(n => !names.includes(n)) })), { ...H.store(), records: H.store().records.filter(r => !ids.includes(r.id)) }));
        H.render();
    }) });
}

function cardText(p) {
    const ch = p.card ? (ctx()?.characters || []).find(c => c.avatar === p.card) : null;
    return charText(ch, p.name);
}
function charText(ch, name) {
    if (!ch) return '';
    const p = { name };
    const fill = s => String(s || '').replaceAll('{{char}}', p.name).replaceAll('{{user}}', userName());
    return [fill(ch.description || ch.data?.description), ch.personality || ch.data?.personality ? `Personality: ${fill(ch.personality || ch.data?.personality)}` : '',
        ch.mes_example || ch.data?.mes_example ? `How ${p.name} talks:\n${fill(ch.mes_example || ch.data?.mes_example).replace(/<START>\s*/gi, '')}` : ''].filter(Boolean).join('\n');
}

/** After the story moved on: letters that arrived get answered (each answer is a letter on its way in turn). */
export function deliverLetters(w) {
    if (!H || !w) return;
    deliverGroups(w);
    for (const m of repliesDue(H.store(), clockNow(), lastI())) {
        if (w.people?.[m.to]?.muted) continue;   // muted: it waits for them
        if (m.letter) answer(m, { ...w, look: 'letters' });
        else if (m.held) {   // unmuted, or a slow / busy / sleeping reply whose time has come: answered now
            if (m.wait && !waitOver(m.wait, { lastI: lastI(), ...nowFor(w, m.to) })) continue;
            H.save(updateMessage(H.store(), m.id, { held: false, read: m.read || new Date().toISOString() })); answer(m, w);
        }
        else H.save(updateMessage(H.store(), m.id, { answered: true }));   // a text that was never answered stays unanswered
    }
}

// ── people write first (stage 2) ────────────────────────────────────────────

let ticking = false, warnedNoConn = false;
/**
 * Maybe tick: `trigger` 'open' (the panel opened) · 'reply' (a new main-chat reply) · 'moment' (the story helper said
 * big / quiet). One call decides who, if anyone, writes to {{user}} now; their messages are `auto` (a swipe of that
 * reply replaces them). Nothing while paused or without a World connection.
 */
export async function maybeTick(w, trigger, moment = null) {
    if (!H || !w || ticking) return;
    const L = live(); if (!L) return;
    const clock = clockNow(), nowI = lastI();
    const reason = tickReason({ alive: w.alive, paused: w.paused, trigger, moment, nowI, day: clock?.day ?? null, last: lastTick(H.store()) });
    if (!reason) return;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) {
        if (!warnedNoConn) { warnedNoConn = true; K.notify({ title: 'World', text: 'People could write to you first, but the world has no AI connection yet: Settings › AI & connections › World.', tone: 'warn' }); }
        return;
    }
    ticking = true;
    const cid = H.chat();
    // the tick is recorded first, so the same moment never asks twice (it is `auto`: a swipe of this reply takes it back)
    H.save(addRecord(H.store(), { kind: 'tick', id: newId('t'), reason, day: clock?.day ?? null, auto: true }, nowI));
    try {
        const main = w.first.main ? mainInfo() : null;
        const cast = w.first.cast ? peopleOf(L.board, L.state) : [];
        const writers = [...(main ? [{ key: MAIN, name: main.name, card: charText(main.ch, main.name), here: false, wants: '', plans: H.store().records.filter(r => r.kind === 'mplan').map(r => r.text), knows: H.store().records.filter(r => r.kind === 'mknow').map(r => r.fact) }] : []),
            ...cast.map(x => { const now = personNow(L.state, x.cast, x.p); return { key: x.key, name: x.p.name, card: cardText(x.p), here: now.here, wants: now.wants, plans: now.plans.map(p => p.text), knows: now.knows.map(k => k.fact) }; })];
        for (const p of writers) p.quirks = quirksOf(w, p.key);
        const muted = new Set(writers.filter(p => w.people?.[p.key]?.muted === true || neverTalk(w, p.key, USER)).map(p => p.name));
        writers.splice(0, writers.length, ...writers.filter(p => !muted.has(p.name)));   // muted people (and those who never talk to her) never write first
        if (!writers.length || !w.sections.msgs) return reason;   // the reason goes on to the feed (world.js)
        const dm = discretionMap(w); for (const p of writers) p.discretion = dm.get(p.key) || '';   // who they never gossip about (built once)
        for (const p of writers) p.last = threadOf(H.store(), USER, p.key, clock, nowI).filter(m => !m.onWay).slice(-3).map(m => ({ who: nameOf(m.from), text: textOf(m) }));
        const story = (ctx()?.chat || []).filter(x => x && !x.is_system && typeof x.mes === 'string').slice(-4).map(x => ({ name: x.name, mes: x.mes }));
        // a big moment travels: the world is told what happened (the newest message), people away may have heard of it
        const event = reason === 'big' ? (story.at(-1) ? `${story.at(-1).name}: ${story.at(-1).mes}` : '') : '';
        // no main scene for the writers: people in the scene don't text, and those away never saw it (found live: an away Kettle knew about the tape)
        const p = tickPrompt({ userName: userName(), people: writers, reason, look: w.look, when: clock ? stampText({ day: clock.day, part: clock.part }) : '', story: [], event });
        const r = await callAI(p.system, p.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 800), caller: 'world', skipThrottle: true, jsonSchema: TICK_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        if (window.__dleWorldDebug) console.log('[DLE] world tick', reason, r?.text, '\n---\n', p.user);
        if (H.chat() !== cid) return null;   // another chat opened meanwhile: nothing goes there
        const out = parseTick(r?.text, writers.map(x => x.name));
        let st = H.store();
        const i = lastI();
        for (const m of out) {
            const from = writers.find(x => x.name === m.from);
            if (!from || from.here) continue;   // people in the scene talk, they don't text
            for (const part of (w.look === 'letters' ? [m.text] : splitParts(m.text))) st = addRecord(st, { ...newMessage({ store: st, from: from.key, to: USER, text: part, clock, i, look: w.look, id: newId('w') }), alts: [part], s: 0, auto: true, why: m.why }, i);
        }
        H.save(st);
    } catch (err) {
        console.warn('[DLE] world: tick failed', err?.message || err);
    } finally {
        ticking = false; H.changed(); H.render();
    }
    return reason;   // world.js hands it on to the feed's tick
}

// ── planned messages (stage 3) ──────────────────────────────────────────────

let firing = false;
/** Their quirks (the board's World tab), or ''. */
const quirksOf = (w, key) => String(w?.people?.[key]?.quirks || '').trim();

/** Who a key is, with what the prompt needs: { key, name, card text, now } (null when gone). */
function whoIs(L, key) {
    if (key === NEWS) { const a = newsAccount(worldNow()); return { key, voice: true, p: { name: a.name }, text: a.about, now: null }; }
    if (key === RUMOR) { const w = worldNow(), name = rumorName(w); return { key, voice: true, p: { name }, text: accountCard(name, w.look), now: null }; }   // ⋯ Write it again on a rumor post
    if (String(key).startsWith('v:')) { const v = voiceOf(key); return v ? { key, voice: true, p: { name: v.name }, text: v.bio || '', now: null } : null; }
    if (key === MAIN) { const m = mainInfo(); return m ? { key, main: true, p: { name: m.name, card: m.card }, text: charText(m.ch, m.name), now: { knows: H.store().records.filter(r => r.kind === 'mknow').map(r => ({ fact: r.fact })) } } : null; }
    const x = personByKey(L.board, key);
    return x ? { ...x, text: cardText(x.p), now: personNow(L.state, x.cast, x.p) } : null;
}
/**
 * Send the planned messages whose moment has come (the board's World tab). Once per chat; a missed chance is recorded
 * too, so it isn't rolled again. The firing and the message are `auto`: a swipe of the reply that set them off takes
 * them back, and they go out again when their moment comes again.
 */
export async function firePlans(w) {
    if (!H || !w || firing || w.paused) return;
    const L = live(); if (!L) return;
    const due = duePlans(L.board, L.state, w.planned, H.store(), Math.random, k => w.people?.[k]?.muted === true);
    if (!due.length) return;
    firing = true;
    const cid = H.chat();
    try {
        const conn = resolveConnectionConfig('world'), clock = clockNow();
        for (const { plan, hit } of due) {
            if (H.chat() !== cid) break;
            const i = Math.max(0, lastI());
            // recorded once it went out (or the chance missed): a plan that couldn't go out yet tries again next time
            const fired = () => H.save(addRecord(H.store(), { kind: 'fired', id: newId('f'), plan: plan.id, hit, auto: true }, i));
            if (!hit) { fired(); continue; }
            const isPost = plan.kind === 'post' || plan.kind === 'news' || plan.kind === 'rumor';   // stage 4–5: a planned post, news item or rumor goes to the feed
            const from = whoIs(L, plan.from), to = isPost ? { key: 'feed', p: { name: 'the feed' } } : plan.to === USER ? { key: USER, p: { name: userName() } } : whoIs(L, plan.to);
            if (!from || !to || from.key === to.key) continue;
            let text = plan.words === 'mine' ? plan.text : '';
            if (plan.words !== 'mine') {
                if (conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: `A planned message from ${from.p.name} is due, but the world has no AI connection to write it: Settings › AI & connections › World.`, tone: 'warn' }); continue; }
                const p = plannedPrompt({ discretion: discretionOf(w, from.key), name: from.p.name, card: from.text, now: from.now, toName: to.p.name, note: plan.text, look: w.look, when: clock ? stampText({ day: clock.day, part: clock.part }) : '', quirks: quirksOf(w, from.key) || from.voice && voiceOf(from.key)?.quirks || '', kind: plan.kind });
                const r = await callAI(p.system, p.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'world', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
                text = parseReply(r?.text, from.p.name)?.reply || '';
                if (H.chat() !== cid) break;
            }
            if (!text) continue;
            fired();
            if (isPost) {
                const lines = text.split('\n'), news = plan.kind === 'news';
                const title = news ? lines[0].replace(/^#+\s*|\*\*/g, '').trim() : '', body = news && lines.length > 1 ? lines.slice(1).join('\n').trim() : text;
                const c = clockNow();
                // a planned rumor goes out through the rumor account; whoever it's from is behind it (and knows)
                const rumor = plan.kind === 'rumor' ? { rumor: { kind: 'planned', truth: plan.words === 'mine' ? '' : plan.text, from: 'Planned on the board', who: from.key, heard: [from.key] } } : {};
                H.save(addRecord(H.store(), { ...newPost({ store: H.store(), by: rumor.rumor ? RUMOR : from.key, text: body || text, title, news, stamp: c ? { day: c.day, part: c.part || '' } : { msg: i }, id: newId('p'), crowd: Math.round(3 + Math.random() * 20), auto: true }), ...rumor, planned: plan.id }, i));
                continue;
            }
            const parts = w.look === 'letters' || plan.words === 'mine' ? [text] : (splitParts(text).length ? splitParts(text) : [text]);
            let m = null;
            for (const part of parts) { const r = { ...newMessage({ store: H.store(), from: from.key, to: to.key, text: part, clock, i, look: w.look, id: newId('w') }), alts: [part], s: 0, auto: true, planned: plan.id }; m ||= r; H.save(addRecord(H.store(), r, i)); }
            // a planned message to someone else: they read it — what they learn joins their knowledge
            if (to.key !== USER && conn.profileId) extract(to, { ...m, text: parts.join('\n'), alts: null }, '(not answered yet)', conn);
        }
    } catch (err) {
        console.warn('[DLE] world: planned message failed', err?.message || err);
    } finally {
        firing = false; H.changed(); H.render();
    }
}

/**
 * ↻ on a post or news item (Miinthe, 2026-10-19: the world's posts get their own regen): its author writes it again —
 * same moment, fresh words. Returns { title, text } or null.
 */
export async function writeAgain(w, p) {
    const L = live(); if (!L || !p) return null;
    const from = whoIs(L, p.by); if (!from) return null;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: 'Writing it again needs the world\'s AI connection: Settings › AI & connections › World.', tone: 'warn' }); return null; }
    const c = clockNow(), news = !!p.news;
    const pr = plannedPrompt({ discretion: discretionOf(w, from.key), name: from.p.name, card: from.text, now: from.now, toName: 'the feed', note: `Write this ${news ? 'news item' : 'post'} again, differently: the same moment, fresh words.\n${p.title ? p.title + '\n' : ''}${p.text}`, look: w.look, when: c ? stampText({ day: c.day, part: c.part }) : '', quirks: quirksOf(w, from.key) || from.voice && voiceOf(from.key)?.quirks || '', kind: news ? 'news' : 'post' });
    const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 700), caller: 'world', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.95 });
    const text = parseReply(r?.text, from.p.name)?.reply || '';
    if (!text) return null;
    if (!news) return { title: '', text };
    const lines = text.split('\n'), title = lines[0].replace(/^#+\s*|\*\*/g, '').trim(), body = lines.slice(1).join('\n').trim();
    return { title, text: body || text };
}

/** After a main-chat exchange: at most one AI-to-AI answer, and not after every exchange (nextThread's gap and streak). */
/**
 * The rumor account checks a tip with a witness (Miinthe, F1: "ask Spoon" → an NPC-to-NPC chat, "limited … over a main
 * exchange or two"): one main exchange after the tip it texts them; one more, and they answer (or not); then it posts.
 * One check at a time (rumors.js openAsk). The texts show under Between others.
 */
let asking = false;
export async function fireAsks(w) {
    if (!H || !w || w.paused || asking || ticking || firing) return;
    const a = openAsk(H.store()), li = lastI();
    if (!a || li < a.due) return;
    asking = true;
    const cid = H.chat(), done = patch => H.save({ ...H.store(), records: H.store().records.map(r => (r.id === a.id ? { ...r, ...patch } : r)) });
    try {
        const L = live(), to = L ? whoIs(L, a.who) : null;
        if (!to || w.people?.[a.who]?.muted) { done({ stage: 'done' }); spreadTip(w, a.tipper, a.tip, { mayAsk: false }); return; }
        if (a.stage === 'wait') {
            const conn = resolveConnectionConfig('world');
            if (conn.mode !== 'profile' || !conn.profileId) return;
            const name = rumorName(w), clock = clockNow();
            const p = plannedPrompt({ name, card: accountCard(name, w.look), toName: to.p.name, note: `Check a tip with ${to.p.name}, in your own way: ask whether they saw it or know something. Never say who tipped you. The tip: ${a.tip}`, look: w.look, when: clock ? stampText({ day: clock.day, part: clock.part }) : '' });
            const r = await callAI(p.system, p.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 400), caller: 'world', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
            const text = parseReply(r?.text, name)?.reply || '';
            if (H.chat() !== cid || !text) return;
            const id = newId('w');
            H.save(addRecord(H.store(), { ...newMessage({ store: H.store(), from: RUMOR, to: a.who, text, clock, i: Math.max(0, li), look: w.look, id }), alts: [text], s: 0, auto: true, ask: a.id }, Math.max(0, li)));
            done({ stage: 'sent', msg: id, due: li + 2 });
        } else {
            done({ stage: 'done' });
            const m = H.store().records.find(r => r.kind === 'msg' && r.id === a.msg);
            if (m && !m.answered) await answer(m, w, { slow: true });
        }
    } catch (err) { console.warn('[DLE] world: the check with a witness failed', err?.message || err); }
    finally { asking = false; H.changed(); H.render(); }
}

export async function continueThreads(w) {
    if (!H || !w || w.paused || ticking || firing) return;
    // a muted person takes no part; two who never talk to each other never answer each other
    const m = nextThread(H.store(), clockNow(), lastI(), x => !!(w.people?.[x.to]?.muted || w.people?.[x.from]?.muted || neverTalk(w, x.from, x.to)));
    if (!m) return;
    H.save(addRecord(H.store(), { kind: 'thread', id: newId('th'), msg: m.id, auto: true }, Math.max(0, lastI())));
    await answer(m, w, { slow: true });
}

export function resetMessagesView() { resetGroups(); talkForm = null; openWith = null; peekConv = null; editing = null; asMenu = false; meetOpen = false; stopLeak(); }

/** Peeking at a conversation between others: read-only, both sides, nothing marked read. */
function renderPeek(body, asRow, letters, clock, li) {
    const [a, b] = peekConv.split('|');
    const th = convThread(H.store(), peekConv, clock, li);
    let h = `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-back title="All conversations" aria-label="All conversations">${I('back')}</button><span class="av2">${avatar(a, 'fa')}${avatar(b, 'fa')}</span>` +
        `<span class="who"><b>${esc(nameOf(a))} ↔ ${esc(nameOf(b))}</b><small>spying — they don't know you're reading</small></span>` +
        `<button type="button" class="dk-ib" data-askmero="${esc(peekConv)}" title="Ask Mero about this conversation" aria-label="Ask Mero about this conversation">${I('mero')}</button>` +
        `<button type="button" class="dk-ib${leaking ? ' on' : ''}" data-leak title="Leak… (pick messages and who hears them)" aria-label="Leak">${I('leak')}</button>` + `<button type="button" class="dk-ib" data-clearconv="${esc(peekConv)}" title="Clear this conversation: every message, and what anyone learned from it (Undo)" aria-label="Clear this conversation">${I('trash')}</button>` + '</div>';
    h += threadHtml(th, { me: b, other: a, letters, peek: true });
    h += leaking ? leakBar() : `<div class="dle-wd-peeknote">To write here, pick ${esc(nameOf(a))} or ${esc(nameOf(b))} under Writing as.</div>`;
    body.innerHTML = asRow + h;   // the Writing-as menu works here too (the note below says to use it)
    const t = body.querySelector('.dle-wd-thread'); if (t && !leaking) t.scrollTop = t.scrollHeight;
}

/** The main writer's line: what the main character knows from messages (index.js adds it to the story block). */
export function mainWriterLines() {
    if (!H) return [];
    const main = mainInfo();
    if (!main) return [];
    return [mainKnowsLine(H.store(), main.name, userName()), mainPlanLine(H.store(), main.name)].filter(Boolean);
}
