/**
 * Overhaul round 2a (2026-10-15) — the side panel's frame, as in the approved mock-up (side panel + bar v13):
 *
 *   header:  [● Ready · 12 sent ▾]  Refresh · Scribe · New lore · New run · 🔒 (PC) · ✕ (phone)
 *            "Ready" opens the numbers and health: today's budget bars, active filters and the diagnostics icons,
 *            moved as they are (their own code keeps them up to date).
 *   tabs:    today's tabs for now (rounds 2b–2e redo them); the Tools tab is gone, its tools are in ⋯ (in the header
 *            for now, so it never scrolls out of sight; the mock-up's place at the end of the tabs comes with 2b).
 *   ⋯:       every Tools item, Graph and Reroll from the old action row, Diagnostics, left / right, Settings.
 *   lock:    SillyTavern's own "pinned open" (it stays under SillyTavern's own panels and is there when they close);
 *            remembered as before (settings.drawerPinned). No lock on a phone.
 *   side:    left or right (settings.drawerSide), remembered.
 *
 * Nothing here runs an action itself: the header buttons ARE today's action buttons (moved, with line icons), and
 * ⋯ presses today's Tools buttons, so every check they make (DeepLore off, a reply generating, indexing) still runs.
 */
import { saveSettingsDebounced } from '../../../../../../script.js';
import { getSettings } from '../../settings.js';
import * as K from '../kit/kit.js';
import { keepUnderStPanels } from './drawer-stack.js';

const I = K.icon;

/** A today's-button gets a line icon inside an <i>, so its own spinner code (hide the <i>, spin the <i>) still works. */
function lineIcon(btn, name) {
    btn.innerHTML = `<i class="dle-li" aria-hidden="true">${I(name)}</i>`;
    btn.className = 'dk-ib dle-action-btn';
}

export function initPanelFrame($drawer) {
    const panel = $drawer.find('#deeplore-panel')[0];
    const inner = panel?.querySelector('.dle-drawer-inner');
    if (!panel || !inner || panel.querySelector('.dle-ph')) return;
    panel.classList.add('dle-framed');

    // ── header ──
    const ph = document.createElement('div');
    ph.className = 'dle-ph dk';
    ph.innerHTML = '<button type="button" class="dle-statusbtn" aria-haspopup="dialog" aria-expanded="false" title="The numbers for this reply, and health"><span class="dle-sdot"></span><span class="dle-st">Ready</span><span class="dle-sq"></span></button>';
    const take = (action, icon, title) => {
        const b = panel.querySelector(`#dle-drawer-actions .dle-action-btn[data-action="${action}"]`);
        if (!b) return;
        lineIcon(b, icon);
        b.setAttribute('data-i18n', '');   // else SillyTavern's translator puts the old titles back; empty, not removed — removing it makes ST's translator throw (bug hunt 2026-10-17)
        b.title = title; b.setAttribute('aria-label', title);
        ph.append(b);
    };
    take('refresh', 'refresh', 'Refresh: read your vault again');
    take('scribe', 'scribe', 'Scribe: write session notes now');
    take('newlore', 'newlore', 'New lore ideas: the AI suggests entries from the chat');
    take('new-run', 'newrun', 'New run: a fresh chat as the next run, same folders');
    const lock = K.iconButton({ icon: 'unlock', title: 'Lock the side panel open' });
    lock.classList.add('dle-lock');
    lock.addEventListener('click', () => { panel.querySelector('#dle-drawer-pin')?.click(); drawLock(); });
    const close = K.iconButton({ icon: 'close', title: 'Close the side panel' });
    close.classList.add('dle-close-ph');
    close.addEventListener('click', () => {
        // a PC too (Miinthe, 2026-11-03: "deeplore side panel has no X to close it"); closing clears the lock
        if (panel.classList.contains('pinnedOpen') && !panel.classList.contains('dle-mobile')) lock.click();
        if (panel.classList.contains('openDrawer')) panel.querySelector('#dle-drawer-close')?.click();
    });
    ph.append(lock, close);
    function drawLock() {
        const on = panel.classList.contains('pinnedOpen');
        lock.classList.toggle('on', on);
        lock.innerHTML = I(on ? 'lock' : 'unlock');
        const t = (on ? 'Locked open: stays until you unlock it, even under SillyTavern’s own panels. Click to unlock' : 'Lock the side panel open') + ' · right-click: move to the other side';
        lock.title = t; lock.setAttribute('aria-label', t); lock.setAttribute('aria-pressed', String(on));
    }
    drawLock();
    inner.parentElement.insertBefore(ph, inner);

    // ── "Ready": today's status, budget bars, filters and diagnostics, moved into a pop-up ──
    const pop = document.createElement('div');
    pop.className = 'dle-readypop dk';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'This reply’s numbers and health');
    const status = panel.querySelector('#dle-drawer-status'), footer = panel.querySelector('#dle-drawer-footer');
    if (status) pop.append(status);
    if (footer) pop.append(footer);
    panel.append(pop);
    const sbtn = ph.querySelector('.dle-statusbtn');
    const out = e => { if (!pop.contains(e.target) && !sbtn.contains(e.target)) showPop(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); showPop(false); sbtn.focus(); } };
    function showPop(v) {
        pop.hidden = !v; sbtn.setAttribute('aria-expanded', String(v));
        if (v) { setTimeout(() => document.addEventListener('pointerdown', out, true)); document.addEventListener('keydown', key, true); }
        else { document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key, true); }
    }
    sbtn.addEventListener('click', () => showPop(pop.hidden));
    panel.__dleShowReady = () => showPop(true);

    // the status button mirrors today's label, dot and entry count (their own code keeps updating them)
    const label = panel.querySelector('.dle-pipeline-label'), dot = panel.querySelector('.dle-status-dot'), entries = panel.querySelector('.dle-stat[data-stat="entries"]');
    const icons = panel.querySelector('.dle-health-icons');
    const mirror = () => {
        const t = (label?.textContent || '').trim();
        sbtn.querySelector('.dle-st').textContent = !t || /^idle$/i.test(t) ? 'Ready' : t;   // the design's word for "nothing running"
        const n = (entries?.textContent || '').trim();
        sbtn.querySelector('.dle-sq').textContent = n && n !== '0' ? `· ${n}` : '';
        sbtn.title = `${!t || /^idle$/i.test(t) ? 'Ready' : t}${n ? ` · ${n} entries in your vault` : ''}. Click for this reply’s numbers and health`;
        // the dot: busy while DeepLore works; otherwise the worst of the health icons (green, amber, red)
        const busy = !!dot?.classList.contains('dle-status-active');
        const health = icons?.querySelector('.dle-health-error') ? 'bad' : icons?.querySelector('.dle-health-warn') ? 'warn' : 'ok';
        sbtn.querySelector('.dle-sdot').className = 'dle-sdot ' + (busy ? 'busy' : health);
        sbtn.classList.toggle('busy', busy);
    };
    for (const el of [label, dot, entries, icons].filter(Boolean)) new MutationObserver(mirror).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    mirror();

    // ── the old action row and controls stay in the page (hidden) for the buttons that moved into ⋯ ──
    panel.querySelector('#dle-drawer-actions')?.setAttribute('hidden', '');
    panel.querySelector('.dle-drawer-controls')?.setAttribute('hidden', '');
    panel.querySelectorAll('.dle-drawer-inner > .dle-zone-divider').forEach(d => d.setAttribute('hidden', ''));

    // ── ⋯ instead of the Tools tab ──
    const toolsTab = panel.querySelector('#dle-tab-tools');
    if (toolsTab) toolsTab.hidden = true;
    const more = K.moreButton(() => moreItems(panel), { title: 'More: tools, diagnostics, left or right, settings' });
    more.classList.add('dle-tab-more');
    // ── the tab row as in the mock-up: Lore · Filters · Story · Cast · Mero · ⋯ ──
    // Changes is a fold in Story (src/panel/story-view.js).
    const bar = panel.querySelector('.dle-tab-bar');
    if (bar) {
        const TABS = [['injection', 'lore', 'Lore'], ['gating', 'filter', 'Filters'], ['story', 'story', 'Story'], ['cast', 'cast', 'Cast'], ['mero', 'mero', 'Mero']];
        for (const [id, icon, name] of TABS) {
            const t = bar.querySelector(`#dle-tab-${id}`);
            if (!t) continue;
            const badge = t.querySelector('.dle-tab-badge');
            t.innerHTML = `<i class="dle-li" aria-hidden="true">${I(icon)}</i><span class="dle-tab-text">${name}</span>`;
            t.setAttribute('data-i18n', ''); t.setAttribute('aria-label', name);   // the old long names ("Injection — …") were still read out
            if (badge) t.append(badge);
            bar.append(t);   // in this order
        }
        for (const id of ['browse', 'changes', 'tools']) { const t = bar.querySelector(`#dle-tab-${id}`); if (t) t.hidden = true; }
        bar.append(more);
        bar.classList.add('dle-tabs5');
        // out of the scrolling part, right under the header: the scroll bar starts below the tabs and never takes their
        // width (Miinthe, 2026-11-03: "the scrollbar in cast is moving the lore, filter etc tab … goes all the way up")
        inner.parentElement.insertBefore(bar, inner);
    } else ph.insertBefore(more, lock);

    applySide(panel);
    keepOpenOnOwnClicks();
    keepUnderStPanels(panel);   // SillyTavern's own panels open over a locked DeepLore, whatever the theme
    // Locked = stays open: a locked panel comes back open after a reload (PC only; a phone has no lock)
    if (panel.classList.contains('pinnedOpen') && !panel.classList.contains('dle-mobile')) {
        setTimeout(() => { if (!panel.classList.contains('openDrawer')) panel.parentElement?.querySelector('.drawer-toggle')?.click(); }, 400);
    }
}

/**
 * SillyTavern closes every unlocked panel on a press outside it, except on its own pop-ups and notices
 * (public/script.js, the html touchstart/mousedown handler's "forbiddenTargets"). DeepLore's bar, menus, windows,
 * pickers and notices get the same exception: otherwise choosing from ⋯ would close the panel it belongs to, and
 * the bar's side-panel button would close the panel on the press and open it again on the click.
 * The press stops at <body>, before it reaches SillyTavern's handler on <html>; DeepLore's own "press outside"
 * checks listen earlier (capture) and are not affected.
 */
const OWN = '#dle-bar, .dk-menu, .dk-scrim, .dk-epick, .dk-swpick, .dk-notices, .dle-notes, .dle-world, .dle-dock-drop';   // + My notes, World (panel tabs, 2026-11-03)
let keeping = false;
function keepOpenOnOwnClicks() {
    if (keeping) return;
    keeping = true;
    const stop = e => { if (e.target.closest?.(OWN)) e.stopPropagation(); };
    document.body.addEventListener('mousedown', stop);
    document.body.addEventListener('touchstart', stop, { passive: true });
}

const tool = (panel, action) => () => $(panel).find(`#dle-panel-tools .dle-tool-btn[data-action="${action}"]`).trigger('click');
const act = (panel, action) => () => $(panel).find(`#dle-drawer-actions .dle-action-btn[data-action="${action}"]`).trigger('click');

function moreItems(panel) {
    const left = getSettings().drawerSide === 'left';
    return [
        { heading: 'See' },
        { label: 'Graph', icon: 'graph', onClick: act(panel, 'graph') },
        { label: 'Open the board', icon: 'board', onClick: async () => { const { openBoardWindow } = await import('../board-window.js'); openBoardWindow(); } },
        { label: 'Pins and blocks', icon: 'pinI', onClick: tool(panel, 'pins-blocks') },
        { heading: 'Tools' },
        { label: 'Try matching', icon: 'test', onClick: tool(panel, 'simulate') },
        { label: 'Reroll lore', icon: 'reroll', sub: 'on the next reply', onClick: act(panel, 'clear-picks') },
        { label: 'Review the vault with Mero', icon: 'why', onClick: tool(panel, 'ai-review') },
        { label: 'Write missing summaries', icon: 'edit', sub: 'with AI', onClick: tool(panel, 'summarize') },
        { label: 'Optimize keywords', icon: 'key', sub: 'with AI', onClick: () => (panel.__dleLorePick ? panel.__dleLorePick('Pick the entries in All entries, then press Optimize keywords.') : tool(panel, 'optimize-keys')()) },
        { label: 'Import World Info', icon: 'import', onClick: tool(panel, 'import-wi') },
        { heading: 'Notebooks' },
        { label: 'Author’s notebook', icon: 'notebook', onClick: tool(panel, 'notebook') },
        { label: 'AI notepad', icon: 'notes', onClick: tool(panel, 'ai-notebook') },
        { label: 'Scribe history', icon: 'scribe', onClick: tool(panel, 'scribe-history') },
        { heading: 'Onyx Quill' },
        { label: 'Setup wizard', icon: 'wand', onClick: tool(panel, 'setup') },
        { label: 'Diagnostics', icon: 'info', onClick: () => panel.__dleShowReady?.() },
        { label: left ? 'Move the side panel to the right' : 'Move the side panel to the left', icon: left ? 'panel' : 'panelL', sub: 'remembered', onClick: () => setSide(panel, left ? 'right' : 'left') },
        'sep',
        { label: 'Settings', icon: 'settings', onClick: async () => { const { openSettingsPopup } = await import('../ui/settings-ui.js'); openSettingsPopup?.(); } },
    ];
}

function applySide(panel) {
    const left = getSettings().drawerSide === 'left';
    panel.classList.toggle('fillLeft', left);
    panel.classList.toggle('fillRight', !left);
    panel.classList.toggle('dle-left', left);
}
function setSide(panel, side) {
    getSettings().drawerSide = side;
    saveSettingsDebounced();
    applySide(panel);
    window.dispatchEvent(new CustomEvent('dle-notes'));   // the panel tabs place My notes / World again
}
/** The panel tabs' "Move to the left / right" and drag (src/dock/dock.js). */
export function setPanelSide(side) { const p = document.getElementById('deeplore-panel'); if (p) setSide(p, side === 'left' ? 'left' : 'right'); }
