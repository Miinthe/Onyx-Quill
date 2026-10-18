/**
 * Overhaul — the side panel's Filters tab, redrawn to the approved mock-up (side panel + bar v13, viewFilters):
 * a card for what this chat is (character · run, its folders, DeepLore in this chat), a Fields fold (set a field for
 * this chat), and one "Change…" button.
 *
 * The mock-up moves changing folders and fields into settings (the Filters hub, step 4 — built 2026-10-16: "Change…" →
 * "Filters in settings…" opens it). "Change…" still holds every one of today's Filters tools, so nothing is out of reach:
 *   base folders / run folders           → characters.js editFolders()          (today: the card's Edit buttons)
 *   this chat's own folders              → today's folder picker (.dle-folder-set-btn, with "Clear all folders")
 *   DeepLore for <character>             → characters.js setCharacterSwitch()   (today: the card's checkbox)
 *   DeepLore in this chat                → characters.js setChatSwitch()        (today: the card's dropdown; here a choice row)
 *   set / remove / clear a field value   → today's /dle-set-* windows; ✕ on a value, as today's chips
 *   show the unused fields               → the fold's "Show" (her patch 2026-10-03)
 *   clear all field values, edit the filter fields, full view → today's toolbar buttons, still in the page
 * Today's tab content stays in the page, hidden (.dle-fv-today): its renders keep running, its buttons keep their
 * handlers, and every time it redraws this view redraws too.
 */
import { chat_metadata } from '../../../../../../script.js';
import { saveMetadataDebounced } from '../../../../../extensions.js';
import { chatStatus, editFolders, setCharacterSwitch, setChatSwitch } from '../characters.js';
import { vaultIndex, fieldDefinitions, notifyGatingChanged, onGatingChanged } from '../state.js';
import { DEFAULT_FIELD_DEFINITIONS } from '../fields.js';
import * as K from '../kit/kit.js';
import { cardModel, fieldRows, fieldsSummary, withoutValue, withoutFolder, folderLeaf, leftOutByFolders } from './filters-pure.js';

const defs = () => (fieldDefinitions.length > 0 ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS);

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}
/** A chip that only shows something (its ✕, when there is one, is the button). */
function plainChip(o) {
    const c = K.chip(o);
    c.removeAttribute('role'); c.removeAttribute('tabindex');
    return c;
}
function runCommand(cmd) {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
    ctx?.executeSlashCommands?.(cmd)?.catch?.(err => console.warn('[DLE] Filters:', cmd, err));
}

export function mountFiltersView(panel) {
    const tab = panel?.querySelector('#dle-panel-gating');
    if (!tab || tab.querySelector('.dle-fv')) return;

    // today's content: kept, hidden, still rendered and wired
    const today = el('div', 'dle-fv-today');
    today.hidden = true;
    today.append(...tab.childNodes);
    const root = el('div', 'dle-fv dk');
    tab.append(root, today);

    const ui = { fieldsOpen: true, showAll: false };
    const proxy = sel => today.querySelector(sel)?.click();

    function setField(name, value) {
        const fd = defs().find(d => d.name === name);
        if (!fd) return;
        if (!chat_metadata.deeplore_context) chat_metadata.deeplore_context = {};
        chat_metadata.deeplore_context[fd.contextKey] = value;
        saveMetadataDebounced();
        notifyGatingChanged();
    }
    function removeValue(name, value) {
        const fd = defs().find(d => d.name === name);
        const ctx = chat_metadata?.deeplore_context;
        if (!fd || !ctx) return;
        setField(name, withoutValue(fd, ctx[fd.contextKey], value));
    }
    function removeChatFolder(folder) {
        if (!chat_metadata?.deeplore_folder_filter) return;
        chat_metadata.deeplore_folder_filter = withoutFolder(chat_metadata.deeplore_folder_filter, folder);
        saveMetadataDebounced();
        notifyGatingChanged();
    }

    function changeMenu(m) {
        // overhaul step 4: the Filters hub lives in settings now (every character and run); the tools below stay here too
        const items = [{ icon: 'settings', label: 'Filters in settings…', sub: 'every character and run', onClick: async () => { const { openSettingsPopup } = await import('../ui/settings-ui.js'); openSettingsPopup({ section: 'filters' }); } }, { heading: 'Folders' }];
        if (!m.group) {
            items.push({ icon: 'folder', label: `${m.title}’s base folders…`, sub: 'all chats with this character', onClick: () => editFolders({ run: false }) });
            items.push(m.run
                ? { icon: 'folder', label: `Run ${m.run}’s folders…`, sub: 'this run only', onClick: () => editFolders({ run: true }) }
                : { icon: 'folder', label: 'Run folders…', sub: 'no run letter yet', disabled: true });
        }
        items.push({ icon: 'folder', label: 'This chat’s own folders…', sub: 'this chat only', onClick: () => proxy('.dle-folder-set-btn') });
        if (!m.group) {
            items.push({ heading: 'Switch' });
            items.push({ label: `DeepLore for ${m.title}`, sub: 'all chats with this character', checked: m.charOn, onClick: () => setCharacterSwitch(!m.charOn) });
        }
        items.push({ heading: 'Fields' });
        items.push({ icon: 'eye', label: ui.showAll ? 'Hide the unused fields' : 'Show the unused fields', onClick: () => { ui.showAll = !ui.showAll; ui.fieldsOpen = true; draw(); } });
        items.push({ icon: 'undo', label: 'Clear all field values', sub: 'for this chat', onClick: () => proxy('.dle-clear-all-gating-btn') });
        items.push({ icon: 'edit', label: 'Edit the filter fields…', onClick: () => proxy('.dle-manage-fields-btn') });
        items.push('sep');
        items.push({ icon: 'popout', label: 'All field values in a window', onClick: () => proxy('[data-expand="gating"]') });
        return items;
    }

    function folderChips(folders, removable) {
        const box = el('span', 'dle-fv-chips');
        if (!folders.length) { box.append(el('span', 'dle-fv-mini', 'nothing')); return box; }
        for (const f of folders) {
            box.append(plainChip({ label: `📁 ${folderLeaf(f)}`, title: f, onRemove: removable ? () => removeChatFolder(f) : undefined }));
        }
        return box;
    }

    function card(m) {
        const c = el('section', 'dle-fv-card');
        const hd = el('div', 'dle-fv-hd');
        hd.append(el('span', 'dle-fv-em', m.group ? '👥' : '🎭'));
        const nm = el('span', 'dle-fv-nm', m.title + (m.run ? ` · run ${m.run}` : ''));
        nm.title = nm.textContent;
        const state = el('span', 'dle-fv-state ' + (m.on ? 'on' : 'off'), m.on ? 'on' : 'off');
        state.title = `DeepLore is ${m.on ? 'on' : 'off'} in this chat`;
        hd.append(nm, el('span', 'dle-fv-tag', 'This chat'), state);
        c.append(hd);
        if (m.why) c.append(el('div', 'dle-fv-mini dle-fv-why', m.why.charAt(0).toUpperCase() + m.why.slice(1) + '.'));

        const kv = el('div', 'dle-fv-kv');
        for (const r of m.rows) kv.append(el('span', '', r.label), folderChips(r.folders, r.key === 'own'));
        const out = leftOutByFolders(vaultIndex, m.folders);
        if (out) { kv.append(el('span', '', 'Left out'), el('span', 'dle-fv-mini', `${out} entr${out === 1 ? 'y' : 'ies'} outside these folders`)); }
        c.append(kv);

        if (m.switchOptions) {
            const ft = el('div', 'dle-fv-ft');
            ft.append(el('span', 'dle-fv-mini', 'DeepLore in this chat'));
            const s = K.seg({ options: m.switchOptions, value: m.chatSwitch, label: 'DeepLore in this chat', onChange: v => setChatSwitch(v) });
            s.classList.add('dle-fv-seg');
            ft.append(s);
            c.append(ft);
        }
        return c;
    }

    function fieldsFold() {
        const ctx = chat_metadata?.deeplore_context || null;
        const { rows, hidden } = fieldRows(defs(), vaultIndex, ctx, ui.showAll);
        const body = el('div', 'dle-fv-fields');
        const kv = el('div', 'dle-fv-kv');
        for (const r of rows) {
            const lab = el('span', '', r.label);
            lab.title = r.name;
            const val = el('span', 'dle-fv-val');
            if (r.choices) {
                const sel = el('select', 'dle-fv-select');
                sel.setAttribute('aria-label', r.label);
                sel.append(new Option('not set', ''));
                for (const v of r.choices) sel.append(new Option(v, v));
                if (r.values[0] && !r.choices.includes(r.values[0])) sel.append(new Option(r.values[0], r.values[0]));
                sel.value = r.values[0] || '';
                sel.addEventListener('change', () => setField(r.name, sel.value || null));
                val.append(sel);
            } else {
                for (const v of r.values) val.append(plainChip({ label: v, title: `${r.label}: ${v}`, onRemove: () => removeValue(r.name, v) }));
                if (!r.values.length) val.append(el('span', 'dle-fv-mini', 'not set'));
            }
            const setB = K.iconButton({ icon: r.multi ? 'plus' : 'edit', title: r.multi ? `Add to ${r.label}` : `Set ${r.label}`, onClick: () => runCommand(r.cmd) });
            setB.classList.add('dle-fv-set');
            val.append(setB);
            if (r.leftOut) { const n = el('span', 'dle-fv-mini dle-fv-out', `leaves out ${r.leftOut}`); n.title = `${r.leftOut} entries don’t match this value and are left out`; val.append(n); }
            kv.append(lab, val);
        }
        if (!rows.length) body.append(el('p', 'dle-fv-mini', 'No fields to filter by.'));
        else body.append(kv);
        const note = el('p', 'dle-fv-mini');
        if (hidden || ui.showAll) {
            note.append(ui.showAll ? '' : `${hidden} unused field${hidden === 1 ? '' : 's'} hidden. `);
            const t = el('button', 'dle-fv-link', ui.showAll ? 'Hide unused' : 'Show');
            t.type = 'button';
            t.addEventListener('click', () => { ui.showAll = !ui.showAll; draw(); });
            note.append(t);
        }
        if (note.childNodes.length) body.append(note);
        body.title = 'Values set here are for this chat only';
        const f = K.fold({ title: 'Fields', summary: fieldsSummary(rows), count: rows.filter(r => r.values.length).length || undefined, open: ui.fieldsOpen, body, onToggle: v => { ui.fieldsOpen = v; } });
        f.classList.add('dle-fv-fold');
        return f;
    }

    let m = null;
    function draw() {
        try {
            m = cardModel(chatStatus());
        } catch (err) { console.warn('[DLE] Filters view:', err); return; }
        const changeB = K.button({ label: 'Change folders and fields…', icon: 'settings', title: 'Folders, the on/off switch, and fields' });
        changeB.classList.add('dle-fv-change');
        changeB.setAttribute('aria-haspopup', 'menu');
        changeB.addEventListener('click', e => { e.stopPropagation(); K.openMenu(changeB, changeMenu(m)); });
        root.replaceChildren(card(m), fieldsFold(), changeB);
    }

    // redraw whenever today's tab redraws (chat change, vault reload, folders, fields, switches), and on gating changes
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
    new MutationObserver(soon).observe(today, { childList: true, subtree: true });
    onGatingChanged(soon);
    draw();
}
