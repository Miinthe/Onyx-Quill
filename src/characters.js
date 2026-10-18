/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — characters and runs own their folders: SillyTavern glue.
 * Rules: characters-pure.js. The real home is the Filters hub (settings design v11, still WIP);
 * until then: a "This character (WIP)" card at the top of the side panel's Filters tab, and commands.
 *
 *   /dle-char-folders [run]   pick this character's base folders (or, with "run", this run's)
 *   /dle-char on|off          DeepLore for this character (on = follow its folders)
 *   /dle-chat on|off|follow   DeepLore for this chat only (follow = like its character)
 *   /dle-char-status          what this chat reads, and whether DeepLore is on
 */
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, saveMetadataDebounced, extension_settings } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { escapeHtml } from '../../../../utils.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../../slash-commands/SlashCommandArgument.js';
import { folderList, vaultIndex } from './state.js';
import { CHARS_KEY, CHAT_SWITCH_KEY, asStore, runOf, chatFolders, isOn, setFolders, setCharOn, describe, autoRunLetter } from './characters-pure.js';
import { nextInstanceLetter } from './drawer/new-run-pure.js';
import { echo } from './echo.js';

const store = () => asStore(extension_settings?.[CHARS_KEY]);
const keep = s => { extension_settings[CHARS_KEY] = s; saveSettingsDebounced(); };
const say = (msg, kind = 'info') => { try { toastr[kind](msg, 'DeepLore'); } catch { /* noop */ } };

/** The open chat's character ({ key: avatar, name }), or null in a group chat / no chat. */
export function currentCharacter() {
    const ctx = getContext();
    if (ctx?.groupId) return null;
    const c = ctx?.characters?.[ctx?.characterId];
    return c?.avatar ? { key: c.avatar, name: c.name } : null;
}

/** Everything about the open chat: who, which run, its own folders, the switches — and the result. */
export function chatStatus() {
    const ch = currentCharacter();
    const run = runOf(chat_metadata?.deeplore_context);
    const own = Array.isArray(chat_metadata?.deeplore_folder_filter) ? chat_metadata.deeplore_folder_filter : [];
    const chatSwitch = chat_metadata?.[CHAT_SWITCH_KEY] || null;
    const args = { store: store(), key: ch?.key || null, name: ch?.name, run, own, chatSwitch };
    const c = ch ? store().chars[ch.key] : null;
    return { ...args, character: ch, setup: c || null, ...isOn(args), folders: chatFolders(args.store, args.key, run, own), text: describe(args) };
}

/** The folders the lore pipeline reads for this chat (null = no folder filter). */
export function effectiveFolderFilter() {
    const f = chatStatus().folders;
    return f.length ? f : null;
}

// ── changes ─────────────────────────────────────────────────────────────────

function changed() { try { renderCharacterCard(); } catch { /* drawer closed */ } }

export async function editFolders({ run = false } = {}) {
    const ch = currentCharacter();
    if (!ch) { say('This chat has no single character (a group chat?) — use the chat\'s own folders in the Filters tab.'); return; }
    const st = chatStatus();
    if (run && !st.run) { say('This chat has no run letter yet (the instance field) — set it in the Filters tab, or start a New Run.'); return; }
    const c = store().chars[ch.key];
    const cur = run ? c?.runs?.[st.run]?.folders || [] : c?.folders || [];
    const picked = await pickFolders(cur, run ? `Folders run ${st.run.toUpperCase()} of ${ch.name} reads` : `Folders ${ch.name} reads`);
    if (!picked) return;
    keep(setFolders(store(), ch.key, ch.name, picked, run ? st.run : null));
    changed();
    const after = chatStatus();
    say(`${ch.name}${run ? ` · run ${st.run.toUpperCase()}` : ''}: ${picked.length} folder${picked.length === 1 ? '' : 's'}. ${after.on ? 'DeepLore is on.' : `DeepLore is off — ${after.why}.`}`);
}

export function setCharacterSwitch(on) {
    const ch = currentCharacter();
    if (!ch) { say('This chat has no single character.'); return; }
    keep(setCharOn(store(), ch.key, ch.name, on));
    changed();
    say(`DeepLore ${on ? 'follows the folders' : 'is off'} for ${ch.name}.`);
}

export function setChatSwitch(value) {
    if (value === 'on' || value === 'off') chat_metadata[CHAT_SWITCH_KEY] = value; else delete chat_metadata[CHAT_SWITCH_KEY];
    saveMetadataDebounced();
    changed();
    say(value === 'on' ? 'DeepLore is on for this chat.' : value === 'off' ? 'DeepLore is off for this chat.' : 'This chat follows its character again.');
}

// ── any character, not only the open chat's (the settings window's Filters hub, overhaul step 4) ──

/** Every character's folders and switch, as stored ({ v, chars: { [avatar]: { name, folders, runs, on? } } }). */
export function characterStore() { return store(); }

/** Pick the base folders (run: '' / null) or one run's folders of any character. → the folders picked, or null. */
export async function editFoldersFor({ key, name, run = null } = {}) {
    if (!key) return null;
    const c = store().chars[key];
    const L = run ? String(run).toLowerCase() : '';
    const cur = L ? c?.runs?.[L]?.folders || [] : c?.folders || [];
    const picked = await pickFolders(cur, L ? `Folders run ${L.toUpperCase()} of ${name} reads` : `Folders ${name} reads`);
    if (!picked) return null;
    keep(setFolders(store(), key, name, picked, L || null));
    changed();
    return picked;
}

/** DeepLore on (= follow its folders) or off for any character. */
export function setCharacterSwitchFor(key, name, on) {
    if (!key) return;
    keep(setCharOn(store(), key, name, on));
    changed();
}

// ── the folder picker (same look as /dle-set-folder: search, indented paths, entry counts) ──

export async function pickFolders(current, title) {
    if (!folderList.length) { say('No folders found in the vault yet.'); return null; }
    const on = new Set(current || []);
    const sorted = [...folderList].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
    let html = `<div class="dle-popup"><h4>${escapeHtml(title)}</h4><p class="dle-text-xs" style="opacity:.7">Tap folders to choose them. The character reads only these.</p>`;
    html += '<input type="text" class="text_pole dle-folder-search" placeholder="Type to filter folders…" aria-label="Filter folders" style="margin-bottom:8px;" />';
    html += '<div class="dle-flex-col dle-gap-1 dle-folder-list" style="overflow-y:auto">';
    for (const { path, entryCount } of sorted) {
        const depth = path.split('/').length - 1, leaf = depth ? path.split('/').pop() : path;
        const style = depth ? ` style="padding-left:${6 + depth * 16}px;border-left:2px solid var(--SmartThemeQuoteColor,#888);"` : ' style="font-weight:600;margin-top:4px;"';
        html += `<button type="button" class="menu_button dle-field-select dle-charfolder dle-flex-between dle-w-full${on.has(path) ? ' dle-field-select--active' : ''}" data-value="${escapeHtml(path)}" data-search="${escapeHtml(path.toLowerCase())}"${style} title="${escapeHtml(path)}"><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;">${escapeHtml(leaf)}</span><span class="dle-text-xs" style="opacity:.5;margin-left:8px;white-space:nowrap">${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}</span></button>`;
    }
    html += '</div></div>';
    const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Done', cancelButton: 'Cancel', wide: false,
        onOpen: popup => {
            const root = popup?.dlg || document;
            const list = root.querySelector('.dle-folder-list');
            if (list) list.style.height = Math.min(list.scrollHeight, Math.min(window.innerHeight * 0.55, 420)) + 'px';
            root.querySelectorAll('.dle-charfolder').forEach(b => b.addEventListener('click', () => {
                const v = b.getAttribute('data-value');
                if (on.has(v)) on.delete(v); else on.add(v);
                b.classList.toggle('dle-field-select--active', on.has(v));
            }));
            const search = root.querySelector('.dle-folder-search');
            search?.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                root.querySelectorAll('.dle-charfolder').forEach(b => { b.style.display = !q || b.getAttribute('data-search').includes(q) ? '' : 'none'; });
            });
        },
    });
    return ok ? [...on] : null;
}

// ── the WIP card at the top of the Filters tab ──────────────────────────────

export function renderCharacterCard() {
    const $card = $('#dle-panel-gating .dle-char-card');
    if (!$card.length) return;
    const st = chatStatus();
    const chips = list => (list.length ? list.map(f => `<span class="dle-char-chip" title="${escapeHtml(f)}">📁 ${escapeHtml(f.split('/').pop())}</span>`).join('') : '<span class="dle-text-xs dle-muted">none</span>');
    const c = st.setup;
    const runFolders = c && st.run ? c.runs?.[st.run]?.folders || [] : [];
    $card.html(st.character ? `
        <div class="dle-char-head"><b>${escapeHtml(st.character.name)}</b>${st.run ? ` <span class="dle-text-xs dle-muted">· run ${escapeHtml(st.run.toUpperCase())}</span>` : ''}<span class="dle-wip">WIP</span>
            <span class="dle-char-state ${st.on ? 'on' : 'off'}">DeepLore ${st.on ? 'on' : 'off'}</span></div>
        <div class="dle-text-xs dle-muted">${escapeHtml(st.why)}</div>
        <div class="dle-char-row"><span class="dle-char-k">Base folders</span><span class="dle-char-chips">${chips(c?.folders || [])}</span><button type="button" class="menu_button dle-char-edit" data-run="0">Edit</button></div>
        ${st.run ? `<div class="dle-char-row"><span class="dle-char-k">Run ${escapeHtml(st.run.toUpperCase())} adds</span><span class="dle-char-chips">${chips(runFolders)}</span><button type="button" class="menu_button dle-char-edit" data-run="1">Edit</button></div>` : ''}
        <div class="dle-char-row"><span class="dle-char-k">This chat adds</span><span class="dle-char-chips">${chips(st.own)}</span></div>
        <div class="dle-char-row dle-char-switches">
            <label class="checkbox_label"><input type="checkbox" class="dle-char-switch" ${c?.on === false ? '' : 'checked'}> DeepLore for ${escapeHtml(st.character.name)}</label>
            <select class="text_pole dle-chat-switch" aria-label="DeepLore for this chat"><option value="follow"${!st.chatSwitch ? ' selected' : ''}>This chat: like ${escapeHtml(st.character.name)}</option><option value="on"${st.chatSwitch === 'on' ? ' selected' : ''}>This chat: always on</option><option value="off"${st.chatSwitch === 'off' ? ' selected' : ''}>This chat: off</option></select>
        </div>`
        : `<div class="dle-char-head"><b>Group chat</b><span class="dle-wip">WIP</span><span class="dle-char-state ${st.on ? 'on' : 'off'}">DeepLore ${st.on ? 'on' : 'off'}</span></div><div class="dle-text-xs dle-muted">Characters own folders in one-on-one chats. Here the chat's own folders apply.</div>`);
    $card.find('.dle-char-edit').on('click', e => editFolders({ run: $(e.currentTarget).attr('data-run') === '1' }));
    $card.find('.dle-char-switch').on('change', e => setCharacterSwitch($(e.currentTarget).is(':checked')));
    $card.find('.dle-chat-switch').on('change', e => setChatSwitch($(e.currentTarget).val()));
}

export function registerCharacterCommands() {
    const add = props => SlashCommandParser.addCommandObject(SlashCommand.fromProps({ returns: ARGUMENT_TYPE.STRING, ...props }));
    const arg = description => [SlashCommandArgument.fromProps({ description, typeList: [ARGUMENT_TYPE.STRING] })];
    add({ name: 'dle-char-folders', unnamedArgumentList: arg('"run" to pick the folders of this chat\'s run instead of the character\'s base folders'),
        callback: async (_a, v) => { await editFolders({ run: String(v || '').trim().toLowerCase() === 'run' }); return ''; },
        helpString: 'Pick the folders this chat\'s character reads (base). With "run": the folders this run adds.' });
    add({ name: 'dle-char', unnamedArgumentList: arg('on | off'),
        callback: async (_a, v) => { const x = String(v || '').trim().toLowerCase(); if (x !== 'on' && x !== 'off') { say('Use /dle-char on or /dle-char off.'); return ''; } setCharacterSwitch(x === 'on'); return ''; },
        helpString: 'DeepLore for this chat\'s character: off, or on (= follow its folders; no folders means off).' });
    add({ name: 'dle-chat', unnamedArgumentList: arg('on | off | follow'),
        callback: async (_a, v) => { const x = String(v || '').trim().toLowerCase(); if (!['on', 'off', 'follow'].includes(x)) { say('Use /dle-chat on, off or follow.'); return ''; } setChatSwitch(x); return ''; },
        helpString: 'DeepLore for this chat only: on, off, or follow (like its character).' });
    add({ name: 'dle-char-status', callback: async () => { const st = chatStatus(); say(`${st.text}${st.folders.length ? `\n${st.folders.join(', ')}` : ''}`); return st.text; },
        helpString: 'What this chat reads and whether DeepLore is on.' });
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — a NEW chat (only the greeting and the first message yet) with DeepLore on and no run
 * letter gets one: the character's next free letter (characters-pure.js autoRunLetter). Older chats are left alone.
 * Called at the start of a generation (index.js), before any lore is picked. Returns the letter set, or null.
 */
export function autoRun() {
    const ctx = getContext();
    if (!ctx?.chat || ctx.groupId || ctx.chat.filter(m => !m?.is_system).length > 2) return null;
    const dc = chat_metadata?.deeplore_context || {};
    if (runOf(dc)) return null;
    if (!chatStatus().on) return null;
    const card = ctx.characters?.[ctx.characterId]?.name || '';
    const { letter } = autoRunLetter(vaultIndex, dc.character, card, nextInstanceLetter);
    if (!letter) return null;
    chat_metadata.deeplore_context = { ...dc, instance: [letter] };
    saveMetadataDebounced();
    echo(() => toastr.info(`This new chat is run ${letter.toUpperCase()} — set by itself, so each run's own entries don't all come in at once. Change it in Filters → Instance.`, 'DeepLore'));   // a notice like the others: quiet in Immersion, listed in What changed
    return letter;
}
