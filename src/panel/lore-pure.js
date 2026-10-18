/**
 * Overhaul — the Lore tab's rules, kept apart from the page so they can be tested (test/lore-view.test.mjs).
 * No SillyTavern, no DOM, no jQuery in here: the view (lore-view.js) hands in plain data and draws what comes back.
 *
 *   howSure · whyOf · leadFor · originOf         — what a row says (how-sure bars, the reason, the icon, the label)
 *   funnelOf · outGroups · timerRows             — Sent's funnel line, Left out's reason folds, the Timers fold
 *   relatedTitles · fieldValues                  — Related entries; the values your own fields have
 *   filterSummary · folderLabel · STATUS · SORTS — the filter chips' words and how many filters are on
 *   folderRows · countByFolder                   — the "Browse any folder" picker
 *   togglePinBlock · isIn · pbKey                — pins and blocks for this chat (one or several entries)
 *   capRows                                      — long lists drawn a page at a time
 */

const low = s => String(s ?? '').toLowerCase();
/** trackerKey-shaped, lower-cased: how today's code compares pins, blocks and verdict rows. */
export const pbKey = (title, vaultSource) => `${vaultSource || ''}:${low(title)}`;
/** A pin/block as stored (legacy bare strings or { title, vaultSource }) → { title, vaultSource }. */
export const normalPB = p => (typeof p === 'string' ? { title: p, vaultSource: null } : { title: String(p?.title ?? ''), vaultSource: p?.vaultSource || null });

// ── what a Sent row says ─────────────────────────────────────────────────────

const SURE_WORD = ['', 'unsure', 'likely', 'sure'];

/** How a source got in: constant · pinned · bootstrap · seed · keyword · keyword_ai · ai · unknown (mirrors helpers.parseMatchReason). */
export function matchType(matchedBy) {
    if (!matchedBy) return { type: 'unknown', keyword: null };
    const m = low(matchedBy);
    if (m.includes('constant') || m.includes('always')) return { type: 'constant', keyword: null };
    if (m.includes('pin')) return { type: 'pinned', keyword: null };
    if (m.includes('bootstrap')) return { type: 'bootstrap', keyword: null };
    if (m.includes('seed')) return { type: 'seed', keyword: null };
    if (matchedBy.includes('→')) return { type: 'keyword_ai', keyword: matchedBy.split('→')[0].trim() };
    if (m.startsWith('ai:') || m === 'ai selection' || m === 'ai') return { type: 'ai', keyword: null };
    if (matchedBy.trim()) return { type: 'keyword', keyword: matchedBy.trim() };
    return { type: 'unknown', keyword: null };
}

/** AI confidence ('high' | 'medium' | 'low' | 0..1) → 1..3, or 0 when there is none. */
function confLevel(c) {
    if (c == null || c === '') return 0;
    if (typeof c === 'number') return c >= 0.75 ? 3 : c >= 0.45 ? 2 : 1;
    const v = low(c);
    return v === 'high' ? 3 : v === 'medium' ? 2 : v === 'low' ? 1 : 0;
}

/**
 * How sure DeepLore is that a sent entry belongs: 3 sure · 2 likely · 1 unsure · 0 (nothing to say).
 * The AI's own confidence wins when it picked the entry; a key, a pin or "always" is sure.
 * @param {{matchedBy?: string}} source  @param {{confidence?: any}|null} aiPick  the trace's aiSelected row
 */
export function howSure(source, aiPick = null) {
    const t = matchType(source?.matchedBy).type;
    let level = confLevel(aiPick?.confidence);
    if (!level && ['constant', 'pinned', 'bootstrap', 'seed', 'keyword'].includes(t)) level = 3;
    if (!level && (t === 'keyword_ai' || t === 'ai') && aiPick) level = 2;
    return { level, word: SURE_WORD[level] };
}

/** The reason, short (for the row's second line) and long (for "Why: …" and the tooltip). */
export function whyOf(source, aiPick = null) {
    const { type, keyword } = matchType(source?.matchedBy);
    const r = String(aiPick?.reason || '').trim();
    const ai = r ? ` ${r.charAt(0).toUpperCase()}${r.slice(1).replace(/[.\s]+$/, '')}.` : '';
    switch (type) {
        case 'constant': return { short: 'always', long: 'It is set to always go in.' };
        case 'pinned': return { short: 'pinned', long: 'You pinned it for this chat.' };
        case 'bootstrap': return { short: 'start of chat', long: 'It goes in while a chat is just starting.' };
        case 'seed': return { short: 'seed', long: 'A seed entry: it goes in at the start to set the scene.' };
        case 'keyword': return { short: `matched “${keyword}”`, long: `Its key “${keyword}” came up in the chat.` };
        case 'keyword_ai': return { short: 'key › AI', long: `The key “${keyword}” matched, and the AI kept it.${ai}` };
        case 'ai': return { short: 'AI pick', long: `No key matched. The AI picked it.${ai}` };
        default: return { short: '', long: source?.matchedBy ? `Matched by ${source.matchedBy}.` : 'No reason was recorded.' };
    }
}

/** The row's lead emoji: writing guide 🧭, character 🎭, place 📍, everything else 📄. */
export function leadFor(entry) {
    if (!entry) return '📄';
    if (entry.guide) return '🧭';
    const kind = low(entry.customFields?.type ?? entry.customFields?.kind ?? '');
    const tags = (entry.tags || []).map(low);
    const has = (...w) => w.some(x => kind === x || tags.includes(x));
    if (has('character', 'characters', 'person', 'npc')) return '🎭';
    if (has('location', 'locations', 'place', 'places')) return '📍';
    return '📄';
}

/** Her "Origin" label (2026-08-03): the entry's character · instance fields, when it has them. */
export function originOf(entry) {
    return [entry?.customFields?.character, entry?.customFields?.instance]
        .map(v => (Array.isArray(v) ? v[0] : v))
        .filter(v => v != null && v !== '')
        .join(' · ');
}

// ── Sent's funnel line ───────────────────────────────────────────────────────

/** { matched, picked (null in keywords-only), sent, msg (#N or null), added, removed } — null without a trace. */
export function funnelOf(trace, sentCount, diff = null, msgIdx = -1) {
    if (!trace) return null;
    return {
        matched: trace.keywordMatched?.length ?? 0,
        picked: trace.mode === 'keywords-only' ? null : (trace.aiSelected?.length ?? 0),
        sent: trace.injected?.length ?? sentCount,
        msg: typeof msgIdx === 'number' && msgIdx >= 0 ? msgIdx : null,
        added: diff?.added?.length ?? 0,
        removed: diff?.removed?.length ?? 0,
    };
}

// ── Left out: one fold per reason ────────────────────────────────────────────

/** Plain words for today's rejection stages, in pipeline order. */
export const OUT_STAGES = [
    ['blocked', 'Blocked by you', 'You blocked it in this chat.'],
    ['folder', 'Not this chat’s folders', 'Its folder is not one of this chat’s folders.'],
    ['ai_rejected', 'The AI passed', 'A key matched, but the AI did not pick it.'],
    ['refine_key_blocked', 'Missing a second key', ''],
    ['contextual_gating', 'Not this scene', ''],
    ['cooldown', 'Resting', ''],
    ['gated_out', 'Needs another entry', ''],
    ['strip_dedup', 'Already in the chat', ''],
    ['budget_cut', 'Over budget', ''],
    ['probability_skipped', 'Left to chance', 'Its chance roll did not come up this time.'],
    ['warmup_failed', 'Not warmed up', 'Its keys have not come up often enough yet.'],
];

/**
 * Left out, grouped by reason. `categorized` = helpers.categorizeRejections(trace, injectedKeys);
 * `folderRemoved` = trace.folderFilterRemoved; `blocks` = this chat's blocks. An entry shows under one reason only
 * (the first in pipeline order), and nothing that was sent shows at all.
 * → [{ stage, label, entries: [{ title, vaultSource, reason }] }]
 */
export function outGroups({ categorized = [], folderRemoved = [], blocks = [], injectedKeys = new Set() } = {}) {
    const seen = new Set(injectedKeys);
    const byStage = new Map();
    const add = (stage, e, reason) => {
        const k = pbKey(e.title, e.vaultSource);
        if (!e.title || seen.has(k)) return;
        seen.add(k);
        if (!byStage.has(stage)) byStage.set(stage, []);
        byStage.get(stage).push({ title: e.title, vaultSource: e.vaultSource || '', reason });
    };
    const plain = Object.fromEntries(OUT_STAGES.map(([s, , r]) => [s, r]));
    for (const b of blocks.map(normalPB)) add('blocked', b, plain.blocked);
    const cats = new Map(categorized.map(g => [g.stage, g]));
    for (const [stage] of OUT_STAGES) {
        if (stage === 'blocked') continue;
        if (stage === 'folder') { for (const e of folderRemoved) add('folder', e, plain.folder); continue; }
        const g = cats.get(stage);
        for (const e of g?.entries || []) add(stage, e, plainReason(stage, e.reason) || plain[stage]);
    }
    // a stage today's code may add later still shows, under its own label
    const labels = new Map();
    for (const g of categorized) {
        if (OUT_STAGES.some(([st]) => st === g.stage)) continue;
        labels.set(g.stage, g.label || String(g.stage));
        for (const e of g.entries || []) add(g.stage, e, e.reason);
    }
    const out = [];
    for (const [stage, label] of OUT_STAGES) if (byStage.has(stage)) out.push({ stage, label, entries: byStage.get(stage) });
    for (const [stage, label] of labels) if (byStage.has(stage)) out.push({ stage, label, entries: byStage.get(stage) });
    return out;
}

/** Today's reason strings, said plainly. Unknown wording passes through. */
function plainReason(stage, r) {
    const s = String(r || '');
    if (stage === 'budget_cut') { const m = s.match(/(\d+)\s*tok/); return m ? `Over budget: it needs ${m[1]} tokens.` : 'There was no room left in the budget.'; }
    if (stage === 'gated_out') return s.replace(/^needs:/, 'Needs').replace(/blocked by:/, 'kept out by') + (s ? '.' : '');
    if (stage === 'cooldown') return /cooldown/i.test(s) || !s ? 'It is resting for a few replies after going in.' : s;
    if (stage === 'strip_dedup') return 'It is already in the recent chat.';
    if (stage === 'ai_rejected') return 'A key matched, but the AI did not pick it.';
    if (stage === 'contextual_gating') return s && !/^Filtered by/.test(s) ? s : 'It does not fit this scene’s era, place or characters.';
    return s;
}

// ── Timers ───────────────────────────────────────────────────────────────────

const nameOf = key => (key.includes(':') ? key.split(':').slice(1).join(':') : key);
const replies = n => `${n} ${n === 1 ? 'reply' : 'replies'}`;

/** Today's Entry Timers: cooldowns, and (with decay on) entries gone stale. → [{ name, text, kind }] */
export function timerRows(cooldown, decay, { decayEnabled = false, threshold = 5 } = {}) {
    const rows = [];
    for (const [key, n] of cooldown || []) rows.push({ name: nameOf(key), text: `rests for ${n} more ${n === 1 ? 'reply' : 'replies'}`, kind: 'cooldown' });
    if (decayEnabled) for (const [key, n] of decay || []) if (n >= threshold) rows.push({ name: nameOf(key), text: `not sent for ${replies(n)}`, kind: 'stale' });
    return rows;
}

// ── Related entries (today's rule: its links first, then entries sharing a key) ──

export function relatedTitles(entry, index, max = 5) {
    const out = [];
    for (const l of entry?.resolvedLinks || []) if (!out.includes(l) && l !== entry.title) out.push(l);
    if (out.length < max) {
        const keys = new Set((entry?.keys || []).map(low));
        if (keys.size) for (const o of index || []) {
            if (out.length >= max) break;
            if (o.title === entry.title || out.includes(o.title)) continue;
            if ((o.keys || []).some(k => keys.has(low(k)))) out.push(o.title);
        }
    }
    return out.slice(0, max);
}

// ── your own fields ──────────────────────────────────────────────────────────

/** The values each filterable field has across the vault (only fields that have any). → [{ name, label, values }] */
export function fieldValues(entries, defs) {
    const out = [];
    for (const fd of defs || []) {
        const vals = new Set();
        for (const e of entries || []) {
            const v = e.customFields?.[fd.name];
            if (v == null) continue;
            if (Array.isArray(v)) v.forEach(x => { if (x !== '' && x != null) vals.add(String(x)); });
            else if (v !== '') vals.add(String(v));
        }
        if (vals.size) out.push({ name: fd.name, label: fd.label || fd.name, values: [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) });
    }
    return out;
}

// ── the filter chips ─────────────────────────────────────────────────────────

export const STATUS = [
    ['all', 'Any status'], ['injected', 'Sent with the last reply'], ['pinned', 'Pinned'], ['blocked', 'Blocked'],
    ['constant', 'Always in'], ['seed', 'Seed'], ['bootstrap', 'Start of chat'], ['never_injected', 'Never sent, in any chat'],
];
export const SORTS = [
    ['alpha_asc', 'A to Z'], ['alpha_desc', 'Z to A'], ['priority_asc', 'priority'], ['priority_desc', 'priority, reversed'],
    ['tokens_desc', 'longest first'], ['tokens_asc', 'shortest first'], ['injections_desc', 'most sent in this chat'],
];
export const statusWord = v => (STATUS.find(([k]) => k === v) || STATUS[0])[1];
export const sortWord = v => (SORTS.find(([k]) => k === v) || [, 'priority'])[1];

/** The Folders chip: this chat's · any folder · the folder's own name. */
export function folderLabel(filter, inboxFolder = '') {
    if (filter === '__chat__') return 'this chat’s';
    if (!filter) return 'any folder';
    if (inboxFolder && filter === inboxFolder) return 'New';
    return filter.slice(filter.lastIndexOf('/') + 1);
}

/**
 * How many filters narrow the list (for "Filters (N on)" on a phone). "This chat's folders" is the normal view, so it
 * does not count; a search does not count (it is visible in its own box).
 */
export function filterSummary({ folder = '', status = 'all', tag = '', fields = {}, quick = null } = {}) {
    let on = 0;
    if (folder && folder !== '__chat__') on++;
    if (status && status !== 'all') on++;
    if (tag) on++;
    on += Object.values(fields || {}).filter(Boolean).length;
    if (quick) on++;
    return { on, text: on ? `Filters (${on} on)` : 'Filters' };
}

// ── the folder picker ────────────────────────────────────────────────────────

/** Entries per folder, counting each parent too ("Kitchen" counts "Kitchen/Run A"). */
export function countByFolder(entries) {
    const n = new Map();
    for (const e of entries || []) {
        if (!e.folderPath) continue;
        const parts = e.folderPath.split('/');
        for (let i = 1; i <= parts.length; i++) { const f = parts.slice(0, i).join('/'); n.set(f, (n.get(f) || 0) + 1); }
    }
    return n;
}

/**
 * The folder picker's list: this chat's folders first (starred), then every folder, empty ones included.
 * A search matches the folder's own name (her rule for the Move picker: "corvin" means folders named after him).
 * → [{ heading } | { folder, leaf, parent, count, star, depth }]
 */
export function folderRows(folders, counts, chatFolders = [], query = '') {
    const q = low(query).trim();
    const isChat = f => chatFolders.some(c => f === c || f.startsWith(c + '/'));
    const all = [...new Set(folders || [])].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const mk = (f, star) => {
        const cut = f.lastIndexOf('/');
        return { folder: f, leaf: f.slice(cut + 1), parent: cut > 0 ? f.slice(0, cut) : '', count: counts?.get?.(f) ?? 0, star, depth: f.split('/').length - 1 };
    };
    const hit = f => !q || low(f.slice(f.lastIndexOf('/') + 1)).includes(q);
    const starred = all.filter(f => isChat(f) && hit(f)).map(f => mk(f, true));
    const rest = all.filter(f => !isChat(f) && hit(f)).map(f => mk(f, false));
    const out = [];
    if (starred.length) out.push({ heading: 'This chat’s folders' }, ...starred);
    if (rest.length) out.push({ heading: starred.length ? 'All folders' : 'Folders' }, ...rest);
    return out;
}

// ── pins and blocks ──────────────────────────────────────────────────────────

export const isIn = (list, title, vaultSource) => (list || []).some(p => { const n = normalPB(p); return pbKey(n.title, n.vaultSource) === pbKey(title, vaultSource); });

/**
 * Pin or block one or more entries, or take them off (today's rules: a pin and a block exclude each other; entries
 * are stored as { title, vaultSource }). `on` undefined = toggle by the first entry.
 * → { pins, blocks, on } (new arrays; the inputs are not changed).
 */
export function togglePinBlock({ pins = [], blocks = [] }, kind, targets, on) {
    const list = Array.isArray(targets) ? targets : [targets];
    const mine = kind === 'pin' ? pins : blocks, other = kind === 'pin' ? blocks : pins;
    const want = on ?? !isIn(mine, list[0]?.title, list[0]?.vaultSource);
    const keys = new Set(list.map(t => pbKey(t.title, t.vaultSource)));
    const keep = arr => arr.filter(p => { const n = normalPB(p); return !keys.has(pbKey(n.title, n.vaultSource)); });
    let nextMine = keep(mine);
    if (want) nextMine = [...nextMine, ...list.map(t => ({ title: t.title, vaultSource: t.vaultSource || null }))];
    const nextOther = want ? keep(other) : [...other];
    return kind === 'pin' ? { pins: nextMine, blocks: nextOther, on: want } : { pins: nextOther, blocks: nextMine, on: want };
}

// ── long lists ───────────────────────────────────────────────────────────────

/** The first `limit` rows and how many are left (a "Show more" button draws the next page). */
export function capRows(rows, limit) {
    const list = rows || [];
    return { shown: list.slice(0, limit), more: Math.max(0, list.length - limit) };
}
