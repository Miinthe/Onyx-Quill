/**
 * Overhaul — the side panel's tabs, redrawn to the approved mock-up (side panel + bar v13). Each tab is its own pair
 * of files (src/panel/<tab>-view.js + <tab>.css); one failing never stops the others.
 */
import { mountLoreView } from './lore-view.js';
import { mountFiltersView } from './filters-view.js';
import { mountStoryView } from './story-view.js';
import { mountCastView } from './cast-view.js';
import { mountMeroView } from './mero-view.js';
import { mountReadyView } from './ready-view.js';

export const PANEL_CSS = ['lore', 'filters', 'story', 'cast', 'mero', 'ready'].map(t => new URL(`./${t}.css`, import.meta.url).href);

export function initPanelViews($drawer) {
    const panel = $drawer.find('#deeplore-panel')[0];
    if (!panel) return;
    for (const href of PANEL_CSS) {
        if (document.querySelector(`link[href="${href}"]`)) continue;
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l);
    }
    for (const [name, fn] of [['Lore', mountLoreView], ['Filters', mountFiltersView], ['Story', mountStoryView], ['Cast', mountCastView], ['Mero', mountMeroView], ['Ready', mountReadyView]]) {
        try { fn(panel); } catch (err) { console.warn(`[DLE] ${name} tab: new view skipped, today's stays`, err); }
    }
}
