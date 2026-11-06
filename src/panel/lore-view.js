/**
 * Overhaul — the side panel's Lore tab, drawn to the approved mock-up (side panel + bar v13, viewLore()):
 *
 *   [ Sent · Left out · All entries ]  [New N]  ⧉
 *   Sent         funnel "38 matched › 15 picked › 12 sent with #34 · +2 new" + copy titles; rows (icon, title,
 *                "folder · why", how-sure bars + tokens); tap → Why, and a bar: Pin · Block · Move to folder… ·
 *                Open in Obsidian; Timers fold.
 *   Left out     one fold per reason; tap → why, and a bar: Let it in next time · Find in All entries.
 *   All entries  search (`/`, ? = search tricks), filter chips (folders: this chat's / any folder, your own fields,
 *                status, tags, sort, since last reply; on a phone they fold behind "Filters (N on)"), Showing N of M,
 *                Group by folder (+ expand / fold all), Select; tap → related entries + a bar: Pin · Block · Move to
 *                folder… · Optimize keywords · Open in Obsidian; Select → checkboxes and "N selected" with Pin ·
 *                Block · Move to folder… · Optimize keywords · Write summaries.
 *   New          her inbox jump (2026-08-03): only when the vault has an inbox; each new entry with Move….
 *   ⧉            today's Full View pop-outs (the [data-expand] buttons, wired in drawer-events.js wireTabExpand).
 *
 * Today's Injection and Browse panels stay in the page, hidden: their renderers still work out what Browse shows
 * (renderBrowseTab → ds.browseFilteredEntries / ds.browseRowModel, the inbox folder, the search tricks), and every
 * filter here is today's own `ds` state, so remembered choices (sort, "this chat's folders") keep working.
 * Pure rules: lore-pure.js (tested in test/lore-view.test.mjs). Looks: lore.css.
 */
import { chat, chat_metadata, getCurrentChatId, eventSource, event_types } from '../../../../../../script.js';
import { saveMetadataDebounced } from '../../../../../extensions.js';
import { accountStorage } from '../../../../../util/AccountStorage.js';
import { getSettings } from '../../settings.js';
import * as K from '../kit/kit.js';
import {
    vaultIndex, generationLock, indexing, cooldownTracker, decayTracker, chatInjectionCounts, trackerKey,
    fieldDefinitions, notifyPinBlockChanged, setIndexTimestamp,
    onIndexUpdated, onPipelineComplete, onInjectionSourcesReady, onPinBlockChanged, onGenerationLockChanged,
    onIndexingChanged, onChatInjectionCountsUpdated, onFieldDefinitionsUpdated,
} from '../state.js';
import { getCurrentForChat, getPrevious, onVerdictChanged } from '../verdict/verdict-store.js';
import { diffVerdicts } from '../verdict/verdict-pure.js';
import { DEFAULT_FIELD_DEFINITIONS } from '../fields.js';
import { categorizeRejections, resolveEntryVault, openObsidianUri } from '../helpers.js';
import { ds, computeEntryTemperatures } from '../drawer/drawer-state.js';
import { renderBrowseTab } from '../drawer/drawer-render-tabs.js';
import { switchTab, moveEntryFlow } from '../drawer/drawer-events.js';
import { topFolderOf } from '../drawer/drawer-browse-pure.js';
import * as P from './lore-pure.js';

const I = K.icon;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 100;            // rows drawn at a time in a long list ("Show more" draws the next page)
const OUT_PAGE = 40;

function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}
const store = {
    get: k => { try { return accountStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { accountStorage.setItem(k, v); } catch { /* noop */ } },
};
function verdict() {
    let cid = null;
    try { cid = getCurrentChatId() ?? null; } catch { cid = null; }
    return getCurrentForChat(cid);
}
const entryKey = e => P.pbKey(e?.title, e?.vaultSource);

export function mountLoreView(panel) {
    const $drawer = ds.$drawer;
    const injP = panel.querySelector('#dle-panel-injection'), browseP = panel.querySelector('#dle-panel-browse');
    if (!$drawer || !injP || !browseP || panel.querySelector('.dle-lv')) return;

    // ── state (what is shown; the filters themselves are today's ds.browse*) ──
    const S = {
        view: 'sent',          // sent · out · all · inbox
        sel: null,             // selected row key (view|vault:title)
        folds: {},             // Left out / Timers folds the user opened or closed
        help: false,           // search tricks shown
        limit: PAGE,           // rows drawn in All entries / New
        outLimit: {},          // rows drawn per Left out fold
        filtersOpen: store.get('dle-filters-open') === '1',   // her phone filter fold (2026-08-03), same memory
        scrollTo: null,
    };

    // ── the view's frame ──
    const root = h('section', 'dk dle-lv');
    root.setAttribute('aria-label', 'Lore');
    const bar = h('div', 'dle-lv-vtools dle-lv-bar');
    const seg = K.seg({ options: [['sent', 'Sent'], ['out', 'Left out'], ['all', 'All entries']], value: 'sent', label: 'Which entries', onChange: v => go(v) });
    seg.classList.add('dle-lv-seg');
    const newB = K.button({ label: 'New', icon: 'inbox', title: 'New entries in your inbox folder. Press again to go back', onClick: () => go(S.view === 'inbox' ? 'all' : 'inbox') });
    newB.classList.add('dle-lv-new');
    const pop = K.iconButton({ icon: 'popout', title: 'Pop this list out into a big window' });
    bar.append(seg, newB, pop);
    const top = h('div', 'dle-lv-top');      // All entries: search + chips (kept while typing)
    const body = h('div', 'dle-lv-body');
    root.append(bar, top, body);
    injP.before(root);
    panel.classList.add('dle-lv-on');

    // ── the search row (built once, so typing never loses focus) ──
    const srch = h('div', 'dle-lv-srch');
    const sbox = h('label', 'dle-lv-search', I('search'));
    const input = h('input');
    input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('aria-label', 'Search your entries');
    sbox.append(input);
    const helpB = K.iconButton({ icon: 'info', title: 'Search tricks', onClick: () => { S.help = !S.help; drawTop(); } });
    helpB.innerHTML = '<b aria-hidden="true">?</b>';
    const helpPop = h('div', 'dle-lv-help',
        '<span><code>tag:</code>lorebook-always · <code>folder:</code>People · <code>key:</code>captain · <code>summary:</code>storm · <code>field:</code>era=modern</span>'
        + '<span class="dle-lv-mini">Mix them with words: <code>folder:People captain</code>. Plain words look in titles and keys.</span>');
    srch.append(sbox, helpB, helpPop);
    // the tricks lie over the filter chips: a press anywhere else folds them away again (bug hunt 2026-10-16)
    document.addEventListener('pointerdown', e => {
        if (S.help && !helpPop.contains(e.target) && !helpB.contains(e.target)) { S.help = false; drawTop(); }
    }, true);
    let typing = null;
    input.addEventListener('input', () => {
        clearTimeout(typing);
        typing = setTimeout(() => { ds.browseQuery = input.value; S.limit = PAGE; refreshBrowse(); }, 250);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; ds.browseQuery = ''; refreshBrowse(); } });
    const chipBox = h('div', 'dle-lv-filters');

    // ── which list ──
    const loreActive = () => injP.classList.contains('active') || browseP.classList.contains('active');
    const inbox = () => {
        const b = panel.querySelector('.dle-browse-inbox-btn');
        const f = b?.getAttribute('data-inbox-folder') || '';
        if (!f || b.style.display === 'none') return null;
        const n = vaultIndex.filter(e => (e.folderPath || '') === f || (e.folderPath || '').startsWith(f + '/')).length;
        return { folder: f, count: n };
    };
    function go(v) {
        S.sel = null; S.limit = PAGE; S.help = false;
        if (v === 'all' || v === 'inbox') {
            S.view = v;
            if (!browseP.classList.contains('active')) switchTab($drawer, 'browse');
            else refreshBrowse(false);
        } else {
            S.view = v;
            ds.whyTabFilter = v === 'out' ? 'filtered' : 'injected';
            store.set('dle-why-filter', ds.whyTabFilter);
            if (!injP.classList.contains('active')) switchTab($drawer, 'injection');
        }
        draw();
    }
    /** Today's tab memory decides the list: Browse active = All entries (or New), Injection active = Sent / Left out. */
    function sync() {
        const on = loreActive();
        root.hidden = !on;
        if (!on) return;
        if (browseP.classList.contains('active')) { if (S.view !== 'all' && S.view !== 'inbox') { S.view = 'all'; S.sel = null; } }
        else if (S.view === 'all' || S.view === 'inbox') { S.view = ds.whyTabFilter === 'filtered' ? 'out' : 'sent'; S.sel = null; }
        else if (S.view !== 'out' && ds.whyTabFilter === 'filtered') S.view = 'out';
        if (browseP.classList.contains('active')) refreshBrowse(false);
        draw();
    }

    /** Today's Browse renderer works out the list (search tricks, every filter, sort, grouping, the inbox folder). */
    function refreshBrowse(redraw = true) {
        const sc = panel.querySelector('.dle-drawer-inner');
        const st = sc?.scrollTop;
        try { renderBrowseTab(); } catch (err) { console.warn('[Onyx Quill] Lore: Browse list', err); }
        if (sc && sc.scrollTop !== st) sc.scrollTop = st;
        // a "Show in All entries" jump (navigateToBrowseEntry: Related, Find in All entries, the big windows) leaves its
        // target here: select it, and open its folder
        if (ds.lastBrowseNav) {
            const { title: t, vaultSource: v } = ds.lastBrowseNav;
            ds.lastBrowseNav = null;
            const list = ds.browseFilteredEntries || [];
            const e = list.find(x => x.title === t && (v == null || (x.vaultSource || '') === v)) || list.find(x => x.title === t);
            if (e) {
                if (S.view !== 'all') S.view = 'all';
                S.sel = 'all|' + entryKey(e); S.scrollTo = S.sel;
                if (ds.browseFolderGrouping) {
                    if (!(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
                    if (!ds.browseExpandedFolders.has(topFolderOf(e))) { ds.browseExpandedFolders.add(topFolderOf(e)); try { renderBrowseTab(); } catch { /* noop */ } }
                }
            }
        }
        if (redraw) draw();
    }

    // ── drawing ──
    let raf = 0;
    const offs = [];
    const later = () => { if (!root.isConnected) { offs.splice(0).forEach(f => { try { f?.(); } catch { /* noop */ } }); return; } if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!root.hidden) { if (S.view === 'all' || S.view === 'inbox') refreshBrowse(false); draw(); } }); };

    function draw() {
        if (!loreActive()) return;
        seg.setValue(S.view === 'inbox' ? 'all' : S.view);
        const ib = inbox();
        newB.hidden = !ib;
        if (ib) {
            newB.querySelector('span').textContent = ib.count ? `New ${ib.count}` : 'New';
            newB.classList.toggle('dk-primary', S.view === 'inbox');
            newB.setAttribute('aria-pressed', String(S.view === 'inbox'));
        } else if (S.view === 'inbox') S.view = 'all';
        pop.dataset.expand = S.view === 'sent' || S.view === 'out' ? 'injection' : 'browse';
        pop.title = S.view === 'sent' || S.view === 'out' ? 'Pop out: what went into the last reply, in a big window' : 'Pop out: all your entries, in a big window';
        pop.setAttribute('aria-label', pop.title);
        drawTop();
        body.textContent = '';
        try {
            if (S.view === 'sent') drawSent();
            else if (S.view === 'out') drawOut();
            else if (S.view === 'inbox') drawInbox(ib);
            else drawAll();
        } catch (err) {
            console.warn('[Onyx Quill] Lore view', err);
            body.append(h('p', 'dle-lv-empty', 'Something went wrong drawing this list. Try Refresh.'));
        }
        if (S.scrollTo) {
            const k = S.scrollTo; S.scrollTo = null;
            requestAnimationFrame(() => body.querySelector(`[data-k="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'nearest' }));
        }
    }

    function drawTop() {
        top.hidden = S.view !== 'all';
        if (top.hidden) return;
        if (!top.contains(srch)) top.append(srch, chipBox);
        if (document.activeElement !== input && input.value !== (ds.browseQuery || '')) input.value = ds.browseQuery || '';
        input.placeholder = `Search ${vaultIndex.length.toLocaleString()} entries (/)`;
        helpB.classList.toggle('on', S.help);
        helpB.setAttribute('aria-expanded', String(S.help));
        helpPop.hidden = !S.help;
        drawChips();
    }

    // ── a row ──
    function entryRow({ k, lead, title, sub, end, why, onPick }) {
        const r = K.row({ lead, title, sub, end, selected: S.sel === k, onClick: onPick || (() => { S.sel = S.sel === k ? null : k; draw(); }) });
        r.dataset.k = k;
        if (why) r.title = why;
        return r;
    }
    function confBars(level, word, why) {
        if (!level) return null;
        const c = h('span', `dle-lv-conf c${level}`, `<i></i><i></i><i></i><em>${esc(word)}</em>`);
        c.title = `How sure: ${word}${why ? ` — ${why}` : ''}`;
        return c;
    }
    const pill = (text, cls = '', title = '') => { const p = h('span', 'dle-lv-pill' + (cls ? ' ' + cls : ''), esc(text)); if (title) p.title = title; return p; };
    const tokens = n => h('span', 'dle-lv-tok', esc(n ?? '?'));
    const mini = t => h('span', 'dle-lv-mini', esc(t));
    function selbar(what, buttons) {
        const b = h('div', 'dle-lv-selbar');
        const w = h('div', 'dle-lv-what', `<span>${esc(what)}</span>`);
        w.append(K.iconButton({ icon: 'close', title: 'Unselect', onClick: () => { if (S.view === 'all' && ds.browseSelectMode) { ds.browseSelected?.clear?.(); refreshBrowse(); } else { S.sel = null; draw(); } } }));
        b.append(w, ...buttons.filter(Boolean));
        return b;
    }
    const btn = (icon, label, onClick, title) => K.button({ icon, label, onClick, title });
    function relatedChips(entry) {
        const rel = P.relatedTitles(entry, vaultIndex);
        if (!rel.length) return null;
        const r = h('span', 'dle-lv-rel', '<span class="dle-lv-mini">Related:</span>');
        for (const t of rel) {
            const c = K.chip({ label: t, title: `Show “${t}” in All entries`, onClick: () => findInAll({ title: t }) });
            c.classList.add('dle-lv-c22');
            r.append(c);
        }
        return r;
    }
    function preview(entry) {
        if (!entry) return null;
        const text = entry.summary || (entry.content ? entry.content.slice(0, 220) + (entry.content.length > 220 ? '…' : '') : '');
        return text ? h('span', 'dle-lv-prev', esc(text)) : null;
    }
    function fieldsLine(entry) {
        const pairs = Object.entries(entry?.customFields || {})
            .filter(([, v]) => v != null && v !== '' && (!Array.isArray(v) || v.length))
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        return pairs.length ? mini(pairs.join(' · ')) : null;
    }
    const findEntry = (title, vaultSource) => vaultIndex.find(e => e.title === title && (e.vaultSource || '') === (vaultSource || ''))
        || vaultIndex.find(e => e.title === title);

    // ── shared actions ──
    function pinBlock(kind, targets) {
        if (!chat_metadata || !targets.length) return;
        const before = { pins: [...(chat_metadata.deeplore_pins || [])], blocks: [...(chat_metadata.deeplore_blocks || [])] };
        const mine = kind === 'pin' ? before.pins : before.blocks;
        const on = !targets.every(t => P.isIn(mine, t.title, t.vaultSource));
        const next = P.togglePinBlock(before, kind, targets, on);
        const apply = s => { chat_metadata.deeplore_pins = s.pins; chat_metadata.deeplore_blocks = s.blocks; saveMetadataDebounced(); notifyPinBlockChanged(); later(); };
        apply(next);
        const what = targets.length > 1 ? `${targets.length} entries` : `“${targets[0].title}”`;
        const verb = kind === 'pin' ? (on ? 'Pinned' : 'Unpinned') : (on ? 'Blocked' : 'Unblocked');
        K.notify({ text: `${verb} ${what} in this chat.`, undo: K.chatOnly(() => apply(before), () => getCurrentChatId() ?? null) });
    }
    const pinState = (title, vaultSource) => ({
        pinned: P.isIn(chat_metadata?.deeplore_pins, title, vaultSource),
        blocked: P.isIn(chat_metadata?.deeplore_blocks, title, vaultSource),
    });
    function pinButtons(targets) {
        const one = targets.length === 1 ? pinState(targets[0].title, targets[0].vaultSource) : null;
        const allPinned = targets.every(t => P.isIn(chat_metadata?.deeplore_pins, t.title, t.vaultSource));
        const allBlocked = targets.every(t => P.isIn(chat_metadata?.deeplore_blocks, t.title, t.vaultSource));
        return [
            btn('pinI', (one ? one.pinned : allPinned) ? 'Unpin' : 'Pin', () => pinBlock('pin', targets), 'Pinned entries go in with every reply in this chat'),
            btn('block', (one ? one.blocked : allBlocked) ? 'Unblock' : 'Block', () => pinBlock('block', targets), 'Blocked entries stay out of every reply in this chat'),
        ];
    }
    function moveB(entries, refs = []) {
        return btn('folder', 'Move to folder…', async () => {
            // looked up again now: the list was drawn from an older index (Miinthe 2026-10-18: "not in the vault index anymore")
            const again = () => refs.map(r => (r.filename && vaultIndex.find(e => e.filename === r.filename)) || findEntry(r.title, r.vaultSource)).filter(Boolean);
            let list = entries.filter(Boolean);
            if (!list.length && refs.length) list = again();
            if (!list.length && refs.length) { setIndexTimestamp(0); const { buildIndex } = await import('../vault/vault.js'); await buildIndex(); list = again(); }
            if (!list.length) { K.notify({ text: 'That entry isn’t in your vault any more (renamed or moved in Obsidian?).', tone: 'bad' }); return; }
            await moveEntryFlow(list[0], list.length > 1 ? { entries: list } : {});
            later();
        }, 'Move it into another folder of your vault (copied, checked, then the old file removed)');
    }
    function obsidianB(src) {
        const { uri } = src ? resolveEntryVault(src, getSettings().vaults) : {};
        if (!uri) return null;
        return btn('lore', 'Open in Obsidian', () => openObsidianUri(uri));
    }
    function optimizeB(keys) {
        return btn('key', 'Optimize keywords', async () => {
            if (ds._batchOptimizeInflight || !keys.length) return;
            ds._batchOptimizeInflight = true;
            try {
                const mod = await import('../ui/popups.js');
                await mod.runBatchOptimize(keys);
                if (ds.browseSelectMode) ds.browseSelected?.clear?.();
            } catch (err) {
                console.error('[Onyx Quill] Optimize keywords failed:', err);
                K.notify({ text: `Optimize keywords failed: ${err?.message || err}`, tone: 'bad' });
            } finally { ds._batchOptimizeInflight = false; later(); }
        }, 'The AI suggests better keywords; you check each one before it is written');
    }
    function summariesB(entries) {
        return btn('notes', 'Write summaries', async () => {
            const missing = entries.filter(e => e && !(e.summary && e.summary.trim()));
            if (!missing.length) { K.notify({ text: entries.length > 1 ? `All ${entries.length} already have a summary.` : 'It already has a summary.' }); return; }
            const ok = await K.ask({ title: `Write ${missing.length === 1 ? 'a summary' : `${missing.length} summaries`}?`, text: `The AI writes a one-line summary for ${missing.length === 1 ? `“${missing[0].title}”` : `the ${missing.length} selected entries that have none`}. You check each one before it is saved.${missing.length < entries.length ? ` ${entries.length - missing.length} already have one and are left alone.` : ''}`, yes: 'Write them' });
            if (!ok) return;
            try {
                const { summarizeEntries } = await import('../ui/commands-ai.js');
                const r = await summarizeEntries(missing);
                K.notify({ text: `Summaries: ${r.generated} written, ${r.skipped} skipped, ${r.failed} failed.`, tone: r.failed ? 'wait' : 'good' });
                if (r.generated > 0) { setIndexTimestamp(0); const { buildIndex } = await import('../vault/vault.js'); await buildIndex(); }
            } catch (err) {
                console.error('[Onyx Quill] Write summaries failed:', err);
                K.notify({ text: `Write summaries failed: ${err?.message || err}`, tone: 'bad' });
            }
            later();
        }, 'Write the missing one-line summaries with AI (each one shown to you first)');
    }
    async function findInAll(t) {
        const { navigateToBrowseEntry } = await import('../drawer/drawer.js');
        navigateToBrowseEntry(t.vaultSource != null ? { title: t.title, vaultSource: t.vaultSource } : t.title);
        later();
    }

    // ── Sent ──
    function drawSent() {
        // the swipe on screen (a swipe keeps its own list; the last verdict only while it is that swipe's)
        const shown = P.sentShown(verdict(), chat?.[(chat?.length || 0) - 1] || null, (chat?.length || 0) - 1);
        const v = shown.verdict, sources = shown.sources;
        const trace = v?.trace ?? null;
        if (!sources) { body.append(emptySent(shown.ofSwipe)); drawTimers(); return; }
        const diff = v ? diffVerdicts(v, getPrevious()) : { added: [], removed: [], same: [] };
        const added = new Set((diff.added || []).map(s => P.pbKey(s.title, s.vaultSource)));
        const f = P.funnelOf(trace, sources.length, diff, v?.msgIdx ?? -1);
        const fl = h('div', 'dle-lv-vtools');
        const fun = h('div', 'dle-lv-funnel');
        if (f) {
            fun.innerHTML = `<b>${f.matched}</b> matched › ${f.picked != null ? `<b>${f.picked}</b> picked › ` : ''}<b>${f.sent}</b> sent${f.msg != null ? ` with #${f.msg}` : ''}`
                + (f.added ? ` · <span class="dle-lv-good">+${f.added} new</span>` : '') + (f.removed ? ` · <span class="dle-lv-muted">${f.removed} dropped</span>` : '');
        } else fun.innerHTML = `<b>${sources.length}</b> sent with ${shown.ofSwipe ? 'this swipe' : 'the last reply'}`;
        fl.append(fun, K.iconButton({ icon: 'copy', title: `Copy the ${sources.length} titles`, onClick: () => copyTitles(sources) }));
        body.append(fl);
        const aiBy = new Map((trace?.aiSelected || []).map(a => [P.pbKey(a.title, a.vaultSource), a]));
        const rows = h('div', 'dle-lv-rows');
        rows.setAttribute('role', 'list');
        let selSrc = null;
        for (const s of sources) {
            const key = P.pbKey(s.title, s.vaultSource), k = 'sent|' + key;
            const entry = findEntry(s.title, s.vaultSource);
            const ai = aiBy.get(key) || null;
            const why = P.whyOf(s, ai), sure = P.howSure(s, ai);
            const folder = entry?.folderPath ? `${entry.folderPath}/` : '';
            const end = [];
            if (added.has(key)) end.push(pill('new', 'g', 'Not sent with the reply before'));
            end.push(confBars(sure.level, sure.word, why.long), tokens(s.tokens));
            rows.append(entryRow({ k, lead: P.leadFor(entry), title: s.title, sub: [folder, why.short].filter(Boolean).join(' · '), end: end.filter(Boolean), why: `Why: ${why.long}` }));
            if (S.sel === k) {
                selSrc = { s, entry };
                const x = h('div', 'dle-lv-expand');
                x.append(h('span', 'dle-lv-why', `<b>Why:</b> ${esc(why.long)}`));
                const p = preview(entry); if (p) x.append(p);
                const n = chatInjectionCounts.get(trackerKey(s)) || 0;
                x.append(mini([n ? `sent ${n}× in this chat` : '', entry ? `priority ${entry.priority ?? 50}` : '', `${s.tokens ?? '?'} tokens`, s.vaultSource && (getSettings().vaults || []).filter(z => z.enabled !== false).length > 1 ? `from ${s.vaultSource}` : ''].filter(Boolean).join(' · ')));
                const rel = entry && relatedChips(entry); if (rel) x.append(rel);
                rows.append(x);
            }
        }
        body.append(rows);
        drawTimers();
        if (selSrc) {
            const t = { title: selSrc.s.title, vaultSource: selSrc.s.vaultSource || null };
            body.append(selbar(selSrc.s.title, [...pinButtons([t]), moveB([selSrc.entry], [selSrc.s]), obsidianB(selSrc.entry || selSrc.s)]));
        }
    }
    function emptySent(ofSwipe = false) {
        const e = h('div', 'dle-lv-empty');
        if (generationLock) e.innerHTML = '<p>Choosing lore…</p>';
        else if (!vaultIndex.length) {
            e.innerHTML = indexing ? '<p>Loading your entries…</p>' : '<p>No entries yet.</p>';
            if (!indexing) { e.title = 'Connect your Obsidian vault and tag notes with lorebook, or bring in a SillyTavern lorebook'; e.append(setupButtons()); }
        } else { e.innerHTML = `<p>Nothing was sent with ${ofSwipe ? 'this swipe' : 'the last reply'}.</p>`; e.title = 'After a reply, the entries that went in show here, with why'; }
        return e;
    }
    function setupButtons() {
        const r = h('div', 'dle-lv-vtools');
        // today's buttons: the click goes to drawer-events.js's [data-empty-action] handler (setup wizard / import)
        const a = K.button({ icon: 'wand', label: 'Setup wizard' }); a.classList.add('dle-empty-cta-btn'); a.dataset.emptyAction = 'setup';
        const b = K.button({ icon: 'import', label: 'Import World Info' }); b.classList.add('dle-empty-cta-btn'); b.dataset.emptyAction = 'import-wi';
        r.append(a, b);
        return r;
    }
    function copyTitles(sources) {
        const titles = sources.map(s => s.title).join('\n');
        navigator.clipboard?.writeText(titles).then(
            () => K.notify({ text: `Copied ${sources.length} title${sources.length === 1 ? '' : 's'}.`, tone: 'good' }),
            () => K.notify({ text: 'The browser did not allow copying. Try again after clicking in the page.', tone: 'wait' }),
        );
    }
    function drawTimers() {
        const s = getSettings();
        const rows = P.timerRows(cooldownTracker, decayTracker, { decayEnabled: !!s.decayEnabled, threshold: s.decayBoostThreshold || 5 });
        if (!rows.length) return;
        const f = K.fold({
            title: 'Timers', summary: rows.slice(0, 2).map(r => `${r.name}: ${r.text}`).join(' · '), count: rows.length, open: !!S.folds.timers,
            body: rows.map(r => K.row({ lead: r.kind === 'cooldown' ? '⏳' : '💤', title: r.name, sub: r.text })),
            onToggle: o => { S.folds.timers = o; },
        });
        body.append(f);
    }

    // ── Left out ──
    function drawOut() {
        const v = verdict();
        const trace = v?.trace ?? null;
        const sources = v?.injectedSources || [];
        const injectedKeys = new Set(sources.map(s => P.pbKey(s.title, s.vaultSource)));
        const groups = P.outGroups({
            categorized: trace ? categorizeRejections(trace, injectedKeys) : [],
            folderRemoved: trace?.folderFilterRemoved || [],
            blocks: chat_metadata?.deeplore_blocks || [],
            injectedKeys,
        });
        if (!groups.length) {
            const e = h('div', 'dle-lv-empty dk-empty', trace ? '<b>Nothing was left out of the last reply.</b>' : '<b>Nothing yet.</b><span>Send a message: what lore went in shows here.</span>');
            if (!trace) e.title = 'After a reply, the entries that matched but did not go in show here, by reason';
            body.append(e);
            return;
        }
        let selected = null;
        groups.forEach((g, gi) => {
            const lim = S.outLimit[g.stage] || OUT_PAGE;
            const { shown, more } = P.capRows(g.entries, lim);
            const list = [];
            for (const e of shown) {
                const k = `out|${g.stage}|${P.pbKey(e.title, e.vaultSource)}`;
                const entry = findEntry(e.title, e.vaultSource);
                list.push(entryRow({ k, lead: P.leadFor(entry), title: e.title, sub: e.reason, why: `Why: ${e.reason}` }));
                if (S.sel === k) {
                    selected = { e, g, entry };
                    const x = h('div', 'dle-lv-expand');
                    x.append(h('span', 'dle-lv-why', `<b>Why:</b> ${esc(e.reason)}`));
                    const p = preview(entry); if (p) x.append(p);
                    list.push(x);
                }
            }
            if (more) list.push(K.button({ kind: 'quiet', label: `Show ${Math.min(more, OUT_PAGE)} more (${more} left)`, onClick: () => { S.outLimit[g.stage] = lim + OUT_PAGE; S.folds[g.stage] = true; draw(); } }));
            const open = S.folds[g.stage] ?? (gi === 0 || (selected && selected.g === g));
            const titles = g.entries.slice(0, 3).map(x => x.title).join(', ') + (g.entries.length > 3 ? '…' : '');
            body.append(K.fold({ title: g.label, summary: titles, count: g.entries.length, open: !!open, body: list, onToggle: o => { S.folds[g.stage] = o; } }));
        });
        if (selected) {
            const t = { title: selected.e.title, vaultSource: selected.e.vaultSource || null };
            const st = pinState(t.title, t.vaultSource);
            const letIn = st.blocked
                ? btn('block', 'Unblock', () => pinBlock('block', [t]), 'Take the block off: it can go in again when it matches')
                : btn('pinI', st.pinned ? 'Pinned' : 'Let it in next time', () => { if (!st.pinned) pinBlock('pin', [t]); }, 'Pin it for this chat: it goes in with the next reply, whatever the reason was');
            body.append(selbar(selected.e.title, [letIn, btn('search', 'Find in All entries', () => findInAll(t))]));
        }
    }

    // ── All entries ──
    function drawChips() {
        chipBox.textContent = '';
        const phone = panel.classList.contains('dle-mobile');
        const sum = P.filterSummary({ folder: ds.browseFolderFilter, status: ds.browseStatusFilter, tag: ds.browseTagFilter, fields: ds.browseCustomFieldFilters, quick: ds.browseQuickFilter });
        const chips = h('div', 'dle-lv-chips');
        chips.id = 'dle-lv-chips';
        if (phone) {
            const t = K.button({ icon: 'filter', label: sum.text, kind: 'quiet', onClick: () => { S.filtersOpen = !S.filtersOpen; store.set('dle-filters-open', S.filtersOpen ? '1' : '0'); drawChips(); } });
            t.classList.add('dle-lv-ftoggle'); t.classList.toggle('on', sum.on > 0);
            t.setAttribute('aria-expanded', String(S.filtersOpen)); t.setAttribute('aria-controls', chips.id);
            chipBox.append(t);
            chips.hidden = !S.filtersOpen;
        }
        const c = (label, on, onClick, title) => { const x = K.chip({ label, on, onClick, title }); x.classList.add('dle-lv-c22'); chips.append(x); return x; };
        const ib = inbox();
        const ff = ds.browseFolderFilter || '';
        c(`Folders: ${P.folderLabel(ff, ib?.folder)} ▾`, ff === '__chat__' || !!ff, e => openFolderPicker(e.currentTarget), 'Which folders to show: this chat’s, any folder, or one folder (empty ones too)');
        const defs = (fieldDefinitions.length ? fieldDefinitions : DEFAULT_FIELD_DEFINITIONS).filter(fd => fd.gating?.enabled);
        for (const fv of P.fieldValues(vaultIndex, defs)) {
            const cur = ds.browseCustomFieldFilters?.[fv.name] || '';
            c(`${cur ? `${fv.label}: ${cur}` : fv.label} ▾`, !!cur, e => K.openMenu(e.currentTarget, [
                { label: `Any ${fv.label}`, checked: !cur, onClick: () => setField(fv.name, '') }, 'sep',
                ...fv.values.map(val => ({ label: val, checked: cur === val, onClick: () => setField(fv.name, val) })),
            ]), `Show entries by their ${fv.label}`);
        }
        const st = ds.browseStatusFilter || 'all';
        c(`${st === 'all' ? 'Status' : P.statusWord(st)}${ds.browseQuickFilter === 'never-injected' ? ' · not sent here' : ''} ▾`, st !== 'all' || ds.browseQuickFilter === 'never-injected', e => K.openMenu(e.currentTarget, [
            ...P.STATUS.map(([val, l]) => ({ label: l, checked: st === val, onClick: () => { ds.browseStatusFilter = val; refreshBrowse(); } })), 'sep',
            { label: 'Not sent in this chat yet', checked: ds.browseQuickFilter === 'never-injected', onClick: () => { ds.browseQuickFilter = ds.browseQuickFilter === 'never-injected' ? null : 'never-injected'; refreshBrowse(); } },
        ]));
        const tag = ds.browseTagFilter || '';
        c(`${tag ? `Tag: ${tag}` : 'Tags'} ▾`, !!tag, e => {
            const counts = new Map();
            for (const x of vaultIndex) for (const t of x.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
            const tags = [...(ds.cachedTagSet || counts.keys())].sort((a, b) => a.localeCompare(b));
            K.openMenu(e.currentTarget, [{ label: 'Any tag', checked: !tag, onClick: () => { ds.browseTagFilter = ''; refreshBrowse(); } }, 'sep',
                ...tags.map(t => ({ label: `${t} (${counts.get(t) || 0})`, checked: tag === t, onClick: () => { ds.browseTagFilter = t; refreshBrowse(); } }))]);
        });
        c(`Sort: ${P.sortWord(ds.browseSort)} ▾`, false, e => K.openMenu(e.currentTarget, P.SORTS.map(([val, l]) => ({ label: l, checked: ds.browseSort === val, onClick: () => { ds.browseSort = val; store.set('dle-browse-sort', val); refreshBrowse(); } }))));
        c('Since last reply', ds.browseQuickFilter === 'since-gen', () => { ds.browseQuickFilter = ds.browseQuickFilter === 'since-gen' ? null : 'since-gen'; S.limit = PAGE; refreshBrowse(); }, 'Only the entries that went in with the last reply and not the one before');
        if (sum.on || ds.browseQuery) {
            const x = K.button({ kind: 'quiet', label: 'Clear', title: 'Clear the search and every filter (back to this chat’s folders)', onClick: clearFilters });
            x.classList.add('dle-lv-clear');
            chips.append(x);
        }
        chipBox.append(chips);
    }
    function setField(name, val) {
        if (!ds.browseCustomFieldFilters) ds.browseCustomFieldFilters = {};
        if (val) ds.browseCustomFieldFilters[name] = val; else delete ds.browseCustomFieldFilters[name];
        S.limit = PAGE; refreshBrowse();
    }
    function clearFilters() {
        // today's "Clear all filters", plus the quick filter
        ds.browseQuery = ''; ds.browseStatusFilter = 'all'; ds.browseTagFilter = ''; ds.browseFolderFilter = '';
        ds._browseScopeTouched = false; ds.browseCustomFieldFilters = {}; ds.browseQuickFilter = null;
        input.value = ''; S.limit = PAGE;
        refreshBrowse();
    }
    async function openFolderPicker() {
        const counts = P.countByFolder(vaultIndex);
        const folders = new Set([...(ds.cachedFolderSet || []), ...counts.keys()]);
        const chatFolders = chat_metadata?.deeplore_folder_filter || [];
        const wrap = h('div', 'dle-lv-fp');
        const q = h('input', 'dle-lv-fpq');
        q.type = 'search'; q.placeholder = 'Search folders'; q.setAttribute('aria-label', 'Search folders'); q.autocomplete = 'off';
        const list = h('div', 'dle-lv-fpl');
        list.setAttribute('role', 'listbox');
        const note = h('p', 'dle-lv-mini', 'Looking for empty folders in your vault…');
        wrap.append(q, list, note);
        const w = K.openWindow({ title: 'Browse a folder', body: wrap, size: 'small' });
        const pick = f => {
            ds.browseFolderFilter = f; ds._browseScopeTouched = true;
            if (f && f !== '__chat__' && ds.cachedFolderSet instanceof Set) ds.cachedFolderSet.add(f);   // an empty folder must survive the "folder vanished" reset
            w.close(); S.limit = PAGE; refreshBrowse();
        };
        const opt = (label, sub, on, f, depth = 0) => {
            const b = h('button', 'dle-lv-mrow' + (on ? ' on' : ''), `<span>${label}</span><span class="dle-lv-cnt">${esc(sub)}</span>`);
            b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(on));
            if (depth) b.style.paddingLeft = `${8 + Math.min(depth, 3) * 14}px`;
            b.addEventListener('click', () => pick(f));
            return b;
        };
        const drawList = () => {
            list.textContent = '';
            const cur = ds.browseFolderFilter || '';
            if (!q.value.trim()) {
                if (chatFolders.length) {
                    const n = vaultIndex.filter(e => !e.folderPath || chatFolders.some(f => e.folderPath === f || e.folderPath.startsWith(f + '/'))).length;
                    list.append(opt('This chat’s folders', String(n), cur === '__chat__', '__chat__'));
                }
                list.append(opt('Any folder', String(vaultIndex.length), cur === '', ''));
            }
            const searching = !!q.value.trim();
            for (const r of P.folderRows([...folders], counts, chatFolders, q.value)) {
                if (r.heading) { list.append(h('div', 'dle-lv-mlab', esc(r.heading))); continue; }
                const label = `${r.star ? '★ ' : ''}${(r.star || searching) && r.parent ? `<span class="dle-lv-ctx">${esc(r.parent)}/</span>` : ''}${esc(r.leaf)}`;
                list.append(opt(label, r.count ? String(r.count) : 'empty', cur === r.folder, r.folder, r.star || searching ? 0 : r.depth));
            }
        };
        q.addEventListener('input', drawList);
        drawList();
        q.focus();
        // Obsidian lists folders the index cannot see (no entries yet): ask each vault, as moveEntryFlow does
        try {
            const { listAllFolders } = await import('../vault/obsidian-api.js');
            for (const v of (getSettings().vaults || []).filter(x => x.enabled !== false)) {
                try { for (const f of await listAllFolders(v.host, v.port, v.apiKey, '', 0, !!v.https)) folders.add(String(f).replace(/\/+$/, '')); } catch { /* that vault is not reachable */ }
            }
            note.remove();
            if (wrap.isConnected) drawList();
        } catch { note.textContent = 'Could not ask Obsidian for empty folders; showing the folders that have entries.'; }
    }

    function drawAll() {
        const tools = h('div', 'dle-lv-vtools');
        const shown = ds.browseFilteredEntries?.length ?? 0;
        tools.append(h('span', 'dle-lv-mini dle-lv-grow', `Showing ${shown.toLocaleString()} of ${vaultIndex.length.toLocaleString()}`));
        const grp = K.button({ icon: 'group', kind: 'quiet', label: ds.browseFolderGrouping ? 'Grouped' : 'Group by folder', title: ds.browseFolderGrouping ? 'Grouped by folder. Press for one list' : 'Show the entries under their folders', onClick: () => {
            ds.browseFolderGrouping = !ds.browseFolderGrouping;
            if (ds.browseFolderGrouping && !(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
            S.limit = PAGE; refreshBrowse();
        } });
        grp.classList.toggle('on', !!ds.browseFolderGrouping); grp.setAttribute('aria-pressed', String(!!ds.browseFolderGrouping));
        tools.append(grp);
        const tops = ds.browseFolderGrouping ? [...new Set((ds.browseFilteredEntries || []).map(topFolderOf))] : [];
        if (tops.length > 1) {
            const exp = ds.browseExpandedFolders instanceof Set ? ds.browseExpandedFolders : new Set();
            const allOpen = tops.every(f => exp.has(f));
            tools.append(K.iconButton({ icon: 'chev', title: allOpen ? 'Fold all folders' : 'Open all folders', on: allOpen, onClick: () => { ds.browseExpandedFolders = allOpen ? new Set() : new Set(tops); refreshBrowse(); } }));
            tools.lastChild.classList.add('dle-lv-expall');
        }
        const sel = K.button({ icon: 'check', kind: 'quiet', label: ds.browseSelectMode ? 'Done' : 'Select', title: 'Pick several entries for one action', onClick: () => {
            ds.browseSelectMode = !ds.browseSelectMode;
            if (!ds.browseSelectMode) ds.browseSelected?.clear?.();
            S.sel = null; refreshBrowse();
        } });
        sel.setAttribute('aria-pressed', String(!!ds.browseSelectMode));
        tools.append(sel);
        body.append(tools);

        if (!vaultIndex.length) {
            const e = h('div', 'dle-lv-empty', indexing ? '<p>Loading your entries…</p>' : '<p>No entries yet.</p>');
            if (!indexing) { e.title = 'Your vault needs notes tagged lorebook, each with keys to match'; e.append(setupButtons()); }
            body.append(e); return;
        }
        if (!shown) {
            const e = h('div', 'dle-lv-empty', ds.browseFolderFilter && ds.browseFolderFilter !== '__chat__' && !(ds.browseQuery || ds.browseTagFilter || (ds.browseStatusFilter && ds.browseStatusFilter !== 'all')) ? '<p>Nothing in this folder yet.</p>' : '<p>No entries match.</p>');
            e.append(K.button({ label: 'Clear filters', onClick: clearFilters }));
            body.append(e); return;
        }

        const selectMode = !!ds.browseSelectMode;
        if (!(ds.browseSelected instanceof Set)) ds.browseSelected = new Set();
        const selected = ds.browseSelected;
        const pins = chat_metadata?.deeplore_pins || [], blocks = chat_metadata?.deeplore_blocks || [];
        // today's row markers: sent with the last reply, or why it was left out; how often it goes in (temperature)
        const v = verdict(), trace = v?.trace ?? null;
        const sentKeys = new Set((v?.injectedSources?.length ? v.injectedSources : trace?.injected || []).filter(x => x?.title).map(x => P.pbKey(x.title, x.vaultSource)));
        const leftOut = new Map();
        if (trace) for (const g of P.outGroups({ categorized: categorizeRejections(trace, sentKeys), folderRemoved: trace.folderFilterRemoved || [], injectedKeys: sentKeys })) for (const x of g.entries) leftOut.set(P.pbKey(x.title, x.vaultSource), `${g.label}: ${x.reason}`);
        let temps = new Map();
        try { temps = computeEntryTemperatures(); } catch { /* no temperatures, no tint */ }
        const rowsBox = h('div', 'dle-lv-rows');
        rowsBox.setAttribute('role', 'list');
        const { shown: page, more } = P.capRows(ds.browseRowModel || [], S.limit);
        let one = null;
        for (const r of page) {
            if (r.type === 'header') { rowsBox.append(groupHead(r, selectMode, selected)); continue; }
            const e = r.entry;
            const k = 'all|' + entryKey(e), trk = trackerKey(e);
            const on = selected.has(trk);
            const ck = `<span class="dle-lv-ck${on ? ' on' : ''}" aria-hidden="true">${on ? '✓' : ''}</span>`;
            const end = [];
            const tip = (el, t) => { el.title = t; end.push(el); };
            if (P.isIn(pins, e.title, e.vaultSource)) tip(h('span', 'dle-lv-state', I('pinI')), 'Pinned in this chat');
            if (P.isIn(blocks, e.title, e.vaultSource)) tip(h('span', 'dle-lv-state bad', I('block')), 'Blocked in this chat');
            if (e.guide) end.push(pill('secret for Mero ☆', 'g', 'A secret for Mero ☆: she reads it in her talks and pitches — never sent to the writing AI'));
            const origin = P.originOf(e);
            if (origin) end.push(pill(origin, '', 'Origin: where it came from'));
            const ek = entryKey(e);
            if (sentKeys.has(ek)) tip(h('span', 'dle-lv-state good', I('check')), 'Sent with the last reply');
            else if (leftOut.has(ek)) tip(h('span', 'dle-lv-state quiet', I('why')), `Left out of the last reply. ${leftOut.get(ek)}`);
            const n = chatInjectionCounts.get(trk) || 0, temp = temps.get(trk)?.hue;
            if (n) tip(h('span', `dle-lv-tok${temp === 'hot' || temp === 'cold' ? ' ' + temp : ''}`, `${n}×`), `Sent ${n} times in this chat${temp === 'hot' ? ', more often than most entries' : temp === 'cold' ? ', less often than most entries' : ''}`);
            tip(h('span', 'dle-lv-prio', e.constant ? 'always' : `P${e.priority ?? 50}`), e.constant ? 'Always goes in' : `Priority ${e.priority ?? 50} (lower = more important)`);
            const keys = e.constant ? '' : (e.keys || []).slice(0, 4).join(', ');
            const sub = [keys, !ds.browseFolderGrouping && e.folderPath ? `${e.folderPath}/` : ''].filter(Boolean).join(' · ');
            const row = entryRow({
                k, lead: selectMode ? ck : P.leadFor(e), title: e.title, sub, end,
                why: [e.summary, e.keys?.length ? `Keys: ${e.keys.join(', ')}` : '', e.tokenEstimate ? `${e.tokenEstimate} tokens` : ''].filter(Boolean).join('\n\n'),
                onPick: selectMode
                    ? () => { if (selected.has(trk)) selected.delete(trk); else selected.add(trk); refreshBrowse(); }
                    : () => { S.sel = S.sel === k ? null : k; draw(); },
            });
            if (selectMode) { row.setAttribute('aria-pressed', String(on)); row.classList.toggle('sel', on); }
            rowsBox.append(row);
            if (!selectMode && S.sel === k) {
                one = e;
                rowsBox.append(entryExpand(e));
            }
        }
        body.append(rowsBox);
        if (more) {
            const m = K.button({ kind: 'quiet', label: `Show ${Math.min(more, PAGE)} more (${more.toLocaleString()} left)`, onClick: () => { S.limit += PAGE; draw(); } });
            m.classList.add('dle-lv-more');
            body.append(m);
        }
        if (selectMode && selected.size) {
            const list = [...selected].map(t => vaultIndex.find(e => trackerKey(e) === t)).filter(Boolean);
            const targets = list.map(e => ({ title: e.title, vaultSource: e.vaultSource || null }));
            body.append(selbar(`${selected.size} selected`, [...pinButtons(targets), moveB(list), optimizeB([...selected]), summariesB(list)]));
        } else if (one) {
            body.append(selbar(one.title, [...pinButtons([{ title: one.title, vaultSource: one.vaultSource || null }]), moveB([one]), optimizeB([trackerKey(one)]), obsidianB(one)]));
        }
    }
    function entryExpand(e) {
        const x = h('div', 'dle-lv-expand');
        const p = preview(e); if (p) x.append(p);
        const fl = fieldsLine(e); if (fl) x.append(fl);
        x.append(mini([e.folderPath ? `${e.folderPath}/` : 'vault root', e.tokenEstimate ? `${e.tokenEstimate} tokens` : '', e.keys?.length ? `keys: ${e.keys.join(', ')}` : ''].filter(Boolean).join(' · ')));
        const rel = relatedChips(e); if (rel) x.append(rel);
        return x;
    }
    function groupHead(r, selectMode, selected) {
        const f = r.folder, cut = f.lastIndexOf('/');
        const g = h('div', 'dle-lv-grp' + (r.expanded ? ' open' : ''));
        g.setAttribute('role', 'button'); g.tabIndex = 0; g.setAttribute('aria-expanded', String(r.expanded));
        g.title = f;
        let ck = '';
        if (selectMode) {
            const inF = (ds.browseFilteredEntries || []).filter(e => topFolderOf(e) === f).map(trackerKey);
            const n = inF.filter(k => selected.has(k)).length;
            ck = `<span class="dle-lv-ck${n && n === inF.length ? ' on' : n ? ' part' : ''}" data-all title="Select every entry in this folder">${n && n === inF.length ? '✓' : n ? '–' : ''}</span>`;
            g.dataset.keys = JSON.stringify(inF);
        }
        g.innerHTML = `${ck}${I('chev', 'dle-lv-gchev')}<span class="dle-lv-gname">📁 ${cut > 0 ? `<span class="dle-lv-ctx">${esc(f.slice(0, cut))}/</span>` : ''}${esc(cut > 0 ? f.slice(cut + 1) : f)}</span><span class="dk-n">${r.count}</span>`;
        const toggle = () => {
            if (!(ds.browseExpandedFolders instanceof Set)) ds.browseExpandedFolders = new Set();
            if (ds.browseExpandedFolders.has(f)) ds.browseExpandedFolders.delete(f); else ds.browseExpandedFolders.add(f);
            refreshBrowse();
        };
        g.addEventListener('click', ev => {
            if (ev.target.closest('[data-all]')) {
                const keys = JSON.parse(g.dataset.keys || '[]');
                const all = keys.length && keys.every(k => selected.has(k));
                for (const k of keys) { if (all) selected.delete(k); else selected.add(k); }
                refreshBrowse(); return;
            }
            toggle();
        });
        g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
        return g;
    }

    // ── New (her inbox, 2026-08-03) ──
    function drawInbox(ib) {
        if (!ib) { S.view = 'all'; drawAll(); return; }
        const note = h('div', 'dle-lv-mini dle-lv-note', `New entries land in <b>${esc(ib.folder)}/</b>.`);
        note.title = 'Move each one into the folder it belongs in';
        body.append(note);
        const list = vaultIndex.filter(e => (e.folderPath || '') === ib.folder || (e.folderPath || '').startsWith(ib.folder + '/'))
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
        if (!list.length) { body.append(h('p', 'dle-lv-empty', 'Nothing new since you last looked.')); return; }
        const { shown, more } = P.capRows(list, S.limit);
        const rows = h('div', 'dle-lv-rows');
        let one = null;
        for (const e of shown) {
            const k = 'inbox|' + entryKey(e);
            const sub = (e.folderPath || '') !== ib.folder ? e.folderPath.slice(ib.folder.length + 1) + '/' : (e.keys || []).slice(0, 4).join(', ');
            const mv = K.button({ icon: 'folder', kind: 'quiet', label: 'Move…', title: 'Move to another folder', onClick: async () => { await moveEntryFlow(e); later(); } });
            rows.append(entryRow({ k, lead: P.leadFor(e), title: e.title, sub, end: mv }));
            if (S.sel === k) { one = e; rows.append(entryExpand(e)); }
        }
        body.append(rows);
        if (more) body.append(K.button({ kind: 'quiet', label: `Show ${Math.min(more, PAGE)} more (${more} left)`, onClick: () => { S.limit += PAGE; draw(); } }));
        if (one) body.append(selbar(one.title, [...pinButtons([{ title: one.title, vaultSource: one.vaultSource || null }]), moveB([one]), optimizeB([trackerKey(one)]), obsidianB(one)]));
    }

    // ── keys: `/` jumps to the search (All entries) ──
    panel.addEventListener('keydown', e => {
        if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey || root.hidden) return;
        if (e.target.matches?.('input, textarea, select, [contenteditable], [contenteditable] *')) return;
        e.preventDefault(); e.stopPropagation();
        if (S.view !== 'all') go('all');
        requestAnimationFrame(() => input.focus());
    });

    // ── keep in step ──
    for (const p of [injP, browseP]) new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => { if (panel.classList.contains('openDrawer')) later(); }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    const inboxBtn = panel.querySelector('.dle-browse-inbox-btn');
    if (inboxBtn) new MutationObserver(later).observe(inboxBtn, { attributes: true, attributeFilter: ['data-inbox-folder', 'style'] });
    // Sent follows the swipe on screen (2026-11-06)
    try { const onSwipe = () => later(); eventSource.on(event_types.MESSAGE_SWIPED, onSwipe); offs.push(() => eventSource.removeListener(event_types.MESSAGE_SWIPED, onSwipe)); } catch { /* no swipe events: Sent redraws on the next reply */ }
    for (const on of [onIndexUpdated, onPipelineComplete, onInjectionSourcesReady, onPinBlockChanged, onGenerationLockChanged, onIndexingChanged, onChatInjectionCountsUpdated, onFieldDefinitionsUpdated, onVerdictChanged]) {
        try { offs.push(on(() => later())); } catch { /* an observer that is not there just means one less reason to redraw */ }
    }
    // ⋯ → Optimize keywords (overhaul bug hunt 2026-10-16): the tool works on entries you pick, so it opens
    // All entries in Select mode; the bar under the picked ones has Optimize keywords
    panel.__dleLorePick = text => {
        panel.querySelector('#dle-tab-injection')?.click();
        ds.browseSelectMode = true;
        if (!(ds.browseSelected instanceof Set)) ds.browseSelected = new Set();
        go('all');
        if (text) K.notify({ text });
    };
    // a remembered "Both" (let go, 2026-10-15) becomes Sent
    if (ds.whyTabFilter === 'both') { ds.whyTabFilter = 'injected'; store.set('dle-why-filter', 'injected'); }
    sync();
    setTimeout(later, 0);   // the drawer's first renders run after this; draw once more with their data
}
