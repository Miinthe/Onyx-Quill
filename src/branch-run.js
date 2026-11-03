/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — a branch from a past point becomes its own run.
 * SillyTavern glue; the rules live in src/drawer/branch-run-pure.js.
 *
 * The first time a branch chat opens, DeepLore offers to start it as the next run and
 * carry the run's history up to the branch point: session notes (before it ticked, the
 * one covering it unticked) and the lore filed for that run (dated ones before the
 * point ticked, undated ones for Miinthe to pick). Everything is copied, never moved; the
 * parent run is left exactly as it was. Nothing is written until she presses Start.
 *
 * Design: `4 workbench/0 projects/mechanic; MWT x DeepLore/6 merge roadmap.md`, P3.
 */
import { chat_metadata } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { escapeHtml } from '../../../../utils.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE } from '../../../../slash-commands/SlashCommandArgument.js';
import { vaultIndex, notifyGatingChanged, setLastScribeSummary, setLastScribeChatLength } from './state.js';
import { ensureIndexFresh, buildIndex } from './vault/vault.js';
import { readNote, writeNote } from './vault/obsidian-api.js';
import { getSettings, resolveWriteVault } from '../settings.js';
import { nextInstanceLetter, swapInstanceFolders } from './drawer/new-run-pure.js';
import { frontmatterDate, frontmatterSummary, runEntries, planCarry, copyTarget, carriedContent } from './drawer/branch-run-pure.js';

const STATE_KEY = 'deeplore_branch_run';
const first = v => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

let busy = false;

/**
 * CHAT_CHANGED: offer once per branch.
 * @returns {Promise<boolean>} true when Miinthe started the branch as a new run just now —
 *   the caller then rolls the trackers back to the branch point without asking again.
 */
export async function maybeOfferBranchRun() {
    if (!chat_metadata?.main_chat) return false;              // not a branch
    const st = chat_metadata[STATE_KEY]?.status;
    if (st === 'done' || st === 'never') return false;
    await offerBranchRun({ fromCommand: false });
    return chat_metadata?.[STATE_KEY]?.status === 'done';
}

/** The dialog and, on Start, the copy. Also behind /oq-branch-run. */
export async function offerBranchRun({ fromCommand }) {
    if (busy) return 'Already open.';
    busy = true;
    try {
        const ctx = chat_metadata?.deeplore_context || {};
        const character = first(ctx.character);
        const current = first(ctx.instance).toLowerCase();
        if (!character || !current) {
            if (fromCommand) toastr.warning('This chat has no Character and Instance set in Filters, so there is no run to branch from.', 'Onyx Quill');
            return 'No run set.';
        }
        const chat = getContext()?.chat || [];
        if (!chat.length) return 'Empty chat.';
        // the files are read before the dialog: she may be in another chat by the time it closes (bug hunt 2026-11-03)
        const chatId = getContext()?.getCurrentChatId?.() ?? null;
        const sameChat = () => (getContext()?.getCurrentChatId?.() ?? null) === chatId;
        const atMessage = chat.length - 1;
        const branchTime = Date.parse(chat[atMessage]?.send_date);
        if (!Number.isFinite(branchTime)) {
            toastr.warning('Could not read the time of the branch point, so session notes cannot be sorted.', 'Onyx Quill');
            return 'No branch time.';
        }

        try { await ensureIndexFresh(); } catch { /* use what we have */ }
        const next = nextInstanceLetter(vaultIndex, character, current);
        if (!next) { toastr.error('Ran out of instance letters (z reached).', 'Onyx Quill'); return 'No letter.'; }

        const settings = getSettings();
        const vault = resolveWriteVault('scribe', settings);
        const read = async path => {
            const r = await readNote(vault.host, vault.port, vault.apiKey, path, !!vault.https);
            return r.ok ? r.content : null;
        };

        // Read each candidate once: its date decides before/after, its content is what gets copied.
        const { sessions, lore } = runEntries(vaultIndex, { character, instance: current });
        const load = async es => (await Promise.all(es.map(async e => {
            const content = await read(e.filename);
            return content == null ? null : { path: e.filename, title: e.title, content, date: frontmatterDate(content) };
        }))).filter(Boolean);
        const plan = planCarry(await load(sessions), await load(lore), branchTime);
        if (!sameChat()) return 'Another chat is open now.';

        const swapFolder = folder => swapInstanceFolders([folder], current, next).folders[0];
        const filterNow = chat_metadata.deeplore_folder_filter || [];
        const { folders: nextFolders, swapped } = swapInstanceFolders(filterNow, current, next);

        // ── the dialog ──
        const fmtDate = t => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
        const name = p => escapeHtml(p.split('/').pop().replace(/\.md$/i, ''));
        let i = 0;
        const box = (item, checked, note = '') => {
            const id = `dle-br-${i++}`;
            item._id = id;
            return `<label style="display:flex;align-items:flex-start;gap:8px;margin:4px 0;text-align:left;cursor:pointer"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="flex:none;margin-top:3px"> <span>${name(item.path)}${item.date ? ` <span style="opacity:.6">· ${escapeHtml(fmtDate(item.date))}</span>` : ''}${note ? ` <i style="opacity:.75">${note}</i>` : ''}</span></label>`;
        };
        const L = String(next).toUpperCase();
        let html = `<h3>This branch starts at message ${atMessage}. Start it as run ${L}?</h3>
            <p><b>${escapeHtml(character)}</b> — instance ${escapeHtml(current)} → <b>${escapeHtml(next)}</b></p>`;
        const sessionRows = [
            ...plan.sessionsBefore.map(n => box(n, true)),
            ...(plan.sessionStraddle ? [box(plan.sessionStraddle, false, '— covers the branch point; may describe things this branch never had')] : []),
            ...plan.sessionsUndated.map(n => box(n, false, '— no date')),
        ];
        html += `<p style="margin-top:.8em"><b>Session notes</b> to copy into the new run:</p>${sessionRows.join('') || '<p style="opacity:.7">None found for this run.</p>'}`;
        const loreRows = [...plan.loreBefore.map(e => box(e, true))];
        const undatedRows = plan.loreUndated.map(e => box(e, false));
        html += `<p style="margin-top:.8em"><b>Lore filed for this run</b> before the branch point:</p>${loreRows.join('') || '<p style="opacity:.7">None with a date.</p>'}`;
        if (undatedRows.length) {
            html += `<p style="margin-top:.6em">Filed before dates were recorded — <b>date unknown</b>, your pick
                <button type="button" class="menu_button dle-br-tickall" style="display:inline-block;padding:1px 8px;margin-left:6px">tick all</button></p>
                <div class="dle-br-undated">${undatedRows.join('')}</div>`;
        }
        if (plan.loreAfterCount) html += `<p style="opacity:.7">${plan.loreAfterCount} entr${plan.loreAfterCount === 1 ? 'y was' : 'ies were'} filed after the branch point and ${plan.loreAfterCount === 1 ? 'stays' : 'stay'} behind.</p>`;
        html += swapped.length
            ? `<p style="margin-top:.8em;opacity:.85">Folder filter:</p><pre style="white-space:pre-wrap;font-size:.85em;opacity:.8">${escapeHtml(swapped.map(x => `${x.from}  →  ${x.to}`).join('\n'))}</pre>`
            : '<p style="opacity:.7">No folder in the filter names the run letter — the filter carries over unchanged.</p>';
        html += `<p style="opacity:.7;font-size:.9em">Everything is copied; the run ${escapeHtml(current.toUpperCase())} files stay exactly as they are. Each copy notes where it came from.</p>
            <label style="display:flex;align-items:center;gap:8px;margin-top:.6em;opacity:.85;cursor:pointer"><input type="checkbox" id="dle-br-never" style="flex:none"> Don't ask again for this branch</label>`;
        html = `<div style="text-align:left">${html}</div>`;

        const all = [...plan.sessionsBefore, ...(plan.sessionStraddle ? [plan.sessionStraddle] : []), ...plan.sessionsUndated, ...plan.loreBefore, ...plan.loreUndated];
        let picked = [];
        let never = false;
        const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
            okButton: `Start run ${L}`, cancelButton: 'Not now', wide: true, allowVerticalScrolling: true,
            onOpen: popup => {
                const root = popup?.dlg || document;
                root.querySelector('.dle-br-tickall')?.addEventListener('click', () => {
                    root.querySelectorAll('.dle-br-undated input[type=checkbox]').forEach(c => { c.checked = true; });
                });
            },
            onClosing: popup => {
                const root = popup?.dlg || document;
                picked = all.filter(it => root.querySelector(`#${it._id}`)?.checked);
                never = !!root.querySelector('#dle-br-never')?.checked;
                return true;
            },
        });

        if (!sameChat()) { toastr.warning('Another chat is open now — nothing was copied. Open the branch again to start it as a run.', 'Onyx Quill'); return 'Another chat is open now.'; }
        if (!ok) {
            if (never) { chat_metadata[STATE_KEY] = { status: 'never' }; saveMetadataDebounced(); }
            return 'Not now.';
        }

        // ── copy ──
        const written = [];
        const skipped = [];
        for (const it of picked) {
            const target = copyTarget(it.path, next, swapFolder);
            if (await read(target) != null) { skipped.push(`${target} (already exists — not overwritten)`); continue; }
            const content = carriedContent(it.content, { newLetter: next, carriedFrom: it.path, atMessage });
            if (content == null) { skipped.push(`${it.path} (no frontmatter)`); continue; }
            const r = await writeNote(vault.host, vault.port, vault.apiKey, target, content, !!vault.https);
            if (r?.ok) written.push(target); else skipped.push(`${target} (${r?.error || 'write failed'})`);
        }

        // ── switch this chat to the new run ── (only the branch's own chat: never one opened while the files were copied)
        if (!sameChat()) {
            toastr.warning(`${written.length} file${written.length === 1 ? '' : 's'} copied, but another chat is open now, so no chat was switched to run ${L}. Open the branch and use /oq-branch-run (copies already there are kept).`, 'Onyx Quill', { timeOut: 12000 });
            return 'Another chat is open now.';
        }
        chat_metadata.deeplore_context = { ...ctx, instance: [next] };
        if (nextFolders.length) chat_metadata.deeplore_folder_filter = nextFolders;
        // Scribe continues from the branch point, not from the parent's end: its counter
        // would otherwise be larger than this chat and keep it silent.
        const lastSession = [...picked].filter(p => plan.sessionsBefore.includes(p) || p === plan.sessionStraddle).pop();
        const summary = lastSession ? frontmatterSummary(lastSession.content) : '';
        chat_metadata.deeplore_lastScribeChatLength = chat.length;
        chat_metadata.deeplore_lastScribeSummary = summary;
        setLastScribeChatLength(chat.length);
        setLastScribeSummary(summary);
        chat_metadata[STATE_KEY] = { status: 'done', from: current, run: next, atMessage, copied: written, at: new Date().toISOString() };
        saveMetadataDebounced();
        try { await buildIndex(); } catch { /* the next refresh picks the copies up */ }
        notifyGatingChanged();

        const msg = `Run ${L} started — ${written.length} file${written.length === 1 ? '' : 's'} copied${skipped.length ? `, ${skipped.length} skipped` : ''}.`;
        if (skipped.length) console.warn('[DLE] branch run skipped:', skipped);
        toastr[skipped.length ? 'warning' : 'success'](msg, 'Onyx Quill', { timeOut: 8000 });
        return msg + (skipped.length ? '\nSkipped:\n' + skipped.join('\n') : '');
    } catch (err) {
        console.error('[DLE] branch run failed:', err);
        toastr.error('Starting the branch as a new run failed: ' + (err?.message || err), 'Onyx Quill');
        return 'Failed.';
    } finally {
        busy = false;
    }
}

export function registerBranchRunCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-branch-run',
        callback: async () => await offerBranchRun({ fromCommand: true }),
        helpString: 'Start this chat as the next run, copying the run\'s session notes and lore up to this point.',
        returns: ARGUMENT_TYPE.STRING,
    }));
}
