/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆'s tab: mounts mero/mero.html (the approved mock-up in host mode) in the
 * side panel's ☆ Mero tab, and pops it out into its own movable, resizable window on request. The page talks to
 * DeepLore only through window.__dleMeroHost (below); the work happens in mero.js.
 */
import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import { getSettings } from '../settings.js';
import { stIsDark, openBoardWindow } from './board-window.js';
// overhaul (2026-10-17): the old helper's lore gaps live in her Requests now (their one home)
import { loreGaps, onLoreGapsChanged, vaultIndex } from './state.js';
import { hideGap, dismissGap, getHiddenGapIds, getDismissedGapIds, persistGaps } from './librarian/librarian-tools.js';
import { resolveEntryVault, openObsidianUri } from './helpers.js';
import { getTrackers } from './trackers.js';
import { live } from './board-live.js';
import {
    onMeroChanged, meroWhere, meroTalks, meroNotes, meroSettings, meroBusy, meroTold, newTalk, updateTalk, deleteTalk,
    addNote, updateNote, removeNote, keepCard, dropCard, redoWithNote, sendToMero, whereAreWe,
    meroGlow, seeGlow, setMomentsAside, talkAboutMoments, meroConnectionName,
} from './mero.js';
import { requestsHere, answerRequest, onRequestsChanged, replyWaits, initRequests } from './requests.js';   // 📬 (step 3)
import { lookAtLore, undoEntry, meroLooking, onLookChanged, initMeroLore } from './mero-lore.js';   // ☆ entry ideas
import * as P from './pitches.js';   // 💡 pitches (step 4, 2026-10-14)
import { fitHeight, gapCards } from './panel/mero-view-pure.js';   // overhaul (side panel v13)

let frame = null, popped = false, float = null;
const clone = o => JSON.parse(JSON.stringify(o ?? null));


/** What the page asks for whenever it redraws. */
function load() {
    let trackers = [];
    try { trackers = [...getTrackers().map(t => t.name), ...(live()?.board.trackers || []).map(t => t.name)]; } catch { /* no board */ }
    return clone({
        where: meroWhere(), talks: meroTalks(), notes: meroNotes(), settings: meroSettings(), busy: meroBusy(),
        connection: meroConnectionName(), trackers: [...new Set(trackers)], popped, lastIndex: (getContext()?.chat || []).length - 1,
        requests: requestsHere(), holding: replyWaits(), looking: meroLooking(), glow: meroGlow(), pitches: P.pitchesView(),
        profiles: (extension_settings?.connectionManager?.profiles || []).map(p => ({ id: p.id, name: p.name || p.id })), profileId: getSettings().meroProfileId || '',
        side: getSettings().drawerSide === 'left' ? 'left' : 'right',   // her rail follows the panel's side (v13)
        gaps: gapsView(),
        // who a pitch may focus on besides the Cast: the main character and Miinthe's persona (Miinthe 2026-10-18)
        people: { main: getContext()?.groupId ? '' : (getContext()?.name2 || ''), user: getContext()?.name1 || '' },
    });
}

/** The lore gaps for her Requests (hidden and dismissed ones left out). */
function gapsView() {
    try { return gapCards(loreGaps, { hidden: [...getHiddenGapIds()], dismissed: [...getDismissedGapIds()] }); } catch { return { open: [], done: [] }; }
}
/**
 * A lore gap's buttons: 'write' — "Write a new entry…" with its words filled in (Create marks it written) · 'open' — the
 * entry it is about, in Obsidian · 'done' — mark it written · 'hide' — until it is flagged again · 'no' — for good.
 */
function gapAction(id, what) {
    const g = loreGaps.find(x => x.id === id);
    if (!g) return { ok: false, msg: 'That gap is gone.' };
    if (what === 'write') { openBoardWindow({ entry: { title: String(g.query || '').trim(), ask: String(g.reason || '').trim(), gapId: id } }); return { ok: true }; }
    if (what === 'open') {
        const e = (vaultIndex || []).find(x => x.title === g.entryTitle);
        const uri = e ? resolveEntryVault(e, getSettings().vaults).uri : null;
        if (!uri) return { ok: false, msg: `“${g.entryTitle || g.query}” isn't in the vault index.` };
        openObsidianUri(uri);
        return { ok: true };
    }
    if (what === 'done') { g.status = 'written'; persistGaps([...loreGaps]); return { ok: true }; }
    if (what === 'hide') { hideGap(id); return { ok: true }; }
    if (what === 'no') { dismissGap(id); return { ok: true }; }
    return { ok: false, msg: 'Not done.' };
}

/** A tracker Mero named: the side panel's Story tab, that tracker in view. */
function openStory(name) {
    const tab = document.getElementById('dle-tab-story');
    tab?.click();
    setTimeout(() => {
        const el = [...document.querySelectorAll('#dle-panel-story .dle-sv-card, #dle-panel-story .dle-sv-held, #dle-panel-story .dle-tracker, #dle-panel-story .dle-collection')].find(x => (x.dataset.name || x.querySelector('.dle-tracker-name')?.textContent || '').includes(name));
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('dle-mero-flash'); setTimeout(() => el.classList.remove('dle-mero-flash'), 1600);
    }, 200);
}

export function refreshMero() { refresh(); }
function refresh() { try { frame?.contentWindow?.__meroRefresh?.(); } catch { /* not loaded yet */ } updateGlowSignal(); }

/** The glow reaches the side panel's ☆ Mero tab too — Mero's own rail is out of sight while another tab is open. */
function updateGlowSignal() {
    const tab = document.getElementById('dle-tab-mero');
    if (!tab) return;
    const g = meroGlow().glows;
    tab.classList.toggle('dle-mero-glow', g);
    if (tab.dataset.dleTitle == null) tab.dataset.dleTitle = tab.title || '';
    tab.title = g ? 'Mero ☆ — big moment, want to talk about it?' : tab.dataset.dleTitle;
}

function makeFrame() {
    const f = document.createElement('iframe');
    f.className = 'dle-mero-frame';
    f.title = 'Mero ☆';
    f.src = new URL('../mero/mero.html', import.meta.url).href + '?v=' + Date.now();
    return f;
}

/**
 * The tab fills the side panel down to its bottom edge (Miinthe, 2026-10-15: "only half down"). It used to measure up to
 * the panel's footer, but the footer now lives in the hidden "Ready" pop-up (top 0), so the box fell back to its
 * minimum. Now: whatever the panel's scroller has left below where the box starts, measured inside the scroller.
 */
export function fitMount() {
    const mount = document.querySelector('#dle-panel-mero .dle-mero-mount');
    if (!mount || mount.hidden || !mount.offsetParent) return;
    const scroller = mount.closest('.dle-drawer-inner');
    if (!scroller) { mount.style.height = fitHeight({ scrollerHeight: innerHeight, top: mount.getBoundingClientRect().top, padBottom: 6 }) + 'px'; return; }
    const cs = getComputedStyle(scroller);
    const sr = scroller.getBoundingClientRect(), mr = mount.getBoundingClientRect();
    const inner = scroller.clientHeight - (parseFloat(cs.paddingTop) || 0);
    const top = mr.top - sr.top - (parseFloat(cs.paddingTop) || 0) - (scroller.clientTop || 0) + scroller.scrollTop;
    mount.style.height = fitHeight({ scrollerHeight: inner, top, padBottom: parseFloat(cs.paddingBottom) || 0 }) + 'px';
    if (scroller.scrollTop) scroller.scrollTop = 0;
}
addEventListener('resize', () => fitMount());

/** Put Mero into the ☆ Mero tab (once), or into her window when popped out. */
export function mountMero() {
    const mount = document.querySelector('#dle-panel-mero .dle-mero-mount');
    if (!mount) return;
    if (!frame) frame = makeFrame();
    const home = popped ? float.querySelector('.dle-mero-float-body') : mount;
    if (frame.parentElement !== home) home.appendChild(frame);   // moving an iframe reloads it; the page reads everything from the host
    document.querySelector('#dle-panel-mero .dle-mero-away')?.toggleAttribute('hidden', !popped);
    mount.toggleAttribute('hidden', popped);
    requestAnimationFrame(fitMount); setTimeout(fitMount, 300);
}

/** ⧉ / ⇲ — Mero in her own window (not full screen, movable, resizable) or back in the panel. */
function popToggle() {
    popped = !popped;
    if (popped && !float) {
        float = document.createElement('div');
        float.id = 'dle-mero-float';
        float.innerHTML = '<div class="dle-mero-float-head"><b>☆ Mero</b><span>drag to move · corner to resize</span><button type="button" class="dle-mero-float-back" title="Back into the side panel">⇲</button></div><div class="dle-mero-float-body"></div>';
        document.body.appendChild(float);
        float.querySelector('.dle-mero-float-back').onclick = () => popToggle();
        const head = float.querySelector('.dle-mero-float-head');
        head.addEventListener('pointerdown', e => {
            if (e.target.closest('button')) return;
            const r = float.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            if (frame) frame.style.pointerEvents = 'none';
            const mv = ev => { float.style.left = Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)) + 'px'; float.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px'; };
            const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (frame) frame.style.pointerEvents = ''; };
            addEventListener('pointermove', mv); addEventListener('pointerup', up);
        });
    }
    if (float) float.hidden = !popped;
    mountMero();
    refresh();
}

window.__dleMeroHost = {
    load, dark: () => stIsDark(),
    send: (id, text) => sendToMero(id, text),
    where: id => whereAreWe(id),
    newTalk: tag => clone(newTalk(tag)),
    updateTalk: (id, patch) => updateTalk(id, patch),
    deleteTalk: (id, what) => deleteTalk(id, what),
    keepCard: (id, k, c, f) => keepCard(id, k, c, f),
    dropCard: (id, k, c) => dropCard(id, k, c),
    redo: (id, k, c, f) => redoWithNote(id, k, c, f),
    addNote: f => clone(addNote(f)),
    updateNote: (id, patch) => updateNote(id, patch),
    removeNote: id => removeNote(id),
    told: id => clone(meroTold(id)),
    settings: patch => meroSettings(patch),
    openStory, popToggle,
    // your notebooks in her Notes (v13): the same tools as the side panel's ⋯ → Notebooks
    tool: action => { const b = document.querySelector(`#deeplore-panel #dle-panel-tools .dle-tool-btn[data-action="${action}"]`); if (!b) return false; b.click(); return true; },
    // Mero's connection, right in her tab (Miinthe, 2026-10-14: the settings window's AI Connections were too hard to find)
    openSettings: async section => { try { const { openSettingsView } = await import('./settings/settings-view.js'); openSettingsView({ section }); } catch (err) { console.warn('[DLE] settings did not open', err); } },
    setConnection: id => { const s = getSettings(); s.meroConnectionMode = 'profile'; s.meroProfileId = String(id || ''); saveSettingsDebounced(); refresh(); },
    answer: (id, choice, n, extra) => answerRequest(id, choice, n, extra),
    gap: (id, what) => { const r = gapAction(id, what); refresh(); return r; },
    lookLore: () => lookAtLore({ force: true }),
    undoEntry: id => undoEntry(id),
    resetSettings: what => meroSettings(null, { reset: what }),
    seeGlow: () => seeGlow(),
    momentsAside: keys => setMomentsAside(keys),
    talkMoments: async keys => { const r = await talkAboutMoments(keys); return r?.talk ? { ok: true, talk: clone(r.talk) } : r; },
    // 💡 pitches
    pitch: opts => P.pitch(opts), pitchMenu: patch => P.setMenu(patch), pitchBack: () => P.back(), pitchBringBack: () => P.bringBackDropped(),
    pitchUse: id => P.useNextReply(id), pitchDraft: id => P.draftLine(id), pitchGive: (id, c, p) => P.giveTo(id, c, p), pitchTakeBack: id => P.takeBack(id),
    pitchKeep: ids => P.keep(ids), pitchLetGo: id => P.letGo(id), pitchNo: (ids, why) => P.notMine(ids, why), pitchPeek: (id, on) => P.peek(id, on),
    pitchTalk: ids => P.talkOpener(ids), tasteEdit: (id, text) => P.editTaste(id, text),
    planStart: id => P.startPlanFor(id), planSet: (id, x) => P.planSet(id, x), planAbandon: id => P.abandonPlan(id), planLinger: id => P.lingerPlan(id),
    planRewrite: (id, mode) => P.rewritePlan(id, mode), planUseReview: id => P.useReview(id), planDropReview: id => P.dropReview(id),
};

/**
 * 📬 on DeepLore's quick-action row (Miinthe: the icon bar is DeepLore's quick-action row): a dot with the count; while a
 * reply waits for an answer the dot turns amber, the icon wiggles now and then and a small ticker says so (mock-up
 * v9–v12). Because the side panel may be closed, a toast stays up as well until the question is answered.
 */
let holdToast = null;
function mailButton() {
    const row = document.querySelector('#deeplore-panel .dle-action-row');
    if (!row) return null;
    let w = row.querySelector('.dle-mailwrap');
    if (!w) {
        w = document.createElement('span');
        w.className = 'dle-mailwrap';
        w.innerHTML = '<button type="button" class="menu_button menu_button_icon dle-action-btn dle-mail-btn" title="Mero\'s mailbox" aria-label="Mero\'s mailbox">📬<span class="dle-mail-dot" hidden></span></button><button type="button" class="dle-mail-bubble" hidden title="The reply waits for your answer" aria-label="The reply waits for your answer"><span class="ic">⏸</span><span class="tw"><span class="tick"><span>The reply waits for your answer</span><span>The reply waits for your answer</span></span></span></button>';
        row.prepend(w);
        w.querySelectorAll('button').forEach(b => b.onclick = () => openRequests());
    }
    return w;
}
window.__dleOpenRequests = () => openRequests();
/** 💡 — Mero's pitches drawer; `fromIdx`: "pitch from this message" (the 💡 on a chat message). */
window.__dleOpenPitches = (fromIdx = null) => openMeroDrawer(w => w.__meroOpenPitches?.(fromIdx));   // the "waiting in the mailbox" notices (autotrack.js, board-grow.js)
/** Open Mero on one talk (📚 a vault review just started). */
export function openMeroTalk(id) { openMeroDrawer(w => w.__meroOpenTalk?.(id)); }
export function openRequests() { openMeroDrawer(w => w.__meroOpenRequests?.()); }
/** Open Mero (the panel, her tab — or her window when popped out), then `fn(the page's window)`. */
function openMeroDrawer(fn) {
    // DeepLore's panel may be closed (the toast is there for exactly that): open it first — unless Mero is popped out
    const panel = document.getElementById('deeplore-panel');
    if (!popped && panel && !panel.classList.contains('openDrawer')) document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle')?.click();
    if (!popped) document.getElementById('dle-tab-mero')?.click();
    setTimeout(() => {
        if (popped && float) float.hidden = false;
        mountMero();
        fitMount();
        let done = false;
        const go = () => { if (done) return; try { const w = frame?.contentWindow; if (w?.__meroRefresh) { fn(w); done = true; } } catch { /* not loaded */ } };
        go(); setTimeout(go, 400); setTimeout(go, 1200);
    }, 0);
}
function updateMailSignal() {
    // overhaul 2a (2026-10-15): the DeepLore bar's side-panel button carries the signal (dot, amber + wiggle,
    // the "reply waits" bubble) — src/bar/bar.js. The old 📬 and its sticky toast only while the bar is missing.
    if (document.getElementById('dle-bar')) { document.querySelector('#deeplore-panel .dle-mailwrap')?.remove(); if (holdToast) { try { toastr.clear(holdToast); } catch { /* noop */ } holdToast = null; } return; }
    const { waiting } = requestsHere(), hold = replyWaits();
    const w = mailButton();
    if (w) {
        const dot = w.querySelector('.dle-mail-dot');
        dot.hidden = !waiting.length; dot.textContent = waiting.length || '';
        w.classList.toggle('hold', hold);
        w.querySelector('.dle-mail-bubble').hidden = !hold;
    }
    if (hold && !holdToast) {
        try { holdToast = toastr.warning('The reply waits for your answer — click to open Mero\'s mailbox.', '📬 The helper is unsure', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, onclick: () => openRequests() }); } catch { /* noop */ }
    } else if (!hold && holdToast) { try { toastr.clear(holdToast); } catch { /* noop */ } holdToast = null; }
}

/** Wire once: redraw on every change, on chat switch; mount when the tab opens. */
export function initMeroTab() {
    onMeroChanged(refresh);
    P.onPitchesChanged(refresh);
    P.initPitches();
    initRequests();
    initMeroLore();
    onLookChanged(refresh);
    onLoreGapsChanged(refresh);
    onRequestsChanged(() => { refresh(); updateMailSignal(); });
    try { eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(updateMailSignal, 300)); } catch { /* noop */ }
    setTimeout(updateMailSignal, 1000);
    try { eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(refresh, 300)); } catch { /* noop */ }
    try { eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(refresh, 300)); } catch { /* noop */ }
    document.addEventListener('click', e => {
        if (e.target.closest('#dle-tab-mero')) setTimeout(mountMero, 0);
        if (e.target.closest('.dle-mero-back')) { if (popped) popToggle(); }
    });
}
