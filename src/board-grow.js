/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — collections that grow (storyboard stage 3): SillyTavern glue.
 * Rules (what may be added, waiting finds, refusals, +1 instead of a copy): collections-pure.js,
 * tested in test/collections.test.mjs. Design: `6 merge roadmap.md` (mock-up v46 #3).
 *
 * The helper (autotrack.js) reports a new thing for a collection switched to "the story can add
 * new items". "Ask me first": it waits in the collection's list — a notice with Keep it, the Story
 * tab, and the board window all show it. "Add on their own": kept at once. Keeping
 *   1. links an entry: one of that name already in the vault (any folder), else a new file written
 *      from the story's words (never over an existing file — the same writer as "Create" on the board);
 *   2. adds the item to the board (every chat of the board gets it, in its first state);
 *   3. gives it its state in this chat — logged, so the notice's Undo puts it back.
 * Undo leaves the item and its entry on the board (only this chat's state goes back).
 */
import { chat_metadata } from '../../../../../script.js';
import { escapeHtml } from '../../../../utils.js';
import { getSettings, resolveWriteVault } from '../settings.js';
import { readNote, writeNote } from './vault/obsidian-api.js';
import { buildIndexWithReuse } from './vault/vault.js';
import { runStampYaml } from './ai/run-stamp-pure.js';
import { buildEntryFile } from './board-entry-pure.js';
import { vaultIndex } from './state.js';
import { BOARD_KEY } from './storyboard-pure.js';
import { boardStore, putBoard } from './board-store.js';
import { normalizeBoard } from './board-model-pure.js';
import { live, saveLiveState } from './board-live.js';
import { echo } from './echo.js';   // Immersion = no echoes (Miinthe, 2026-10-05)
import { getTrackers, saveTrackers } from './trackers.js';
import { addPending, dropPending, growItem, keptChange, findDraft, applyCollectionChanges, describeFind } from './collections-pure.js';

const low = s => String(s ?? '').trim().toLowerCase();

/**
 * A new entry, written as a new file into the vault — never over an existing one — then the vault
 * is re-read so DeepLore knows it. Returns { ok, filename } or { ok: false, error, exists? }.
 * (The board's "Create" form and collections that grow.)
 */
export async function writeEntry(form, { reindex = true } = {}) {
    try {
        const s = getSettings();
        const v = resolveWriteVault('autoSuggest', s);
        if (!v?.host && !v?.port) return { ok: false, error: 'no vault to write to — set one up in Onyx Quill\'s settings' };
        const { filename, content } = buildEntryFile(form, { stamp: runStampYaml(chat_metadata?.deeplore_context, ['character', 'instance']), lorebookTag: s.lorebookTag || 'lorebook' });
        const there = await readNote(v.host, v.port, v.apiKey, filename, !!v.https);
        if (there.ok) return { ok: false, exists: true, filename, error: `${filename} already exists — nothing was written` };
        if (there.status !== 404) return { ok: false, error: `the vault did not answer (${there.error || there.status}) — nothing was written` };
        const w = await writeNote(v.host, v.port, v.apiKey, filename, content, !!v.https);
        if (!w.ok) return { ok: false, error: w.error || 'the vault refused it' };
        if (reindex) buildIndexWithReuse().catch(err => console.warn('[DLE] re-reading the vault after a new entry failed:', err?.message || err));
        return { ok: true, filename, vault: v.name || '' };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

/** An entry already in the vault by this title (any folder, any case) — linked instead of a repeat. */
const vaultEntryNamed = title => (vaultIndex || []).find(e => low(e.title) === low(title))?.title || null;

/** Store a changed v2 board (and the engine's v1 copy, like a window save). */
function storeBoard(name, board) {
    if (!boardStore().boards[name]) return false;
    putBoard(name, board);   // engine on v2, step 5: one board store
    return true;
}

/**
 * Keep a waiting find (Keep it — or at once on "add on their own"). `name` may be changed by Miinthe.
 * Returns { ok, logId, entry, linked, dup } or { ok: false, error } (the find then keeps waiting).
 */
export async function keepFound(colId, pendId, { name = null, quiet = false } = {}) {
    const L = live();
    const boardName = chat_metadata?.[BOARD_KEY];
    const rec = boardName ? boardStore()?.boards?.[boardName] : null;
    if (!L || !rec?.board) return { ok: false, error: 'this chat has no board' };
    const col = L.board.trackers.find(t => t.id === colId);
    const f = (L.state.collections?.[colId]?.pending || []).find(p => p.id === pendId);
    if (!col || !f) return { ok: false, error: 'already answered' };
    const itemName = String(name || f.name).trim() || f.name;
    const listed = col.items.find(x => low(x.name) === low(itemName));
    // 1. the entry: an item already listed keeps its own; else one already in the vault; else a new file
    let entry = null, linked = false;
    if (!listed) {
        entry = vaultEntryNamed(itemName);
        linked = !!entry;
        if (!entry) {
            const w = await writeEntry({ ...findDraft(L.board, col, { ...f, name: itemName }), summary: f.summary, body: f.body, title: itemName, keys: [itemName] });
            if (w.ok || w.exists) { entry = itemName; linked = !!w.exists; } else return { ok: false, error: w.error };
        }
    }
    // 2. the board grows (the stored board — every chat of it gets the item)
    const g = growItem(normalizeBoard(rec.board, boardName), colId, itemName, entry);
    if (g.error) return { ok: false, error: g.error };
    if (!storeBoard(boardName, g.board)) return { ok: false, error: 'the board could not be saved' };
    // 3. this chat: the find leaves the waiting list, the item gets its state (logged — Undo)
    const L2 = live();
    const st0 = dropPending(L2.state, colId, pendId).state;
    const ch = keptChange(L2.board, st0, colId, g.itemId, f);
    saveLiveState(applyCollectionChanges(L2.board, st0, [ch], Number(f.m) || 0, { who: quiet ? 'auto' : 'you' }));
    saveTrackers(getTrackers());          // lines waiting on it may open; the Story tab redraws
    return { ok: true, logId: ch.logId, entry, linked, dup: g.dup, name: itemName };
}

/** Not worth keeping: the find goes, and the helper isn't asked about that name again in this chat. */
export function refuseFound(colId, pendId) {
    const L = live();
    if (!L) return false;
    const r = dropPending(L.state, colId, pendId, { refuse: true });
    if (!r.found) return false;
    saveLiveState(r.state);
    saveTrackers(getTrackers());
    try { toastr.info(`Not kept. Onyx Quill won't ask about ${escapeHtml(r.found.name)} again in this chat.`, 'Storyboard', { escapeHtml: false }); } catch { /* noop */ }
    return true;
}

/** What keeping did, for a notice. */
const keptText = r => `${escapeHtml(r.name)} is kept${r.dup ? ' (it was on the list already — counted, no copy)' : r.linked ? ` — linked to your entry “${escapeHtml(r.entry)}”` : ` — new entry “${escapeHtml(r.entry)}” written`}.`;

/** Keep it, from a notice or the Story tab. */
export async function keepFoundWithNotice(colId, pendId, opts = {}) {
    const r = await keepFound(colId, pendId, opts);
    try {
        if (!r.ok) toastr.warning(`Not kept — ${escapeHtml(r.error)}. It is still waiting in the Story tab.`, 'Storyboard', { escapeHtml: false, timeOut: 12000 });
        else echo(() => toastr.info(`${keptText(r)}<br><u>Undo</u>`, 'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => import('./autotrack.js').then(m => m.undoCollection(r.logId)) }));
    } catch { /* noop */ }
    return r;
}

/**
 * The helper's new finds (checked: collections-pure validateCollectionChanges, kind 'find').
 * Each waits in its collection; on "add on their own" it is kept at once. `i` = the message.
 */
export async function handleFinds(finds, i) {
    const out = [];
    for (const ch of finds) {
        const L = live();
        if (!L) break;
        const { state, id } = addPending(L.board, L.state, ch, i);
        saveLiveState(state);
        const quote = `<br><i>“${escapeHtml(ch.quote)}”</i>`;
        if (!ch.ask) {
            const r = await keepFound(ch.col, id, { quiet: true });
            try {
                if (r.ok) echo(() => toastr.info(`🆕 ${keptText(r)}${quote}<br><u>Undo</u>`, 'Storyboard', { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, onclick: () => import('./autotrack.js').then(m => m.undoCollection(r.logId)) }));
                else toastr.warning(`🆕 ${escapeHtml(describeFind(L.board, ch))} — couldn't add it on its own (${escapeHtml(r.error)}). It waits for you in the Story tab.${quote}`, 'Storyboard', { escapeHtml: false, timeOut: 15000 });
            } catch { /* noop */ }
            out.push({ ...ch, kept: r.ok });
            continue;
        }
        // a request, not an echo: it waits in 📬 (and the Story tab); in Director a short pointer to it (Miinthe, 2026-10-05)
        echo(() => toastr.info(`📬 ${escapeHtml(describeFind(L.board, ch))} — keep it? Waiting in the mailbox.`, 'Storyboard — keep this?', { escapeHtml: false, timeOut: 8000, onclick: () => window.__dleOpenRequests?.() }));
        saveTrackers(getTrackers());       // the Story tab shows it
        out.push(ch);
    }
    return out;
}
