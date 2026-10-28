/**
 * Cleaning up a run: SillyTavern glue (Miinthe, 2026-10-27). Rules: run-cleanup-pure.js (tested).
 *
 * When a chat is deleted and it was the LAST chat of its run, one question: clean up the run in Obsidian too? "Show me
 * what would go" lists the run's files, all ticked; the ticked ones go to the trash folder (Settings › Vault, the
 * default) or are deleted for good. DeepLore also forgets the run's folders (Filters). Nothing is touched without a yes.
 *
 * SillyTavern says only the chat's NAME, and only after the file is gone — so the run of each chat is remembered
 * beforehand: the open chat at once, the character's other chats once per session in the background (SillyTavern's own
 * chat list call, with metadata). A chat whose run is unknown asks nothing; "Clean up a run…" in Settings › Vault does
 * any run by hand.
 */
import { chat_metadata, eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
import { getSettings } from '../settings.js';
import { fetchAllMdFiles, readNote, writeNote } from './vault/obsidian-api.js';
import { deleteNote } from './vault/delete-note.js';
import { moveEntry } from './vault/move-entry-pure.js';
import { buildIndexWithReuse } from './vault/vault.js';
import { parseFrontmatter } from '../core/utils.js';
import { folderList } from './state.js';
import { resolveSessionFolder } from './ai/session-folder-pure.js';
import { CHARS_KEY, asStore, setFolders } from './characters-pure.js';
import { runOfMeta, sameRun, chatsLeft, planCleanup, trashFolder, trashDest, runsInVault } from './run-cleanup-pure.js';
import * as K from './kit/kit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const known = new Map();       // chat name → { charKey, cardName, run, story }
const fetched = new Set();     // characters whose chats were read this session

const trashName = () => String(getSettings().runTrashFolder || '').trim().replace(/^\/+|\/+$/g, '') || 'zz Deleted runs';
const forGood = () => getSettings().runCleanupMode === 'delete';
const vaults = () => (getSettings().vaults || []).filter(v => v.enabled);

/** A character's chats with their metadata (SillyTavern's chat list call). [] when it fails. */
async function chatsOf(avatar) {
    try {
        const r = await fetch('/api/characters/chats', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, metadata: true }) });
        const list = r.ok ? await r.json() : [];
        return Array.isArray(list) ? list : Object.values(list || {}).filter(x => x && typeof x === 'object' && x.file_name);
    } catch { return []; }
}

function remember(charKey, cardName, name, meta) {
    const r = runOfMeta(meta);
    if (name && r.run) known.set(name, { charKey, cardName, ...r }); else if (name) known.delete(name);
}

/** On every chat change: this chat's run now; the character's other chats once per session, a little later. */
function onChatChanged() {
    const ctx = getContext();
    if (ctx?.groupId) return;
    const c = ctx?.characters?.[ctx?.characterId], name = ctx?.getCurrentChatId?.();
    if (!c?.avatar) return;
    remember(c.avatar, c.name, name, chat_metadata);
    if (fetched.has(c.avatar)) return;
    fetched.add(c.avatar);
    setTimeout(async () => { for (const x of await chatsOf(c.avatar)) remember(c.avatar, c.name, String(x.file_name || '').replace(/\.jsonl$/, ''), x.chat_metadata); }, 5000);
}

// deletes come one by one (deleting a character sends one per chat): gather them for a moment
let pending = [], timer = null, charGone = false;
function onChatDeleted(name) {
    const info = known.get(name); known.delete(name);
    if (!info) return;
    pending.push(info);
    clearTimeout(timer); timer = setTimeout(afterDeletes, 600);
}
async function afterDeletes() {
    const list = pending; pending = [];
    if (charGone) { charGone = false; return; }   // a whole character was deleted: its runs are not asked about one by one
    const runs = [];
    for (const r of list) if (!runs.some(x => x.charKey === r.charKey && sameRun(x, r))) runs.push(r);
    for (const r of runs) {
        const left = chatsLeft((await chatsOf(r.charKey)).map(x => x.chat_metadata), r);
        if (!left) await askAfterDelete(r);
    }
}

/** "That was the last chat of … run B. Clean up run B in Obsidian too?" */
function askAfterDelete(r) {
    return new Promise(resolve => {
        const R = r.run.toUpperCase();
        const body = document.createElement('div');
        body.innerHTML = `<p style="margin:0">Clean up run ${R} in Obsidian too?</p><p class="dle-rc-mini">Nothing is touched unless you say so on the next step.</p>`;
        const keep = K.button({ label: 'Keep the files', onClick: () => w.close() });
        const show = K.button({ label: 'Show me what would go…', kind: 'primary', onClick: () => { w.close(); openCleanup(r); } });
        const w = K.openWindow({ title: `That was the last chat of ${r.story || r.cardName} · run ${R}.`, body, foot: [keep, show], size: 'small', onClose: resolve });
    });
}

/** Every note in the enabled vaults, with its frontmatter (the trash folder left out). */
async function readVault() {
    const out = [];
    for (const v of vaults()) {
        const data = await fetchAllMdFiles(v.host, v.port, v.apiKey, !!v.https, { skipFolder: trashName() });
        if (data.partial || data.failed) throw new Error(`Couldn't read all of "${v.name}" — nothing was changed. Is Obsidian open?`);
        for (const f of data.files || []) out.push({ vault: v.name, path: f.filename, fm: parseFrontmatter(String(f.content || '')).frontmatter });
    }
    return out;
}

/** The list: what would go, ticked; what stays and why; then move or delete the ticked files. */
export async function openCleanup(r) {
    const R = r.run.toUpperCase(), name = `${r.story || r.cardName || 'this story'} · run ${R}`;
    const body = document.createElement('div');
    body.className = 'dle-rc';
    body.innerHTML = '<p class="dle-rc-mini">Looking through your vault…</p>';
    const cancel = K.button({ label: 'Cancel', onClick: () => w.close() });
    const go = K.button({ label: '…', kind: forGood() ? 'danger' : 'primary', disabled: true, onClick: () => run() });
    const w = K.openWindow({ title: `Clean up ${name}`, body, foot: [cancel, go], size: '' });
    let plan;
    try {
        const files = await readVault();
        const base = String(getSettings().scribeFolder || '').trim();
        // the folders the notes really sit in: DeepLore's own folder list only knows folders that hold lore entries,
        // so a session folder of Scribe notes alone was missed and its notes were listed as entries (live test 2026-10-28)
        const folders = [...new Set([...folderList.map(f => (typeof f === 'string' ? f : f?.path)), ...files.map(f => f.path.slice(0, f.path.lastIndexOf('/')))].filter(Boolean))];
        const sf = resolveSessionFolder(base, [r.story, r.cardName].filter(Boolean), r.run, folders);
        const store = asStore(extension_settings?.[CHARS_KEY]);
        plan = planCleanup({ files, run: r.run, story: r.story, sessionFolder: sf && sf !== base ? sf : '', runFolders: r.charKey ? store.chars[r.charKey]?.runs?.[r.run]?.folders || [] : [], trash: trashName() });
    } catch (err) {
        body.innerHTML = `<p>${esc(err?.message || err)}</p>`;
        return;
    }
    const forgets = !!(r.charKey && asStore(extension_settings?.[CHARS_KEY]).chars[r.charKey]?.runs?.[r.run]);
    body.innerHTML = (plan.count ? '' : `<p>No files of run ${R} were found in your vault.</p>`)
        + plan.groups.map((g, i) => `<details class="dle-rc-grp"><summary><input type="checkbox" checked data-g="${i}" aria-label="${esc(g.label)}"><b>${esc(g.label)}</b><span class="dle-rc-mini">${g.files.length}</span></summary><ul>${g.files.map((f, j) => `<li><label><input type="checkbox" checked data-f="${i}:${j}"><span>${esc(f.path)}</span></label></li>`).join('')}</ul></details>`).join('')
        + (plan.kept.length ? `<details class="dle-rc-kept"><summary>Kept: ${plan.kept.length} ${plan.kept.length === 1 ? 'file' : 'files'} another run also uses</summary><ul>${plan.kept.map(k => `<li><b>${esc(k.path)}</b> — ${esc(k.why)}</li>`).join('')}</ul></details>` : '')
        + (forgets ? `<p class="dle-rc-also">Also in DeepLore: forget run ${R}'s folders (Filters).</p>` : '')
        + `<p class="dle-rc-mini">${forGood() ? 'Deleted for good — there is no undo. (Settings › Vault)' : `They move to “${esc(trashName())}” in your vault; drag a file back out to undo. Folders left empty stay — remove them in Obsidian. (Settings › Vault)`}</p>`;
    const ticked = () => [...body.querySelectorAll('[data-f]:checked')].map(c => { const [i, j] = c.dataset.f.split(':').map(Number); return plan.groups[i].files[j]; });
    const label = () => {
        const n = ticked().length;
        go.textContent = !n && forgets ? 'Only forget the folders' : forGood() ? `Delete ${n} for good` : `Move ${n} to the trash`;
        go.disabled = !n && !forgets;
    };
    body.querySelectorAll('[data-g]').forEach(cb => {
        cb.onclick = e => e.stopPropagation();
        cb.onchange = () => { body.querySelectorAll(`[data-f^="${cb.dataset.g}:"]`).forEach(f => { f.checked = cb.checked; }); label(); };
    });
    body.querySelectorAll('[data-f]').forEach(f => f.onchange = () => {
        const g = f.dataset.f.split(':')[0], all = [...body.querySelectorAll(`[data-f^="${g}:"]`)], box = body.querySelector(`[data-g="${g}"]`);
        box.checked = all.every(x => x.checked); box.indeterminate = !box.checked && all.some(x => x.checked);
        label();
    });
    label();

    async function run() {
        const list = ticked();
        go.disabled = true; cancel.disabled = true; go.textContent = forGood() ? 'Deleting…' : 'Moving…';
        const folder = trashFolder(trashName(), r), failed = [];
        for (const f of list) {
            const v = vaults().find(x => x.name === f.vault); if (!v) { failed.push(`${f.path}: vault not found`); continue; }
            const res = forGood()
                ? await deleteNote(v.host, v.port, v.apiKey, f.path, !!v.https)
                : await moveEntry({ from: f.path, destFolder: trashDest(folder, f.path), io: {
                    read: p => readNote(v.host, v.port, v.apiKey, p, !!v.https),
                    write: (p, c) => writeNote(v.host, v.port, v.apiKey, p, c, !!v.https),
                    del: p => deleteNote(v.host, v.port, v.apiKey, p, !!v.https),
                }, log: m => console.log(`[DLE] run cleanup: ${m}`) });
            if (!res.ok) failed.push(`${f.path}: ${res.error || 'failed'}`);
        }
        if (forgets) { extension_settings[CHARS_KEY] = setFolders(asStore(extension_settings?.[CHARS_KEY]), r.charKey, r.cardName, [], r.run); saveSettingsDebounced(); }
        w.close();
        const done = list.length - failed.length;
        K.notify({ text: `${forGood() ? `${done} deleted` : `${done} moved to “${folder}”`}.${forgets ? ` Run ${R} is forgotten.` : ''}${failed.length ? ` ${failed.length} couldn't be ${forGood() ? 'deleted' : 'moved'} — they're still in place (see the browser console).` : ''}`, tone: failed.length ? 'wait' : 'good', timeout: 9000 });
        if (failed.length) console.warn('[DLE] run cleanup — not done:\n' + failed.join('\n'));
        if (done) buildIndexWithReuse().catch(() => {});
    }
}

/** Settings › Vault › "Clean up a run…": pick any run the vault has stamps for. */
export async function pickRunToClean() {
    const body = document.createElement('div');
    body.className = 'dle-rc';
    body.innerHTML = '<p class="dle-rc-mini">Looking through your vault…</p>';
    const w = K.openWindow({ title: 'Clean up a run', body, size: 'small' });
    let runs;
    try { runs = runsInVault(await readVault()); } catch (err) { body.innerHTML = `<p>${esc(err?.message || err)}</p>`; return; }
    if (!runs.length) { body.innerHTML = '<p>No runs found: no note in your vault has a run stamp (character + instance).</p>'; return; }
    body.innerHTML = '<p class="dle-rc-mini">Only clean up a run you\'re done with — its chats may still be in SillyTavern.</p>'
        + runs.map((x, i) => `<button class="dle-rc-run" data-r="${i}"><b>${esc(x.story)}</b> · run ${esc(x.run.toUpperCase())}<span class="dle-rc-mini">${x.files} ${x.files === 1 ? 'file' : 'files'}</span></button>`).join('');
    body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
        const x = runs[Number(b.dataset.r)];
        w.close();
        openCleanup({ charKey: '', cardName: '', run: x.run, story: x.story });
    });
}

export function initRunCleanup() {
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CHAT_DELETED, onChatDeleted);
    if (event_types.CHARACTER_DELETED) eventSource.on(event_types.CHARACTER_DELETED, () => { charGone = true; setTimeout(() => { charGone = false; }, 3000); });
}
