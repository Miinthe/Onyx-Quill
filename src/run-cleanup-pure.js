/**
 * Cleaning up a run (Miinthe, 2026-10-27: "if you delete a chat with an instance it should ask you if you want to delete it
 * from obsidian as well"; mock-up https://claude.ai/artifact/138w9AchcDdmyuijzsLpoC). Pure; tested in
 * test/run-cleanup.test.mjs. Glue: run-cleanup.js.
 *
 * A RUN is a story (the chat's context `character`, e.g. "Corvin; A Fox as a Pet is an Ask for Trouble") and an
 * instance letter. Its files are found ONE BY ONE by their own stamp — never "everything in this folder": a story's
 * folder is shared by all its runs. A file belongs to the run when its `instance` is the run's letter and its
 * `character` is the run's story; a file with no character only when it sits in the run's own session folder or one of
 * the run's folders. Anything that another run also uses (two letters, two stories) is KEPT and shown with the reason.
 *
 * Nothing here touches the vault; the glue moves (to the trash folder, via the safe copy-check-delete of
 * vault/move-entry-pure.js) or deletes (vault/delete-note.js) exactly the ticked files.
 */

const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const norm = v => str(v).replace(/^["']|["']$/g, '').trim().toLowerCase();
const letter = v => norm(arr(v)[0]).slice(0, 1);
const folderOf = p => (str(p).includes('/') ? str(p).slice(0, str(p).lastIndexOf('/')) : '');
const under = (path, folder) => !!folder && (str(path) === folder || str(path).startsWith(folder.replace(/\/+$/, '') + '/'));

/** The run a chat belongs to, from its chat_metadata: { run: 'b', story } ('' when none). */
export function runOfMeta(meta) {
    const ctx = meta?.deeplore_context || {};
    return { run: letter(ctx.instance), story: str(arr(ctx.character)[0]).trim() };
}

/** Same run: the same letter, and the same story (when either side names one). */
export const sameRun = (a, b) => !!a?.run && a.run === b?.run && (!a.story || !b.story || norm(a.story) === norm(b.story));

/** How many of these chats (their chat_metadata) still belong to the run. */
export const chatsLeft = (metas, run) => arr(metas).filter(m => sameRun(runOfMeta(m), run)).length;

export const GROUPS = [
    ['sessions', 'Session notes (Scribe)'],
    ['entries', 'Entries from this run'],
    ['copies', 'Branch copies'],
    ['mero', 'Made by Mero'],
];

/**
 * Which files go. files: [{ vault, path, fm }] (fm: the note's frontmatter). sessionFolder: the run's own Scribe folder
 * ('' when the run has none — never the shared base folder). runFolders: folders set for this run (Filters).
 * trash: the trash folder (never offered again). → { groups: [{ id, label, files: [{ vault, path }] }], kept: [{ path, why }], count }
 */
export function planCleanup({ files, run, story = '', sessionFolder = '', runFolders = [], trash = '' } = {}) {
    const L = letter(run), S = norm(story);
    const own = [sessionFolder, ...arr(runFolders)].filter(Boolean);
    const out = Object.fromEntries(GROUPS.map(([id]) => [id, []])), kept = [];
    if (!L) return { groups: [], kept, count: 0 };
    for (const f of arr(files)) {
        const path = str(f?.path); if (!path || (trash && under(path, trash))) continue;
        const fm = f.fm || {};
        const letters = [...new Set(arr(fm.instance).map(letter).filter(Boolean))];
        const stories = [...new Set(arr(fm.character).map(norm).filter(Boolean))];
        const inOwn = own.some(d => under(path, d));
        const mine = letters.includes(L) && (stories.length ? !!S && stories.includes(S) : inOwn);
        const unstampedHere = !letters.length && !stories.length && inOwn;
        if (!mine && !unstampedHere) {
            if (inOwn && (letters.length || stories.length)) kept.push({ path, why: letters.length && !letters.includes(L) ? `stamped run ${letters.map(x => x.toUpperCase()).join(', ')}` : 'stamped for another story' });
            continue;
        }
        const others = letters.filter(x => x !== L), otherStories = stories.filter(x => x !== S);
        if (others.length) { kept.push({ path, why: `also used by run ${others.map(x => x.toUpperCase()).join(', ')}` }); continue; }
        if (otherStories.length) { kept.push({ path, why: 'also used by another story' }); continue; }
        const g = fm.carried_from ? 'copies' : /mero/i.test(str(fm.made_by)) ? 'mero' : sessionFolder && under(path, sessionFolder) ? 'sessions' : 'entries';
        out[g].push({ vault: str(f.vault), path });
    }
    const groups = GROUPS.map(([id, label]) => ({ id, label, files: out[id].sort((a, b) => a.path.localeCompare(b.path)) })).filter(g => g.files.length);
    return { groups, kept: kept.sort((a, b) => a.path.localeCompare(b.path)), count: groups.reduce((n, g) => n + g.files.length, 0) };
}

/** The trash folder for one cleanup: "<trash>/<story> B (2026-10-27)" — a name Obsidian accepts. */
export function trashFolder(trash, { run, story = '' }, now = new Date()) {
    const safe = s => str(s).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const name = `${safe(story).slice(0, 60) || 'Run'} ${letter(run).toUpperCase()} (${now.toISOString().slice(0, 10)})`;
    return `${str(trash).replace(/^\/+|\/+$/g, '') || 'zz Deleted runs'}/${name}`;
}

/** Where a file lands in the trash: its own folders kept under the cleanup's folder (so dragging it back is easy). */
export const trashDest = (folder, path) => [folder, folderOf(path)].filter(Boolean).join('/');

/** Every run the vault knows, from the stamps: [{ run, story, files }] — for "Clean up a run…" by hand. */
export function runsInVault(files) {
    const seen = new Map();
    for (const f of arr(files)) {
        const fm = f?.fm || {};
        const stories = arr(fm.character).map(x => str(x).replace(/^["']|["']$/g, '').trim()).filter(Boolean);
        for (const l of new Set(arr(fm.instance).map(letter).filter(Boolean))) {
            for (const s of stories) { const k = `${norm(s)}\u0000${l}`; const e = seen.get(k) || { run: l, story: s, files: 0 }; e.files++; seen.set(k, e); }
        }
    }
    return [...seen.values()].sort((a, b) => a.story.localeCompare(b.story) || a.run.localeCompare(b.run));
}
