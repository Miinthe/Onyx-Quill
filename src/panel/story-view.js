/**
 * Overhaul — the side panel's Story tab, redrawn to the approved mock-up (side panel + bar v13).
 *
 *   top line   ✨ Follows the story / ✋ By hand · + New tracker · Open the board
 *   cards      one per step tracker: ◀ pips step x/y ▶, a note line (✨ quote + Undo, detour, waiting, fork …);
 *              tap one for its steps (tap a step to jump) and its bar: Pause / Edit steps / Abandon / ⋯
 *   fold       On the board — time, places, collections (pause, ⋯, finds to keep), switch the board off here
 *   fold       What changed — today's separate Changes tab, moved here (Clear list, each Undo, pop-up style)
 *
 * Today's Story list and toolbar (drawer.html, drawer-render-tabs.js renderStoryTab) are taken out once this view has
 * drawn; "Re-evaluate and swipe" lives on the DeepLore bar and each reply's ⋯ now, so it is not repeated here.
 * Pure rules: story-pure.js.
 */
import { chat_metadata } from '../../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../../extensions.js';
import * as K from '../kit/kit.js';
import {
    getTrackers, saveTrackers, setTracker, moveTracker, setTrackerAside, chooseBranch, setTrackerRun, undoTrackerRun,
    switchBoard, removeTracker, onTrackersChanged, currentBoardName, notifyTrackersView,
} from '../trackers.js';
import { autoTrackEnabled, setAutoTrackEnabled, undoAutoMove, undoCollection } from '../autotrack.js';
import { live, boardOffHere, onLiveChanged, STATE_KEY, saveLiveState } from '../board-live.js';
import { boardStore, putBoard } from '../board-store.js';
import { TRACKERS_KEY } from '../trackers-pure.js';
import { pendingFork } from '../forks-pure.js';
import { conditionText } from '../conditions-pure.js';
import { collectionsOf } from '../collections-pure.js';
import { placeTrackersOf, placeLabel, applyPlaceChanges } from '../places-pure.js';
import { turnIndex } from '../turn-index.js';
import { stateTrackersOf, nowLine, datesOf, dueText } from '../state-pure.js';
import { itemState, itemAmount, purseValue, runOf, hereOf, stateNow } from '../board-model-pure.js';
import { feedOf, onFeedChanged, clearFeed, immersed } from '../echo.js';
import { groupFeed } from '../notices-pure.js';
import { standing, isQuiet, cardNotes, boardSummary, changeRow, changesSummary, groupLabel, checkEdit } from './story-pure.js';

const S = { sel: null, open: { board: false, changes: false } };
const undone = new WeakSet();   // changes undone from this list (while the page is open)
let root = null, scheduled = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const say = (r, ok) => { if (r?.error) K.notify({ text: r.error, tone: 'bad' }); else if (ok) K.notify({ text: ok }); };

async function openBoard(select = null, { add = false, view = null } = {}) {
    try { (await import('../board-window.js')).openBoardWindow({ ...(select ? { select } : {}), ...(add ? { add: true } : {}), ...(view ? { view } : {}) }); } catch (err) { K.notify({ text: `The board did not open: ${err?.message || err}`, tone: 'bad' }); }
}

// ── step trackers ───────────────────────────────────────────────────────────

function boardTracker(id) {
    try { return live()?.board?.trackers?.find(x => x.id === id) || null; } catch { return null; }
}

function card(t, list) {
    const bt = boardTracker(t.id);
    const st = standing(t), sel = S.sel === (t.id || t.name);
    const c = el('div', 'dle-sv-card' + (sel ? ' sel' : '') + (isQuiet(t) ? ' dim' : ''));
    c.style.setProperty('--tc', bt?.color || 'var(--dk-accent)');
    c.dataset.name = t.name; if (t.id) c.dataset.id = t.id;
    c.tabIndex = 0; c.setAttribute('role', 'button'); c.setAttribute('aria-expanded', String(sel));
    c.title = sel ? '' : 'Tap for its steps and what you can do with it';
    c.append(el('div', 'dle-sv-hd', `<span class="dle-sv-ic">${esc(bt?.icon || '📶')}</span><span class="dle-sv-nm">${esc(t.name)}</span>${t.state && t.state !== 'running' && !t.ended ? `<span class="dk-tag">${esc(t.state)}</span>` : ''}${t.ended ? '<span class="dk-tag">ended</span>' : ''}`));

    const line = el('div', 'dle-sv-stepline');
    const arrow = (d, label) => {
        const b = el('button', 'dle-sv-arrow', d < 0 ? '◀' : '▶');
        b.type = 'button'; b.title = label; b.setAttribute('aria-label', `${t.name}: ${label}`);
        b.disabled = d < 0 ? st.first : st.last;
        b.addEventListener('click', e => { e.stopPropagation(); say(moveTracker(t.name, { delta: d })); });
        return b;
    };
    const pips = el('span', 'dle-sv-pips', st.pips.map(f => `<i class="${f ? 'f' : ''}"></i>`).join(''));
    pips.setAttribute('aria-hidden', 'true');
    line.append(arrow(-1, 'Back a step'), pips, el('span', 'dle-sv-cur', esc(st.cur)), el('span', 'dle-sv-of', `${st.step || '–'}/${st.count}`), arrow(1, 'Forward a step'));
    c.append(line);

    for (const n of cardNotes(t, { cond: x => conditionText(x, list), fork: pendingFork(t) })) {
        const note = el('div', 'dle-sv-note dle-sv-note-' + n.kind, `<span>${esc(n.text)}</span>`);
        if (n.undo === 'auto') note.append(K.button({ label: 'Undo', kind: 'quiet', title: 'Put it back where it was', onClick: e => { e.stopPropagation(); undoAutoMove(t.name); } }));
        if (n.undo === 'run') note.append(K.button({ label: 'Undo', kind: 'quiet', title: 'Put it back as it was', onClick: e => { e.stopPropagation(); say(undoTrackerRun(t.name), 'Put back as it was.'); } }));
        if (n.branches?.length) {
            const b = el('span', 'dle-sv-branches');
            for (const name of n.branches) b.append(K.button({ label: name, title: `Take “${name}” by hand`, onClick: e => { e.stopPropagation(); takeBranch(t, name); } }));
            note.append(b);
        }
        c.append(note);
    }

    if (sel) {
        const steps = el('div', 'dle-sv-steps');
        t.steps.forEach((s, k) => {
            const b = el('button', k === st.index && st.step ? 'on' : '', esc(s));
            b.type = 'button';
            const why = t.unmet?.[k]?.map(u => u.text).join(' and ');
            b.title = k === st.index ? 'Where it stands now' : `Jump to ${s}${why ? ` (normally only possible ${why})` : ''}`;
            b.addEventListener('click', e => { e.stopPropagation(); if (k !== st.index || !st.step) say(moveTracker(t.name, { toIndex: k })); });
            steps.append(b);
        });
        c.append(steps);
    }
    const pick = () => { S.sel = sel ? null : (t.id || t.name); draw(); };
    c.addEventListener('click', e => { if (!e.target.closest('button, a, input')) pick(); });
    c.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); pick(); } });
    return c;
}

function takeBranch(t, name) {
    const r = chooseBranch(t.name, name);
    say(r, r.text);
}

async function runAct(name, act) {
    if (act === 'abandon') {
        const ok = await K.ask({ title: `Abandon ${name}?`, text: 'In this chat only: it goes back to the start and is switched off, its lore hidden. Undo puts it back.', yes: 'Abandon', danger: true });
        if (!ok) return;
    }
    const r = setTrackerRun(name, act);
    if (r.error) { K.notify({ text: r.error, tone: 'bad' }); return; }
    K.notify({ text: r.text, undo: () => say(undoTrackerRun(name), 'Put back as it was.') });
}

function editSteps(t) {
    const bt = boardTracker(t.id);
    const name = el('input', 'dk-field'); name.value = t.name; name.setAttribute('aria-label', 'Name');
    const nameBox = el('label', 'dk-labeled', '<span>Name: what it follows</span>'); nameBox.append(name);
    const tiles = K.tilesEditor({ items: [...t.steps], color: bt?.color, noun: 'step' });
    const stepsBox = el('div', 'dk-labeled', '<span>Steps, in order</span>'); stepsBox.append(tiles);
    let skip = t.skip === true;
    const sw = K.toggle({ checked: skip, onChange: v => { skip = v; } });
    const body = [nameBox, stepsBox, K.setting({ title: 'May skip steps', help: 'For time jumps. Off: one step at a time.', control: sw }),
        Object.assign(el('p', 'dk-hint', 'Tip: name steps as your stage entries’ summaries do.'), { title: 'That is how the lore judge finds the right entry. It stays on its current step if that step is still in the list.' })];
    const w = K.openWindow({
        title: `Edit ${t.name}`, body,
        foot: [K.button({ label: 'Cancel', onClick: () => w.close() }), K.button({ label: 'Save', kind: 'primary', onClick: () => {
            const r = checkEdit({ name: name.value, steps: tiles.getItems(), others: getTrackers().map(x => x.name), was: t.name });
            if (r.error) { K.notify({ text: r.error, tone: 'bad' }); return; }
            setTracker(t.name, r.steps, { rename: r.name, skip });
            if (S.sel === t.name) S.sel = r.name;
            w.close();
        } })],
    });
}

function editDetour(t) {
    const bt = boardTracker(t.id);
    const here = bt?.steps?.[standing(t).index]?.detours || [];
    const input = el('input', 'dk-field'); input.value = t.aside || ''; input.placeholder = 'e.g. Nuisance'; input.setAttribute('aria-label', 'Detour');
    const body = [el('p', '', `Something happening beside the step. The step stays at <b>${esc(standing(t).cur)}</b>.`)];
    if (here.length) {
        const chips = el('div', 'dk-chips');
        for (const d of here) chips.append(K.chip({ label: d.name, on: d.name === t.aside, title: 'A detour this step has on the board', onClick: () => { input.value = d.name; } }));
        body.push(chips);
    }
    body.push(input);
    const save = text => { const r = setTrackerAside(t.name, text); if (r.error) K.notify({ text: r.error, tone: 'bad' }); w.close(); };
    const w = K.openWindow({
        title: `Detour: ${t.name}`, size: 'small', body,
        foot: [t.aside ? K.button({ label: 'Clear the detour', kind: 'quiet', onClick: () => save('') }) : null, el('span', 'dk-sp'),
            K.button({ label: 'Cancel', onClick: () => w.close() }), K.button({ label: 'Save', kind: 'primary', onClick: () => save(input.value.trim()) })].filter(Boolean),
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(input.value.trim()); } });
    input.focus();
}

function setOwn(t, patch) {
    const list = getTrackers();
    const i = list.findIndex(x => x.name === t.name);
    if (i === -1) return;
    list[i] = { ...list[i], ...patch };
    saveTrackers(list);
}

async function remove(t) {
    const bname = currentBoardName();
    const keep = {
        board: bname ? structuredClone(boardStore()?.boards?.[bname]?.board ?? null) : null,
        state: chat_metadata?.[STATE_KEY] ? structuredClone(chat_metadata[STATE_KEY]) : null,
        list: chat_metadata?.[TRACKERS_KEY] ? structuredClone(chat_metadata[TRACKERS_KEY]) : null,
    };
    await K.removeWithCare({
        name: t.name, big: true, askKey: 'tracker',
        text: bname ? `It is taken off the board “${bname}”, with its steps, so every chat that uses this board loses it. Undo puts it back.` : 'It is taken out of this chat, with its steps. Undo puts it back.',
        remove: () => { removeTracker(t.name); if (S.sel === (t.id || t.name)) S.sel = null; },
        undo: () => {
            if (bname && keep.board) putBoard(bname, keep.board);
            if (keep.state) chat_metadata[STATE_KEY] = keep.state;
            if (keep.list) chat_metadata[TRACKERS_KEY] = keep.list;
            saveMetadataDebounced();
            notifyTrackersView();
        },
    });
}

function trackerMenu(t) {
    const st = standing(t), fork = pendingFork(t);
    const lr = t.lastRun?.action;
    return [
        { heading: 'Jump to a step' },
        ...t.steps.map((s, k) => ({ label: s, checked: !!st.step && k === st.index, sub: t.unmet?.[k] ? `normally only ${t.unmet[k].map(u => u.text).join(' and ')}` : undefined, onClick: () => { if (k !== st.index || !st.step) say(moveTracker(t.name, { toIndex: k })); } })),
        'sep',
        { heading: 'When it moves by itself' },
        { label: 'Forward only', sub: 'never back by itself', checked: t.direction === 'forward', onClick: () => setOwn(t, { direction: 'forward' }) },
        { label: 'Both ways', sub: 'may also move back', checked: t.direction !== 'forward', onClick: () => setOwn(t, { direction: 'both' }) },
        { label: 'May skip steps', sub: 'for time jumps', checked: t.skip === true, onClick: () => setOwn(t, { skip: t.skip !== true }) },
        'sep',
        { label: t.aside ? 'Change the detour…' : 'Set a detour…', emoji: '↪', sub: t.aside ? `now: ${t.aside}` : undefined, onClick: () => editDetour(t) },
        t.aside ? { label: 'Clear the detour', emoji: '✕', onClick: () => say(setTrackerAside(t.name, '')) } : null,
        ...(fork && !t.ended ? [{ heading: `Pick the branch after ${fork.step}` }, ...fork.fork.branches.map(b => ({ label: b.name, emoji: '⑂', onClick: () => takeBranch(t, b.name) }))] : []),
        'sep',
        t.run === 'abandoned' ? null : t.run === 'paused' ? { label: 'Continue', icon: 'skip', onClick: () => runAct(t.name, 'continue') } : { label: 'Pause in this chat', icon: 'pause', sub: 'keeps its step', onClick: () => runAct(t.name, 'pause') },
        t.run === 'abandoned' ? { label: 'Reactivate', icon: 'undo', sub: 'from the start', onClick: () => runAct(t.name, 'reactivate') } : { label: 'Abandon in this chat…', icon: 'stop', onClick: () => runAct(t.name, 'abandon') },
        lr ? { label: `Undo “${{ pause: 'Pause', abandon: 'Abandon', continue: 'Continue', reactivate: 'Reactivate' }[lr] || lr}”`, icon: 'undo', onClick: () => say(undoTrackerRun(t.name), 'Put back as it was.') } : null,
        { label: 'Open on the board', icon: 'board', onClick: () => openBoard(t.id || null) },
        'sep',
        { label: 'Remove tracker…', icon: 'trash', danger: true, onClick: () => remove(t) },
    ].filter(Boolean);
}

function selbar(t) {
    const bar = el('div', 'dle-sv-selbar');
    const what = el('div', 'dle-sv-what', `<span>${esc(boardTracker(t.id)?.icon || '📶')} ${esc(t.name)}</span>`);
    what.append(K.iconButton({ icon: 'close', title: 'Unselect', onClick: () => { S.sel = null; draw(); } }));
    bar.append(what);
    if (t.run !== 'abandoned') bar.append(t.run === 'paused'
        ? K.button({ label: 'Continue', icon: 'skip', onClick: () => runAct(t.name, 'continue') })
        : K.button({ label: 'Pause', icon: 'pause', title: 'Pause in this chat: keeps its step; not followed, not told to the AI, its lore hidden', onClick: () => runAct(t.name, 'pause') }));
    bar.append(K.button({ label: 'Edit steps', icon: 'edit', onClick: () => editSteps(t) }));
    bar.append(t.run === 'abandoned'
        ? K.button({ label: 'Reactivate', icon: 'undo', title: 'On again from the start', onClick: () => runAct(t.name, 'reactivate') })
        : K.button({ label: 'Abandon', icon: 'stop', title: 'In this chat: back to the start, switched off (Undo works)', onClick: () => runAct(t.name, 'abandon') }));
    bar.append(K.moreButton(() => trackerMenu(t), { title: `More for ${t.name}` }));
    return bar;
}

// ── what the board holds (time, places, collections) ────────────────────────

function setPlace(t, to) {
    const L = live();
    if (!L) return;
    const from = hereOf(L.state, t);
    if (from === to) return;
    const ch = { kind: 'place', key: `place:${t.id}`, col: t.id, from, to, quote: '', reason: 'set by you', confidence: 'high' };
    saveLiveState(applyPlaceChanges(L.board, L.state, [ch], turnIndex(getContext()?.chat), { who: 'you' }));
    K.notify({ text: `${t.name}: the scene is now at ${placeLabel(t, to)}.`, undo: () => undoCollection(ch.logId) });
}

function heldRows(L) {
    const rows = [], shorts = [];
    const lastOf = id => (L.state.log || []).filter(e => e.col === id && e.who === 'auto').at(-1);
    const end = t => {
        const r = runOf(L.state, t);
        const b = r === 'abandoned' ? null : K.iconButton({ icon: r === 'paused' ? 'skip' : 'pause', title: r === 'paused' ? 'Continue' : 'Pause in this chat', onClick: () => runAct(t.name, r === 'paused' ? 'continue' : 'pause') });
        const last = lastOf(t.id);
        const more = K.moreButton(() => [
            r === 'abandoned' ? { label: 'Reactivate', icon: 'undo', sub: 'from the start', onClick: () => runAct(t.name, 'reactivate') } : { label: 'Abandon in this chat…', icon: 'stop', onClick: () => runAct(t.name, 'abandon') },
            L.state.lastRun?.id === t.id ? { label: 'Undo the last pause / abandon', icon: 'undo', onClick: () => say(undoTrackerRun(t.name), 'Put back as it was.') } : null,
            last ? { label: 'Undo the last change by itself', icon: 'undo', sub: last.quote ? `“${last.quote}”` : undefined, onClick: () => undoCollection(last.id) } : null,
            { label: 'Open on the board', icon: 'board', onClick: () => openBoard(t.id) },
            // a place set by hand (Miinthe 2026-10-18: "no good way to adjust location per hand"), logged with Undo like the helper's moves
            ...(t.kind === 'place' ? [{ heading: 'The scene is now at' }, ...t.places.map(p => ({ label: placeLabel(t, p.id), checked: hereOf(L.state, t) === p.id, onClick: () => setPlace(t, p.id) }))] : []),
        ].filter(Boolean), { title: `More for ${t.name}` });
        return [b, more].filter(Boolean);
    };
    const paused = t => { const r = runOf(L.state, t); return r === 'paused' ? 'paused by you' : r === 'abandoned' ? 'abandoned in this chat' : null; };
    const add = (t, lead, title, sub, short) => {
        const r = K.row({ lead: esc(lead), title, sub: paused(t) || sub, end: end(t), onClick: () => openBoard(t.id) });
        r.classList.add('dle-sv-held'); r.dataset.name = t.name; r.title = 'Open it on the board';
        if (runOf(L.state, t)) r.classList.add('dim');
        rows.push(r); if (short) shorts.push(short);
    };
    for (const t of stateTrackersOf(L.board)) {
        const day = stateNow(L.state, t).day, up = datesOf(t, L.state).filter(d => d.due >= day);
        const now = nowLine(t, L.state);
        add(t, t.icon || '🌦️', now, up.length ? `coming up: ${up.map(d => `${d.by === 'ai' ? '✨' : '📅'} ${d.name} (${dueText(d, day)})`).join(' · ')}` : t.name, now);
    }
    for (const t of placeTrackersOf(L.board)) {
        const at = placeLabel(t, hereOf(L.state, t));
        add(t, t.icon || '📍', `The scene is at ${at}`, t.setsLocation !== false ? 'sets the location filter' : t.name, `${t.icon || '📍'} ${at}`);
    }
    for (const col of collectionsOf(L.board)) {
        const groups = col.states.map((stt, k) => {
            const its = col.items.filter(it => itemState(L.state, col, it.id) === stt.id);
            if (!its.length) return null;
            return { first: k === 0, text: `${stt.label}: ${its.map(it => `${it.name}${col.amounts && itemAmount(L.state, col, it.id) > 1 ? ` ×${itemAmount(L.state, col, it.id)}` : ''}`).join(', ')}` };
        }).filter(Boolean);
        const money = (col.purse || []).map(p => { const v = purseValue(L.state, col, p.id); return p.before ? `${p.unit}${v}` : `${v} ${p.unit}`; });
        const sub = [...groups.map(g => g.text), ...money].join(' · ') || 'nothing yet';
        const held = groups.filter(g => !g.first).map(g => g.text.replace(/^[^:]*:\s*/, ''));
        add(col, col.icon || '🗂️', col.name, sub, [...held, ...money].length ? `${col.icon || '🗂️'} ${[...held, ...money].join(', ')}` : null);
        // collections that grow: things the story found, waiting for an answer (board-grow.js)
        for (const f of L.state.collections?.[col.id]?.pending || []) {
            const keep = K.button({ label: 'Keep it', kind: 'quiet', title: `Add it to ${col.name}, with its entry`, onClick: async () => { keep.disabled = true; (await import('../board-grow.js')).keepFoundWithNotice(col.id, f.id); } });
            const drop = K.button({ label: 'Not worth keeping', kind: 'quiet', title: 'Don’t ask about it again in this chat', onClick: async () => (await import('../board-grow.js')).refuseFound(col.id, f.id) });
            const r = K.row({ lead: '❓', title: f.name, sub: `found in the story: “${f.q || ''}”${f.about ? ` · ${f.about}` : ''}`, end: [keep, drop] });
            r.classList.add('dle-sv-find');
            rows.push(r);
        }
    }
    return { rows, shorts };
}

function boardFold(L) {
    const { rows, shorts } = heldRows(L);
    // pausing the board is the ⏸ button on Story's top line now (no second copy here)
    return K.fold({ title: 'On the board', summary: boardSummary(shorts), count: rows.filter(r => r.classList.contains('dle-sv-held')).length || undefined, open: S.open.board, body: rows, onToggle: v => { S.open.board = v; } });
}

// ── what changed (today's Changes tab, as a fold) ───────────────────────────

function changesFold() {
    const groups = groupFeed(feedOf());
    const head = changesSummary(groups);
    const body = [];
    if (immersed()) body.push(el('p', 'dk-hint', 'Immersion: no pop-ups.'));
    if (!groups.length) body.push(Object.assign(el('p', 'dk-hint', 'Nothing yet.'), { title: 'What the helper, the director and the board change shows up here, newest first' }));
    for (const g of groups) {
        body.push(el('div', 'dle-sv-half', esc(groupLabel(g.i))));
        for (const x of g.items) {
            const { title, sub } = changeRow(x);
            const was = undone.has(x);
            const endPart = x.onclick && !was
                ? K.button({ label: 'Undo', kind: 'quiet', onClick: () => {
                    try { x.onclick(); } catch (err) { console.warn('[DLE] undo from the list failed:', err?.message || err); }
                    undone.add(x); draw();
                } })
                : was ? el('span', 'dk-hint', 'undone') : null;
            const r = K.row({ lead: '<span class="dk-dot"></span>', title, sub, end: endPart });
            r.classList.add('dle-changes-item'); if (was) r.classList.add('dim');
            r.dataset.g = String(g.i);
            body.push(r);
        }
    }
    // the Pop-ups choice lives in Settings › Interface only (Miinthe, 2026-10-17: one home per setting)
    if (groups.length) {
        const foot = el('div', 'dle-sv-foot', '<span class="dk-hint">The changes themselves stay.</span>');
        foot.append(K.button({ label: 'Clear list', kind: 'quiet', onClick: async () => {
            const ok = await K.ask({ title: 'Clear the list?', text: 'The list empties. The changes stay as they are, but their Undo here is gone with it.', yes: 'Clear list' });
            if (ok) clearFeed();
        } }));
        body.push(foot);
    }
    const f = K.fold({ title: 'What changed', summary: head.summary, count: head.count || undefined, open: S.open.changes, body, onToggle: v => { S.open.changes = v; } });
    f.classList.add('dle-sv-changes');
    return f;
}

// ── the view ────────────────────────────────────────────────────────────────

function tools() {
    // Miinthe, 2026-10-16: "Remove + new tracker (redundant: the board's Add) … make open the board open the timeline … remove the follows the story and
    // by hand … I would rather have a pause board button and other useful functions". Follows the story / By hand now
    // lives in ⋯ (same setting, not removed).
    const t = el('div', 'dle-sv-tools');
    const off = !!boardOffHere();
    t.append(K.button({ label: off ? 'Resume board' : 'Pause board', icon: off ? 'skip' : 'pause', kind: off ? 'primary' : '',
        title: off ? 'The board runs again in this chat' : 'Nothing of the board runs in this chat until you resume it',
        onClick: () => say(switchBoard(!off), off ? 'The board runs again in this chat.' : 'The board is paused for this chat.') }));
    t.append(K.button({ label: 'Timeline', icon: 'story', title: 'Open the board on its Timeline', onClick: () => openBoard(null, { view: 'time' }) }));
    t.append(el('span', 'dle-sv-sp'));
    const auto = autoTrackEnabled();
    t.append(K.moreButton(() => [
        { heading: 'Trackers move' },
        { label: 'By themselves when the story says so', checked: auto, onClick: () => { setAutoTrackEnabled(true); schedule(); } },
        { label: 'Only by hand', checked: !auto, onClick: () => { setAutoTrackEnabled(false); schedule(); } },
        'sep',
        { label: 'Open the board', icon: 'board', onClick: () => openBoard() },
    ], { title: 'More for the story' }));
    return t;
}

function draw() {
    scheduled = false;
    if (!root) return;
    const out = [tools()];
    const offFor = boardOffHere();
    let list = [];
    try { list = getTrackers(); } catch (err) { console.warn('[DLE] Story: trackers not read', err); }
    if (offFor) {
        const box = el('div', 'dk-state dk-wait dle-sv-off', `<span><b>The board is paused for ${esc(offFor)}.</b></span>`);
        box.title = 'Nothing of it runs here: no trackers followed or told, no helper calls. Resume it on the top line.';
        out.push(box);
    } else {
        let L = null;
        try { L = live(); } catch { /* no board */ }
        if (!list.length) out.push(Object.assign(el('p', 'dk-hint dle-sv-empty', 'No trackers yet.'), { title: 'New tracker opens the board\'s Add window: for example Relationship, with its stages' }));
        for (const t of list) out.push(card(t, list));
        if (L) out.push(boardFold(L));
    }
    out.push(changesFold());
    const t = S.sel && !offFor ? list.find(x => (x.id || x.name) === S.sel) : null;
    if (S.sel && !t) S.sel = null;
    if (t) out.push(selbar(t));
    root.replaceChildren(...out);
}

function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(draw); }

/** Open the panel on Story with "What changed" open — at message `n` when given (the reply ⋯, the summary notice). */
function openChanges(n) {
    const panelEl = document.getElementById('deeplore-panel');
    if (panelEl && !panelEl.classList.contains('openDrawer')) document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle')?.click();
    document.getElementById('dle-tab-story')?.click();
    S.open.changes = true;
    draw();
    setTimeout(() => {
        const at = Number.isFinite(Number(n)) && n !== null && n !== undefined ? root?.querySelector(`.dle-changes-item[data-g="${Number(n)}"]`) : null;
        const target = at || root?.querySelector('.dle-sv-changes');
        target?.scrollIntoView({ block: 'center' });
        if (at) { at.classList.add('dle-sv-flash'); setTimeout(() => at.classList.remove('dle-sv-flash'), 1600); }
    }, 250);
}

export function mountStoryView(panel) {
    const host = panel?.querySelector('#dle-panel-story');
    if (!host) return;
    root = el('div', 'dk dle-sv');
    root.setAttribute('aria-label', 'Story');
    host.append(root);
    draw();
    // drawn: today's list, toolbar and hint go (their own render then finds nothing to fill)
    host.querySelectorAll(':scope > .dle-panel-toolbar, :scope > .dle-story-list, :scope > .dle-story-hint').forEach(x => x.remove());
    onTrackersChanged(schedule);
    onLiveChanged(schedule);
    onFeedChanged(schedule);
    const ctx = getContext(), es = ctx?.eventSource, et = ctx?.eventTypes;
    if (es && et?.CHAT_CHANGED) es.on(et.CHAT_CHANGED, () => { S.sel = null; schedule(); });
    document.getElementById('dle-tab-story')?.addEventListener('click', schedule);
    window.__dleOpenChanges = openChanges;
}
