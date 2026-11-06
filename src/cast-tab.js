/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the 🎭 Cast tab in DeepLore's side panel (Miinthe: "the whole cast thing should be in the
 * side main 'action' side panel … for easy access"). The board keeps the set-up; here is where you play:
 *  - the queue: who speaks next — ▲ ▼ ✕, + someone, "You", click a name to write as them, ▶ Go / ■ Stop;
 *  - each person: in the scene (switch), 💬 speak now, and opening up to wants / plans / thoughts / knows (editable;
 *    hidden people blurred until 👁).
 * Hand changes are logged like the helper's (Undo, a delete rolls them back). A working look for now — the real design
 * comes with the UI tidy-up.
 */
import { getContext } from '../../../../extensions.js';
import { escapeHtml } from '../../../../utils.js';
import { live, saveLiveState, onLiveChanged } from './board-live.js';
import { onTrackersChanged } from './trackers.js';
import { runningCasts, personNow, handChange, HOW_WORDS, MAX_PLANS, appearsOf, oddsOf } from './cast-pure.js';

const APPEARS_WORDS = { off: 'only when called in', places: 'turns up at their places', plans: 'turns up at their places or comes looking' };
import { SPEAKS_WORDS, speaksOf, moveItem, addItem, setText, isMine, personSummary } from './cast-voice-pure.js';
import { speakAs, cannotSpeak, npcSpeaking } from './cast-voice.js';
import { askOffscreen } from './cast.js';
import { getQueue, setQueue, runQueue, stopQueue, queueRunning, onQueueChanged, getSuggestions, setSuggestions, resetRound, addStaying, removeFromRound } from './cast-queue.js';
import { turnIndex } from './turn-index.js';

const esc = s => escapeHtml(String(s ?? ''));
const peek = new Set();          // hidden people you are peeking at (until the page reloads)
const open = new Set();          // people opened up in the tab
let writing = null;              // the queue item you are writing as: id
let scheduled = false;

const panel = () => document.querySelector('#dle-panel-cast .dle-cast-mount');
const at = () => turnIndex(getContext()?.chat);
function change(castId, personId, field, to) {
    const L = live(); if (!L) return;
    saveLiveState(handChange(L.board, L.state, castId, personId, field, to, at()));
}
// the player by their persona's name, never "You" (Miinthe, 2026-10-19: "'you' should be just {{user}}")
const userName = () => getContext()?.name1 || '{{user}}';
const nameOf = (L, x) => (x.kind === 'you' ? userName() : L.board.trackers.find(t => t.id === x.cast)?.people?.find(p => p.id === x.person)?.name ?? '?');

/**
 * Overhaul (2026-10-15): the new Cast view (src/panel/cast-view.js) draws the tab instead, on the same events; this
 * one stays as the fallback if it fails. view: { render(), openPerson(key) }.
 */
let view = null;
export function useCastView(v) { view = v; schedule(); }

export function renderCastTab() {
    scheduled = false;
    if (view) {
        try { view.render(); return; } catch (err) { console.warn('[Onyx Quill] Cast tab: new view failed, today\'s comes back', err); view.dispose?.(); view = null; }
    }
    const el = panel();
    if (!el) return;
    const L = live();
    const casts = L ? runningCasts(L.board, L.state).filter(c => (c.people || []).length) : [];
    if (!L || !casts.length) {
        el.innerHTML = `<p class="dle-text-sm dle-cast-empty">No cast yet. On the board: <b>Add ▸ 🎭 Cast</b>, then <b>+ person</b>.</p>`;
        return;
    }
    const q = getQueue(), run = queueRunning(), speaking = npcSpeaking();
    const people = casts.flatMap(c => c.people.map(p => ({ c, p })));
    const mainName = getContext()?.name2 || 'Main character';
    const mine = q.filter(isMine), ai = q.filter(x => !isMine(x));
    const qRow = (x, k, half) => {
        const name = x.kind === 'you' ? userName() : x.kind === 'main' ? mainName : nameOf(L, x);
        const icon = x.kind === 'you' ? '🙂' : x.kind === 'main' ? '💬' : isMine(x) ? '✍️' : '🤖';
        const sub = x.kind === 'you' ? 'your message from the chat box' : x.kind === 'main' ? 'the main character replies'
            : isMine(x) ? `you write: “${esc(x.text.slice(0, 60))}${x.text.length > 60 ? '…' : ''}”` : x.exit ? esc(`says goodbye and leaves${x.exit.why ? ` — ${x.exit.why}` : ''}`) : esc(x.why ? `the AI writes — ${x.why}` : 'the AI writes');
        return `<li class="dle-cast-qi${isMine(x) ? ' mine' : ' ai'}" data-q="${esc(x.id)}">
            <span class="dle-cast-qn">${k + 1}.</span>
            ${x.kind === 'npc' ? `<button type="button" class="dle-cast-qname dle-cast-write" title="${isMine(x) ? 'Change what you wrote, or let the AI write it' : `Write ${esc(name)}'s line yourself`}">${icon} ${esc(name)}</button>` : `<span class="dle-cast-qname">${icon} ${esc(name)}</span>`}<span class="dle-cast-qsub">${sub}</span>
            <span class="dle-cast-qbtns"><button type="button" class="menu_button" data-qup="${esc(x.id)}" title="Earlier" ${k ? '' : 'disabled'}>▲</button><button type="button" class="menu_button" data-qdown="${esc(x.id)}" title="Later" ${k < half.length - 1 ? '' : 'disabled'}>▼</button><button type="button" class="menu_button" data-qx="${esc(x.id)}" title="Not this round">✕</button></span>
            ${writing === x.id ? `<div class="dle-cast-writeas"><textarea class="text_pole" rows="3" placeholder="What ${esc(name)} says — it goes out under their name, in your half of the round">${esc(x.text || '')}</textarea><div><button type="button" class="menu_button dle-cast-wok">Use this</button>${isMine(x) ? '<button type="button" class="menu_button dle-cast-wclear">Let the AI write it</button>' : ''}</div></div>` : ''}
        </li>`;
    };
    const sugg = getSuggestions().filter(w => people.some(({ c, p }) => c.id === w.cast && p.id === w.person) && !q.some(x => x.kind === 'npc' && x.cast === w.cast && x.person === w.person));
    const personRow = ({ c, p }) => {
        const n = personNow(L.state, c, p), k = `${c.id}:${p.id}`, veiled = p.hidden && !peek.has(k), isOpen = open.has(k), off = L.state.cast?.[c.id]?.[p.id]?.offscreen || [];
        const veil = t => `<div class="dle-cast-veil">${esc(t)}</div>`;
        return `<div class="dle-cast-person${n.here ? ' here' : ''}" data-p="${esc(k)}">
            <div class="dle-cast-ph">
                <button type="button" class="dle-cast-open" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'} ${p.hidden ? '🙈' : '🎭'} <b>${esc(p.name)}</b></button>
                <span class="dle-cast-sum">${esc(personSummary(L.state, c, p))}${speaking?.person === p.id ? ' · ✍️ speaking…' : ''}</span>
                <label class="checkbox_label dle-cast-here" title="In the scene — the helper sees people come and go; set it here by hand"><input type="checkbox" data-here ${n.here ? 'checked' : ''}> here</label>
                <button type="button" class="menu_button dle-cast-speak" title="${esc(p.name)} speaks now — their own message" ${run ? 'disabled' : ''}>💬</button>
                <button type="button" class="menu_button dle-cast-queue-add" title="Add ${esc(p.name)} to this round — the AI writes (click the name in the round to write it yourself)">+</button>
                ${n.here ? '' : `<button type="button" class="menu_button dle-cast-offscreen" title="What has ${esc(p.name)} been up to while away? (one helper call)">📜</button>`}
            </div>
            ${off.length && !isOpen ? `<div class="dle-cast-lastoff">📜 ${veiled ? '<span class="dle-cast-veil">while away</span>' : esc(off.at(-1).text)}</div>` : ''}
            ${isOpen ? `<div class="dle-cast-pb">
                <div class="dle-text-sm dle-cast-mode">${esc(SPEAKS_WORDS[speaksOf(p)])} · ${esc(APPEARS_WORDS[appearsOf(p)])}${appearsOf(p) !== 'off' && (p.hangouts || []).length ? ` (1 in ${oddsOf(p)} at their places)` : ''} <span class="dle-cast-dim">— set on the board</span></div>
                <label>Wants <span class="dle-cast-dim">the long goal</span></label>${veiled ? veil('what they want') : `<textarea class="text_pole" rows="2" data-wants>${esc(n.wants)}</textarea>`}
                <label>Plans <span class="dle-cast-dim">up to ${MAX_PLANS} — the writer acts on them, never says them</span></label>
                ${veiled ? veil(`${n.plans.length} plan(s)`) : `${n.plans.map((x, j) => `<div class="dle-cast-row"><input class="text_pole" data-plan="${j}" value="${esc(x.text)}"><button type="button" class="menu_button" data-planx="${j}" title="Drop">✕</button></div>`).join('')}${n.plans.length < MAX_PLANS ? '<input class="text_pole" data-newplan placeholder="+ a plan">' : ''}`}
                <label>Thinking <span class="dle-cast-dim">this moment — never told to the writer</span></label>
                ${veiled ? veil('a thought') : n.thoughts ? `<blockquote class="dle-cast-thought">${esc(n.thoughts.text)}</blockquote>` : '<div class="dle-cast-dim">Nothing yet — the director fills this in while they are here.</div>'}
                <label>Knows <span class="dle-cast-dim">earned — the writer is told, so they never know more</span></label>
                ${veiled ? veil(`${n.knows.length} thing(s)`) : `${n.knows.map((x, j) => `<div class="dle-cast-row"><span>${esc(x.fact)} <span class="dle-cast-dim">(${esc(HOW_WORDS[x.how] || x.how)}${x.i != null ? ` · #${x.i}` : ''})</span>${x.quote ? `<small class="dle-cast-q">“${esc(x.quote)}”</small>` : ''}</span><button type="button" class="menu_button" data-knowx="${j}" title="Forget">✕</button></div>`).join('') || '<div class="dle-cast-dim">Nothing special yet.</div>'}<div class="dle-cast-row"><input class="text_pole" data-newfact placeholder="+ something they know"><select class="text_pole" data-how>${Object.entries(HOW_WORDS).map(([h, w]) => `<option value="${h}"${h === 'told' ? ' selected' : ''}>${w}</option>`).join('')}</select></div>`}
                <label>Off-screen <span class="dle-cast-dim">what they did while away — written when they come back, or 📜</span></label>
                ${veiled ? veil(`${off.length} entr${off.length === 1 ? 'y' : 'ies'}`) : off.length ? off.slice(-4).reverse().map(x => `<div class="dle-cast-off">${x.from != null ? `<span class="dle-cast-dim">#${x.from}${x.to != null ? `–#${x.to}` : ''}</span> ` : ''}${esc(x.text)}</div>`).join('') : '<div class="dle-cast-dim">Nothing yet.</div>'}
                ${p.hidden ? `<button type="button" class="menu_button dle-cast-peek">${veiled ? '👁 Peek' : '🙈 Hide again'}</button>` : ''}
            </div>` : ''}
        </div>`;
    };
    el.innerHTML = `
        <div class="dle-cast-queue">
            <div class="dle-cast-h"><b>This round</b><span class="dle-cast-dim">your lines first, then the AI — ▲ ▼ within each; people you add to the AI half stay until ✕</span></div>
            <div class="dle-cast-half">Your half</div>
            ${mine.length ? `<ol class="dle-cast-ql">${mine.map((x, k) => qRow(x, k, mine)).join('')}</ol>` : '<div class="dle-cast-dim dle-cast-none">Nothing of yours this round.</div>'}
            <div class="dle-cast-half">Then the AI</div>
            ${ai.length ? `<ol class="dle-cast-ql" start="${mine.length + 1}">${ai.map((x, k) => qRow(x, k, ai)).join('')}</ol>` : '<div class="dle-cast-dim dle-cast-none">No AI replies this round.</div>'}
            ${sugg.length ? `<div class="dle-cast-sugg">${sugg.map(w => `<button type="button" class="menu_button dle-cast-sug" data-sug="${esc(w.cast)}:${esc(w.person)}" title="${esc(w.why || '')}">✨ ${esc(nameOf(L, { kind: 'npc', ...w }))} ${w.leave ? 'wants to leave — let them go' : 'wants to say something — add'}</button>`).join('')}</div>` : ''}
            <div class="dle-cast-qa">
                <select class="text_pole dle-cast-addsel"><option value="">+ add…</option>${q.some(x => x.kind === 'you') ? '' : `<option value="you">🙂 ${esc(userName())}</option>`}${people.map(({ c, p }) => `<option value="w:${esc(c.id)}:${esc(p.id)}">✍️ ${esc(p.name)} — you write</option><option value="a:${esc(c.id)}:${esc(p.id)}">🤖 ${esc(p.name)} — the AI writes</option>`).join('')}${q.some(x => x.kind === 'main') ? '' : `<option value="main">💬 ${esc(mainName)}</option>`}</select>
                ${run ? '<button type="button" class="menu_button dle-cast-stop">■ Stop after this one</button>' : `<button type="button" class="menu_button dle-cast-go" ${q.length ? '' : 'disabled'}>▶ Go</button>`}
                ${!run ? '<button type="button" class="menu_button dle-cast-clear" title="Back to: your persona, then the main character">Reset</button>' : ''}
            </div>
            <div class="dle-cast-dim dle-text-sm">Send in the chat box works too: your message, the main character, then the AI's people above.</div>
        </div>
        <div class="dle-cast-people">${people.map(personRow).join('')}</div>`;
    wire(el, L, q);
}

function wire(el, L, q) {
    const pick = node => { const [c, p] = (node.closest('[data-p]')?.dataset.p || '').split(':'); return { c, p }; };
    el.querySelectorAll('[data-qup]').forEach(b => b.onclick = () => setQueue(moveItem(q, b.dataset.qup, -1)));
    el.querySelectorAll('[data-qdown]').forEach(b => b.onclick = () => setQueue(moveItem(q, b.dataset.qdown, 1)));
    el.querySelectorAll('[data-qx]').forEach(b => b.onclick = () => removeFromRound(b.dataset.qx));
    el.querySelectorAll('.dle-cast-write').forEach(b => b.onclick = () => { const id = b.closest('[data-q]').dataset.q; writing = writing === id ? null : id; renderCastTab(); });
    el.querySelector('.dle-cast-wok')?.addEventListener('click', e => { const li = e.target.closest('[data-q]'); writing = null; setQueue(setText(q, li.dataset.q, li.querySelector('textarea').value)); });
    el.querySelector('.dle-cast-wclear')?.addEventListener('click', e => { const li = e.target.closest('[data-q]'); writing = null; setQueue(setText(q, li.dataset.q, '')); });
    el.querySelector('.dle-cast-addsel')?.addEventListener('change', e => {
        const v = e.target.value; if (!v) return;
        if (v === 'you' || v === 'main') { setQueue(addItem(q, { kind: v })); return; }
        const [how, cast, person] = v.split(':');
        if (how === 'a') { addStaying(cast, person); return; }   // the AI writes: stays in every round until ✕
        const nq = addItem(q, { kind: 'npc', cast, person });
        setQueue(nq);
        if (how === 'w') { writing = nq.filter(x => x.kind === 'npc' && x.cast === cast && x.person === person).at(-1)?.id || null; renderCastTab(); }   // you write: the box opens at once
    });
    el.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => { const [cast, person] = b.dataset.sug.split(':'); const w = getSuggestions().find(x => x.cast === cast && x.person === person); setSuggestions(getSuggestions().filter(x => x !== w)); if (w?.leave) setQueue(addItem(getQueue(), { kind: 'npc', cast, person, exit: { why: w.why } })); else addStaying(cast, person, w?.why); });
    el.querySelector('.dle-cast-go')?.addEventListener('click', () => runQueue());
    el.querySelector('.dle-cast-stop')?.addEventListener('click', () => stopQueue());
    el.querySelector('.dle-cast-clear')?.addEventListener('click', () => resetRound());
    el.querySelectorAll('.dle-cast-open').forEach(b => b.onclick = () => { const k = b.closest('[data-p]').dataset.p; if (open.has(k)) open.delete(k); else open.add(k); renderCastTab(); });
    el.querySelectorAll('[data-here]').forEach(i => i.onchange = () => { const { c, p } = pick(i); change(c, p, 'here', i.checked); });
    el.querySelectorAll('.dle-cast-speak').forEach(b => b.onclick = () => { const { c, p } = pick(b); const why = cannotSpeak(); if (why) { try { toastr.info(why, 'Cast'); } catch { /* noop */ } return; } speakAs(c, p); });
    el.querySelectorAll('.dle-cast-offscreen').forEach(b => b.onclick = async () => { const { c, p } = pick(b); b.disabled = true; b.textContent = '…'; await askOffscreen(c, p); open.add(`${c}:${p}`); renderCastTab(); });
    el.querySelectorAll('.dle-cast-queue-add').forEach(b => b.onclick = () => { const { c, p } = pick(b); addStaying(c, p); });
    el.querySelectorAll('.dle-cast-peek').forEach(b => b.onclick = () => { const k = b.closest('[data-p]').dataset.p; if (peek.has(k)) peek.delete(k); else peek.add(k); renderCastTab(); });
    const nowOf = node => { const { c, p } = pick(node); const cast = L.board.trackers.find(t => t.id === c); const person = cast?.people?.find(x => x.id === p); return { c, p, n: cast && person ? personNow(L.state, cast, person) : null }; };
    el.querySelectorAll('[data-wants]').forEach(t => t.onchange = () => { const { c, p } = pick(t); change(c, p, 'wants', t.value.trim()); });
    el.querySelectorAll('[data-plan]').forEach(i => i.onchange = () => { const { c, p, n } = nowOf(i); const list = n.plans.map(x => ({ ...x })); const v = i.value.trim(); if (v) list[+i.dataset.plan].text = v; else list.splice(+i.dataset.plan, 1); change(c, p, 'plans', list); });
    el.querySelectorAll('[data-planx]').forEach(b => b.onclick = () => { const { c, p, n } = nowOf(b); change(c, p, 'plans', n.plans.filter((_, j) => j !== +b.dataset.planx)); });
    el.querySelectorAll('[data-newplan]').forEach(i => i.onchange = () => { const { c, p, n } = nowOf(i); const v = i.value.trim(); if (v) change(c, p, 'plans', [...n.plans, { id: 'p' + Date.now().toString(36), text: v }]); });
    // forgetting a fact is a correction, not a story event: taken out, not logged
    el.querySelectorAll('[data-knowx]').forEach(b => b.onclick = () => { const { c, p, n } = nowOf(b); const gone = n.knows[+b.dataset.knowx]; const st = structuredClone(live().state); const s = st.cast?.[c]?.[p]; if (s?.knows && gone) { s.knows = s.knows.filter(k => k.id !== gone.id); saveLiveState(st); } });
    el.querySelectorAll('[data-newfact]').forEach(i => i.onchange = () => { const { c, p } = pick(i); const v = i.value.trim(); const how = i.parentElement.querySelector('[data-how]')?.value || 'told'; if (v) change(c, p, 'knows', { fact: v, how }); });
}

const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(renderCastTab); };

/** Open the Cast tab (from a notice or the board), opening DeepLore's panel first if it is closed. */
export function openCastTab(personKey = null) {
    const panelEl = document.getElementById('deeplore-panel');
    if (panelEl && !panelEl.classList.contains('openDrawer')) document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle')?.click();
    document.getElementById('dle-tab-cast')?.click();
    if (personKey) { open.add(personKey); view?.openPerson?.(personKey); }
    schedule();
}
window.__dleOpenCast = openCastTab;

/** Draw the tab and keep it fresh (index.js at start-up). */
export function initCastTab() {
    onLiveChanged(schedule);
    onTrackersChanged(schedule);
    onQueueChanged(schedule);
    const ctx = getContext(), es = ctx?.eventSource, et = ctx?.eventTypes;
    if (es && et) for (const ev of [et.CHAT_CHANGED, et.MESSAGE_RECEIVED, et.MESSAGE_DELETED, et.GENERATION_ENDED, et.GENERATION_STOPPED]) if (ev) es.on(ev, schedule);
    // the side panel may not be built yet at start-up: wait for its Cast tab (up to a minute)
    let tries = 0;
    const hook = () => { const tab = document.getElementById('dle-tab-cast'); if (tab) { tab.addEventListener('click', schedule); schedule(); } else if (tries++ < 120) setTimeout(hook, 500); };
    hook();
}
