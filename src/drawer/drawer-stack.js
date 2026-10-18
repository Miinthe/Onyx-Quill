/**
 * Overhaul 2a fix (Miinthe, 2026-10-15): "Locking and opening the character side panel makes the character panel go
 * underneath the DL side panel. I specifically requested the Character SP goes OVER the DL SP."
 *
 * A locked DeepLore panel stays open, and SillyTavern's own panels open ON TOP of it. A fixed layer number can't
 * promise that: themes restyle the panels — Moonlit Echoes sets every `.drawer-content` to `z-index: 1000
 * !important`, which put DeepLore and the character panel on the same layer, and DeepLore (later in the page) won.
 * So while any other SillyTavern panel is open, DeepLore sits one layer below the lowest of them, whatever the
 * theme says; when they close, DeepLore's own layer comes back.
 */

/** SillyTavern's panels that should cover a locked DeepLore. */
export const ST_PANELS = '.drawer-content.openDrawer, #character_popup.open, #WorldInfo.openDrawer, #floatingPrompt.openDrawer';

/** The layer DeepLore should take: one below the lowest open SillyTavern panel, or null (its own CSS) when none. */
export function layerUnder(zs) {
    const n = zs.map(z => parseInt(z, 10)).filter(Number.isFinite);
    return n.length ? Math.min(...n) - 1 : null;
}

/** Keep `panel` (DeepLore's) under SillyTavern's open panels. Returns a function that stops watching. */
export function keepUnderStPanels(panel) {
    const doc = panel.ownerDocument, win = doc.defaultView;
    const apply = () => {
        const others = [...doc.querySelectorAll(ST_PANELS)].filter(el => el !== panel && !panel.contains(el));
        const z = layerUnder(others.map(el => win.getComputedStyle(el).zIndex));
        if (z === null) panel.style.removeProperty('z-index');
        else panel.style.setProperty('z-index', String(z), 'important');
    };
    let queued = false;
    const soon = () => { if (queued) return; queued = true; win.requestAnimationFrame(() => { queued = false; apply(); }); };
    const mo = new win.MutationObserver(soon);
    // SillyTavern's panels open and close by class: the top bar's panels, and the few that live elsewhere
    const roots = [doc.getElementById('top-settings-holder'), doc.getElementById('character_popup'), doc.getElementById('WorldInfo'), doc.getElementById('floatingPrompt')].filter(Boolean);
    for (const r of roots) mo.observe(r, { attributes: true, attributeFilter: ['class'], subtree: true });
    apply();
    return () => mo.disconnect();
}
