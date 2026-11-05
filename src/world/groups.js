/**
 * World layer — group chats (groups-pure.js has the rules). Drawn inside Messages: "+ New group" and the groups she is
 * in at the top of the list, the others under Between others; a group opens like a conversation (each bubble with its
 * sender), ⋯ for members, rename, clear and delete. Answers come from the members who have something to add, each in
 * their own time: those who are slow, busy in the scene or asleep answer later (a `gwait` record, picked up after the
 * story moves on — deliverGroups).
 */
import { getContext } from '../../../../../extensions.js';
import { resolveConnectionConfig } from '../../settings.js';
import { callAI } from '../ai/ai.js';
import { live } from '../board-live.js';
import { icon as I } from '../kit/icons.js';
import * as K from '../kit/kit.js';
import { addRecord, neverTalk } from './world-pure.js';
import { USER, MAIN, peopleOf, personByKey, personNow, storyClock, newMessage, textOf, stampText, replyWait, waitOver, replyStatus } from './messages-pure.js';
import { groupConv, groupsOf, groupMsgs, newGroup, groupMax, GROUP_SCHEMA, groupPrompt, parseGroup } from './groups-pure.js';
import { avatarOf as avatar, nameOfKey as nameOf, mainInfo, cardText, charText, threadHtmlFor, currentMe, pinBtn } from './messages.js';
import { discretionMap } from './feed.js';   // who people never gossip about (Miinthe 2026-10-26)

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lastI = () => (getContext()?.chat?.length ?? 0) - 1;
const clockNow = () => { const L = live(); return L ? storyClock(L.board, L.state) : null; };
const stack = keys => `<span class="av2 g3">${keys.slice(0, 3).map(k => avatar(k, 'fa')).join('')}</span>`;

let H = null;
export function hookGroups(h) { H = h; }
let openG = null, form = null, menu = false, renaming = false, membersOpen = false;
const busy = new Set();
export const groupOpen = () => !!openG || !!form;
export function resetGroups() { openG = null; form = null; menu = false; renaming = false; membersOpen = false; }

/** Who can be in a group: {{user}}, the main character, the Cast. */
function candidates() {
    const L = live(); if (!L) return [];
    const m = mainInfo();
    return [USER, ...(m ? [MAIN] : []), ...peopleOf(L.board, L.state).map(x => x.key)];
}
/** Where someone is now — for reply times and the status under a name. */
function nowOf(w, key) {
    const L = live(), clock = clockNow();
    const x = L && key !== USER && key !== MAIN ? personByKey(L.board, key) : null;
    const here = x ? personNow(L.state, x.cast, x.p).here === true : false;   // the main character is with her: never "busy" for that
    return { m: Number(w.people?.[key]?.m) || 2, here, clock };
}
export const statusOf = (w, key) => (w.alive.realReplies === false ? '' : replyStatus(nowOf(w, key)));

// ── the list ────────────────────────────────────────────────────────────────

/** Rows for the Messages list: [mine (groups `me` is in), others (to peek at)]. */
export function groupRows(w, me) {
    if (w.look === 'letters' || !H) return { btn: '', pinned: '', rest: '', others: [] };
    const st = H.store(), gs = groupsOf(st);
    const row = (g, peek) => {
        const last = groupMsgs(st, g.id).filter(m => !m.later).at(-1), unread = peek ? 0 : groupMsgs(st, g.id).filter(m => m.from !== me && !m.read).length;
        return { n: last ? last.n : -1, html: `<button type="button" class="dle-wd-row${unread ? ' unread' : ''}${peek ? ' peek' : ''}" data-g-open="${esc(g.id)}">${stack(g.members.filter(k => k !== me))}` +
            `<span class="nm">${(st.pins || []).includes(groupConv(g.id)) ? '<span class="pin" title="Pinned">★</span>' : ''}${esc(g.name)}</span><span class="tm">${last ? esc(stampText(last.stamp)) : ''}</span>` +
            `<span class="pv${peek ? ' blur' : ''}">${last ? `${esc(nameOf(last.from))}: ${esc(textOf(last))}` : '<i>No messages yet</i>'}</span>${unread ? '<span class="ud" aria-label="unread"></span>' : ''}</button>` };
    };
    const pins = st.pins || [];
    const mine = gs.filter(g => g.members.includes(me)).map(g => ({ ...row(g, false), pin: pins.includes(groupConv(g.id)) })).sort((a, b) => b.n - a.n);
    return { btn: '<div class="dle-wd-newg"><button type="button" class="dk-btn" data-g-new>+ New group</button></div>', pinned: mine.filter(r => r.pin).map(r => r.html).join(''), rest: mine.filter(r => !r.pin).map(r => r.html).join(''), others: gs.filter(g => !g.members.includes(me)).map(g => row(g, true)) };
}

// ── a group, or the new-group form ─────────────────────────────────────────────

export function renderGroup(body, w, asRow) {
    if (form) { body.innerHTML = asRow + formHtml(w); body.querySelector('[data-g-name]')?.focus(); return; }
    const st = H.store(), g = groupsOf(st).find(x => x.id === openG);
    if (!g) { openG = null; H.render(); return; }
    const me = currentMe(), inIt = g.members.includes(me);
    // what arrived for her is read now
    const unread = groupMsgs(st, g.id).filter(m => m.from !== me && !m.read && inIt);
    if (unread.length) { const ids = new Set(unread.map(m => m.id)), at = new Date().toISOString(); H.save({ ...st, records: st.records.map(r => (ids.has(r.id) ? { ...r, read: at } : r)) }); H.changed(); }
    const th = groupMsgs(H.store(), g.id);
    const others = g.members.filter(k => k !== me);
    let h = `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-g-back title="All conversations" aria-label="All conversations">${I('back')}</button>${stack(others)}` +
        `<span class="who">${renaming ? `<input class="dk-field" data-g-rename value="${esc(g.name)}" aria-label="The group's name">` : `<b>${esc(g.name)}</b>`}<small>${inIt ? others.map(k => `${esc(nameOf(k))}${statusOf(w, k) && statusOf(w, k) !== 'online' ? ` (${esc(statusOf(w, k))})` : ''}`).join(', ') : "spying — they don't know you're reading"}</small></span>` +
        (inIt && st.records.some(r => r.kind === 'gwait' && r.group === g.id) ? `<button type="button" class="dk-ib on" data-g-nudge title="Answer now: those still taking their time reply right away" aria-label="Answer now">${I('send')}</button>` : '') +
        pinBtn(groupConv(g.id)) +
        `<button type="button" class="dk-ib" data-askmero="${esc(groupConv(g.id))}" title="Ask Mero about this group" aria-label="Ask Mero about this group">${I('mero')}</button>` +
        `<button type="button" class="dk-ib" data-g-menu title="Members, rename, clear, delete" aria-label="Group menu" aria-expanded="${menu}">${I('more')}</button></div>`;
    if (menu) h += `<div class="dle-wd-gmenu" role="menu"><button type="button" role="menuitem" data-g-members>Members<small>add or take someone out</small></button><button type="button" role="menuitem" data-g-ren>Rename</button><button type="button" role="menuitem" data-g-clear>Clear conversation<small>every message, and what was learned from it (Undo)</small></button><button type="button" role="menuitem" data-g-del>Delete group<small>with its messages (Undo)</small></button></div>`;
    if (membersOpen) h += `<div class="dle-wd-meet"><div class="chips">${candidates().map(k => `<button type="button" class="dk-chip${g.members.includes(k) ? ' on' : ''}" data-g-mem="${esc(k)}" aria-pressed="${g.members.includes(k)}">${avatar(k, 'fa')}${esc(nameOf(k))}</button>`).join('')}</div><button type="button" class="dk-btn" data-g-members>Done</button></div>`;
    h += threadHtmlFor(th, { me, group: true, letters: false, typing: busy.has(g.id) });
    h += inIt ? `<div class="dle-wd-compose"><button type="button" class="dk-ib" data-g-photo title="Attach a photo (described)" aria-label="Attach a photo">📷</button><textarea rows="1" class="dk-field" data-g-cmp data-tagbox placeholder="Message ${esc(g.name)}${me === USER ? '' : ' as ' + esc(nameOf(me))}…" aria-label="Write to the group"></textarea><button type="button" class="send" data-g-send title="Send">${I('send')}</button></div>`
        : `<div class="dle-wd-peeknote">To write here, pick ${g.members.map(k => esc(nameOf(k))).join(', ')} under Writing as.</div>`;
    body.innerHTML = asRow + h;
    const t = body.querySelector('.dle-wd-thread'); if (t) t.scrollTop = t.scrollHeight;
    if (renaming) body.querySelector('[data-g-rename]')?.focus();
}

function formHtml(w) {
    const pairs = [];
    const ms = [...form.members];
    for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) if (neverTalk(w, ms[a], ms[b])) pairs.push(`${nameOf(ms[a])} and ${nameOf(ms[b])}`);
    const ok = form.members.size >= 3;
    return `<div class="dle-wd-cvh"><button type="button" class="dk-ib" data-g-back title="Cancel" aria-label="Cancel">${I('back')}</button><span class="who"><b>New group</b></span></div>
      <div class="dle-wd-gform"><label>Name<input class="dk-field" data-g-name value="${esc(form.name)}" placeholder="e.g. Kitchen crew"></label>
      <div><span class="lt">Members</span><div class="chips">${candidates().map(k => `<button type="button" class="dk-chip${form.members.has(k) ? ' on' : ''}" data-g-pick="${esc(k)}" aria-pressed="${form.members.has(k)}">${avatar(k, 'fa')}${esc(nameOf(k))}${k === USER ? ' <small>(you)</small>' : k === MAIN ? ' <small>(main)</small>' : ''}</button>`).join('')}</div></div>
      ${pairs.length ? `<div class="warn">${esc(pairs.join('; '))} never talk to each other (board rule), not even here.</div>` : ''}
      <div class="hint">${form.members.has(currentMe()) ? 'You are in it: you write, and whoever has something to add answers.' : 'You are not in it: a group only for them. You read it under Between others.'}</div>
      <div class="btns"><button type="button" class="dk-btn dk-primary" data-g-create ${ok ? '' : 'disabled'}>Start the group</button><button type="button" class="dk-btn" data-g-back>Cancel</button></div>
      <div class="hint">At least three people (you count).</div></div>`;
}

// ── acting ──────────────────────────────────────────────────────────────────

export function onGroupClick(e, body, w) {
    const q = s => e.target.closest(s);
    if (q('[data-g-new]')) { form = { name: '', members: new Set([currentMe()]) }; openG = null; H.render(); return true; }
    if (q('[data-g-open]')) { openG = q('[data-g-open]').dataset.gOpen; form = null; menu = false; membersOpen = false; renaming = false; H.render(); return true; }
    if (!form && !openG) return false;
    if (q('[data-g-back]')) { resetGroups(); H.render(); return true; }
    if (form) {
        if (q('[data-g-pick]')) { const k = q('[data-g-pick]').dataset.gPick; form.name = body.querySelector('[data-g-name]')?.value ?? form.name; if (form.members.has(k)) form.members.delete(k); else form.members.add(k); H.render(); return true; }
        if (q('[data-g-create]')) { create(body); return true; }
        return false;
    }
    const st = H.store(), g = groupsOf(st).find(x => x.id === openG); if (!g) return false;
    if (q('[data-g-menu]')) { menu = !menu; H.render(); return true; }
    if (q('[data-g-members]')) { membersOpen = !membersOpen; menu = false; H.render(); return true; }
    if (q('[data-g-mem]')) {
        const k = q('[data-g-mem]').dataset.gMem, has = g.members.includes(k);
        if (has && g.members.length <= 3) { K.notify({ title: 'World', text: 'A group needs at least three people.' }); return true; }
        save(g.id, { members: has ? g.members.filter(x => x !== k) : [...g.members, k] }); H.render(); return true;
    }
    if (q('[data-g-ren]')) { renaming = true; menu = false; H.render(); return true; }
    if (q('[data-g-clear]')) { menu = false; clear(g, false); return true; }
    if (q('[data-g-del]')) { menu = false; clear(g, true); return true; }
    if (q('[data-g-send]')) { send(body, w, g); return true; }
    if (q('[data-g-nudge]')) { nudge(w, g); return true; }
    if (q('[data-g-photo]')) { const ta = body.querySelector('[data-g-cmp]'); if (ta) { ta.value += (ta.value && !/\s$/.test(ta.value) ? '\n' : '') + '[photo: ]'; ta.focus(); ta.setSelectionRange(ta.value.length - 1, ta.value.length - 1); } return true; }
    return false;
}
export function onGroupKey(e, body, w) {
    if (!openG && !form) return false;
    if (e.target.matches?.('[data-g-rename]') && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); const v = e.target.value.trim(); if (e.key === 'Enter' && v) save(openG, { name: v.slice(0, 60) }); renaming = false; H.render(); return true; }
    if (e.target.matches?.('[data-g-name]') && e.key === 'Enter') { e.preventDefault(); create(body); return true; }
    if (e.target.matches?.('[data-g-cmp]') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const g = groupsOf(H.store()).find(x => x.id === openG); if (g) send(body, w, g); return true; }
    return false;
}

function save(id, patch) { H.save({ ...H.store(), records: H.store().records.map(r => (r.kind === 'group' && r.id === id ? { ...r, ...patch } : r)) }); H.changed(); }

function create(body) {
    form.name = body.querySelector('[data-g-name]')?.value?.trim() || form.name || '';
    const g = newGroup({ id: newId('g'), name: form.name || [...form.members].filter(k => k !== USER).map(nameOf).join(', '), members: [...form.members] });
    if (!g) { K.notify({ title: 'World', text: 'A group needs at least three people (you count).' }); return; }
    H.save(addRecord(H.store(), g, Math.max(0, lastI())));
    openG = g.id; form = null; H.render(); H.changed();
}

/** Clear its messages (and what was learned from them) — or delete the whole group. Undo brings it back. */
function clear(g, whole) {
    const st = H.store(), ms = groupMsgs(st, g.id), ids = new Set(ms.map(m => m.id));
    const gone = st.records.filter(r => ids.has(r.id) || (r.kind === 'mknow' && ids.has(r.msg)) || (r.kind === 'gwait' && r.group === g.id) || (whole && r.id === g.id));
    const logIds = ms.flatMap(m => m.logIds || []);
    if (logIds.length) import('../autotrack.js').then(m => m.undoCollections(logIds)).catch(() => {});
    H.save({ ...st, records: st.records.filter(r => !gone.includes(r)) });
    if (whole) resetGroups();
    H.render(); H.changed();
    K.notify({ title: 'World', text: whole ? `Group "${g.name}" deleted.` : `Group "${g.name}" cleared (${ms.length} message${ms.length === 1 ? '' : 's'}).`, undo: H.here(() => { let s2 = H.store(); for (const r of gone) if (r.kind !== 'mknow') s2 = addRecord(s2, { ...r, ...(r.kind === 'msg' ? { logIds: [] } : {}) }, r.i); H.save(s2); H.render(); H.changed(); }) });
}

function send(body, w, g) {
    const ta = body.querySelector('[data-g-cmp]'), text = (ta?.value || '').trim();
    const me = currentMe();
    if (!text || !g.members.includes(me)) return;
    const st = H.store(), clock = clockNow(), i = Math.max(0, lastI());
    const m = { ...newMessage({ store: st, from: me, to: groupConv(g.id), text, clock, i, look: 'phone', id: newId('w') }), conv: groupConv(g.id), group: g.id, mine: true, read: new Date().toISOString() };
    H.save(addRecord(st, m, i));
    ta.value = '';
    H.render();
    answer(w, g, m);
}

/**
 * The members answer `m`: those free now in one call (as many as the pace allows), the others later — each one who is
 * slow, busy or asleep gets a `gwait` and may still chime in once the story moves on. `only`: just this member (a late
 * reply; they may pass).
 */
export async function answer(w, g, m, { only = null, these = null } = {}) {
    if (!H || !w || w.paused) return;
    const L = live(); if (!L) return;
    const conn = resolveConnectionConfig('world');
    if (conn.mode !== 'profile' || !conn.profileId) { K.notify({ title: 'World', text: 'No AI connection for the world yet. Pick one in Settings › AI & connections › World.', tone: 'warn' }); return; }
    const li = Math.max(0, lastI()), clock = clockNow(), cid = H.chat();
    // who could answer: the members but the sender, not muted, not someone who never talks to the sender
    let can = (only ? [only] : these || g.members).filter(k => k !== m.from && k !== USER && g.members.includes(k) && !w.people?.[k]?.muted && !neverTalk(w, k, m.from));
    if (!only && !these && w.alive.realReplies !== false) {
        const later = [];
        can = can.filter(k => { const wt = replyWait({ ...nowOf(w, k), lastI: li }); if (wt) later.push({ k, wt }); return !wt; });
        let st = H.store();
        // one wait per member and group: a second message moves it to the newest (hunt 2: two waits = two late answers)
        for (const { k, wt } of later) {
            const old = st.records.find(r => r.kind === 'gwait' && r.group === g.id && r.who === k);
            st = old ? { ...st, records: st.records.map(r => (r === old ? { ...r, msg: m.id } : r)) } : addRecord(st, { kind: 'gwait', id: newId('gw'), group: g.id, msg: m.id, who: k, wait: wt, auto: true }, li);
        }
        if (later.length) H.save(st);
    }
    if (!can.length || busy.has(g.id)) return;
    busy.add(g.id); H.render();
    let seen = Number(m.n) || 0;   // the newest message the call saw (the follow-up below)
    try {
        const dm = discretionMap(w);   // who they never gossip about (built once)
        const people = can.map(k => {
            if (k === MAIN) { const mi = mainInfo(); return { key: k, name: nameOf(k), card: mi ? charText(mi.ch, mi.name) : '', knows: H.store().records.filter(r => r.kind === 'mknow').map(r => r.fact), quirks: w.people?.[k]?.quirks || '', discretion: dm.get(k) || '' }; }
            const x = personByKey(L.board, k); const now = x ? personNow(L.state, x.cast, x.p) : null;
            return { key: k, name: nameOf(k), card: x ? cardText(x.p) : '', knows: now ? now.knows.map(f => f.fact) : [], quirks: w.people?.[k]?.quirks || '', discretion: dm.get(k) || '' };
        });
        const msgs = groupMsgs(H.store(), g.id);
        seen = Math.max(seen, ...msgs.map(x => Number(x.n) || 0));
        const thread = msgs.map(x => ({ who: nameOf(x.from), text: textOf(x) }));
        const pr = groupPrompt({ groupName: g.name, people, others: g.members.filter(k => !can.includes(k)).map(nameOf), thread, max: only ? 1 : groupMax(w.alive.pace), userName: nameOf(USER), alone: !!only });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 700), caller: 'world', skipThrottle: true, jsonSchema: GROUP_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        if (window.__dleWorldDebug) console.log('[DLE] world group', g.name, r?.text);
        if (H.chat() !== cid) return;
        let replies = parseGroup(r?.text, people, only ? 1 : groupMax(w.alive.pace));
        if (!replies.length && !only && people.length) replies = [];   // nobody had anything to add: fine
        for (const rep of replies) {
            await new Promise(res => setTimeout(res, 700 + Math.min(2500, rep.text.length * 25)));
            if (H.chat() !== cid) return;
            const s2 = addRecord(H.store(), { ...newMessage({ store: H.store(), from: rep.who.key, to: groupConv(g.id), text: rep.text, clock, i: li, look: 'phone', id: newId('w') }), conv: groupConv(g.id), group: g.id, alts: [rep.text], s: 0 }, li);
            // they answered now: an older wait of theirs here is done (else they chimed in a second time later)
            H.save({ ...s2, records: s2.records.filter(r => !(r.kind === 'gwait' && r.group === g.id && r.who === rep.who.key)) });
            H.render(); H.changed();
        }
    } catch (err) { console.warn('[DLE] world: group answer failed', err?.message || err); }
    finally {
        busy.delete(g.id); H.render(); H.changed();
        // she wrote again while they answered: that message is answered now (hunt 2: it got no answer at all)
        if (!only && !these && H.chat() === cid) {
            const next = groupMsgs(H.store(), g.id).filter(x => x.mine && Number(x.n) > seen).at(-1);
            if (next) answer(w, g, next);
        }
    }
}

// one run at a time (hunt 2: it runs several times after each reply — a second run answered the same wait again)
let delivering = false;
/** After the story moved on: members who were slow, busy or asleep may chime in now (one call each, they may pass). */
export async function deliverGroups(w) {
    if (!H || !w || w.paused || delivering) return;
    delivering = true;
    const li = lastI(), st = H.store(), cid = H.chat();
    try {
        for (const x of st.records.filter(r => r.kind === 'gwait')) {
            if (H.chat() !== cid) return;   // another chat opened meanwhile: its groups are not these
            if (!H.store().records.some(r => r.id === x.id)) continue;   // answered meanwhile (Answer now)
            const g = groupsOf(st).find(y => y.id === x.group), m = st.records.find(r => r.kind === 'msg' && r.id === x.msg);
            if (!g || !m || !g.members.includes(x.who)) { H.save({ ...H.store(), records: H.store().records.filter(r => r.id !== x.id) }); continue; }
            if (w.people?.[x.who]?.muted || busy.has(g.id) || !waitOver(x.wait, { lastI: li, ...nowOf(w, x.who) })) continue;   // busy: next time
            H.save({ ...H.store(), records: H.store().records.filter(r => r.id !== x.id) });
            await answer(w, g, m, { only: x.who });
        }
    } finally { delivering = false; }
}

/** Answer now (Miinthe: "sometimes you just want to chat regardless"): everyone still waiting in this group may answer now, together. */
async function nudge(w, g) {
    const st = H.store(), ws = st.records.filter(r => r.kind === 'gwait' && r.group === g.id);
    if (!ws.length) return;
    // someone is still writing here: the waits stay (hunt 2: they were dropped, and nobody answered)
    if (busy.has(g.id)) { K.notify({ title: 'World', text: 'Someone is still writing in this group. Try again in a moment.' }); return; }
    H.save({ ...st, records: st.records.filter(r => !ws.includes(r)) });
    const m = st.records.filter(r => r.kind === 'msg' && r.group === g.id).sort((a, b) => a.n - b.n).at(-1);
    if (m) await answer(w, g, m, { these: [...new Set(ws.map(x => x.who))] });
}

/** A short line for the small moves: the groups and their newest lines (feed.js pulse). */
export function groupsForPulse(w) {
    if (!H || w.look === 'letters') return [];
    return groupsOf(H.store()).map(g => ({ id: g.id, name: g.name, members: g.members.filter(k => k !== USER && !w.people?.[k]?.muted), last: groupMsgs(H.store(), g.id).slice(-3).map(m => `${nameOf(m.from)}: ${textOf(m)}`) })).filter(g => g.members.length >= 2);
}
