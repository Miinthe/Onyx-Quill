/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the "What changed" tab in DeepLore's side panel: every change the board and the Cast
 * made in this chat, newest message first, each with its line and its Undo (while the page is open). The popups are
 * gathered into one summary per message (echo.js); this is where the details are. A working look until the UI tidy-up.
 */
import { getContext } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { getSettings } from '../settings.js';
import { feedOf, onFeedChanged, clearFeed, immersed } from './echo.js';
import { groupFeed } from './notices-pure.js';

const undone = new WeakSet();
let scheduled = false;
const mount = () => document.querySelector('#dle-panel-changes .dle-changes-mount');
const stripUndo = html => String(html ?? '').replace(/(<br\s*\/?>)?\s*<u>Undo( all)?<\/u>\s*$/i, '');

export function renderChangesTab() {
    scheduled = false;
    const el = mount();
    if (!el) return;
    const groups = groupFeed(feedOf());
    const style = getSettings()?.noticeStyle || 'summary';
    el.innerHTML = `
        <div class="dle-changes-head">
            <label class="dle-text-sm">Pop-ups <select class="text_pole dle-changes-style">
                <option value="summary"${style === 'summary' ? ' selected' : ''}>one summary per message</option>
                <option value="each"${style === 'each' ? ' selected' : ''}>every change</option>
            </select></label>
            ${groups.length ? '<button type="button" class="menu_button dle-changes-clear" title="Empty this list (the changes stay)">Clear list</button>' : ''}
        </div>
        ${immersed() ? '<p class="dle-text-sm dle-changes-dim">Immersion: no pop-ups — the changes are only listed here.</p>' : ''}
        ${groups.length ? groups.map(g => `<div class="dle-changes-group">
            <div class="dle-changes-at">${g.i >= 0 ? `Message #${g.i}` : 'Earlier'}</div>
            ${g.items.map((x, k) => `<div class="dle-changes-item${undone.has(x) ? ' undone' : ''}" data-g="${g.i}" data-k="${k}">
                <span class="dle-changes-title">${x.title.replace(/[<>&]/g, '')}</span>
                <div class="dle-changes-text">${stripUndo(x.html)}</div>
                ${x.onclick && !undone.has(x) ? '<button type="button" class="menu_button dle-changes-undo">Undo</button>' : undone.has(x) ? '<span class="dle-changes-dim">undone</span>' : ''}
            </div>`).join('')}
        </div>`).join('') : '<p class="dle-text-sm dle-changes-dim">Nothing yet in this chat. What the helper, the director and the board change shows up here, newest first.</p>'}`;
    el.querySelector('.dle-changes-style')?.addEventListener('change', e => { getSettings().noticeStyle = e.target.value; saveSettingsDebounced(); });
    el.querySelector('.dle-changes-clear')?.addEventListener('click', () => clearFeed());
    el.querySelectorAll('.dle-changes-undo').forEach(b => b.onclick = () => {
        const it = b.closest('[data-g]'), g = groups.find(x => String(x.i) === it.dataset.g), x = g?.items[+it.dataset.k];
        if (!x?.onclick) return;
        try { x.onclick(); } catch (err) { console.warn('[DLE] undo from the list failed:', err?.message || err); }
        undone.add(x);
        renderChangesTab();
    });
}

const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(renderChangesTab); };

/** Open the tab (the summary pop-up's "See what changed"), opening DeepLore's panel first if it is closed. */
export function openChangesTab() {
    const panelEl = document.getElementById('deeplore-panel');
    if (panelEl && !panelEl.classList.contains('openDrawer')) document.querySelector('#deeploreDrawerIcon')?.closest('.drawer-toggle')?.click();
    document.getElementById('dle-tab-changes')?.click();
    schedule();
}
window.__dleOpenChanges = openChangesTab;

export function initChangesTab() {
    onFeedChanged(schedule);
    const ctx = getContext(), es = ctx?.eventSource, et = ctx?.eventTypes;
    if (es && et?.CHAT_CHANGED) es.on(et.CHAT_CHANGED, schedule);
    let tries = 0;
    const hook = () => { const tab = document.getElementById('dle-tab-changes'); if (tab) { tab.addEventListener('click', schedule); schedule(); } else if (tries++ < 120) setTimeout(hook, 500); };
    hook();
}
