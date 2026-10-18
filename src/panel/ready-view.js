/**
 * Overhaul — "Ready" (the side panel's status button) redrawn to the mock-up (side panel + bar v13, spot 3):
 *   This reply:  Lore budget · Entries · Context as quiet meters, the mode line, active filters
 *   Health:      Vault · Connection · Lore selection · Cache · AI service as rows with a dot; a click runs today's check
 *                Reset the AI pause (only while the AI is paused) · Recent activity (fold) · Session numbers
 * Miinthe, 2026-10-15: "if I open the budget bars and what not, it's still in the old DeepLore style".
 * Today's status zone and footer stay in the pop-up, hidden: their own code keeps the numbers current, and this view
 * reads them (aria values, labels, health classes) and clicks their buttons, so every check works as before.
 */
import * as K from '../kit/kit.js';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = n => num(n).toLocaleString('en-US');

export function mountReadyView(panel) {
    const pop = panel.querySelector('.dle-readypop');
    if (!pop || pop.querySelector('.dle-rv')) return;
    const status = pop.querySelector('#dle-drawer-status'), footer = pop.querySelector('#dle-drawer-footer');
    const q = s => pop.querySelector(s);

    const view = document.createElement('div');
    view.className = 'dle-rv dk';
    const meters = document.createElement('div'); meters.className = 'dle-rv-meters';
    const health = document.createElement('div'); health.className = 'dle-rv-health';
    const activity = q('.dle-activity-feed');
    const actFold = K.fold({ title: 'Recent activity', summary: '', body: activity ? [activity] : [] });
    const session = document.createElement('div'); session.className = 'dle-rv-session dk-hint';
    view.append(Object.assign(document.createElement('h4'), { className: 'dk-label', textContent: 'This reply' }), meters,
        Object.assign(document.createElement('h4'), { className: 'dk-label', textContent: 'Health' }), health, actFold, session);
    pop.prepend(view);
    if (status) status.hidden = true;
    if (footer) footer.hidden = true;

    const meter = (name, el, unit, warnAt = 0.85) => {
        const now = num(el?.getAttribute('aria-valuenow')), max = num(el?.getAttribute('aria-valuemax'));
        const pct = max > 0 ? Math.min(1, now / max) : 0;
        const tone = pct >= 0.95 ? 'bad' : pct >= warnAt ? 'wait' : '';
        return `<div class="dle-rv-m${tone ? ' ' + tone : ''}"><span>${name}</span><b>${max > 0 ? `${fmt(now)} / ${fmt(max)}${unit}` : '—'}</b><span class="dle-rv-bar"><i style="width:${Math.round(pct * 100)}%"></i></span></div>`;
    };
    const HEALTH = [['vault', 'Vault', 'your Obsidian entries'], ['connection', 'Connection', 'Obsidian is reachable'], ['pipeline', 'Lore selection', 'the last run, step by step'], ['cache', 'Cache', 'the saved copy of your vault'], ['ai', 'AI service', 'the AI that picks lore']];

    function draw() {
        const notes = [q('.dle-token-bar-note'), q('.dle-entries-bar-note')].filter(n => n && !n.classList.contains('dle-hidden') && n.textContent.trim()).map(n => n.textContent.trim());
        const mode = (q('.dle-stat[data-stat="mode"]')?.textContent || '').trim();
        const filters = (q('.dle-active-filters')?.textContent || '').replace(/\s+/g, ' ').trim();
        const lib = q('.dle-librarian-usage');
        meters.innerHTML = meter('Lore budget', q('.dle-token-bar-container'), ' tokens') + meter('Entries', q('.dle-entries-bar-container'), '') + meter('Context', q('.dle-context-bar-container'), ' tokens', 0.85)
            + (notes.length ? `<p class="dk-hint">${notes.map(n => n.replace(/[<>&]/g, '')).join(' · ')}</p>` : '')
            + `<p class="dk-hint">${mode && mode !== '—' ? `Mode: ${mode.replace(/[<>&]/g, '')}` : 'Mode: not known yet'}${filters ? ` · ${filters.replace(/[<>&]/g, '')}` : ''}</p>`
            + (lib && !lib.classList.contains('dle-hidden') && lib.textContent.trim() ? `<p class="dk-hint">${lib.textContent.trim().replace(/[<>&]/g, '')}</p>` : '');
        health.textContent = '';
        for (const [key, name, what] of HEALTH) {
            const icon = q(`.dle-health-icon[data-health="${key}"]`);
            if (!icon) continue;
            const tone = icon.classList.contains('dle-health-error') ? 'bad' : icon.classList.contains('dle-health-warn') ? 'wait' : icon.classList.contains('dle-health-ok') ? 'good' : '';
            const said = (icon.getAttribute('aria-label') || '').split(':').slice(1).join(':').trim();
            const r = K.row({ lead: `<span class="dk-dot" style="background:var(--dk-${tone || 'muted'})"></span>`, title: name, sub: said, onClick: () => icon.click() });
            r.title = `${name}: ${what}`;
            health.append(r);
        }
        const breaker = q('#dle-reset-ai-breaker');
        if (breaker && !breaker.classList.contains('dle-hidden')) health.append(K.button({ label: 'Reset the AI pause', icon: 'refresh', onClick: () => breaker.click() }));
        const stats = [...pop.querySelectorAll('.dle-ai-stat')].map(s => s.textContent.trim()).filter(Boolean);
        session.textContent = stats.length ? `This session: ${stats.join(' · ')}` : '';
        session.title = 'All chats, until the page reloads';
        actFold.setSummary(activity?.children.length ? `${activity.children.length} recent` : 'nothing yet');
    }
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
    for (const el of [status, footer, activity].filter(Boolean)) new MutationObserver(soon).observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-valuenow', 'aria-valuemax', 'aria-label'] });
    draw();
}
