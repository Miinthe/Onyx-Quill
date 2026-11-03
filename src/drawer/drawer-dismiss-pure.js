/**
 * Pure helper for the drawer's outside-click dismiss handler.
 *
 * No imports from ST / jQuery. Test/integration imports this without DOM.
 *
 * Background (gotchas.md #56): ST's `callGenericPopup` renders <dialog class="popup">
 * to document.body — NOT inside `#deeplore-panel`. The naive "click outside panel
 * dismisses drawer" check therefore fires on every click inside a popup spawned
 * from the drawer (rule-builder, vault-scan, optimize-keys, the "Why not?" diag
 * popup, callGenericPopup confirms, etc.), closing the drawer behind the popup.
 *
 * This helper centralizes the bail conditions so both the live handler and the
 * regression test exercise the same logic.
 *
 * @param {Element|null} target - Click event target (or null).
 * @param {Element|null} panel - The drawer panel element (`#deeplore-panel`).
 * @param {Document} [doc] - DOM document for `dialog[open]` lookup. Defaults to globalThis.document.
 * @returns {boolean} true → drawer should NOT dismiss (bail), false → safe to dismiss.
 */
export function shouldBailDrawerDismiss(target, panel, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!target) return true;                           // defensive: no target → don't dismiss
    if (!target.closest) return true;                   // not a real element (text node, etc.)
    // Bug hunt 2026-10-16: a button that redraws its own part of the panel on click (the phone's Filters fold, a Lore row,
    // a chip) is already out of the page when the click reaches the document — it was inside the panel a moment ago, so
    // it must not count as "outside" (on a phone every such tap closed the side panel).
    if (target.isConnected === false) return true;
    if (panel && panel.contains && panel.contains(target)) return true;    // inside the panel itself
    // Drawer toggle / icon — those have their own handlers; outside-click must not interfere.
    if (target.closest('.drawer-toggle, #deeploreDrawerIcon')) return true;
    // ST popup chrome:
    //   - callGenericPopup produces <dialog class="popup"> appended to <body>.
    //     Subclasses include .popup--input, .popup--confirm, .wide_dialogue_popup, etc.,
    //     but the base `.popup` class is invariant — match on that.
    //   - `dialog[open]` covers any open native dialog (DLE's own modals, ST's
    //     character-import dialog, future popups that skip the .popup class).
    //   - `.toast` / `.toast-container` covers toastr notifications (some are
    //     click-to-dismiss, others have action buttons — either way a click on
    //     a toast must NOT close the drawer behind it).
    //   - `.ui-dialog` is the legacy jQuery-UI dialog class still used by a few
    //     ST surfaces (kept for forward-compat; cheap to include).
    if (target.closest('dialog.popup, .popup, .toast, .toast-container, dialog[open], .ui-dialog')) return true;
    // Overhaul 2a (2026-10-15): DeepLore's own bar, menus, windows, pickers and notices belong to the panel too —
    // a tap on the bar's side-panel button must not open and then close the panel in the same tap (phone).
    if (target.closest('#dle-bar, .dk-menu, .dk-scrim, .dk-epick, .dk-swpick, .dk-notices')) return true;
    // Panel tabs (2026-11-03): My notes, World and the tabs are DeepLore's panels too — a click there leaves this one be.
    if (target.closest('.dle-notes, .dle-world, .dle-dock-tabs, .dle-dock-drop')) return true;
    // Defense in depth: if any dialog is open anywhere on the page and contains
    // the click target, bail. Catches cases where a popup root lacks .popup
    // (custom dialogs from third-party extensions, polyfilled <dialog>).
    if (doc && doc.querySelector) {
        const openDialog = doc.querySelector('dialog[open]');
        if (openDialog && openDialog.contains && openDialog.contains(target)) return true;
    }
    return false;
}
