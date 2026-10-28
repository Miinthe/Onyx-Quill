/**
 * Overhaul step 4 (2026-10-16) — DeepLore's settings window, drawn to the approved mock-up (settings v4).
 *
 *   header   DeepLore settings · On / Off everywhere · search · Everywhere | <character ▾> | This chat · Simple | Sandbox ·
 *            Only what I changed (n) · ✕ (inside the header on a phone too — Miinthe's patch 23)
 *   body     the section list (Lore · AI · Story · Look, with a count of changed settings) and the open section;
 *            on a phone the list first, tap a section to open it, ← All settings to go back
 *
 * What is in it and which saved setting each row is: settings-pure.js. This file only draws and wires. Values are read
 * and written exactly where today's window kept them (getSettings() + saveSettingsDebounced, Mero's own settings,
 * the characters' folders, the chat's metadata). The flows that do more than store a value (Preview, Reset all, the AI
 * pause, diagnostics, vault scan, prompt files) are today's own code, shared from src/ui/settings-ui.js and
 * src/ui/prompts-tab.js.
 */
import { saveSettingsDebounced, chat_metadata } from '../../../../../../script.js';
import { getContext, extension_settings } from '../../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';
import { accountStorage } from '../../../../../util/AccountStorage.js';
import { ConnectionManagerRequestService } from '../../../../shared.js';
import { promptManager } from '../../../../../openai.js';
import { getSettings, defaultSettings, settingsConstraints, getPrimaryVault, invalidateSettingsCache, askBeforeRemoving, setAskBeforeRemoving } from '../../settings.js';
import * as K from '../kit/kit.js';
import {
    SECTIONS, GROUPS, cardRows, rowValue, writeRow, isChanged, resetRow, showValue, cardSummary, changedCount, searchAll,
    clampNumber, sectionForNav, JOBS, JOB_KEYS, jobRuns, connChoice, writeConnChoice, followers, PROMPTS, roughTokens,
} from './settings-pure.js';
import {
    drainPendingPromptListCleanup, refreshClaudeEffortBanner, testToolConnection, previewJudgePrompt, exportDiagnosticsFlow,
    scanForVaultFlow, resetAllSettingsFlow, resetAiBreakerFlow, fuzzyPreviewHtml,
} from '../ui/settings-ui.js';
import { bindPromptsTabHandlers } from '../ui/prompts-tab.js';
import { DLE_COMMANDS } from '../ui/commands-admin.js';
import { testConnection, buildConnectionGuidanceHtml } from '../vault/obsidian-api.js';
import { buildIndex, buildIndexWithReuse } from '../vault/vault.js';
import { setupSyncPolling } from '../vault/sync.js';
import { vaultIndex, fieldDefinitions, setVaultIndex, setIndexTimestamp, notifyDebugModeChanged, aiSearchStats } from '../state.js';
import { resolvePromptOrOverride } from '../prompts/prompt-store.js';
import { sanitizePromptsFolderPath } from '../prompts/prompt-validators.js';
import { DLE_PROMPTS_DEFAULT_DIR } from '../prompts/prompt-api.js';
import { meroSettings } from '../mero.js';
import { asStore as meroStoreShape } from '../mero-pure.js';
import { chatStatus, currentCharacter, editFolders, setChatSwitch, characterStore, editFoldersFor, setCharacterSwitchFor } from '../characters.js';
import { currentBoardName } from '../trackers.js';
import { V2_KEY } from '../board-store.js';
import { fieldRows, folderLeaf } from '../panel/filters-pure.js';
import { DEFAULT_FIELD_DEFINITIONS } from '../fields.js';
import { chatBudget, characterBudget, setChatBudget, setCharacterBudget, effectiveBudget } from '../budget.js';
import { PARTS, partText, fromText } from '../budget-pure.js';
import { ownPrompts, newOwnId, ownWhere, cleanOwn } from '../own-prompts-pure.js';
import { newEntryFolder } from '../new-entry-pure.js';

export const SETTINGS_CSS = new URL('./settings.css', import.meta.url).href;
const LAST_SECTION = 'dle-last-settings-section';
const LEVEL = 'dle-settings-level';

// ── small helpers ──────────────────────────────────────────────────────────

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}
const store = key => { try { return accountStorage.getItem(key); } catch { return null; } };
const keep = (key, v) => { try { accountStorage.setItem(key, v); } catch { /* noop */ } };
function save() { invalidateSettingsCache(); saveSettingsDebounced(); }
function runCommand(cmd) {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
    return ctx?.executeSlashCommands?.(cmd)?.catch?.(err => console.warn('[DLE] settings:', cmd, err));
}
function ensureCss() {
    if (document.querySelector(`link[href="${SETTINGS_CSS}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = SETTINGS_CSS; document.head.append(l);
}
const isPhone = () => window.matchMedia?.('(max-width: 720px)').matches;
const chatOpen = () => { const c = getContext(); return !!(c?.chatId || c?.getCurrentChatId?.()); };
const characters = () => (getContext()?.characters || []).filter(c => c?.avatar).map(c => ({ key: c.avatar, name: c.name || c.avatar }));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

// where each row reads from: DeepLore's settings, Mero's, or the one "own" switch
const meroDefaults = () => meroStoreShape(null).settings;
function pick(row) {
    if (row.src === 'mero') return meroSettings();
    if (row.src === 'own') return { askBeforeRemoving: askBeforeRemoving() };
    return getSettings();
}
function pickDef(row) {
    if (row.src === 'mero') return meroDefaults();
    if (row.src === 'own') return { askBeforeRemoving: false };
    return defaultSettings;
}

// ── state of the window (kept while SillyTavern is open; the section and Simple/Sandbox are remembered) ──

const ui = {
    sec: 'vault', scope: 'all', charKey: '', q: '', changed: false, level: 'sandbox', open: {}, more: {}, phoneSec: false,
    vopen: null, vstatus: {}, hubOpen: null, idleOpen: false, hubQ: '', fineOpen: false, flash: null, flashJob: null,
};
let W = null;          // the open window
let rebuildTimer = null;

// ── saving a row ───────────────────────────────────────────────────────────

const fx = {
    rebuild: () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => buildIndexWithReuse(), 500); },
    reindex: () => buildIndexWithReuse(),
    sync: () => setupSyncPolling(buildIndexWithReuse, buildIndexWithReuse),
    debug: () => notifyDebugModeChanged(),
};

/** Text rows: today's rules for empty / tidy values. → the value to store, or undefined to refuse. */
function tidyText(row, raw) {
    const v = String(raw ?? '');
    const fallback = { lorebookTag: 'lorebook', constantTag: 'lorebook-always', neverInsertTag: 'lorebook-never', seedTag: 'lorebook-seed', bootstrapTag: 'lorebook-bootstrap', librarianGuideTag: 'lorebook-guide', fieldDefinitionsPath: 'DeepLore/field-definitions.yaml', scribeFolder: 'Sessions' };
    if (row.key in fallback) return v.trim() || fallback[row.key];
    if (row.key === 'autoSuggestFolder') return v.trim();
    if (row.key === 'promptsFolderPath') {
        const t = sanitizePromptsFolderPath(v.trim());
        if (!t) { K.notify({ text: 'That prompts folder path can’t be used — back to the default.', tone: 'wait' }); return DLE_PROMPTS_DEFAULT_DIR; }
        return t;
    }
    return v;
}

async function commit(row, value) {
    if (row.src === 'mero') {
        if (row.key === 'signoff' && value === false && !(await K.ask({ title: 'Turn off sign-off?', text: 'Let Mero write entry changes without asking you? Each one is listed with an Undo.', yes: 'Turn it off' }))) { redraw(); return; }
        meroSettings({ [row.key]: value });
        if (row.id === 'm-chat' && value === 'custom') ui.more.mero2 = true;   // Custom: show the three parts
    } else if (row.src === 'own') {
        setAskBeforeRemoving(!!value);
    } else {
        const s = getSettings();
        const oldMode = s.injectionMode;
        writeRow(row, s, value);
        if (row.fx === 'injmode' && oldMode === 'prompt_list' && s.injectionMode !== 'prompt_list') {
            // H16 / BUG-341, as the old window did it
            if (promptManager) drainPendingPromptListCleanup(); else s._pendingPromptListCleanup = true;
        }
        save();
        try { fx[row.fx]?.(); } catch (err) { console.warn('[DLE] settings: after-change step failed', err); }
    }
    redraw();
}

function resetOne(row) {
    if (row.src === 'mero') { const d = meroDefaults(); meroSettings({ [row.key]: d[row.key] }); }
    else if (row.src === 'own') setAskBeforeRemoving(false);
    else { resetRow(row, getSettings(), defaultSettings); save(); try { fx[row.fx]?.(); } catch { /* noop */ } }
    K.notify({ text: `${row.label}: back to its default.` });
    redraw();
}

// ── the controls ───────────────────────────────────────────────────────────

function control(row, s) {
    const v = rowValue(row, s);
    const off = !!row.dis?.(s);
    let c;
    if (row.type === 'switch') {
        c = K.toggle({ checked: !!v, label: row.label, disabled: off, onChange: x => commit(row, x) });
    } else if (row.type === 'seg') {
        c = K.seg({ options: row.opts, value: v, label: row.label, onChange: x => commit(row, x) });
        if (off) c.querySelectorAll('button').forEach(b => { b.disabled = true; });
    } else if (row.type === 'select') {
        c = el('select', 'dk-field dle-st-sel');
        const opts = row.optsFrom === 'vaults' ? vaultOptions(v) : row.opts;
        for (const [ov, ol] of opts) c.append(new Option(ol, String(ov)));
        c.value = String(v ?? '');
        c.disabled = off;
        c.addEventListener('change', () => commit(row, row.num ? Number(c.value) : c.value));
    } else if (row.type === 'num') {
        c = el('input', 'dk-field dle-st-num');
        c.type = 'number'; c.inputMode = 'decimal';
        const k = row.key ? settingsConstraints[row.key] : null;
        const min = row.min ?? k?.min, max = row.max ?? k?.max;
        if (min != null) c.min = String(row.scale ? min / row.scale : min);
        if (max != null) c.max = String(row.scale ? max / row.scale : max);
        if (row.step) c.step = String(row.step);
        c.value = v == null ? '' : String(row.scale ? Number(v) / row.scale : v);
        c.disabled = off;
        c.addEventListener('change', () => {
            const n = clampNumber(row, c.value, settingsConstraints);
            if (n === null) { c.value = v == null ? '' : String(row.scale ? Number(v) / row.scale : v); return; }
            commit(row, n);
        });
    } else if (row.type === 'text') {
        c = el('input', 'dk-field dle-st-txt');
        c.value = v ?? ''; c.disabled = off; c.spellcheck = false;
        c.addEventListener('change', () => { const t = tidyText(row, c.value); if (t !== undefined) commit(row, t); });
    } else if (row.type === 'area') {
        c = el('textarea', 'dk-field dle-st-area');
        c.rows = 3; c.value = v ?? ''; c.disabled = off; c.spellcheck = false;
        c.addEventListener('change', () => commit(row, c.value));
    } else if (row.type === 'btn') {
        c = K.button({ label: row.btn, title: row.tip || row.label, onClick: () => act(row.act, c) });
    }
    c?.setAttribute?.('data-focus', row.id);
    if (c && !c.getAttribute('aria-label')) c.setAttribute('aria-label', row.label);
    return c;
}

function vaultOptions(current) {
    const vaults = getSettings().vaults || [];
    const opts = [['', 'the primary vault']];
    for (const v of vaults) if (v.name) opts.push([v.name, v.enabled ? v.name : `${v.name} (off)`]);
    if (current && !vaults.some(v => v.name === current)) opts.push([current, `${current} (missing)`]);
    return opts;
}

function rowEl(row) {
    const s = pick(row), d = pickDef(row);
    if (row.show && !row.show(s)) return null;
    const ch = isChanged(row, s, d);
    const r = el('div', 'dle-st-r' + (ch ? ' changed' : '') + (row.dis?.(s) ? ' off' : ''));
    r.id = 'dle-st-row-' + row.id;
    const lab = el('div', 'dle-st-lab');
    lab.append(el('b', '', row.label));
    const small = [row.hint, ch ? `default: ${showValue(row, rowValue(row, d))}` : ''].filter(Boolean).join(' · ');
    if (small) lab.append(el('small', '', small));
    const tip = row.dis?.(s) ? row.disWhy : row.tip;
    if (tip) lab.title = tip;
    const ctrl = el('div', 'dle-st-ctrl');
    const c = control(row, s);
    if (c) ctrl.append(c);
    if (ch) { const rb = el('button', 'dk-link', 'Reset'); rb.type = 'button'; rb.title = `Back to ${showValue(row, rowValue(row, d))}`; rb.addEventListener('click', () => resetOne(row)); ctrl.append(rb); }
    r.append(lab, ctrl);
    if (row.preview === 'fuzzy' && !ui.changed) {
        const pv = el('div', 'dle-st-preview');
        pv.innerHTML = fuzzyPreviewHtml(Number(s.fuzzySearchMinScore) || 0.5);
        r.append(pv);
    }
    return r;
}

// ── cards and sections ─────────────────────────────────────────────────────

function cardEl(sec, card, k) {
    const key = sec.id + k;
    const all = cardRows(card);
    let rows = all.filter(r => !r.more), more = ui.level === 'sandbox' ? all.filter(r => r.more) : [];
    if (ui.changed) { rows = all.filter(r => isChanged(r, pick(r), pickDef(r))); more = []; if (!rows.length) return null; }
    const nChanged = all.filter(r => isChanged(r, pick(r), pickDef(r))).length;
    const open = ui.changed || (ui.open[key] !== undefined ? ui.open[key] : k === 0);
    const body = el('div', 'dle-st-fb');
    if (card.custom === 'vaults' && !ui.changed) body.append(vaultsBlock());
    for (const r of rows) { const e = rowEl(r); if (e) body.append(e); }
    if (card.custom === 'budgetScopes' && !ui.changed) body.append(budgetScopesBlock());
    if (more.length) {
        if (ui.more[key]) for (const r of more) { const e = rowEl(r); if (e) body.append(e); }
        const mb = el('button', 'dle-st-more', ui.more[key] ? 'Less' : `More (${more.length})`);
        mb.type = 'button';
        mb.addEventListener('click', () => { ui.more[key] = !ui.more[key]; redraw(); });
        body.append(mb);
    }
    const f = K.fold({ title: card.t, summary: cardSummary(card, pick), count: nChanged || undefined, open, body, onToggle: v => { ui.open[key] = v; } });
    f.classList.add('dle-st-card');
    if (nChanged) f.querySelector('.dk-fh .dk-n')?.setAttribute('title', `${nChanged} changed`);
    return f;
}

function sectionEl(sec) {
    const frag = document.createDocumentFragment();
    if (sec.custom === 'jobs') { frag.append(jobsPane()); return frag; }
    if (sec.custom === 'prompts') { frag.append(promptsPane()); return frag; }
    if (sec.custom === 'hub') { frag.append(hubPane()); return frag; }
    const cards = sec.cards.map((c, k) => cardEl(sec, c, k)).filter(Boolean);
    if (ui.changed && !cards.length) return frag;
    frag.append(el('h3', '', sec.name));
    if (!ui.changed && sec.lead) frag.append(el('p', 'dle-st-lead', sec.lead));
    frag.append(...cards);
    return frag;
}

// ── Vault › Vaults ─────────────────────────────────────────────────────────

function mirrorPrimary(s) {
    const p = getPrimaryVault(s);
    s.obsidianPort = p.port; s.obsidianApiKey = p.apiKey;
}

function vaultsBlock() {
    const s = getSettings();
    const box = el('div', 'dle-st-vaults');
    (s.vaults || []).forEach((v, i) => {
        const r = el('div', 'dle-st-r');
        const lab = el('div', 'dle-st-lab');
        lab.append(el('b', '', v.name || `Vault ${i + 1}`));
        const st = ui.vstatus[i];
        lab.append(el('small', st?.bad ? 'dle-st-bad' : st?.ok ? 'dle-st-good' : '', `${v.host || '127.0.0.1'}:${v.port}${v.https ? ' · HTTPS' : ''} · ${v.enabled ? 'on' : 'off'}${st ? ' · ' + st.text : ''}`));
        if (st?.guide) {
            const g = el('button', 'dk-link', 'How to fix'); g.type = 'button';
            g.addEventListener('click', () => callGenericPopup(`<div class="dle-popup">${buildConnectionGuidanceHtml(st.guide)}</div>`, POPUP_TYPE.TEXT, 'Connection Help', { wide: true, allowVerticalScrolling: true, okButton: 'Got it' }));
            lab.append(g);
        }
        const ctrl = el('div', 'dle-st-ctrl');
        ctrl.append(K.toggle({ checked: !!v.enabled, label: `${v.name} on`, onChange: x => { v.enabled = x; mirrorPrimary(s); save(); redraw(); } }));
        ctrl.append(K.button({ label: ui.vopen === i ? 'Done' : 'Edit', onClick: () => { ui.vopen = ui.vopen === i ? null : i; redraw(); } }));
        r.append(lab, ctrl);
        box.append(r);
        if (ui.vopen === i) box.append(vaultEditor(s, v, i));
    });
    const foot = el('div', 'dle-st-btnrow');
    foot.append(K.button({ label: 'Add a vault', icon: 'plus', onClick: () => {
        s.vaults = s.vaults || [];
        s.vaults.push({ name: `Vault ${s.vaults.length + 1}`, host: '127.0.0.1', port: 27123, apiKey: '', enabled: true, https: false });
        ui.vopen = s.vaults.length - 1; save(); redraw();
    } }));
    foot.append(K.button({ label: 'Scan for vaults', icon: 'search', title: 'Look for Obsidian vaults on this computer', onClick: async () => { if (await scanForVaultFlow()) redraw(); } }));
    foot.append(K.button({ label: 'Test all', icon: 'test', title: 'Test every vault that is on', onClick: async () => {
        for (const [i, v] of (s.vaults || []).entries()) if (v.enabled) await testVault(v, i, false);
        redraw();
    } }));
    box.append(foot);
    return box;
}

async function testVault(v, i, draw = true) {
    ui.vstatus[i] = { text: 'testing…' };
    if (draw) redraw();
    try {
        const data = await testConnection(v.host, v.port, v.apiKey, !!v.https);
        if (data.ok) ui.vstatus[i] = { ok: true, text: `connected${data.authenticated ? '' : ' (no key needed)'}` };
        else if (data.diagnosis) ui.vstatus[i] = { bad: true, text: data.diagnosis === 'cert' ? 'certificate not trusted' : data.diagnosis === 'auth' ? 'the API key was refused' : 'can’t reach Obsidian', guide: data };
        else ui.vstatus[i] = { bad: true, text: `failed: ${data.error}` };
    } catch (err) { ui.vstatus[i] = { bad: true, text: `error: ${err.message}` }; }
    if (draw) redraw();
}

function vaultEditor(s, v, i) {
    const box = el('div', 'dle-st-vedit');
    const field = (label, input) => { const l = el('label', 'dle-st-vf'); l.append(el('span', '', label), input); box.append(l); return input; };
    const name = field('Name', el('input', 'dk-field'));
    name.value = v.name || ''; name.title = 'Must match your Obsidian vault’s name exactly';
    name.addEventListener('change', async () => {
        const was = v.name;
        let nn = name.value.trim() || 'Vault';
        const others = (s.vaults || []).filter((_, k) => k !== i).map(x => String(x.name).toLowerCase());
        if (others.includes(nn.toLowerCase())) {
            let n = 2; while (others.includes(`${nn} ${n}`.toLowerCase())) n++;
            nn = `${nn} ${n}`;
            K.notify({ text: `That name is in use — renamed to “${nn}”.`, tone: 'wait' });
        }
        if (was && nn !== was) {
            // V-M5: renaming clears per-entry tracking tied to the old name — say so first
            const ok = await K.ask({ title: `Rename “${was}” to “${nn}”?`, text: 'Renaming a vault clears its entries’ cooldowns, pins and blocks, chat counts and analytics (they are kept under the old name). The entries themselves are not touched.', yes: 'Rename', danger: true });
            if (!ok) { name.value = was; return; }
        }
        v.name = nn; save(); redraw();
    });
    const host = field('Address', el('input', 'dk-field'));
    host.value = v.host || '127.0.0.1';
    host.addEventListener('change', () => { v.host = host.value.trim().replace(/^https?:\/\//, '').replace(/:\d+$/, '') || '127.0.0.1'; save(); redraw(); });
    const port = field('Port', el('input', 'dk-field'));
    port.type = 'number'; port.min = '1'; port.max = '65535'; port.value = String(v.port);
    port.addEventListener('change', () => { const n = Number(port.value); v.port = Math.max(1, Math.min(65535, Number.isFinite(n) ? Math.round(n) : 27123)); mirrorPrimary(s); save(); redraw(); });
    const key = field('API key', el('input', 'dk-field'));
    key.type = 'password'; key.value = v.apiKey || ''; key.autocomplete = 'off';
    key.addEventListener('change', () => { v.apiKey = key.value; mirrorPrimary(s); save(); });
    const httpsBox = el('span', 'dle-st-inline');
    httpsBox.append(K.toggle({ checked: !!v.https, label: 'HTTPS', onChange: x => {
        v.https = x;
        if (x && Number(v.port) === 27123) v.port = 27124; else if (!x && Number(v.port) === 27124) v.port = 27123;
        mirrorPrimary(s); save(); redraw();
    } }));
    if (v.https) {
        const a = el('a', 'dk-link', 'Trust its certificate');
        a.href = `https://${v.host || '127.0.0.1'}:${v.port}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.title = 'Opens Obsidian’s address so your browser can trust it. HTTP is easier.';
        httpsBox.append(a);
    }
    field('HTTPS', httpsBox);
    const btns = el('div', 'dle-st-btnrow dle-st-end');
    btns.append(K.button({ label: 'Test', icon: 'test', onClick: () => testVault(v, i) }));
    btns.append(K.button({ label: 'Remove', icon: 'trash', kind: 'danger', onClick: async () => {
        if ((s.vaults || []).length <= 1) { K.notify({ text: 'Add another vault before removing this one — DeepLore needs one.', tone: 'wait' }); return; }
        const saved = { ...v };
        await K.removeWithCare({ name: `the vault “${v.name}”`, big: true, askKey: 'vault', text: 'DeepLore stops reading it. Your files in Obsidian are not touched.',
            remove: () => { s.vaults.splice(i, 1); ui.vopen = null; ui.vstatus = {}; mirrorPrimary(s); save(); redraw(); },
            undo: () => { s.vaults.splice(Math.min(i, s.vaults.length), 0, saved); mirrorPrimary(s); save(); redraw(); } });
    } }));
    box.append(btns);
    return box;
}

// ── AI & connections ───────────────────────────────────────────────────────

function profiles() {
    try { return ConnectionManagerRequestService.getSupportedProfiles() || []; } catch { return []; }
}
function profileName(id) {
    if (!id) return '';
    try { return ConnectionManagerRequestService.getProfile(id)?.name || ''; } catch { return ''; }
}
function judgeAiName(s) {
    if (s.aiSearchConnectionMode === 'proxy') return 'a custom proxy';
    return profileName(s.aiSearchProfileId) || 'no profile yet';
}

function connSelect(job, s) {
    const sel = el('select', 'dk-field dle-st-sel');
    sel.setAttribute('aria-label', `${job.job}: connection`);
    const cur = connChoice(job.tool, s);
    const list = profiles();
    if (job.modes.includes('inherit')) sel.append(new Option(`Same as the judge → ${judgeAiName(s)}`, 'inherit'));
    if (job.modes.includes('st')) sel.append(new Option('SillyTavern’s own connection', 'st'));
    if (cur === 'proxy') sel.append(new Option('Custom proxy (old)', 'proxy'));
    if (!cur) sel.append(new Option('— pick a profile —', ''));
    for (const p of list) { const o = new Option(p.name, p.id); o.title = `${p.api}${p.model ? ' / ' + p.model : ''}`; sel.append(o); }
    if (cur && !['inherit', 'st', 'proxy'].includes(cur) && !list.some(p => p.id === cur)) sel.append(new Option('(a profile that no longer exists)', cur));
    sel.value = cur;
    sel.addEventListener('change', () => {
        if (!sel.value) return;
        writeConnChoice(job.tool, s, sel.value);
        save();
        if (job.root) {
            const f = followers(s);
            K.notify({ text: f.length ? `The judge now uses ${judgeAiName(s)}. ${f.join(', ')} ${f.length > 1 ? 'follow' : 'follows'} it.` : `The judge now uses ${judgeAiName(s)}.` });
        }
        redraw();
    });
    return sel;
}

function jobsPane() {
    const s = getSettings();
    const box = el('div', 'dle-st-sec');
    box.append(el('h3', '', 'AI & connections'));
    if (!ui.changed) box.append(el('p', 'dle-st-lead', 'Which AI does which job.'));
    const banner = el('div', 'dk-state dk-wait'); banner.id = 'dle-claude-effort-banner'; banner.style.display = 'none';
    banner.append(el('span', 'dle-claude-effort-banner-text'));
    box.append(banner);
    try { refreshClaudeEffortBanner($(box)); } catch { /* noop */ }
    if (!profiles().length) box.append(el('div', 'dk-state dk-info', 'No connection profiles yet. Make one in SillyTavern’s API Connections (the plug icon) → Connection Profile, then come back here.'));
    const realCalls = aiSearchStats.calls - aiSearchStats.cachedHits;
    if (realCalls > 0 && aiSearchStats.totalInputTokens + aiSearchStats.totalOutputTokens > 0) {
        const per = Math.round((aiSearchStats.totalInputTokens + aiSearchStats.totalOutputTokens) / realCalls);
        const t = el('div', 'dle-st-total');
        t.append(el('span', '', `This session the judge ran ${aiSearchStats.calls} time${aiSearchStats.calls === 1 ? '' : 's'}`), el('b', '', `about ${per.toLocaleString()} tokens each`));
        t.title = 'Counted from your replies since SillyTavern was opened';
        box.append(t);
    }
    const wrap = el('div', 'dle-st-jobswrap');
    const tbl = el('table', 'dle-st-jobs');
    tbl.innerHTML = '<thead><tr><th>Job</th><th>Connection</th><th>Runs</th><th class="n" title="The most the AI may answer; the prompt comes on top">Answer up to</th></tr></thead>';
    const tb = el('tbody');
    const caps = JOBS.map(j => Number(s[JOB_KEYS[j.tool].maxTokens]) || 0), max = Math.max(1, ...caps);
    JOBS.forEach((j, n) => {
        const tr = el('tr');
        tr.id = 'dle-st-job-' + j.tool;
        if (ui.flashJob === j.tool) tr.classList.add('flash');
        const a = el('td'); a.append(el('b', '', j.job), el('small', '', j.what));
        const b = el('td'); b.append(connSelect(j, s));
        const c = el('td', '', jobRuns(j.tool, s));
        const d = el('td', 'n'); d.append(el('span', '', `${caps[n].toLocaleString()}`));
        const bar = el('span', 'dle-st-bar'); const i = el('i'); i.style.width = Math.round(caps[n] / max * 100) + '%'; bar.append(i); d.append(bar);
        tr.append(a, b, c, d); tb.append(tr);
    });
    tbl.append(tb); wrap.append(tbl); box.append(wrap);
    box.append(el('p', 'dle-st-note', '“Same as the judge” uses the judge’s connection.'));
    // fine print: per job model, answer length, time limit, Test; and one switch for providers without a system role
    const fb = el('div', 'dle-st-fb');
    for (const j of JOBS) {
        const k = JOB_KEYS[j.tool];
        const g = el('div', 'dle-st-fine'); g.id = 'dle-st-fine-' + j.tool;
        g.append(el('b', 'dle-st-fine-t', j.job));
        const mode = s[k.mode];
        const model = el('input', 'dk-field'); model.value = s[k.model] || ''; model.setAttribute('aria-label', `${j.job}: model`);
        const hint = mode === 'inherit' ? 'empty = the judge’s' : mode === 'st' ? '' : 'empty = the profile’s';
        model.placeholder = hint;
        model.disabled = mode === 'st';
        model.addEventListener('change', () => { s[k.model] = model.value.trim(); save(); });
        const num = (key, label, scale) => {
            const c = settingsConstraints[key] || {};
            const inp = el('input', 'dk-field dle-st-num'); inp.type = 'number';
            inp.value = String(scale ? Number(s[key]) / scale : s[key]); inp.setAttribute('aria-label', `${j.job}: ${label}`);
            if (c.min != null) inp.min = String(scale ? c.min / scale : c.min);
            if (c.max != null) inp.max = String(scale ? c.max / scale : c.max);
            inp.addEventListener('change', () => { const v = clampNumber({ key, scale }, inp.value, settingsConstraints); if (v === null) return; s[key] = v; save(); redraw(); });
            return inp;
        };
        const grid = el('div', 'dle-st-finegrid');
        const lab = (t, c, tip) => { const l = el('label', 'dle-st-vf'); const sp = el('span', '', t); if (tip) sp.title = tip; l.append(sp, c); grid.append(l); };
        lab('Model', model, 'A different model on the same connection');
        lab('Answer up to', num(k.maxTokens, 'answer up to'), 'tokens');
        lab('Time limit', num(k.timeout, 'time limit', 1000), 'seconds');
        g.append(grid);
        const tb2 = K.button({ label: 'Test', icon: 'test', title: 'Send a one-line test message through this connection', onClick: async () => { tb2.disabled = true; try { await testToolConnection(j.tool); } finally { tb2.disabled = false; } } });
        g.append(tb2);
        if (ui.flashJob === j.tool) g.classList.add('flash');
        fb.append(g);
    }
    const ur = { id: 'ai-user', label: 'Put the system prompt into the user message', tip: 'For providers that have no system role', type: 'switch', key: 'aiForceUserRole' };
    fb.append(rowEl(ur));
    const f = K.fold({ title: 'Fine print', summary: 'model · answer length · time limit · Test', open: ui.fineOpen || !!ui.flashJob, body: fb, onToggle: v => { ui.fineOpen = v; } });
    f.classList.add('dle-st-card');
    box.append(f);
    return box;
}

// ── Prompts ────────────────────────────────────────────────────────────────

const LANGS = [['', 'follow SillyTavern'], ['en', 'English'], ['es-es', 'Español'], ['fr-fr', 'Français'], ['de-de', 'Deutsch'], ['ja-jp', '日本語'], ['zh-cn', '简体中文'], ['ru-ru', 'Русский']];

function defaultPromptText(p) {
    if (!p.prompt) return '';
    try { return resolvePromptOrOverride(p.prompt, '') || ''; } catch { return ''; }
}

function promptsPane() {
    const s = getSettings();
    const box = el('div', 'dle-st-sec');
    box.append(el('h3', '', 'Prompts'));
    box.append(el('p', 'dle-st-lead', 'Every prompt in one place, with its size.'));
    const top = el('div', 'dle-st-btnrow');
    const lang = el('select', 'dk-field dle-st-sel'); lang.id = 'dle-sp-prompts-language'; lang.setAttribute('aria-label', 'Prompt language');
    for (const [v, l] of LANGS) lang.append(new Option(l, v));
    lang.value = s.aiPromptLocale || '';
    const ll = el('label', 'dle-st-inline'); ll.append(el('span', 'dle-st-note', 'Language'), lang);
    ll.title = 'Which language the built-in prompts are in';
    top.append(ll);
    box.append(top);

    const list = el('div', 'dle-st-fb');
    for (const p of PROMPTS) {
        const custom = String(s[p.key] || '');
        const edited = custom.trim().length > 0;
        const r = el('div', 'dle-st-prow');
        const a = el('div');
        a.append(el('b', '', p.name));
        if (edited) a.append(el('span', 'dle-st-badge', 'edited'));
        a.append(el('small', '', p.what));
        const size = edited ? roughTokens(custom) : p.prompt ? roughTokens(defaultPromptText(p)) : null;
        const tok = el('span', 'dle-st-tok', size == null ? 'built in' : `~${size.toLocaleString()} tokens`);
        const acts = el('span', 'dle-st-ctrl');
        if (edited) acts.append(K.button({ label: 'Revert', title: 'Back to the built-in prompt', onClick: () => {
            const prev = s[p.key]; s[p.key] = ''; save(); redraw();
            K.notify({ text: `${p.name}: back to the built-in prompt.`, undo: () => { s[p.key] = prev; save(); redraw(); } });
        } }));
        acts.append(K.button({ label: 'Edit', icon: 'edit', onClick: () => editPrompt(p) }));
        r.append(a, tok, acts);
        list.append(r);
    }
    // her own prompt pieces, next to the built-in ones (overhaul 2026-10-17; rules: own-prompts-pure.js)
    const own = ownPrompts(s.ownPrompts);
    for (const p of own) {
        const r = el('div', 'dle-st-prow');
        const a = el('div');
        a.append(el('b', '', `Your own: “${p.name}”`), el('small', '', ownWhere(p)));
        const tok = el('span', 'dle-st-tok', p.text.trim() ? `~${roughTokens(p.text).toLocaleString()} tokens` : 'empty');
        const acts = el('span', 'dle-st-ctrl');
        acts.append(K.button({ label: 'Edit', icon: 'edit', onClick: () => editOwnPrompt(p.id) }));
        r.append(a, tok, acts);
        list.append(r);
    }
    const addRow = el('div', 'dle-st-btnrow');
    addRow.append(K.button({ label: '+ Your own prompt', title: 'A piece of your own that goes into every prompt, where you say', onClick: () => editOwnPrompt(null) }));
    list.append(addRow);
    const lf = K.fold({ title: 'AI jobs', summary: `${PROMPTS.filter(p => String(s[p.key] || '').trim()).length} edited${own.length ? ` · ${own.length} of your own` : ''}`, open: ui.open.promptsList !== false, body: list, onToggle: v => { ui.open.promptsList = v; } });
    lf.classList.add('dle-st-card');
    box.append(lf);

    // the prompt files in the vault (today's Prompts tab, wired by its own code)
    const files = el('div', 'dle-st-fb');
    const status = el('div', 'dle-st-note'); status.id = 'dle-sp-prompts-status';
    const grid = el('div', 'dle-st-pgrid'); grid.id = 'dle-sp-prompts-grid';
    const btns = el('div', 'dle-st-btnrow');
    const b1 = K.button({ label: 'Export to vault', title: 'Write every prompt as a file into the prompts folder, to edit there' }); b1.id = 'dle-sp-prompts-export';
    const b2 = K.button({ label: 'Reload', title: 'Read the prompt files from the vault again' }); b2.id = 'dle-sp-prompts-reload';
    const b3 = K.button({ label: 'Reset all', kind: 'danger', title: 'Delete every prompt file from the vault folder (asks first)' }); b3.id = 'dle-sp-prompts-reset-all';
    btns.append(b1, b2, b3);
    files.append(btns, status, grid);
    const ff = K.fold({ title: 'Prompt files in your vault', summary: s.promptsFolderPath || DLE_PROMPTS_DEFAULT_DIR, open: !!ui.open.promptFiles, body: files, onToggle: v => { ui.open.promptFiles = v; } });
    ff.classList.add('dle-st-card');
    box.append(ff);
    try { bindPromptsTabHandlers($(box), s); } catch (err) { console.warn('[DLE] settings: prompt files not wired', err); }
    return box;
}

function editPrompt(p) {
    const s = getSettings();
    if (!s.promptPresets) s.promptPresets = {};
    const body = el('div', 'dle-st-pedit');
    const def = defaultPromptText(p);
    // the prompt itself is in the box, the built-in one when it isn't changed (Miinthe 2026-10-18: "the judge prompt has nothing
    // in it yet it shows 749 tokens"); saved unchanged, it stays the built-in
    const ta = el('textarea', 'dk-field'); ta.rows = 14; ta.value = s[p.key] || def || ''; ta.spellcheck = false;
    ta.placeholder = 'Empty = the built-in prompt.';
    const bar = el('div', 'dle-st-btnrow');
    const presets = () => s.promptPresets[p.tool] || {};
    const sel = el('select', 'dk-field dle-st-sel'); sel.setAttribute('aria-label', 'Saved presets');
    const fill = () => { sel.replaceChildren(new Option('Saved presets…', '')); for (const n of Object.keys(presets())) sel.append(new Option(n, n)); };
    fill();
    sel.addEventListener('change', () => { const t = presets()[sel.value]; if (t !== undefined) ta.value = t; sel.value = ''; });
    bar.append(sel);
    bar.append(K.button({ label: 'Save as preset…', onClick: async () => {
        const text = ta.value.trim();
        if (!text) { K.notify({ text: 'Nothing to save — the box is empty.', tone: 'wait' }); return; }
        const name = await askText('Save as a preset', 'Name', '');
        if (!name) return;
        if (!s.promptPresets[p.tool]) s.promptPresets[p.tool] = {};
        s.promptPresets[p.tool][name] = text; save(); fill();
        K.notify({ text: `Preset “${name}” saved.` });
    } }));
    bar.append(K.button({ label: 'Remove a preset…', onClick: e => {
        const names = Object.keys(presets());
        if (!names.length) { K.notify({ text: 'No saved presets for this prompt yet.' }); return; }
        K.openMenu(e.currentTarget, names.map(n => {
            const text = presets()[n];
            return { label: n, icon: 'trash', onClick: () => K.removeWithCare({ name: `the preset “${n}”`, askKey: 'preset',
                remove: () => { delete s.promptPresets[p.tool][n]; save(); fill(); },
                undo: () => { (s.promptPresets[p.tool] ||= {})[n] = text; save(); fill(); } }) };
        }));
    } }));
    const size = el('span', 'dle-st-tok');
    const upd = () => { size.textContent = `~${roughTokens(ta.value || def).toLocaleString()} tokens${def && ta.value.trim() === def.trim() ? ' · as it ships' : ''}`; };
    if (def) bar.append(K.button({ label: 'Back to the built-in', title: 'Put the built-in prompt back in the box (saved when you press Save)', onClick: () => { ta.value = def; upd(); } }));
    ta.addEventListener('input', upd); upd();
    body.append(bar, ta, size);
    const cancel = K.button({ label: 'Cancel', onClick: () => w.close() });
    const ok = K.button({ label: 'Save', kind: 'primary', onClick: () => { s[p.key] = def && ta.value.trim() === def.trim() ? '' : ta.value; save(); w.close(); redraw(); } });
    const w = K.openWindow({ title: `Prompt: ${p.name}`, body, foot: [cancel, ok], size: 'wide' });
    w.win.classList.add('dle-st-sub');
}

/** Add (id null) or edit one of her own prompts: name, text, where it goes; Remove asks first. */
function editOwnPrompt(id) {
    const s = getSettings();
    const list = ownPrompts(s.ownPrompts);
    const cur = id ? list.find(p => p.id === id) : null;
    const draft = cur ? { ...cur } : cleanOwn({ id: newOwnId(list), name: '', text: '', position: 0 });
    const body = el('div', 'dle-st-pedit');
    const field = (label, input, tip) => { const l = el('label', 'dle-st-vf'); const sp = el('span', '', label); if (tip) sp.title = tip; l.append(sp, input); body.append(l); return input; };
    const name = field('Name', el('input', 'dk-field')); name.value = cur ? cur.name : ''; name.placeholder = 'e.g. Keep it in present tense';
    const where = field('Where it goes', el('select', 'dk-field dle-st-sel'), 'The same places DeepLore offers for its lore');
    for (const [v, l] of [[2, 'before the main prompt'], [0, 'after the main prompt'], [1, 'in the chat']]) where.append(new Option(l, String(v)));
    where.value = String(draft.position);
    const depth = field('Depth', el('input', 'dk-field dle-st-num'), 'How many messages from the bottom of the chat'); depth.type = 'number'; depth.min = '0'; depth.value = String(draft.depth);
    const role = field('As', el('select', 'dk-field dle-st-sel'));
    for (const [v, l] of [[0, 'system'], [1, 'user'], [2, 'assistant']]) role.append(new Option(l, String(v)));
    role.value = String(draft.role);
    const inChatOnly = () => { const on = where.value === '1'; depth.closest('label').style.display = on ? '' : 'none'; role.closest('label').style.display = on ? '' : 'none'; };
    where.addEventListener('change', inChatOnly); inChatOnly();
    const ta = el('textarea', 'dk-field'); ta.rows = 10; ta.value = draft.text; ta.spellcheck = true; ta.setAttribute('aria-label', 'The prompt');
    ta.placeholder = 'What the writer should be told, in your words.';
    const size = el('span', 'dle-st-tok');
    const upd = () => { size.textContent = `~${roughTokens(ta.value).toLocaleString()} tokens`; };
    ta.addEventListener('input', upd); upd();
    body.append(ta, size);
    const foot = [];
    if (cur) foot.push(K.button({ label: 'Remove', icon: 'trash', kind: 'danger', onClick: async () => {
        if (!(await K.ask({ title: `Remove “${cur.name}”?`, text: 'Your prompt is deleted and no longer sent.', yes: 'Remove', danger: true }))) return;
        s.ownPrompts = ownPrompts(s.ownPrompts).filter(p => p.id !== cur.id); save(); w.close(); redraw();
        K.notify({ text: `“${cur.name}” removed.` });
    } }));
    foot.push(K.button({ label: 'Cancel', onClick: () => w.close() }));
    foot.push(K.button({ label: 'Save', kind: 'primary', onClick: () => {
        const p = cleanOwn({ id: draft.id, name: name.value, text: ta.value, position: Number(where.value), depth: depth.value, role: Number(role.value) });
        const now = ownPrompts(s.ownPrompts);
        const k = now.findIndex(x => x.id === p.id);
        if (k >= 0) now[k] = p; else now.push(p);
        s.ownPrompts = now; save(); w.close(); redraw();
    } }));
    const w = K.openWindow({ title: cur ? `Your prompt: ${cur.name}` : 'Your own prompt', body, foot, size: 'wide' });
    w.win.classList.add('dle-st-sub');
    name.focus();
}

function askText(title, label, value) {
    return new Promise(resolve => {
        let out = null;
        const body = el('label', 'dk-labeled');
        const inp = el('input', 'dk-field'); inp.value = value || ''; inp.autofocus = true;
        body.append(el('span', '', label), inp);
        const okB = K.button({ label: 'Save', kind: 'primary', onClick: () => { out = inp.value.trim() || null; w.close(); } });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); okB.click(); } });
        const w = K.openWindow({ title, body, foot: [K.button({ label: 'Cancel', onClick: () => w.close() }), okB], size: 'small', onClose: () => resolve(out) });
        inp.focus();
    });
}

// ── Filters: the hub ───────────────────────────────────────────────────────

function chips(list, empty = 'none') {
    const box = el('span', 'dk-chips');
    if (!list?.length) { box.append(el('span', 'dle-st-note', empty)); return box; }
    for (const f of list) { const c = el('span', 'dk-chip dle-st-chip', `📁 ${folderLeaf(f)}`); c.title = f; box.append(c); }
    return box;
}
const hasFolders = c => !!c && (c.folders.length > 0 || Object.values(c.runs || {}).some(r => r.folders.length));

function hubPane() {
    const box = el('div', 'dle-st-sec');
    box.append(el('h3', '', 'Filters'));
    box.append(el('p', 'dle-st-lead', 'Which lore each character, run and chat reads.'));
    const st = characterStore();
    // open now
    if (chatOpen()) {
        const cs = chatStatus();
        const now = el('div', 'dle-st-now');
        now.append(el('span', 'dle-st-note', 'Open now'));
        now.append(el('b', '', [cs.character?.name || 'Group chat', cs.run ? `run ${cs.run.toUpperCase()}` : '', `“${getContext()?.getCurrentChatId?.() || ''}”`].filter(Boolean).join(' · ')));
        now.append(chips(cs.folders, 'no folders — DeepLore reads nothing here'));
        const board = currentBoardName();
        now.append(el('span', 'dle-st-note', `DeepLore ${cs.on ? 'on' : 'off'} · ${cs.why}${board ? ` · board: ${board}` : ''}`));
        now.append(el('span', 'dle-st-note', newEntriesHere(cs)));
        const b = el('div', 'dle-st-btnrow');
        if (cs.character) b.append(K.button({ label: `Edit ${cs.character.name}`, onClick: () => { ui.scope = 'char'; ui.charKey = cs.character.key; redraw(); } }));
        b.append(K.button({ label: 'This chat only…', onClick: () => { ui.scope = 'chat'; redraw(); } }));
        now.append(b);
        box.append(now);
    }
    // search + rescan
    const sr = el('div', 'dle-st-btnrow');
    const q = el('input', 'dk-field dle-st-find'); q.placeholder = 'Find a character…'; q.value = ui.hubQ; q.setAttribute('aria-label', 'Find a character'); q.dataset.focus = 'hubq';
    q.addEventListener('input', () => { ui.hubQ = q.value; redraw(); });
    sr.append(q, K.button({ label: 'Rescan cards', icon: 'refresh', title: 'Read SillyTavern’s character list again', onClick: () => redraw() }));
    box.append(sr);
    const t = ui.hubQ.trim().toLowerCase();
    const all = characters();
    const known = new Set(all.map(c => c.key));
    for (const [k, c] of Object.entries(st.chars)) if (!known.has(k) && hasFolders(c)) all.push({ key: k, name: c.name, gone: true });
    const match = c => !t || c.name.toLowerCase().includes(t);
    const using = all.filter(c => hasFolders(st.chars[c.key]) && st.chars[c.key].on !== false).filter(match).sort(byName);
    const idle = all.filter(c => !(hasFolders(st.chars[c.key]) && st.chars[c.key].on !== false)).filter(match).sort(byName);
    const roster = el('div', 'dle-st-roster');
    for (const c of using) {
        const rec = st.chars[c.key];
        const open = ui.hubOpen === c.key;
        const card = el('div', 'dle-st-rc' + (open ? ' open' : ''));
        const head = el('button', 'dle-st-rch'); head.type = 'button'; head.setAttribute('aria-expanded', String(open));
        head.append(el('b', '', c.name + (c.gone ? ' (card gone)' : '')));
        const runs = Object.keys(rec.runs || {}).sort();
        head.append(el('small', '', `${rec.folders.length ? rec.folders.map(folderLeaf).join(', ') : 'no base folders'}${runs.length ? ` · run${runs.length > 1 ? 's' : ''} ${runs.map(r => r.toUpperCase()).join(', ')}` : ''}`));
        head.addEventListener('click', () => { ui.hubOpen = open ? null : c.key; redraw(); });
        card.append(head);
        if (open) card.append(charDetail(c, rec));
        roster.append(card);
    }
    if (!using.length) roster.append(el('p', 'dle-st-note', t ? 'No character with folders matches.' : 'No character has folders yet.'));
    box.append(roster);
    box.append(el('div', 'dle-st-note', 'Not using DeepLore (no folders yet, or switched off) — tap a name to give it folders'));
    const idleBox = el('div', 'dle-st-idle' + (ui.idleOpen ? ' open' : ''));
    const ic = el('span', 'dk-chips');
    for (const c of idle) {
        const rec = st.chars[c.key];
        const off = rec?.on === false;
        ic.append(K.chip({ label: c.name + (off ? ' · off' : ''), title: off ? `DeepLore is switched off for ${c.name}` : `Give ${c.name} folders`, onClick: async () => {
            if (off && hasFolders(rec)) { setCharacterSwitchFor(c.key, c.name, true); K.notify({ text: `DeepLore is on for ${c.name} again.` }); redraw(); return; }
            const picked = await editFoldersFor({ key: c.key, name: c.name });
            if (picked) { ui.hubOpen = c.key; redraw(); }
        } }));
    }
    if (!idle.length) ic.append(el('span', 'dle-st-note', 'nobody'));
    idleBox.append(ic);
    box.append(idleBox);
    if (idle.length > 12) {
        const m = el('button', 'dle-st-more', ui.idleOpen ? 'Show less' : `Show all (${idle.length})`); m.type = 'button';
        m.addEventListener('click', () => { ui.idleOpen = !ui.idleOpen; redraw(); });
        box.append(m);
    }
    // More: the filter fields
    const fb = el('div', 'dle-st-fb');
    const defs = (fieldDefinitions.length ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS).filter(fd => fd?.gating?.enabled);
    for (const fd of defs) {
        const r = el('div', 'dle-st-r');
        const lab = el('div', 'dle-st-lab'); lab.append(el('b', '', fd.label || fd.name), el('small', '', fd.multi ? 'a list' : 'one value'));
        r.append(lab, el('div', 'dle-st-ctrl'));
        fb.append(r);
    }
    const eb = el('div', 'dle-st-btnrow');
    eb.append(K.button({ label: 'Edit the filter fields…', icon: 'edit', title: 'Add, rename or remove fields (saved in the field definitions file)', onClick: async () => { const { openRuleBuilder } = await import('../ui/rule-builder.js'); await openRuleBuilder(); redraw(); } }));
    fb.append(eb);
    const mf = K.fold({ title: 'More', summary: `filter fields: ${defs.map(d => d.label || d.name).join(', ') || 'none'}`, open: !!ui.open.hubMore, body: fb, onToggle: v => { ui.open.hubMore = v; } });
    mf.classList.add('dle-st-card');
    mf.id = 'dle-st-hub-fields';
    box.append(mf);
    return box;
}

/** Where Auto Lorebook's new entries go in the open chat, in words (Settings › Story & memory › New entries). */
function newEntriesHere(cs) {
    const s = getSettings();
    const base = cs.setup?.folders || [], run = cs.run ? cs.setup?.runs?.[cs.run]?.folders || [] : [];
    const at = type => newEntryFolder({ type, mode: s.newEntryPlacement, target: s.autoSuggestFolder, base, run }).folder || 'the vault’s top';
    const story = at('story'), other = at('lore');
    return story === other ? `New entries go to ${story}` : `New entries go to ${story} (about the run) or ${other} (about ${cs.character?.name || 'the character'})`;
}

/** A character's folders, runs and switch (the hub's open card, and the character page). */
function charDetail(c, rec) {
    const d = el('div', 'dle-st-fb');
    const row = (label, content, ctrl) => { const r = el('div', 'dle-st-r'); const l = el('div', 'dle-st-lab'); l.append(el('b', '', label)); if (content) l.append(content); const k = el('div', 'dle-st-ctrl'); if (ctrl) k.append(ctrl); r.append(l, k); d.append(r); return r; };
    // the switch means "follow the folders": say what that comes to right now (bug hunt 2026-10-17: ON beside "no folders = off" read as a contradiction)
    const folderCount = (rec?.folders || []).length + Object.values(rec?.runs || {}).reduce((n, r) => n + (r.folders || []).length, 0);
    const now = rec?.on === false ? 'off for this character' : folderCount ? 'on — reads its folders' : 'no folders yet, so it stays off';
    row(`DeepLore for ${c.name}`, el('small', '', now), K.toggle({ checked: rec?.on !== false, label: `DeepLore for ${c.name}`, onChange: x => { setCharacterSwitchFor(c.key, c.name, x); redraw(); } }));
    row('Base folders', chips(rec?.folders), K.button({ label: 'Edit', onClick: async () => { if (await editFoldersFor({ key: c.key, name: c.name })) redraw(); } }));
    for (const L of Object.keys(rec?.runs || {}).sort()) {
        row(`Run ${L.toUpperCase()} adds`, chips(rec.runs[L].folders), K.button({ label: 'Edit', onClick: async () => { if (await editFoldersFor({ key: c.key, name: c.name, run: L })) redraw(); } }));
    }
    const board = extension_settings?.[V2_KEY]?.characters?.[c.key];   // read only (boardStore() could start its one-time move)
    row('Board', el('small', '', board || 'none'));
    return d;
}

// ── budgets: this chat · a character · Everywhere (overhaul 2026-10-17; rules: budget-pure.js) ──

const BUDGET_ROWS = [['tokens', 'Lore budget', 'tokens per reply · 0 = no limit'], ['entries', 'Entries per reply', '0 = no limit']];

/**
 * The budget rows of a scope page: each shows the value that counts here and where it comes from; Set makes it this
 * chat's / character's own (starting from today's value), Reset gives it back.
 * scope: 'chat' (the open chat) or 'character' (key, name).
 */
function budgetRowsInto(d, scope, { key = null, name = 'the character' } = {}) {
    const s = getSettings();
    const own = scope === 'chat' ? chatBudget() : characterBudget(key);
    const res = scope === 'chat' ? effectiveBudget(s) : effectiveBudget(s, { character: own });
    const set = (part, v) => { if (scope === 'chat') setChatBudget(part, v); else setCharacterBudget(key, part, v); redraw(); };
    for (const [part, label, hint] of BUDGET_ROWS) {
        const p = PARTS[part];
        const v = res[p.unlimited] ? 0 : Number(res[p.max]) || 0;
        const from = res.from[part];
        const mine = own[part] !== undefined;
        const r = el('div', 'dle-st-r' + (mine ? ' changed' : ''));
        r.id = `dle-st-row-${scope}-${part}`;
        const l = el('div', 'dle-st-lab'); l.append(el('b', '', label), el('small', '', mine ? hint : partText(part, v)));
        l.title = 'The most specific wins: this chat → its character → Everywhere';
        const k = el('div', 'dle-st-ctrl');
        k.append(badge(fromText(from, { here: scope, characterName: name }), from === 'chat' ? 'chat' : from === 'character' ? 'char' : ''));
        if (mine) {
            const inp = el('input', 'dk-field dle-st-num'); inp.type = 'number'; inp.min = '0'; inp.max = String(p.top); inp.value = String(own[part]);
            inp.setAttribute('aria-label', `${label} for ${scope === 'chat' ? 'this chat' : name}`); inp.dataset.focus = `bud-${scope}-${part}`;
            inp.addEventListener('change', () => { if (inp.value === '' || !Number.isFinite(Number(inp.value))) { inp.value = String(own[part]); return; } set(part, Number(inp.value)); });
            const rb = el('button', 'dk-link', 'Reset'); rb.type = 'button'; rb.title = scope === 'chat' ? 'Follow the character / Everywhere again' : 'Follow Everywhere again';
            rb.addEventListener('click', () => set(part, undefined));
            k.append(inp, rb);
        } else {
            k.append(K.button({ label: 'Set', title: `Give ${scope === 'chat' ? 'this chat' : name} its own ${label.toLowerCase()}`, onClick: () => set(part, v) }));
        }
        r.append(l, k);
        d.append(r);
    }
}

/** Budget card (Everywhere): which chat / character has its own, with a way there. */
function budgetScopesBlock() {
    const box = el('div', 'dle-st-fb');
    const s = getSettings();
    const r = el('div', 'dle-st-r');
    const l = el('div', 'dle-st-lab'); l.append(el('b', '', 'This chat · a character'));
    const bits = [];
    const open = currentCharacter();
    if (chatOpen()) {
        const own = chatBudget();
        bits.push(Object.keys(own).length ? `this chat: ${Object.entries(own).map(([p, v]) => partText(p, v)).join(', ')}` : 'this chat follows');
    }
    const m = s.characterBudgets && typeof s.characterBudgets === 'object' ? s.characterBudgets : {};
    const names = Object.keys(m).filter(k => Object.keys(characterBudget(k)).length).map(k => characters().find(c => c.key === k)?.name || characterStore().chars[k]?.name || k);
    bits.push(names.length ? `own budget: ${names.join(', ')}` : 'no character has its own');
    l.append(el('small', '', bits.join(' · ')));
    l.title = 'The most specific wins: this chat → its character → Everywhere';
    const k = el('div', 'dle-st-ctrl');
    if (open) k.append(K.button({ label: `${open.name}…`, onClick: () => { ui.scope = 'char'; ui.charKey = open.key; redraw(); } }));
    if (chatOpen()) k.append(K.button({ label: 'This chat…', onClick: () => { ui.scope = 'chat'; redraw(); } }));
    r.append(l, k);
    box.append(r);
    return box;
}

// ── scopes: a character · this chat ────────────────────────────────────────

function badge(text, kind = '') { return el('span', 'dle-st-pill' + (kind ? ' ' + kind : ''), text); }

function charPane() {
    const box = el('div', 'dle-st-sec');
    const c = characters().find(x => x.key === ui.charKey) || (ui.charKey ? { key: ui.charKey, name: characterStore().chars[ui.charKey]?.name || ui.charKey } : null);
    if (!c) { box.append(el('p', 'dle-st-note', 'Pick a character above.')); return box; }
    box.append(el('h3', '', c.name));
    box.append(el('p', 'dle-st-lead', 'What can differ for this character. Everything else follows Everywhere.'));
    box.append(charDetail(c, characterStore().chars[c.key]));
    const bd = el('div', 'dle-st-fb');
    budgetRowsInto(bd, 'character', { key: c.key, name: c.name });
    box.append(bd);
    return box;
}

function chatPane() {
    const box = el('div', 'dle-st-sec');
    if (!chatOpen()) { box.append(el('p', 'dle-st-note', 'No chat is open.')); return box; }
    const cs = chatStatus();
    const who = cs.character?.name || '';
    box.append(el('h3', '', `“${getContext()?.getCurrentChatId?.() || 'This chat'}”`));
    box.append(el('p', 'dle-st-lead', 'Only what can differ per chat. Each value says where it comes from.'));
    const d = el('div', 'dle-st-fb');
    const row = (label, sub, from, ctrl) => {
        const r = el('div', 'dle-st-r'); const l = el('div', 'dle-st-lab'); l.append(el('b', '', label)); if (sub) l.append(typeof sub === 'string' ? el('small', '', sub) : sub);
        const k = el('div', 'dle-st-ctrl'); if (from) k.append(from); if (ctrl) k.append(ctrl); r.append(l, k); d.append(r);
    };
    const opts = who ? [['follow', `like ${who}`], ['on', 'always on'], ['off', 'off']] : [['follow', 'follow'], ['on', 'on'], ['off', 'off']];
    const sw = cs.chatSwitch === 'on' || cs.chatSwitch === 'off' ? cs.chatSwitch : 'follow';
    row('DeepLore in this chat', `${cs.on ? 'on' : 'off'} · ${cs.why}`, badge(sw === 'follow' ? (who ? `from ${who}` : 'automatic') : 'this chat', sw === 'follow' ? 'char' : 'chat'),
        K.seg({ options: opts, value: sw, label: 'DeepLore in this chat', onChange: v => { setChatSwitch(v); redraw(); } }));
    if (cs.character) {
        row('Base folders', chips(cs.setup?.folders), badge(`from ${who}`, 'char'), K.button({ label: 'Edit', onClick: async () => { await editFolders({ run: false }); redraw(); } }));
        if (cs.run) row(`Run ${cs.run.toUpperCase()} adds`, chips(cs.setup?.runs?.[cs.run]?.folders), badge(`run ${cs.run.toUpperCase()}`, 'char'), K.button({ label: 'Edit', onClick: async () => { await editFolders({ run: true }); redraw(); } }));
    }
    row('This chat adds', chips(cs.own), badge('this chat', 'chat'), K.button({ label: 'Change', title: 'Pick this chat’s own folders', onClick: async () => { await runCommand('/dle-set-folder'); redraw(); } }));
    const board = currentBoardName();
    row('Board', board || 'none', null, K.button({ label: 'Open', onClick: () => act('openBoard') }));
    // "Trackers follow the story" has one home: the side panel's Story ⋯ (Miinthe, 2026-10-17: no setting in two places)
    budgetRowsInto(d, 'chat', { name: who || 'the character' });
    try {
        const { rows } = fieldRows(fieldDefinitions.length ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS, vaultIndex, chat_metadata?.deeplore_context || null, false);
        for (const r of rows) {
            row(r.label, r.values.length ? r.values.join(', ') : 'not set', badge(r.values.length ? 'this chat' : 'not set', r.values.length ? 'chat' : ''),
                K.button({ label: 'Set', title: `Set ${r.label} for this chat`, onClick: async () => { await runCommand(r.cmd); redraw(); } }));
        }
    } catch (err) { console.warn('[DLE] settings: field values not shown', err); }
    box.append(d);
    return box;
}

// ── buttons ────────────────────────────────────────────────────────────────

async function act(name, btn) {
    const busy = async fn => { if (btn) btn.disabled = true; try { await fn(); } finally { if (btn) btn.disabled = false; } };
    switch (name) {
        case 'reindex': return busy(async () => {
            try { setVaultIndex([]); setIndexTimestamp(0); await buildIndex(); K.notify({ text: `Read ${vaultIndex.length} entries.`, tone: 'good' }); }
            catch (err) { console.warn('[DLE] Refresh index failed:', err); K.notify({ text: 'Couldn’t read your lore. Check the Obsidian connection.', tone: 'bad' }); }
            redraw();
        });
        case 'previewJudge': return previewJudgePrompt();
        case 'cleanupRun': { W?.close(); const { pickRunToClean } = await import('../run-cleanup.js'); return pickRunToClean(); }
        case 'scopeChat': ui.scope = 'chat'; return redraw();
        case 'openBoard': { W?.close(); const { openBoardWindow } = await import('../board-window.js'); return openBoardWindow(); }
        case 'diagnostics': {
            W?.close();
            const panel = document.getElementById('deeplore-panel');
            if (panel?.__dleShowReady) return panel.__dleShowReady();
            return runCommand('/dle-status');
        }
        case 'exportDiagnostics': return busy(() => exportDiagnosticsFlow());
        case 'resetBreaker': return resetAiBreakerFlow();
        case 'tryMatching': W?.close(); return runCommand('/dle-simulate');
        case 'commands': return showCommands();
        case 'wizard': { W?.close(); const { showSetupWizard } = await import('../ui/setup-wizard.js'); return showSetupWizard(); }
        case 'about': return showAbout();
        case 'resetAll': if (await resetAllSettingsFlow()) redraw(); return;
        case 'meroPersona': return editPersona();
        case 'meroResetPersona':
            if (await K.ask({ title: 'Reset who Mero is?', text: 'Her description goes back to the first draft.', yes: 'Reset' })) { meroSettings(null, { reset: 'persona' }); redraw(); }
            return;
        case 'meroResetSettings':
            if (await K.ask({ title: 'Reset Mero’s settings?', text: 'Chattiness, initiative, how many replies she reads, her job and sign-off go back to how they shipped. Who she is stays.', yes: 'Reset' })) { meroSettings(null, { reset: 'settings' }); redraw(); }
            return;
        default: return undefined;
    }
}

function editPersona() {
    const body = el('label', 'dk-labeled');
    const ta = el('textarea', 'dk-field'); ta.rows = 8; ta.value = meroSettings().persona || '';
    body.append(el('span', '', 'Who Mero is, in your words'), ta);
    const ok = K.button({ label: 'Save', kind: 'primary', onClick: () => { meroSettings({ persona: ta.value.trim() || meroDefaults().persona }); w.close(); redraw(); } });
    const w = K.openWindow({ title: 'Mero ☆', body, foot: [K.button({ label: 'Cancel', onClick: () => w.close() }), ok] });
    w.win.classList.add('dle-st-sub');
}

function showCommands() {
    const body = el('div', 'dle-st-cmds');
    body.append(el('p', 'dle-st-note', 'Click one to copy it.'));
    for (const c of DLE_COMMANDS) {
        if (c.sep) { body.append(el('div', 'dk-label', c.label || 'Commands')); continue; }
        const r = K.row({ title: c.cmd, sub: c.desc, onClick: async () => {
            try { await navigator.clipboard.writeText(c.cmd); K.notify({ text: `Copied ${c.cmd}` }); } catch { K.notify({ text: c.cmd }); }
        } });
        body.append(r);
    }
    const w = K.openWindow({ title: 'Slash commands', body, size: 'wide' });
    w.win.classList.add('dle-st-sub');
}

async function showAbout() {
    let version = '';
    try { version = (await (await fetch(new URL('../../manifest.json', import.meta.url).href)).json()).version || ''; } catch { /* offline */ }
    const body = el('div', 'dle-st-about');
    body.append(el('p', '', `DeepLore ${version ? 'v' + version : ''} — Miinthe’s fork (branch dev/board-model).`));
    const wiki = el('a', 'dk-link', 'The DeepLore wiki'); wiki.href = 'https://github.com/pixelnull/sillytavern-DeepLore/wiki'; wiki.target = '_blank'; wiki.rel = 'noopener noreferrer';
    body.append(wiki);
    // the companions (today's About easter egg): character cards to import
    const base = new URL('../../assets/companions/', import.meta.url).href;
    const list = [
        ['Kara-Emily-Gren-STChar.png', 'Kara Emily Gren', 'Forensic researcher. Was. The boundary between study and practice became more a matter of preference.'],
        ['Nott-STChar.png', 'Nott', 'Norse goddess of night. Pale, tattooed, wrapped in black that drinks light rather than catching it.'],
        ['Emma-STChar.png', 'Emma', 'Copper-red hair, hazel-green eyes, assessing whether what you just said is worth writing down.'],
    ];
    const f = el('div', 'dle-st-fb');
    for (const [file, name, desc] of list) {
        const a = el('a', 'dk-btn', 'Download'); a.href = base + file; a.download = file;
        f.append(K.row({ title: name, sub: desc, end: a }));
    }
    const fold = K.fold({ title: 'Companions', summary: 'character cards to import', body: f });
    body.append(fold);
    const w = K.openWindow({ title: 'About DeepLore', body, size: 'small' });
    w.win.classList.add('dle-st-sub');
}

// ── the header ─────────────────────────────────────────────────────────────

function totalChanged() {
    let n = 0;
    for (const sec of SECTIONS) n += changedCount(sec, pick, pickDef);
    return n;
}

function headEl() {
    const s = getSettings();
    const h = el('div', 'dle-st-head');
    const master = el('button', 'dle-st-toggle dle-st-master' + (s.enabled ? ' on' : ''));
    master.type = 'button'; master.title = 'DeepLore on or off everywhere'; master.setAttribute('aria-pressed', String(!!s.enabled));
    const sw = el('span', 'dk-switch'); sw.setAttribute('aria-checked', String(!!s.enabled)); sw.setAttribute('aria-hidden', 'true');
    master.append(sw, el('span', '', s.enabled ? 'On' : 'Off everywhere'));
    master.addEventListener('click', () => {
        s.enabled = !s.enabled; save();
        setupSyncPolling(buildIndexWithReuse, buildIndexWithReuse);
        try { $('#dle-enabled').prop('checked', s.enabled); } catch { /* noop */ }
        K.notify({ text: s.enabled ? 'DeepLore is on again.' : 'DeepLore is off everywhere until you switch it on.' });
        redraw();
    });
    const search = el('label', 'dle-st-search');
    search.innerHTML = K.icon('search');
    const q = el('input'); q.placeholder = 'Search settings…'; q.value = ui.q; q.setAttribute('aria-label', 'Search settings'); q.dataset.focus = 'q'; q.type = 'search';
    q.addEventListener('input', () => { ui.q = q.value; drawBody(); });
    search.append(q);
    // scopes
    const scopes = el('div', 'dk-seg dle-st-scopes'); scopes.setAttribute('role', 'group'); scopes.setAttribute('aria-label', 'Settings for');
    const sb = (label, on, onClick, dis, title) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(!!on)); b.disabled = !!dis; if (title) b.title = title; b.addEventListener('click', onClick); scopes.append(b); return b; };
    sb('Everywhere', ui.scope === 'all', () => { ui.scope = 'all'; redraw(); });
    const open = currentCharacter();
    const cname = (characters().find(c => c.key === ui.charKey) || open || {}).name;
    const cb = sb(`${ui.scope === 'char' && cname ? cname : open?.name || 'A character'} ▾`, ui.scope === 'char', e => {
        e.stopPropagation();
        const list = characters().sort(byName);
        K.openMenu(cb, [{ heading: 'Settings for a character' }, ...list.map(c => ({ label: c.name, sub: open?.key === c.key ? 'open now' : undefined, onClick: () => { ui.scope = 'char'; ui.charKey = c.key; ui.q = ''; ui.changed = false; redraw(); } }))]);
    }, false, 'Settings for one character — any, not only the open one');
    sb('This chat', ui.scope === 'chat', () => { ui.scope = 'chat'; ui.q = ''; ui.changed = false; redraw(); }, !chatOpen(), chatOpen() ? 'Only what can differ in this chat' : 'No chat is open — open one to set things for it');
    h.append(master, search, scopes);
    if (ui.scope === 'all') {
        const lv = K.seg({ options: [['simple', 'Simple'], ['sandbox', 'Sandbox']], value: ui.level, label: 'How much to show', onChange: v => { ui.level = v; keep(LEVEL, v); redraw(); } });
        lv.title = 'Simple hides the rarely used settings (the “More” parts)';
        const n = totalChanged();
        const oc = el('button', 'dle-st-toggle' + (ui.changed ? ' on' : ''));
        oc.type = 'button'; oc.setAttribute('aria-pressed', String(ui.changed));
        const sw2 = el('span', 'dk-switch'); sw2.setAttribute('aria-checked', String(ui.changed)); sw2.setAttribute('aria-hidden', 'true');
        oc.append(sw2, el('span', '', `Only what I changed (${n})`));
        oc.addEventListener('click', () => { ui.changed = !ui.changed; ui.q = ''; redraw(); });
        h.append(lv, oc);
    }
    return h;
}

// ── the body ───────────────────────────────────────────────────────────────

let bodyEl = null, headBox = null;

function navEl() {
    const nav = el('nav', 'dle-st-nav'); nav.setAttribute('aria-label', 'Sections');
    for (const g of GROUPS) {
        nav.append(el('div', 'dle-st-grp', g));
        for (const sec of SECTIONS.filter(x => x.grp === g)) {
            const b = el('button', 'dle-st-navb' + (ui.sec === sec.id ? ' on' : ''));
            b.type = 'button'; b.innerHTML = K.icon(sec.icon); b.append(el('span', '', sec.name));
            if (ui.sec === sec.id) b.setAttribute('aria-current', 'page');
            const n = changedCount(sec, pick, pickDef);
            if (n) { const c = el('span', 'dle-st-cnt', String(n)); c.title = `${n} changed`; b.append(c); }
            b.addEventListener('click', () => { ui.sec = sec.id; ui.phoneSec = true; keep(LAST_SECTION, sec.id); drawBody(); paneEl()?.scrollTo?.(0, 0); });
            nav.append(b);
        }
    }
    return nav;
}

function searchPane() {
    const { rows, extras } = searchAll(ui.q);
    const box = el('div', 'dle-st-sec');
    const n = rows.length + extras.length;
    box.append(el('h3', '', 'Search'));
    box.append(el('p', 'dle-st-lead', `${n} setting${n === 1 ? '' : 's'} for “${ui.q.trim()}” · also finds DeepLore’s old names`));
    const res = el('div', 'dle-st-results');
    for (const h of rows) {
        const b = el('button', 'dle-st-hit'); b.type = 'button';
        b.append(el('b', '', h.row.label), el('small', '', `${h.sec.name} › ${h.card.t}${h.row.old ? ` · was “${h.row.old.split(' / ')[0]}”` : ''}`));
        b.addEventListener('click', () => goRow(h));
        res.append(b);
    }
    for (const x of extras) {
        const sec = SECTIONS.find(s => s.id === x.sec);
        const b = el('button', 'dle-st-hit'); b.type = 'button';
        b.append(el('b', '', x.label), el('small', '', sec?.name || ''));
        b.addEventListener('click', () => { ui.q = ''; ui.sec = x.sec; ui.phoneSec = true; if (x.id === 'x-fine') ui.fineOpen = true; if (x.id === 'x-fields') ui.open.hubMore = true; if (x.id === 'x-pfiles') ui.open.promptFiles = true; if (x.id === 'x-own') ui.open.promptsList = true; if (x.id === 'x-budget') ui.open.budget0 = true; redraw(); });
        res.append(b);
    }
    if (!n) res.append(el('p', 'dle-st-note', 'Nothing found. Slash commands are in Advanced › Slash commands.'));
    box.append(res);
    return box;
}

function goRow(h) {
    ui.q = ''; ui.scope = 'all'; ui.changed = false; ui.sec = h.sec.id; ui.phoneSec = true;
    const key = h.sec.id + h.k;
    ui.open[key] = true;
    if (h.row.more) {
        ui.more[key] = true;
        if (ui.level === 'simple') { ui.level = 'sandbox'; keep(LEVEL, 'sandbox'); K.notify({ text: 'Showing everything (Sandbox) — that setting is a rarely used one.' }); }
    }
    ui.flash = h.row.id;
    keep(LAST_SECTION, h.sec.id);
    redraw();
}

function paneEl() { return bodyEl?.querySelector('.dle-st-pane'); }

function drawBody() {
    if (!bodyEl) return;
    const phone = isPhone();
    const showNav = ui.scope === 'all' && !ui.changed && !ui.q.trim();
    const pane = el('div', 'dle-st-pane');
    try {
        if (ui.q.trim()) pane.append(searchPane());
        else if (ui.scope === 'char') pane.append(charPane());
        else if (ui.scope === 'chat') pane.append(chatPane());
        else if (ui.changed) {
            pane.append(el('h3', '', 'Only what I changed'));
            pane.append(el('p', 'dle-st-lead', `${totalChanged()} settings differ from the defaults. Reset puts one back.`));
            for (const sec of SECTIONS) if (!sec.custom) pane.append(sectionEl(sec));
        } else pane.append(sectionEl(SECTIONS.find(s => s.id === ui.sec) || SECTIONS[0]));
    } catch (err) {
        console.warn('[DLE] settings: this section could not be drawn', err);
        pane.append(el('div', 'dk-state dk-bad', `This part could not be drawn: ${err?.message || err}`));
    }
    let side;
    if (phone) {
        if (showNav && !ui.phoneSec) { bodyEl.replaceChildren(navEl()); bodyEl.classList.add('phone'); return; }
        if (showNav) { const back = el('button', 'dle-st-back', '← All settings'); back.type = 'button'; back.addEventListener('click', () => { ui.phoneSec = false; drawBody(); }); pane.prepend(back); }
        bodyEl.replaceChildren(pane);
        bodyEl.classList.add('phone');
    } else {
        bodyEl.classList.remove('phone');
        if (showNav) side = navEl();
        else {
            side = el('nav', 'dle-st-nav');
            const label = ui.q.trim() ? 'Search' : ui.changed ? 'Changed' : ui.scope === 'char' ? (characters().find(c => c.key === ui.charKey)?.name || 'A character') : 'This chat';
            side.append(el('div', 'dle-st-grp', label));
            const b = el('button', 'dle-st-navb'); b.type = 'button'; b.innerHTML = K.icon('back'); b.append(el('span', '', 'All settings'));
            b.addEventListener('click', () => { ui.q = ''; ui.changed = false; ui.scope = 'all'; redraw(); });
            side.append(b);
        }
        bodyEl.replaceChildren(side, pane);
    }
    if (ui.flash && bodyEl.isConnected) {
        const id = ui.flash; ui.flash = null;
        requestAnimationFrame(() => { const r = document.getElementById('dle-st-row-' + id); if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); } });
    }
    if (ui.flashJob && bodyEl.isConnected) {
        const t = ui.flashJob; ui.flashJob = null;
        requestAnimationFrame(() => document.getElementById('dle-st-fine-' + t)?.scrollIntoView({ block: 'center' }));
    }
}

/** Redraw everything, keeping the scroll position and the focused field. */
function redraw() {
    if (!W || !bodyEl?.isConnected) return;
    const pane = paneEl();
    const top = pane?.scrollTop || 0;
    const focus = document.activeElement?.dataset?.focus;
    const caret = document.activeElement?.selectionStart;
    headBox.replaceChildren(headEl());
    drawBody();
    const p2 = paneEl();
    if (p2) p2.scrollTop = top;
    if (focus) {
        const f = W.win.querySelector(`[data-focus="${focus}"]`);
        if (f) { f.focus({ preventScroll: true }); try { if (caret != null) f.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    }
}

/**
 * Open the settings window. nav: { section } or today's deep links ({ tab, subtab, toolKey }).
 * → a promise that settles when the window closes.
 */
export async function openSettingsView(nav = null) {
    ensureCss();
    drainPendingPromptListCleanup();
    W?.close();
    ui.q = ''; ui.changed = false; ui.scope = 'all'; ui.phoneSec = false; ui.vopen = null; ui.vstatus = {};
    ui.level = store(LEVEL) === 'simple' ? 'simple' : 'sandbox';
    const last = store(LAST_SECTION);
    ui.sec = sectionForNav(nav) || (SECTIONS.some(s => s.id === last) ? last : 'vault');
    if (nav) ui.phoneSec = true;
    if (nav?.toolKey) { ui.fineOpen = true; ui.flashJob = nav.toolKey; }
    if (nav?.scope === 'chat' && chatOpen()) ui.scope = 'chat';
    const open = currentCharacter();
    ui.charKey = open?.key || ui.charKey || '';

    headBox = el('div', 'dle-st-headbox');
    headBox.append(headEl());
    bodyEl = el('div', 'dle-st-body dk');
    // build the first view before the window opens, so a failure here falls back to the old window (never two windows)
    drawBody();
    const mq = window.matchMedia?.('(max-width: 720px)');
    const onMq = () => drawBody();
    mq?.addEventListener?.('change', onMq);
    return new Promise(resolve => {
        W = K.openWindow({ title: 'DeepLore settings', body: bodyEl, headExtra: headBox, size: 'wide', label: 'DeepLore settings', onClose: () => { W = null; mq?.removeEventListener?.('change', onMq); saveSettingsDebounced(); resolve(); } });
        W.win.classList.add('dle-st-win', 'dk');
        W.win.parentElement?.classList.add('dle-st-scrim');
        // Miinthe's patch 23 (2026-10-03): a close button that always fits on a phone screen — here the window's own ✕, which
        // sits inside the header on every screen (style.css hides .dle-settings-close-mobile on a PC, so it is not reused)
        const x = W.head.querySelector('.dk-ib:last-child');
        x?.classList.add('dle-st-close'); x?.setAttribute('title', 'Close settings'); x?.setAttribute('aria-label', 'Close settings');
        if (ui.flash || ui.flashJob) drawBody();
    });
}

/** Open the settings at the Filters hub (the side panel's Filters tab → "Filters in settings…"). */
export const openFiltersHub = () => openSettingsView({ section: 'filters' });
