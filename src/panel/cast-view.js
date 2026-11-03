/**
 * Overhaul — the side panel's Cast tab, redrawn to the approved mock-up (side panel + bar v13, viewCast()).
 *
 *  - This round: the speaking order, numbered — drag the ⠿ to reorder (finger or mouse; arrow keys on the handle),
 *    write an NPC's line yourself, ✕ takes someone out, "X wants to join / leave" suggestions, Add…, Go / Stop after
 *    this one, Reset.
 *  - People: who is here, then who is away. Tap a person to open them: here / away, wants, plans and what they know
 *    (editable in place), this moment's thought, what they did while away, Peek / Hide again for hidden people, and
 *    "What has X been up to?". Under each picture: + (into the round) and Speak now; in the round, Speak now sits in
 *    their details and ✕ holds them back (Miinthe 2026-10-18: no bar at the bottom any more).
 *
 * Today's tab (src/cast-tab.js) keeps its events and draws through this view (useCastView); if this fails, today's
 * comes back. All the round and people logic stays where it was (cast-queue.js, cast-voice.js, cast.js, cast-pure.js).
 */
import { chat_metadata, getThumbnailUrl } from '../../../../../../script.js';
import { user_avatar } from '../../../../../personas.js';
import { getContext } from '../../../../../extensions.js';
import * as K from '../kit/kit.js';
import { live, saveLiveState, notifyLive, sceneAway, setSceneAway } from '../board-live.js';
import { boardStore, putBoard } from '../board-store.js';
import { BOARD_KEY } from '../storyboard-pure.js';
import { runningCasts, personNow, handChange, handChanges, HOW_WORDS, MAX_PLANS, appearsOf, oddsOf, castLines, withTie, turnDown } from '../cast-pure.js';
import { SPEAKS_WORDS, speaksOf, moveItem, addItem, setText, isMine } from '../cast-voice-pure.js';
import { speakAs, cannotSpeak, npcSpeaking } from '../cast-voice.js';
import { askOffscreen, suggestTies } from '../cast.js';
import { getQueue, setQueue, runQueue, stopQueue, queueRunning, queueStopping, getSuggestions, setSuggestions, resetRound, addStaying, removeFromRound, inRound, ownHere, writingAs, setWritingAs } from '../cast-queue.js';
import { turnIndex } from '../turn-index.js';
import { useCastView } from '../cast-tab.js';
import { halvesOf, moveWithin, dropIndex, roundSummary, queueSub, suggestionText, personSub, fixKnown } from './cast-view-pure.js';

const APPEARS_WORDS = { off: 'only when called in', places: 'turns up at their places', plans: 'turns up at their places or comes looking' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let root = null;
let sel = null;                     // the person opened: "castId:personId"
const peek = new Set();             // hidden people you are peeking at (until the page reloads)
const asking = new Set();           // "What has X been up to?" waiting for its answer
let writing = null;                 // the round item you are writing a line for
const drafts = new Map();           // what you typed in that box so far (survives a redraw)
const folds = { round: true, people: true, ties: true };
let pending = false, scrollToSel = false, pressing = false;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const say = text => K.notify({ text, title: 'Cast' });
const mainName = () => getContext()?.name2 || 'Main character';
function change(castId, personId, field, to) {
    const L = live(); if (!L) return;
    saveLiveState(handChange(L.board, L.state, castId, personId, field, to, turnIndex(getContext()?.chat)));
}
const typing = () => { const a = document.activeElement; return !!(root && a && root.contains(a) && a.matches('input, textarea, select')); };

/** Draw the tab (called by cast-tab.js on every event it listens to). Waits while you are typing in it. */
function render() {
    if (!root || !root.isConnected) return;
    if (typing() || pressing) { pending = true; return; }
    pending = false;
    draw();
}

function draw() {
    const L = live();
    const casts = L ? runningCasts(L.board, L.state).filter(c => (c.people || []).length) : [];
    root.replaceChildren();
    if (!L || !casts.length) {
        // the way there in words, and one button for it (bug hunt 2026-10-17: a bare "No cast yet." left her guessing)
        root.append(el('p', 'dle-cv-empty', 'No cast yet. Add a 🎭 Cast on the board and put people in it — they show up here.'));
        root.append(K.button({ label: 'Add a Cast on the board…', icon: 'cast', kind: 'quiet', onClick: async () => (await import('../board-window.js')).openBoardWindow({ add: true }) }));
        return;
    }
    const people = casts.flatMap(c => c.people.map(p => ({ c, p, k: `${c.id}:${p.id}`, n: personNow(L.state, c, p) })));
    if (sel && !people.some(x => x.k === sel)) sel = null;
    const q = getQueue();
    const nameOf = x => (x.kind === 'you' ? userName() : x.kind === 'main' ? mainName() : people.find(y => y.c.id === x.cast && y.p.id === x.person)?.p.name ?? '?');
    // Miinthe 2026-10-18: nobody twice — who is in the round carries their line there, People lists only the others
    const inRound = x => q.some(y => y.kind === 'npc' && y.cast === x.c.id && y.person === x.p.id);
    const rest = people.filter(x => !inRound(x));
    root.append(roundFold(L, q, people, nameOf), peopleFold(L, rest, q, people.filter(x => x.n.here).length), tiesFold(L, people));
    if (scrollToSel) { scrollToSel = false; root.querySelector('.dle-cv-tile.sel, .dle-cv-qi.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// the player by their persona's name and picture, never "You" (Miinthe, 2026-10-19: "'you' should be just {{user}}")
const userName = () => getContext()?.name1 || '{{user}}';

// ── This round ──────────────────────────────────────────────────────────────

function roundFold(L, q, people, nameOf) {
    const run = queueRunning(), speaking = npcSpeaking();
    const { mine, ai } = halvesOf(q);
    const body = [];
    let no = 0;
    const opened = new Set();   // a person twice in the round opens under their first row only
    const personOf = x => (x.kind === 'npc' ? people.find(y => y.c.id === x.cast && y.p.id === x.person) || null : null);
    const list = (half, items, none) => {
        body.push(el('div', 'dle-cv-half', half === 'mine' ? 'Your half' : 'Then the AI'));
        if (!items.length) { body.push(el('div', 'dle-cv-none', none)); return; }
        const box = el('div', 'dle-cv-qlist'); box.dataset.half = half;
        for (const x of items) box.append(queueItem(x, ++no, nameOf(x), { L, person: personOf(x), opened, speaking }));
        body.push(box);
    };
    // you're out of the scene: Send writes as one of your own NPCs (Miinthe, 2026-10-19)
    if (sceneAway().user) {
        const own = ownHere(), as = writingAs();
        const row = el('div', 'dle-cv-asrow');
        if (!own.length) row.append(el('span', 'dle-cv-mini', `${esc(userName())} is out of the scene, and none of the people you write yourself is in it: Send has no one to write as.`));
        else if (own.length === 1) row.append(el('span', 'dle-cv-mini', `${esc(userName())} is out of the scene: Send writes as <b>${esc(as.name)}</b>.`));
        else {
            row.append(el('span', 'dle-cv-mini', 'Send writes as'));
            const sel2 = el('select', 'dk-field');
            sel2.setAttribute('aria-label', 'Send writes as');
            for (const o of own) { const op = el('option', ''); op.value = `${o.cast}:${o.person}`; op.textContent = o.name; op.selected = as && o.cast === as.cast && o.person === as.person; sel2.append(op); }
            sel2.addEventListener('change', () => { const [c2, p2] = sel2.value.split(':'); setWritingAs(c2, p2); });
            row.append(sel2);
        }
        body.push(row);
    }
    list('mine', mine, 'Nothing of yours this round.');
    list('ai', ai, 'No AI replies this round.');
    // "X wants to join / leave" (the director's suggestions)
    const sugg = getSuggestions().filter(w => people.some(({ c, p }) => c.id === w.cast && p.id === w.person) && (w.leave ? !q.some(x => x.kind === 'npc' && x.cast === w.cast && x.person === w.person) : !inRound(w)));
    for (const w of sugg) {
        const name = nameOf({ kind: 'npc', ...w });
        const s = el('div', 'dle-cv-sugg');
        const t = el('span', ''); t.textContent = '✨ ' + suggestionText(name, w); s.append(t);
        const drop = () => setSuggestions(getSuggestions().filter(x => !(x.cast === w.cast && x.person === w.person)));
        s.append(
            K.button({ label: w.leave ? 'Let them go' : 'Add to round', onClick: () => { drop(); if (w.leave) setQueue(addItem(getQueue(), { kind: 'npc', cast: w.cast, person: w.person, exit: { why: w.why } })); else addStaying(w.cast, w.person, w.why); } }),
            K.button({ label: 'No', kind: 'quiet', onClick: drop }),
        );
        body.push(s);
    }
    // the foot: Add…, Go / Stop after this one, Reset
    const foot = el('div', 'dle-cv-foot');
    foot.append(el('span', 'dle-cv-sp'));   // adding someone: the + on their picture under People (Miinthe 2026-10-18)
    if (run) {
        const stopping = queueStopping();
        const b = K.button({ label: stopping ? 'Stopping after this one…' : 'Stop after this one', icon: 'stop', disabled: stopping, onClick: () => stopQueue() });
        b.classList.add('dle-cv-stop'); foot.append(b);
    } else {
        const r = K.button({ label: 'Reset', kind: 'quiet', title: 'Back to: You, then the main character', onClick: () => { writing = null; resetRound(); } });
        const g = K.button({ label: 'Go', icon: 'castround', kind: 'primary', disabled: !q.length, title: 'Play this round in this order. Send in the chat box works too: your message, the main character, then the AI’s people above.', onClick: () => runQueue() });
        r.classList.add('dle-cv-reset'); g.classList.add('dle-cv-go');
        foot.append(r, g);
    }
    body.push(foot);
    const names = q.map(nameOf);
    const f = K.fold({ title: 'This round', summary: roundSummary(names, { running: run, speaking: speaking?.name || null, stopping: queueStopping() }), count: q.length, open: folds.round, body, onToggle: v => { folds.round = v; } });
    f.classList.add('dle-cv-round');
    return f;
}

function queueItem(x, no, name, { L, person = null, opened, speaking = null } = {}) {
    const wrap = el('div', 'dle-cv-qitem'); wrap.dataset.q = x.id;
    const it = el('div', 'dle-cv-qi' + (isMine(x) ? ' mine' : ' ai'));
    const grip = K.iconButton({ icon: 'grip', title: 'Drag to change the order (or use the arrow keys)' });
    grip.classList.add('dle-cv-grip');
    grip.addEventListener('pointerdown', e => startDrag(e, wrap, x.id));
    grip.addEventListener('keydown', e => {
        const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (!d) return;
        e.preventDefault();
        setQueue(moveItem(getQueue(), x.id, d));
        requestAnimationFrame(() => root?.querySelector(`.dle-cv-qitem[data-q="${CSS.escape(x.id)}"] .dle-cv-grip`)?.focus());
    });
    const icon = x.kind === 'you' ? '🙂' : x.kind === 'main' ? '💬' : isMine(x) ? '✍️' : '🤖';
    it.append(grip, el('span', 'dle-cv-no', String(no)), el('span', 'dle-cv-ic', icon));
    const main = el('span', 'dle-cv-main');
    const t = el('span', 'dle-cv-t'); t.textContent = name;
    // one of the Cast: their own line too ("here · 2 plans"), and a tap opens them right here (Miinthe 2026-10-18)
    const off = person ? L.state.cast?.[person.c.id]?.[person.p.id]?.offscreen || [] : [];
    const veiled = !!person?.p.hidden && !peek.has(person.k);
    const yours = !!person && speaksOf(person.p) === 'mine' && !isMine(x);   // ✍️ you write their lines, none written yet
    const sub = person ? `${yours ? 'yours to write — empty, they say nothing' : queueSub(x)} · ${personSub(person.n, off, { veiled, speaking: speaking?.person === person.p.id && speaking?.cast === person.c.id })}` : queueSub(x);
    const s = el('span', 'dle-cv-s'); s.textContent = sub; s.title = sub;
    main.append(t, s); it.append(main);
    const open = !!person && sel === person.k && !opened.has(person.k);
    if (person) {
        main.classList.add('dle-cv-open'); main.setAttribute('role', 'button'); main.tabIndex = 0;
        main.title = open ? `Close ${person.p.name}` : `Open ${person.p.name}: wants, plans, what they know`;
        main.setAttribute('aria-expanded', String(open));
        const toggle = () => { sel = sel === person.k ? null : person.k; draw(); };
        main.addEventListener('click', toggle);
        main.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        if (open) it.classList.add('sel');
    }
    if (x.kind === 'npc') {
        const w = K.iconButton({ icon: 'line', title: isMine(x) ? 'Change what you wrote, or let the AI write it' : `Write ${name}’s line yourself`, on: writing === x.id, onClick: () => { writing = writing === x.id ? null : x.id; draw(); if (writing) root.querySelector('.dle-cv-writebox textarea')?.focus(); } });
        w.classList.add('dle-cv-write'); it.append(w);
    }
    const rm = K.iconButton({ icon: 'close', title: 'Not this round', onClick: () => { if (writing === x.id) writing = null; removeFromRound(x.id); } });
    rm.classList.add('dle-cv-qx');
    it.append(rm);
    wrap.append(it);
    if (writing === x.id) {
        const box = el('div', 'dle-cv-writebox');
        const ta = el('textarea', 'dk-field'); ta.rows = 2;
        ta.placeholder = `${name}’s line, in your words`;
        ta.title = 'It goes out under their name, in your half of the round';
        ta.value = drafts.has(x.id) ? drafts.get(x.id) : (x.text || '');
        ta.addEventListener('input', () => drafts.set(x.id, ta.value));
        const use = K.button({ label: 'Use this', kind: 'primary', onClick: () => { writing = null; drafts.delete(x.id); setQueue(setText(getQueue(), x.id, ta.value)); } });
        const ai = K.button({ label: isMine(x) ? 'Let the AI write it' : 'Cancel', kind: 'quiet', onClick: () => { writing = null; drafts.delete(x.id); if (isMine(x)) setQueue(setText(getQueue(), x.id, '')); else draw(); } });
        use.classList.add('dle-cv-use'); ai.classList.add('dle-cv-letai');
        const r = el('div', 'dle-cv-btns'); r.append(use, ai);
        box.append(ta, r);
        wrap.append(box);
    }
    if (open) { opened.add(person.k); wrap.append(personBox(person, off, veiled, { speak: true })); }
    return wrap;
}

/** Drag to reorder inside a half, with a finger or a mouse (pointer events on the ⠿ handle). */
function startDrag(e, wrap, id) {
    if (e.button > 0) return;
    const list = wrap.parentElement;
    const rows = [...list.children].filter(r => r.classList.contains('dle-cv-qitem'));
    const from = rows.indexOf(wrap), others = rows.filter(r => r !== wrap);
    if (!others.length) return;
    e.preventDefault();
    const grip = e.currentTarget, y0 = e.clientY;
    grip.setPointerCapture?.(e.pointerId);
    wrap.classList.add('dle-cv-dragging');
    let to = from, moved = false;
    const mark = () => others.forEach((r, i) => { r.classList.toggle('dle-cv-drop-before', i === to && to < others.length); r.classList.toggle('dle-cv-drop-after', to === others.length && i === others.length - 1); });
    const move = ev => {
        const dy = ev.clientY - y0;
        if (Math.abs(dy) > 3) moved = true;
        wrap.style.transform = `translateY(${dy}px)`;
        to = dropIndex(others.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; }), ev.clientY);
        mark();
    };
    const end = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        wrap.classList.remove('dle-cv-dragging'); wrap.style.transform = '';
        others.forEach(r => r.classList.remove('dle-cv-drop-before', 'dle-cv-drop-after'));
        if (moved && to !== from) setQueue(moveWithin(getQueue(), id, to));
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}

// ── People ──────────────────────────────────────────────────────────────────

/**
 * People: a grid of who is not in this round (Miinthe 2026-10-18) — picture, name, here / away, and a + that puts them in
 * (the AI writes their line; someone set to "✍️ you write their lines" goes to your half with the box open). You and the
 * main character get a tile too while they are out of the round. Tap a picture to open the person below the grid.
 */
function peopleFold(L, people, q, present) {
    const speaking = npcSpeaking();
    const grid = el('div', 'dle-cv-grid');
    const tile = ({ pic, letter, name, state, dim, selected, open, add, addTitle, speak = null, speakTitle = '', mute = null, fav = null, leave = null }) => {
        const t = el('div', 'dle-cv-tile' + (dim ? ' away' : '') + (selected ? ' sel' : ''));
        const face = el(open ? 'button' : 'div', 'dle-cv-face');
        if (open) { face.type = 'button'; face.title = `Open ${name}: wants, plans, what they know`; face.setAttribute('aria-expanded', String(!!selected)); face.addEventListener('click', open); }
        const ph = el('span', 'dle-cv-pic');
        if (pic) { const img = el('img', ''); img.src = pic; img.alt = ''; img.loading = 'lazy'; img.onerror = () => { img.remove(); ph.textContent = letter; }; ph.append(img); } else ph.textContent = letter;
        const nm = el('span', 'dle-cv-tn'); nm.textContent = name; nm.title = name;
        face.append(ph, nm, el('span', 'dle-cv-ts', esc(state)));
        // + and Speak now on their own row (Miinthe 2026-10-18: instead of the bar at the bottom)
        const foot = el('div', 'dle-cv-tfoot');
        if (add) { const plus = K.iconButton({ icon: 'plus', title: addTitle, onClick: add }); plus.classList.add('dle-cv-tadd'); foot.append(plus); }
        // you and the main character: out of the scene / back (Miinthe, 2026-10-19)
        if (leave) { const b = K.iconButton({ icon: leave.away ? 'back' : 'skip', on: leave.away, title: leave.away ? `${name} comes back into the scene` : `${name} leaves the scene: not in the rounds, and nobody talks to them`, onClick: leave.toggle }); b.classList.add('dle-cv-tleave'); b.setAttribute('aria-pressed', String(leave.away)); foot.append(b); }
        if (speak) { const sp = K.iconButton({ icon: 'castround', title: speakTitle, onClick: speak }); sp.disabled = queueRunning(); sp.classList.add('dle-cv-tspeak'); foot.append(sp); }
        if (mute) { const m = K.iconButton({ icon: mute.on ? 'mute' : 'sound', on: mute.on, title: mute.on ? `Unmute ${name}: they may step in, offer to join and turn up again` : `Mute ${name} in this chat: they stay quiet until you add them or press Speak now`, onClick: mute.toggle }); m.classList.add('dle-cv-tmute'); m.setAttribute('aria-pressed', String(mute.on)); foot.append(m); }
        if (mute?.on) t.classList.add('muted');
        if (fav) {
            const st = el('button', 'dle-cv-fav' + (fav.on ? ' on' : ''), fav.on ? '★' : '☆'); st.type = 'button';
            st.title = fav.on ? `Not a favorite any more` : `Favorite: ${name} stays first in this list, in every chat on this board`;
            st.setAttribute('aria-label', st.title); st.setAttribute('aria-pressed', String(fav.on));
            st.addEventListener('click', e => { e.stopPropagation(); fav.toggle(); });
            t.append(st);
        }
        t.append(face, foot);
        return t;
    };
    const first = n => String(n || '?').trim().charAt(0).toUpperCase() || '?';
    const ctx = getContext();
    const ours = [];   // You and the main character: after the favorites, before everyone else
    // You and the main character: always a tile — here (in this round or not) or away, with Leave / Back (Miinthe, 2026-10-19)
    const away = sceneAway();
    const seat = (kind, who) => (away[who] ? 'away' : q.some(x => x.kind === kind) ? 'here · in this round' : 'here');
    const leaveOf = who => ({ away: away[who], toggle: () => { const was = away[who]; setSceneAway(who, !was); K.notify({ title: 'Cast', text: `${who === 'user' ? userName() : mainName()} ${was ? 'is back in the scene' : 'left the scene'}.`, undo: K.chatOnly(() => setSceneAway(who, was), () => getContext()?.chatId ?? null) }); } });
    ours.push(tile({ pic: user_avatar ? getThumbnailUrl('persona', user_avatar) : '', letter: '🙂', name: userName(), state: seat('you', 'user'), dim: away.user, add: away.user || q.some(x => x.kind === 'you') ? null : () => setQueue(addItem(getQueue(), { kind: 'you' })), addTitle: 'Your message from the chat box, in this round', leave: leaveOf('user') }));
    const mainCard = ctx?.groupId ? null : ctx?.characters?.[ctx?.characterId];
    if (mainCard) ours.push(tile({ pic: mainCard?.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(mainCard.avatar)}` : '', letter: first(mainName()), name: mainName(), state: seat('main', 'main'), dim: away.main, add: away.main || q.some(x => x.kind === 'main') ? null : () => setQueue(addItem(getQueue(), { kind: 'main' })), addTitle: `${mainName()} replies in this round`, leave: leaveOf('main') }));
    // ★ favorites first (here, then away), then the rest (here, then away)
    const order = [true, false].flatMap(f => [...people.filter(x => !!x.p.fav === f && x.n.here), ...people.filter(x => !!x.p.fav === f && !x.n.here)]);
    // the person opened gets the whole width at the top, their details under them, and the grid moves down below
    // (Miinthe 2026-10-18: "it should not show the other cast member next to it")
    let openTile = null;
    for (const x of order) {
        const { c, p, k, n } = x;
        const own = speaksOf(p) === 'mine';
        const talking = speaking?.person === p.id && speaking?.cast === c.id;
        const t = tile({
            pic: p.card ? `/thumbnail?type=avatar&file=${encodeURIComponent(p.card)}` : '', letter: p.hidden ? '🙈' : first(p.name), name: p.name,
            state: talking ? '✍️ speaking…' : `${n.here ? 'here' : 'away'}${n.muted ? ' · muted' : ''}`, dim: !n.here, selected: sel === k,
            open: () => { sel = sel === k ? null : k; scrollToSel = !!sel; draw(); },   // a tile far down jumps to the top: follow it
            add: () => {
                if (!own) { addStaying(c.id, p.id); return; }
                const nq = addItem(getQueue(), { kind: 'npc', cast: c.id, person: p.id });
                writing = nq.filter(y => y.kind === 'npc' && y.cast === c.id && y.person === p.id).at(-1)?.id || null;
                setQueue(nq);
            },
            speak: () => speakNow(c, p), speakTitle: `${p.name} speaks now: their own message`,
            mute: { on: n.muted, toggle: () => setMuted(c, p, !n.muted) },
            fav: { on: !!p.fav, toggle: () => setFav(c, p, !p.fav) },
            addTitle: own ? `Into this round — you write ${p.name}’s line` : `Into this round — the AI writes ${p.name}’s line; they stay every round until you take them out`,
        });
        if (sel === k) { t.classList.add('wide'); openTile = t; } else { if (!p.fav && ours.length) grid.append(...ours.splice(0)); grid.append(t); }
    }
    grid.append(...ours);
    const body = [];
    const x = order.find(y => y.k === sel);
    if (x && openTile) {
        const box = el('div', 'dle-cv-opened');
        box.append(openTile, personBox(x, L.state.cast?.[x.c.id]?.[x.p.id]?.offscreen || [], !!x.p.hidden && !peek.has(x.k)));
        body.push(box);
    }
    if (grid.children.length) body.push(grid);
    else if (!openTile) body.push(el('div', 'dle-cv-none', 'Everyone is in this round.'));
    // everyone in the scene, {{user}} and the main character too (Miinthe 2026-11-03: "Present: 1" with 3 people there looked wrong)
    const f = K.fold({ title: 'People', summary: `Present: ${present + (away.user ? 0 : 1) + (mainCard && !away.main ? 1 : 0)}`, open: folds.people, body, onToggle: v => { folds.people = v; if (!v && sel) { sel = null; draw(); } } });   // closing People lets go of the opened person (Miinthe, 2026-10-16)
    f.classList.add('dle-cv-people');
    return f;
}

// ── Ties (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/ByQff64nfdyDB4acfqYm7N view 5) ─────────────────────
// How each Cast person feels about the others, the main character and {{user}}: a few words, ↗ warming / ↘ cooling.
// The director writes them when the scene shows it; tap a line for the quote; ✎ edit · 📌 the AI leaves it · ✕ remove.
// Smart ties (Miinthe, 2026-11-03): ✨ suggestions wait for ✓ / ✕ (the director's, or ✨ Suggest ties — one call per press);
// tapping a tie also shows its story, the feelings it had before.
const openQuote = new Set();
const seeding = new Set();          // ✨ Suggest ties waiting for its answer
function tiesFold(L, people) {
    const body = [];
    const targets = x => [...people.filter(y => y.k !== x.k).map(y => y.p.name), mainName(), userName()].filter((v, k, a) => v && a.indexOf(v) === k);
    let count = 0, sugCount = 0;
    for (const x of people) {
        const { c, p, k, n } = x, veiled = !!p.hidden && !peek.has(k);
        const sec = el('div', 'dle-cv-ties');
        const h = el('div', 'dle-cv-tieh');
        h.append(el('span', n.here ? 'dle-cv-dot here' : 'dle-cv-dot'), el('b', '', esc(p.name)), el('span', 'dle-cv-mini', n.here ? 'in the scene' : 'not here'));
        sec.append(h);
        const set = list => change(c.id, p.id, 'ties', list);
        if (veiled) sec.append(veil(`${n.ties.length} tie${n.ties.length === 1 ? '' : 's'}`));
        else {
            n.ties.forEach((t, j) => {
                count++;
                const r = el('div', 'dle-cv-tie');
                const line = el('button', 'dle-cv-tiel'); line.type = 'button';
                line.innerHTML = `→ <span class="${t.to === userName() ? 'dle-cv-tu' : t.to === mainName() ? 'dle-cv-tm' : ''}">${esc(t.to)}</span>: <b>${esc(t.w)}</b>${t.tr ? ` <span class="dle-cv-tr ${t.tr}" title="${t.tr === 'up' ? 'warming' : 'cooling'}">${t.tr === 'up' ? '↗' : '↘'}</span>` : ''}${t.pin ? ' <span class="dle-cv-pinned" title="Pinned: the AI leaves it">📌</span>' : ''}`;
                line.title = t.q ? 'Tap for the line it came from' : 'Set by hand';
                line.addEventListener('click', () => { const id = `${k}|${t.to}`; if (openQuote.has(id)) openQuote.delete(id); else openQuote.add(id); draw(); });
                const ed = K.iconButton({ icon: 'edit', title: 'Edit this tie', onClick: () => {
                    const i = el('input', 'dk-field'); i.value = t.w; i.setAttribute('aria-label', `How ${p.name} feels about ${t.to}`);
                    let done = false;
                    const save = () => { if (done) return; done = true; const v = i.value.trim(); i.blur(); if (v && v !== t.w) set(withTie(n.ties, { ...t, w: v, tr: '', q: '', i: null, pin: true })); setTimeout(render, 0); };
                    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { done = true; i.blur(); setTimeout(render, 0); } });
                    i.addEventListener('blur', save);
                    line.replaceWith(i); i.focus(); i.select();
                } });
                const pin = K.iconButton({ icon: 'pinI', on: t.pin, title: t.pin ? 'Unpin: the AI may change it again' : 'Pin: the AI leaves it as it is', onClick: () => set(n.ties.map((y, m) => (m === j ? { ...y, pin: !y.pin } : y))) });
                pin.setAttribute('aria-pressed', String(t.pin));
                const rm = K.iconButton({ icon: 'close', title: 'Remove this tie', onClick: () => set(n.ties.filter((_, m) => m !== j)) });
                r.append(line, ed, pin, rm);
                sec.append(r);
                if (openQuote.has(`${k}|${t.to}`)) {
                    const q = el('div', 'dle-cv-tq', t.q ? `“${esc(t.q)}”${t.i != null ? ` · #${t.i}` : ''}` : 'Set by hand.');
                    // its story (2026-11-03): what it was before, oldest first — "strangers (#12) → friendly (#30) → now"
                    if (t.h?.length) q.prepend(el('div', 'dle-cv-th', `<span class="dle-cv-mini">Before:</span> ${t.h.map(x => `<span title="${x.q ? esc(`“${x.q}”`) : 'set by hand'}">${esc(x.w)}${x.i != null ? ` <span class="dle-cv-mini">#${x.i}</span>` : ''}</span>`).join(' → ')} → <b>now</b>`));
                    sec.append(q);
                }
            });
            // ✨ suggested ties, waiting for ✓ / ✕ (2026-11-03)
            n.tieSug.forEach(t => {
                sugCount++;
                const r = el('div', 'dle-cv-tie sug');
                const line = el('button', 'dle-cv-tiel'); line.type = 'button';
                line.innerHTML = `<span class="dle-cv-sugm" aria-hidden="true">✨</span> → <span class="${t.to === userName() ? 'dle-cv-tu' : t.to === mainName() ? 'dle-cv-tm' : ''}">${esc(t.to)}</span>: <b>${esc(t.w)}</b>${t.tr ? ` <span class="dle-cv-tr ${t.tr}" title="${t.tr === 'up' ? 'warming' : 'cooling'}">${t.tr === 'up' ? '↗' : '↘'}</span>` : ''}`;
                line.title = 'Suggested — tap for where it comes from';
                line.setAttribute('aria-label', `Suggested: ${p.name} toward ${t.to}: ${t.w}`);
                const id = `${k}|sug|${t.to}`;
                line.addEventListener('click', () => { if (openQuote.has(id)) openQuote.delete(id); else openQuote.add(id); draw(); });
                const rest = n.tieSug.filter(y => y.to !== t.to);
                const yes = K.iconButton({ icon: 'check', title: `Keep it: ${p.name} → ${t.to}: ${t.w}`, onClick: () => {
                    const L2 = live(); if (!L2) return;
                    const { src: _src, why: _why, ...tie } = t;
                    saveLiveState(handChanges(L2.board, L2.state, c.id, p.id, { ties: withTie(n.ties, { ...tie, pin: false }), tieSug: rest }, turnIndex(getContext()?.chat)));
                } });
                const no = K.iconButton({ icon: 'close', title: 'No — and don\'t suggest it again', onClick: () => {
                    const L2 = live(); if (!L2) return;
                    saveLiveState(handChanges(L2.board, L2.state, c.id, p.id, { tieSug: rest, tieNo: turnDown(n.tieNo, t) }, turnIndex(getContext()?.chat)));
                } });
                r.append(line, yes, no);
                sec.append(r);
                if (openQuote.has(id)) sec.append(el('div', 'dle-cv-tq', [t.why ? esc(t.why) : '', t.q ? `“${esc(t.q)}”${t.i != null ? ` · #${t.i}` : ''}` : ''].filter(Boolean).join('<br>') || (t.src === 'seed' ? 'From ✨ Suggest ties.' : 'From the scene.')));
            });
            if (!n.ties.length && !n.tieSug.length) sec.append(el('div', 'dle-cv-none', 'No ties yet.'));
            const tools = el('div', 'dle-cv-tietools');
            const add = K.button({ label: 'Tie', icon: 'plus', kind: 'quiet' });
            add.classList.add('dle-cv-addtie');
            add.addEventListener('click', () => {
                const r = el('div', 'dle-cv-erow');
                const who = el('select', 'dk-field'); who.setAttribute('aria-label', 'Toward whom');
                for (const nm of targets(x)) { const o = el('option'); o.value = nm; o.textContent = nm; who.append(o); }
                const i = el('input', 'dk-field'); i.placeholder = 'How they feel, in a few words'; i.setAttribute('aria-label', 'How they feel');
                let saved = false;
                const save = () => { const v = i.value.trim(); if (!v || saved) return; saved = true; const list = n.ties.filter(y => y.to.toLowerCase() !== who.value.toLowerCase()); set([...list, { to: who.value, w: v, tr: '', q: '', i: null, pin: true }]); };
                i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); i.blur(); } });
                r.addEventListener('focusout', () => setTimeout(() => { if (r.contains(document.activeElement)) return; if (i.value.trim()) save(); else { r.remove(); tools.hidden = false; } if (pending) render(); }));
                r.append(who, i); tools.hidden = true; tools.before(r); i.focus();
            });
            const busy = seeding.has(k);
            const seed = K.button({ label: busy ? 'Thinking…' : 'Suggest', icon: 'wand', kind: 'quiet', title: `✨ Suggest ties for ${p.name} from their card, their lore and the recent chat — one AI call, you keep or drop each`, onClick: async () => {
                if (seeding.has(k)) return;
                seeding.add(k); draw();
                let got = null;
                try { got = await suggestTies(c.id, p.id); } finally { seeding.delete(k); }
                if (got === 0) say(`No new ties to suggest for ${p.name}.`);
                draw();
            } });
            seed.disabled = busy;
            tools.append(add, seed);
            sec.append(tools);
        }
        body.push(sec);
    }
    // what the writer gets this turn: ties of people in the scene only
    const told = castLines(L.board, L.state).filter(l => / feels: /.test(l));
    body.push(el('div', 'dle-cv-tiew', `<b>The writer gets</b> ${told.length ? told.map(esc).join(' ') : 'nothing: nobody in the scene has ties yet.'}`));
    const f = K.fold({ title: 'Ties', summary: `${count} tie${count === 1 ? '' : 's'}${sugCount ? ` · ${sugCount} suggested` : ''}`, open: folds.ties, body, onToggle: v => { folds.ties = v; } });
    f.classList.add('dle-cv-tiesf');
    f.title = 'How Cast people feel about each other, the main character and you. The director notices them in the scene (on the board: ask me / write them / off); ✨ Suggest asks once for starting ties.';
    return f;
}

function h5(title, note) { return el('h5', '', `${esc(title)}${note ? ` <em>${esc(note)}</em>` : ''}`); }
const veil = t => el('div', 'dle-cv-veil', esc(t));

/** ★ Favorite or not — kept on the board, so it holds in every chat that uses it (Miinthe 2026-10-18). */
function setFav(c, p, on) {
    const name = chat_metadata?.[BOARD_KEY];
    const raw = name ? boardStore()?.boards?.[name]?.board : null;
    if (!raw) return;
    const board = structuredClone(raw);
    const person = board.trackers?.find(t => t.id === c.id)?.people?.find(x => x.id === p.id);
    if (!person) return;
    if (on) person.fav = true; else delete person.fav;
    putBoard(name, board);
    notifyLive();
}

/** 🔇 Mute / unmute in this chat (logged, Undo like any change). Muting also drops their offer to join. */
function setMuted(c, p, on) {
    change(c.id, p.id, 'muted', !!on);
    if (on) setSuggestions(getSuggestions().filter(w => !(w.cast === c.id && w.person === p.id)));
}

/** Speak now: their own message, right away (Miinthe 2026-10-18: on the tile / in their details, no bar at the bottom). */
function speakNow(c, p) { const why = cannotSpeak(); if (why) { say(why); return; } speakAs(c.id, p.id); }

function personBox({ c, p, k, n }, off, veiled, { speak = false } = {}) {
    const box = el('div', 'dle-cv-person');
    // here / away
    const hr = el('div', 'dle-cv-erow');
    const lab = el('span', 'dle-cv-mini dle-cv-grow', 'In the scene');
    const sw = K.toggle({ checked: n.here, label: `${p.name} is in the scene`, onChange: v => change(c.id, p.id, 'here', v) });
    sw.classList.add('dle-cv-here');
    hr.append(lab, sw, el('span', 'dle-cv-mini', n.here ? 'here' : 'away'));
    box.append(hr);
    box.append(el('div', 'dle-cv-mode', `${esc(SPEAKS_WORDS[speaksOf(p)])} · ${esc(APPEARS_WORDS[appearsOf(p)])}${appearsOf(p) !== 'off' && (p.hangouts || []).length ? ` (1 in ${oddsOf(p)} at their places)` : ''}`));
    box.lastChild.title = 'Set on the board';

    // wants
    const wants = el('div', 'dle-cv-sec'); wants.append(h5('Wants'));
    if (veiled) wants.append(veil(n.wants ? 'hidden: a secret character' : 'nothing yet'));
    else {
        const t = el('textarea', 'dk-field dle-cv-wants'); t.rows = 2; t.value = n.wants || ''; t.placeholder = 'What they want, in the long run';
        t.setAttribute('aria-label', `What ${p.name} wants`);
        t.addEventListener('change', () => change(c.id, p.id, 'wants', t.value.trim()));
        wants.append(t);
    }
    box.append(wants);

    // plans
    const plans = el('div', 'dle-cv-sec'); plans.append(Object.assign(h5('Plans', `up to ${MAX_PLANS}`), { title: 'The writer acts on them, never says them' }));
    if (veiled) plans.append(veil(`${n.plans.length} plan${n.plans.length === 1 ? '' : 's'}`));
    else {
        n.plans.forEach((x, j) => {
            const r = el('div', 'dle-cv-erow');
            const i = el('input', 'dk-field dle-cv-plan'); i.value = x.text; i.setAttribute('aria-label', `Plan ${j + 1}`);
            i.addEventListener('change', () => { const list = n.plans.map(y => ({ ...y })); const v = i.value.trim(); if (v) list[j].text = v; else list.splice(j, 1); change(c.id, p.id, 'plans', list); });
            r.append(i, K.iconButton({ icon: 'close', title: 'Drop this plan', onClick: () => change(c.id, p.id, 'plans', n.plans.filter((_, m) => m !== j)) }));
            plans.append(r);
        });
        if (n.plans.length < MAX_PLANS) {
            const add = K.button({ label: 'Plan', icon: 'plus', kind: 'quiet' });
            add.classList.add('dle-cv-addplan');
            add.addEventListener('click', () => {
                const r = el('div', 'dle-cv-erow');
                const i = el('input', 'dk-field'); i.placeholder = 'A new plan'; i.setAttribute('aria-label', 'A new plan');
                i.addEventListener('change', () => { const v = i.value.trim(); if (v) change(c.id, p.id, 'plans', [...n.plans, { id: 'p' + Date.now().toString(36), text: v }]); });
                i.addEventListener('blur', () => { if (!i.value.trim()) { r.remove(); add.hidden = false; if (pending) render(); } });
                r.append(i); add.hidden = true; add.before(r); i.focus();
            });
            plans.append(add);
        }
    }
    box.append(plans);

    // thinking
    const th = el('div', 'dle-cv-sec'); th.append(Object.assign(h5('Thinking'), { title: 'This moment, never told to the writer' }));
    if (veiled) th.append(veil(n.thoughts ? 'a thought' : 'nothing yet'));   // bug hunt 2026-10-16: said "a thought" with none there
    else if (n.thoughts) { const b = el('blockquote', 'dle-cv-thought'); b.textContent = n.thoughts.text; th.append(b); }
    else th.append(Object.assign(el('div', 'dle-cv-none', 'Nothing yet.'), { title: 'The director fills this in while they are here' }));
    box.append(th);

    // knows
    const kn = el('div', 'dle-cv-sec'); kn.append(Object.assign(h5('Knows'), { title: 'Earned. The writer is told, so they never know more' }));
    const howSel = (value, label) => {
        const s = el('select', 'dk-field dle-cv-how'); s.setAttribute('aria-label', label);
        for (const [h, w] of Object.entries(HOW_WORDS)) { const o = el('option'); o.value = h; o.textContent = w; if (h === value) o.selected = true; s.append(o); }
        return s;
    };
    if (veiled) kn.append(veil(`${n.knows.length} thing${n.knows.length === 1 ? '' : 's'}`));
    else {
        const fix = (id, patch) => { const L = live(); const st = L && fixKnown(L.state, c.id, p.id, id, patch); if (st) saveLiveState(st); };
        n.knows.forEach(x => {
            const r = el('div', 'dle-cv-erow');
            const i = el('input', 'dk-field dle-cv-fact'); i.value = x.fact; i.setAttribute('aria-label', 'Something they know');
            const where = [x.i != null ? `learned at #${x.i}` : '', x.quote ? `“${x.quote}”` : ''].filter(Boolean).join(' · ');
            if (where) i.title = where;
            i.addEventListener('change', () => fix(x.id, { fact: i.value }));
            const s = howSel(x.how, 'How they know it');
            s.addEventListener('change', () => fix(x.id, { how: s.value }));
            r.append(i, s, K.iconButton({ icon: 'close', title: 'Forget this', onClick: () => fix(x.id, null) }));
            kn.append(r);
        });
        if (!n.knows.length) kn.append(el('div', 'dle-cv-none', 'Nothing yet.'));
        const add = K.button({ label: 'Something they know', icon: 'plus', kind: 'quiet' });
        add.classList.add('dle-cv-addfact');
        add.addEventListener('click', () => {
            const r = el('div', 'dle-cv-erow');
            const i = el('input', 'dk-field'); i.placeholder = 'Something they know'; i.setAttribute('aria-label', 'Something they know');
            const s = howSel('told', 'How they know it');
            // saved once, when you leave the row (or press Enter): so "how they know it", picked after the text, is kept
            // too (bug hunt 2026-10-16: saving on the text's own change stored "told" before the pick could happen)
            let saved = false;
            const save = () => { const v = i.value.trim(); if (v && !saved) { saved = true; change(c.id, p.id, 'knows', { fact: v, how: s.value }); } };
            i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); i.blur(); } });
            r.addEventListener('focusout', () => setTimeout(() => {
                if (r.contains(document.activeElement)) return;
                if (i.value.trim()) save();
                else { r.remove(); add.hidden = false; }
                if (pending) render();
            }));
            r.append(i, s); add.hidden = true; add.before(r); i.focus();
        });
        kn.append(add);
    }
    box.append(kn);

    // while away
    if (off.length || !n.here) {
        const aw = el('div', 'dle-cv-sec'); aw.append(Object.assign(h5('While away'), { title: 'Written when they come back, or when you ask' }));
        if (veiled) aw.append(veil(`${off.length} entr${off.length === 1 ? 'y' : 'ies'}`));
        else if (off.length) for (const x of off.slice(-4).reverse()) {
            const d = el('div', 'dle-cv-off');
            if (x.from != null) d.append(el('span', 'dle-cv-mini', `#${x.from}${x.to != null ? `–#${x.to}` : ''} `));
            d.append(document.createTextNode(x.text)); aw.append(d);
        }
        else aw.append(el('div', 'dle-cv-none', 'Nothing yet.'));
        box.append(aw);
    }

    // Peek / Hide again, What has X been up to?
    const ft = el('div', 'dle-cv-btns');
    if (p.hidden) {
        const b = K.button({ label: veiled ? 'Peek' : 'Hide again', icon: 'eye', title: veiled ? `Show ${p.name}’s secrets to you (only here, until the page reloads)` : 'Cover their secrets again', onClick: () => { if (peek.has(k)) peek.delete(k); else peek.add(k); draw(); } });
        b.classList.add('dle-cv-peek'); ft.append(b);
    }
    if (!n.here) {
        const busy = asking.has(k);
        const b = K.button({ label: busy ? 'Asking…' : `📜 What has ${p.name} been up to?`, disabled: busy, title: 'One helper call: what they did while away', onClick: async () => { asking.add(k); draw(); try { await askOffscreen(c.id, p.id); } finally { asking.delete(k); render(); } } });
        b.classList.add('dle-cv-away'); ft.append(b);
    }
    if (speak) {   // opened from the round: Speak now here (Hold back is the ✕ on their row)
        const b = K.button({ label: 'Speak now', icon: 'castround', disabled: queueRunning(), title: `${p.name} speaks now: their own message`, onClick: () => speakNow(c, p) });
        b.classList.add('dle-cv-speak'); ft.prepend(b);
    }
    if (ft.children.length) box.append(ft);
    return box;
}

/** Mount once (src/panel/index.js): today's Cast content is hidden, this view draws instead. */
export function mountCastView(panel) {
    const host = panel?.querySelector('#dle-panel-cast');
    if (!host) return;
    root = el('div', 'dk dle-cv');
    host.append(root);
    const old = host.querySelector('.dle-cast-mount');
    // a redraw that waited for your typing runs once you leave the field — but not between a press and its click,
    // or the button you are pressing would be redrawn away under you
    const flush = () => { if (pending && !pressing && !typing()) render(); };
    root.addEventListener('focusout', () => setTimeout(flush, 0));
    root.addEventListener('pointerdown', () => { pressing = true; });
    document.addEventListener('pointerup', () => { if (pressing) { pressing = false; setTimeout(flush, 60); } }, true);
    document.addEventListener('pointercancel', () => { if (pressing) { pressing = false; setTimeout(flush, 60); } }, true);
    useCastView({
        render,
        openPerson: key => { sel = key; folds.people = true; folds.round = true; scrollToSel = true; },
        dispose: () => { root?.remove(); root = null; if (old) old.hidden = false; },
    });
    if (old) old.hidden = true;
}
