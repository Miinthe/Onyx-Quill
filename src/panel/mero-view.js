/**
 * Overhaul — the side panel's Mero tab, to the approved mock-up (side panel + bar v13).
 *
 * Mero's talk itself is her own page (mero/mero.html, mounted by src/mero-window.js) — it is restyled to v13 there.
 * This file does the side panel's part:
 *   · the small dot on the Mero tab while she has something for you (amber while the reply waits);
 *   · her box filling the panel to its bottom edge, whenever the panel or the window changes size;
 *   · her rail moving to the outer edge when the side panel is moved left or right.
 */
import { eventSource, event_types } from '../../../../../../script.js';
import { requestsHere, replyWaits, onRequestsChanged } from '../requests.js';
import { fitMount, refreshMero } from '../mero-window.js';
import { tabDot } from './mero-view-pure.js';

function drawDot() {
    const tab = document.getElementById('dle-tab-mero');
    if (!tab) return;
    let d = { show: false };
    try { d = tabDot({ waiting: requestsHere().waiting.length, hold: replyWaits() }); } catch { /* no chat yet */ }
    let dot = tab.querySelector(':scope > .dle-tab-dot');
    if (!d.show) { dot?.remove(); return; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'dle-tab-dot'; dot.setAttribute('aria-hidden', 'true'); tab.append(dot); }
    dot.classList.toggle('hold', d.hold);
    dot.title = d.title;
}

export function mountMeroView(panel) {
    if (!panel || panel.dataset.dleMeroView) return;
    panel.dataset.dleMeroView = '1';
    panel.classList.add('dle-mero-v13');

    // the tab dot
    onRequestsChanged(drawDot);
    try { eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(drawDot, 300)); } catch { /* noop */ }
    setTimeout(drawDot, 1000);

    // her box fills the panel: the scroller and the panel can change size without the window doing so
    const scroller = panel.querySelector('.dle-drawer-inner');
    const fit = () => requestAnimationFrame(() => fitMount());
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(fit);
        ro.observe(panel);
        if (scroller) ro.observe(scroller);
    }
    panel.addEventListener('click', e => { if (e.target.closest('#dle-tab-mero')) { setTimeout(fit, 0); setTimeout(fit, 250); } });

    // the rail follows the panel's side (the frame flips .dle-left when it moves)
    let left = panel.classList.contains('dle-left');
    new MutationObserver(() => {
        const now = panel.classList.contains('dle-left');
        if (now !== left) { left = now; refreshMero(); }
        fit();   // opening the panel (openDrawer) also lands here
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
}
