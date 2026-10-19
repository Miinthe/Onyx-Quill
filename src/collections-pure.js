/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — collections and the purse in play (storyboard stage 3, round 2).
 * Pure rules on the v2 board and chat state (board-model-pure.js); tested in test/collections.test.mjs.
 * Design: `8 storyboard design.md` §12 (what the writer gets) and `6 merge roadmap.md` §4 G+.
 *
 * A COLLECTION is a set of things with states: clues (hidden → uncovered → lost), suspects
 * (unknown → suspected → cleared / guilty), an inventory (not yet → have → used up / lost,
 * with amounts) — and a PURSE (money) that items can cost from.
 *
 * RULES
 *  - The helper watches every running collection like a tracker: it reports an item's new state
 *    (and for an inventory the amount held), or money gained / spent, only when the newest
 *    messages PLAINLY say so, with a word-for-word quote. Checked like moves:
 *      the quote must be in the messages; the item, the state and the collection must exist;
 *      an item whose lines ("only possible once …") don't hold stays as it is;
 *      an item with a cost can only be had if the purse can pay — and then the purse pays;
 *      money never goes below 0; a change Miinthe undid is not re-applied from the same line.
 *  - Every change is logged by message (`state.log`), so a delete rolls it back and each
 *    notice has an Undo.
 *  - The FIRST state means "not part of the story yet": such items are never named to the
 *    writer or the judge (a hidden clue stays hidden), and entries linked on them don't exist.
 *  - The writer gets "ITEM: Rusty Key (Content: …)" per kept item and "MONEY: $3" (§12).
 *  - COLLECTIONS THAT GROW (Miinthe's rusty key; design v46 #3): a collection switched to "the story
 *    can add new items" lets the helper report a thing that isn't on the list ("new": true, with a
 *    short name and what the story says about it). "Ask me first" (the default) parks it in the
 *    collection's `pending` list until Miinthe says Keep it / Not worth keeping; "add on their own"
 *    keeps it at once. Keeping adds the item to the board (shared by every chat of the board),
 *    with an entry: an entry of that name already in the vault is linked instead of a new one
 *    (Auto Lorebook's repeat entries — Miinthe, 2026-10-04); an item of that name already on the list
 *    gets +1 (or its state) instead of a copy. "Not worth keeping" remembers the name for this chat
 *    (`refused`), so the helper isn't asked about it again. The ⚖️ "what's worth keeping" judge
 *    entry (the collection's `keep` entries) is the helper's rule for what to report.
 *    Without the switch, a new thing is reported and left alone.
 */
import { trackerOf, itemOf, itemState, itemAmount, purseValue, runOf, holds, condText, certain, uniqueId, capLog } from './board-model-pure.js';
import { findQuoteMatch, normalizeForMatch } from './quote-match-pure.js';
import { revertState } from './state-pure.js';   // round 4: state and dates share the log
import { revertMeter } from './meters-pure.js';   // meters (2026-10-12) share the log too
import { revertCast } from './cast-pure.js';   // the Cast (2026-10-13) shares it as well
import { findingNow, isFindItem } from './rolls-pure.js';   // items to find (triggers + odds, part 2)

const low = s => String(s ?? '').trim().toLowerCase();
const arr = v => (Array.isArray(v) ? v : []);

export const collectionsOf = board => arr(board?.trackers).filter(t => t.kind === 'collection');
/** Running in this chat (not paused, not abandoned). */
export const runningCollections = (board, st) => collectionsOf(board).filter(t => runOf(st, t) == null);

const stateLabel = (col, id) => col.states.find(s => s.id === id)?.label ?? id;
const fmtMoney = (p, v) => (p.before ? `${p.unit}${v}` : `${v} ${p.unit}`);
const isInventory = col => col.amounts === true || arr(col.purse).length > 0;
/** The word the writer sees before each kept item: the collection's own, else ITEM for an inventory, else its name. */
export const writerLabelOf = col => (col.writerLabel || (isInventory(col) ? 'ITEM' : col.name)).toUpperCase();

// ── what the helper is told ─────────────────────────────────────────────────

/** A collection's ⚖️ "what's worth keeping" entries (the judge kind on its `keep`). */
const keepJudges = col => arr(col.keep?.entries).filter(t => (col.keep?.kinds || {})[t] === 'judge');
const pendingOf = (st, col) => arr(st?.collections?.[col.id]?.pending);
const refusedOf = (st, col) => arr(st?.collections?.[col.id]?.refused);
/** A new item's name as the helper gave it, tidied (no quotes around it, one line, not too long). */
export const cleanFindName = v => String(v ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim().slice(0, 60);

/**
 * The COLLECTIONS part of the helper's message (empty when there are none running).
 * `judgeText(title)` returns an entry's text — for a growing collection's "what's worth keeping".
 */
export function helperSection(board, st, { judgeText = null } = {}) {
    const cols = runningCollections(board, st);
    if (!cols.length) return '';
    const lines = ['', 'COLLECTIONS (things the story keeps track of — report "items" / "money" changes)'];
    for (const col of cols) {
        const states = col.states.map(s => `"${s.label}"`).join(', ');
        const money = arr(col.purse).map(p => `money ${fmtMoney(p, purseValue(st, col, p.id))}`).join(', ');
        lines.push(`- ${col.name} — states in order: ${states}${col.amounts ? '; counts how many' : ''}${money ? `; ${money}` : ''}`);
        // an item the board offers somewhere (a find line) is always listed — hiding it made the helper report the glue
        // as the only item it could see (live check, 2026-10-04) — and marked whether it is there to be found now
        const items = col.items.map(it => {
            const sid = itemState(st, col, it.id), n = itemAmount(st, col, it.id);
            const cost = it.cost?.purse ? `, costs ${fmtMoney(arr(col.purse).find(p => p.id === it.cost.purse) || { unit: '', before: true }, it.cost.amount)}` : '';
            const here = !isFindItem(it) || sid !== col.states[0].id ? ''
                : findingNow(board, st, col, it).length ? ', there to be found here — only if the story plainly picks it up' : ', not here — cannot be taken now';
            return `"${it.name}" (${stateLabel(col, sid)}${col.amounts && n ? ` ×${n}` : ''}${cost}${here})`;
        });
        lines.push(`  Items: ${items.join(', ') || '(none yet)'}`);
        if (col.grows) {
            const rule = judgeText ? keepJudges(col).map(t => String(judgeText(t) || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, 800) : '';
            lines.push(`  This collection takes NEW items: a thing the story plainly adds to it that is not listed — report it with "new": true. Worth keeping: ${rule || 'only what the story plainly keeps (taken, pocketed, given, found and kept) — not things merely seen or mentioned.'}`);
            const asked = pendingOf(st, col).map(p => `"${p.name}"`), no = refusedOf(st, col).map(n => `"${n}"`);
            if (asked.length || no.length) lines.push(`  Do not report again: ${[...asked, ...no].join(', ')}.`);
        }
    }
    return lines.join('\n');
}

export const HELPER_RULES = `- COLLECTIONS: report an item's new state in "items" — {"collection", "item", "state", "amount" (inventories only: how many are held now, or null), "quote", "reason", "confidence"} — only when the newest messages plainly show it (a clue is plainly found, an item plainly kept, used up or lost, a suspect plainly suspected or cleared). Use only listed items, states and collections, spelled exactly. Report money gained or spent in "money" — {"collection", "change" (a number: +5 gained, -3 spent), "quote", "reason", "confidence"}. Buying a listed item that has a cost: report only the item; its cost is paid by itself. The quote must name the item itself — never report a different listed item for something the story calls by another name. A collection that takes NEW items: report a thing the story plainly adds to it that isn't listed with "new": true, a short name for it in "item" (1–3 words, like an entry title: "Brass key", not "small brass key with a green ribbon"), the state it is in now, and "about" (one or two sentences describing the thing itself — what it is, what it looks like — from the story only, invent nothing; why you report it goes in "reason").`;

/** JSON-schema parts for the helper's answer (added next to "changes"). */
export const HELPER_SCHEMA_PARTS = {
    items: { type: 'array', items: { type: 'object', properties: {
        collection: { type: 'string' }, item: { type: 'string' }, state: { type: 'string' }, amount: { type: ['number', 'null'] },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        new: { type: 'boolean' }, about: { type: 'string' },
    }, required: ['collection', 'item', 'state', 'quote', 'reason', 'confidence'] } },
    money: { type: 'array', items: { type: 'object', properties: {
        collection: { type: 'string' }, change: { type: 'number' },
        quote: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['collection', 'change', 'quote', 'reason', 'confidence'] } },
};

// ── checking what the helper reported ───────────────────────────────────────

const conf = c => (['high', 'medium', 'low'].includes(low(c)) ? low(c) : null);
const reasonOf = c => String(c?.reason ?? '').trim().slice(0, 300) || null;
const sameText = (a, b) => normalizeForMatch(a) === normalizeForMatch(b);

/**
 * Turn the helper's `items` and `money` into changes that are safe to apply.
 * @returns {{ changes: Array, rejected: Array<{what, reason}> }}
 *   a change: { kind: 'item', col, item, from: {state, amount}, to: {state, amount}, pay?: {purse, amount}, quote, reason, confidence, msgIdx }
 *          or { kind: 'money', col, purse, from, to, quote, … }
 *          or { kind: 'find', col, name, to: {state, amount}, about, ask, at, quote, … } — a new thing for a growing collection
 */
export function validateCollectionChanges(items, money, board, st, messages) {
    const rejected = [], best = new Map();   // key → change (newest line wins)
    const cols = runningCollections(board, st);
    const findCol = name => cols.find(c => low(c.name) === low(name));
    const lastLogged = key => Math.max(-1, ...arr(st?.log).filter(e => e.key === key).map(e => e.i));
    const take = (key, ch, what) => {
        const prev = best.get(key);
        if (prev && prev.msgIdx > ch.msgIdx) { rejected.push({ what, reason: 'an older line than another change for it' }); return; }
        best.set(key, ch);
    };
    const quoteAt = (raw, what, key) => {
        const quote = String(raw?.quote ?? '').trim();
        const msgIdx = findQuoteMatch(quote, messages);
        if (msgIdx === -1) { rejected.push({ what, reason: 'quote not found in the messages' }); return null; }
        const at = messages[msgIdx]?._i;
        if (Number.isFinite(at) && at <= lastLogged(key)) { rejected.push({ what, reason: 'older than its last change' }); return null; }
        return { quote, msgIdx };
    };

    for (const c of arr(items)) {
        const what = `${c?.collection ?? '?'}: ${c?.item ?? '?'}`;
        const col = findCol(c?.collection);
        if (!col) { rejected.push({ what, reason: 'no running collection by that name' }); continue; }
        const it = col.items.find(x => low(x.name) === low(c?.item));
        if (!it && col.grows) {
            // collections that grow: a new thing, unless Miinthe already said no, or was already asked
            const name = cleanFindName(c?.item);
            if (!name) { rejected.push({ what, reason: 'no name' }); continue; }
            if (refusedOf(st, col).some(n => low(n) === low(name))) { rejected.push({ what, reason: 'not wanted' }); continue; }
            if (pendingOf(st, col).some(p => low(p.name) === low(name))) { rejected.push({ what, reason: 'already asked' }); continue; }
            const stt = col.states.find(x => x.id !== col.states[0].id && (low(x.label) === low(c?.state) || low(x.id) === low(c?.state))) || col.states[1];
            const key = `grow:${col.id}:${low(name)}`;
            const q = quoteAt(c, what, key); if (!q) continue;
            const amount = col.amounts ? Math.max(1, Math.round(Number(c?.amount)) || 1) : 0;
            take(key, { kind: 'find', key, col: col.id, name, to: { state: stt.id, amount }, about: String(c?.about ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) || reasonOf(c) || '',
                ask: col.growAsk !== 'auto', at: messages[q.msgIdx]?._i ?? null, quote: q.quote, reason: reasonOf(c), confidence: conf(c?.confidence), msgIdx: q.msgIdx }, what);
            continue;
        }
        if (!it) { rejected.push({ what, reason: 'not on the list', found: { collection: col.name, item: String(c?.item ?? '').trim(), quote: c?.quote } }); continue; }
        const stt = col.states.find(x => low(x.label) === low(c?.state) || low(x.id) === low(c?.state));
        if (!stt) { rejected.push({ what, reason: `"${c?.state}" is not one of its states` }); continue; }
        const key = `item:${col.id}:${it.id}`;
        const q = quoteAt(c, what, key); if (!q) continue;
        const from = { state: itemState(st, col, it.id), amount: itemAmount(st, col, it.id) };
        const amount = col.amounts && Number.isFinite(Number(c?.amount)) && c.amount !== null ? Math.max(0, Math.round(Number(c.amount))) : (stt.id === col.states[1]?.id && col.amounts ? Math.max(1, from.amount) : from.amount);
        const to = { state: stt.id, amount };
        if (to.state === from.state && to.amount === from.amount) { rejected.push({ what, reason: 'no change' }); continue; }
        // a one-way flag / item ("knows the secret") never goes back by itself once it is past its first state (meters and flags, 2026-10-12)
        if (it.oneWay && from.state !== col.states[0].id && to.state !== from.state) { rejected.push({ what, reason: 'one-way' }); continue; }
        take(key, { kind: 'item', key, col: col.id, item: it.id, from, to, quote: q.quote, reason: reasonOf(c), confidence: conf(c?.confidence), msgIdx: q.msgIdx }, what);
    }
    for (const c of arr(money)) {
        const what = `${c?.collection ?? '?'}: money`;
        const col = findCol(c?.collection);
        const p = arr(col?.purse)[0];
        if (!col || !p) { rejected.push({ what, reason: 'no running collection with money by that name' }); continue; }
        const delta = Number(c?.change);
        if (!Number.isFinite(delta) || delta === 0) { rejected.push({ what, reason: 'no change' }); continue; }
        const key = `money:${col.id}:${p.id}`;
        const q = quoteAt(c, what, key); if (!q) continue;
        const from = purseValue(st, col, p.id);
        take(key, { kind: 'money', key, col: col.id, purse: p.id, from, to: from + delta, quote: q.quote, reason: reasonOf(c), confidence: conf(c?.confidence), msgIdx: q.msgIdx }, what);
    }

    const changes = [];
    const spent = new Map();   // purse key → money already paid by changes in this batch
    // items first: their costs are known before the money reports are looked at
    const ordered = [...best.values()].sort((a, b) => (a.kind === 'item' ? 0 : 1) - (b.kind === 'item' ? 0 : 1));
    for (const ch of ordered) {
        const col = trackerOf(board, ch.col);
        if (ch.kind === 'find') {
            if (arr(st?.undone).some(u => u.key === ch.key && sameText(u.quote, ch.quote))) { rejected.push({ what: `${col.name}: ${ch.name}`, reason: 'undone before from this line' }); continue; }
            changes.push(ch); continue;
        }
        const what = ch.kind === 'item' ? `${col.name}: ${itemOf(col, ch.item).name}` : `${col.name}: money`;
        if (arr(st?.undone).some(u => u.key === ch.key && sameText(u.quote, ch.quote))) { rejected.push({ what, reason: 'undone before from this line' }); continue; }
        if (ch.kind === 'money') {
            // the helper sometimes reports a purchase twice — as the item and as money spent: the item already paid
            const delta = ch.to - ch.from;
            const paidBy = changes.find(x => x.pay && x.col === ch.col && x.pay.purse === ch.purse && (sameText(x.quote, ch.quote) || (x.msgIdx === ch.msgIdx && -delta === x.pay.amount)));
            if (paidBy && delta < 0) { rejected.push({ what, reason: 'already paid by the item' }); continue; }
            const already = spent.get(`${ch.col}:${ch.purse}`) || 0;
            if (ch.to - already < 0) { rejected.push({ what, reason: 'more than there is' }); continue; }
            changes.push(ch); continue;
        }
        const it = itemOf(col, ch.item);
        const first = col.states[0].id;
        if (ch.from.state === first && ch.to.state !== first) {
            const open = arr(it.needs).filter(c => !holds(board, st, certain(c)));
            if (open.length) { rejected.push({ what, reason: 'needs', needs: open.map(c => condText(board, c)), quote: ch.quote }); continue; }
            if (isFindItem(it) && !findingNow(board, st, col, it).length) { rejected.push({ what, reason: 'not there to be found', quote: ch.quote }); continue; }
            if (it.cost?.purse && ch.to.state === col.states[1]?.id) {
                const pk = `${col.id}:${it.cost.purse}`;
                const have = purseValue(st, col, it.cost.purse) - (spent.get(pk) || 0);
                if (have < it.cost.amount) { rejected.push({ what, reason: 'cannot afford', cost: it.cost.amount, have, quote: ch.quote }); continue; }
                spent.set(pk, (spent.get(pk) || 0) + it.cost.amount);
                ch.pay = { purse: it.cost.purse, amount: it.cost.amount };
            }
        }
        changes.push(ch);
    }
    return { changes, rejected };
}

// ── applying, undo, rewind ──────────────────────────────────────────────────

const clone = o => JSON.parse(JSON.stringify(o));
const bag = (st, colId) => ((st.collections ||= {})[colId] ||= { items: {}, purse: {}, pending: [] });
function setItem(st, col, itemId, v) {
    const b = bag(st, col.id);
    if (v.state === col.states[0].id && !v.amount) delete b.items[itemId];
    else b.items[itemId] = { state: v.state, ...(v.amount ? { amount: v.amount } : {}) };
}

/**
 * Apply checked changes at message `i`. Returns the new state; each change gets a log entry
 * (with an id for its Undo). `meta`: who / at.
 */
export function applyCollectionChanges(board, st, changes, i, meta = {}) {
    const next = clone(st);
    next.log = arr(next.log);
    for (const ch of changes) {
        const col = trackerOf(board, ch.col);
        const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const entry = { id, i: Math.floor(i || 0), key: ch.key, kind: ch.kind, col: ch.col, quote: ch.quote, reason: ch.reason, confidence: ch.confidence, who: meta.who || 'auto', at: meta.at || new Date().toISOString() };
        if (ch.kind === 'item') {
            setItem(next, col, ch.item, ch.to);
            Object.assign(entry, { item: ch.item, from: ch.from, to: ch.to });
            if (ch.pay) {
                const was = purseValue(next, col, ch.pay.purse);
                bag(next, col.id).purse[ch.pay.purse] = was - ch.pay.amount;
                entry.pay = { purse: ch.pay.purse, from: was, to: was - ch.pay.amount };
            }
        } else {
            // relative to the purse as it is now (an item in this batch may have paid already)
            const was = purseValue(next, col, ch.purse), to = was + (ch.to - ch.from);
            bag(next, col.id).purse[ch.purse] = to;
            Object.assign(entry, { purse: ch.purse, from: was, to });
            ch.from = was; ch.to = to;
        }
        next.log.push(entry);
        ch.logId = id;
    }
    capLog(next);
    return next;
}

function revert(board, st, e) {
    const col = trackerOf(board, e.col);
    if (!col) return;
    if (e.kind === 'place') { st.places[col.id] = e.from; return; }   // places-pure.js logs here too
    // engine on v2, step 1: a step tracker's move (board-live.js recordSteps) goes back to where it was
    if (e.kind === 'step') { st.trackers ||= {}; const { asideText, ended, ...rest } = e.from || {}; st.trackers[col.id] = { ...(st.trackers[col.id] || {}), ...rest, ...(asideText ? { asideText } : {}), ...(ended ? { ended } : {}) }; if (!asideText) delete st.trackers[col.id].asideText; if (!ended) delete st.trackers[col.id].ended; if (!rest.aside) delete st.trackers[col.id].aside; if (!rest.run) delete st.trackers[col.id].run; if (!arr(rest.branchLog).length) delete st.trackers[col.id].branchLog; if (!rest.waitAt) delete st.trackers[col.id].waitAt; return; }
    if (e.kind === 'state' || e.kind === 'date') { revertState(st, e); return; }   // state-pure.js
    if (e.kind === 'meter') { revertMeter(st, e); return; }   // meters-pure.js
    if (e.kind === 'cast') { revertCast(st, e); return; }   // cast-pure.js (2026-10-13)
    // triggers + odds (rolls-pure.js): a roll is unmade, a fired trigger may fire again
    if (e.kind === 'roll') { st.rolls ||= {}; if (e.from) st.rolls[e.line] = e.from; else delete st.rolls[e.line]; return; }
    if (e.kind === 'trigger') { if (st.fired) delete st.fired[e.line]; if (e.moved && st.trackers?.[col.id]) st.trackers[col.id].at = e.from; return; }
    if (e.kind === 'item') {
        setItem(st, col, e.item, e.from);
        if (e.pay) bag(st, col.id).purse[e.pay.purse] = e.pay.from;
    } else bag(st, col.id).purse[e.purse] = e.from;
}

/** Undo one logged change (its notice's Undo). Remembers it, so the same line doesn't re-apply it. */
export function undoCollectionChange(board, st, logId) {
    const e = arr(st.log).find(x => x.id === logId);
    if (!e) return { state: st, error: 'already undone or rolled back' };
    const next = clone(st);
    revert(board, next, e);
    next.log = next.log.filter(x => x.id !== logId);
    next.undone = [...arr(next.undone), { key: e.key, quote: e.quote }].slice(-20);
    return { state: next, entry: e };
}

/** After a delete back to `messageIndex`: every change from a later message is rolled back. */
export function rewindCollections(board, st, messageIndex, keep = null) {
    // keep (regen-pure.js): a regenerate's delete keeps changes made by hand or by the world (Miinthe, 2026-10-19)
    const later = arr(st?.log).filter(e => e.i > messageIndex && !(keep && keep(e)));
    // a new thing still waiting for Miinthe's answer, found in a message that is gone, goes too
    const gone = Object.values(st?.collections || {}).some(c => arr(c?.pending).some(p => Number(p.m) > messageIndex));
    if (!later.length && !gone) return { state: st, undone: [] };
    const next = clone(st);
    for (const e of later.slice().reverse()) revert(board, next, e);
    next.log = arr(next.log).filter(e => e.i <= messageIndex || (keep && keep(e)));
    for (const c of Object.values(next.collections || {})) if (c && Array.isArray(c.pending)) c.pending = c.pending.filter(p => !(Number(p.m) > messageIndex));
    return { state: next, undone: later };
}

/** The notice text for a change. */
export function describeCollectionChange(board, ch) {
    const col = trackerOf(board, ch.col);
    if (ch.kind === 'money') {
        const p = arr(col.purse).find(x => x.id === ch.purse);
        const d = ch.to - ch.from;
        return `${col.name}: ${d > 0 ? '+' : '−'}${fmtMoney(p, Math.abs(d))} → ${fmtMoney(p, ch.to)}`;
    }
    const it = itemOf(col, ch.item);
    const amt = col.amounts && ch.to.amount !== ch.from.amount && (ch.to.amount > 1 || ch.from.amount > 1) ? ` ×${ch.to.amount}` : '';
    const paid = ch.pay ? ` (paid ${fmtMoney(arr(col.purse).find(x => x.id === ch.pay.purse), ch.pay.amount)})` : '';
    return `${col.name}: ${it.name} → ${stateLabel(col, ch.to.state)}${amt}${paid}`;
}

// ── collections that grow ───────────────────────────────────────────────────

/** Where a growing collection's new entries go: its own folder for them, else the collection's, else the board's first, else Items/. */
export const growFolderOf = (board, col) => String(col?.growFolder || col?.folder || arr(board?.folders)[0] || 'Items/');

/** The drafted entry for a new thing (the form createEntry / buildEntryFile take). Only the story's words — nothing made up. */
export function findDraft(board, col, f) {
    const name = cleanFindName(f?.name) || 'New item';
    const about = String(f?.about ?? '').trim();
    return { title: name, folder: growFolderOf(board, col), type: 'lore', keys: [name],
        summary: `${about ? about.replace(/\s+$/, '') + (/[.!?…]$/.test(about) ? '' : '.') + ' ' : ''}Select when ${name} comes up.`, body: about };
}

/** A new thing waits for Miinthe's answer: into the collection's `pending` (what the board window and the Story tab show). */
export function addPending(board, st, ch, i) {
    const col = trackerOf(board, ch.col);
    const next = clone(st);
    const d = findDraft(board, col, ch);
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    bag(next, ch.col).pending = [...arr(next.collections[ch.col].pending), {
        id, name: ch.name, state: ch.to.state, ...(ch.to.amount ? { amount: ch.to.amount } : {}), m: Number.isFinite(ch.at) ? ch.at : Math.floor(i || 0),
        q: ch.quote, why: ch.reason || '', conf: ch.confidence || 'medium', about: ch.about || '', summary: d.summary, body: d.body,
    }];
    return { state: next, id };
}

/** Miinthe's answer: the waiting thing leaves the list; "Not worth keeping" (`refuse`) remembers the name for this chat. */
export function dropPending(st, colId, pendId, { refuse = false } = {}) {
    const next = clone(st);
    const b = bag(next, colId);
    const p = arr(b.pending).find(x => x.id === pendId);
    b.pending = arr(b.pending).filter(x => x.id !== pendId);
    if (refuse && p && !arr(b.refused).some(n => low(n) === low(p.name))) b.refused = [...arr(b.refused), p.name].slice(-100);
    return { state: next, found: p || null };
}

/**
 * Add a kept thing to the board (the stored v2 board — every chat of the board gets the item, in
 * its first state). An item of that name already on the list is used instead (`dup`). Returns
 * { board, itemId, dup }; `entryTitle` (or none) is linked on a new item.
 */
export function growItem(board, colId, name, entryTitle = null) {
    const next = clone(board);
    const col = arr(next.trackers).find(t => t.id === colId);
    if (!col) return { board, itemId: null, dup: false, error: 'no such collection' };
    col.items = arr(col.items);
    const have = col.items.find(x => low(x.name) === low(name));
    if (have) {
        if (entryTitle && !arr(have.entries).some(t => low(t) === low(entryTitle))) have.entries = [...arr(have.entries), entryTitle];
        return { board: next, itemId: have.id, dup: true };
    }
    const id = uniqueId(name, new Set(col.items.map(x => x.id)));
    col.items.push({ id, name, entries: entryTitle ? [entryTitle] : [], kinds: {}, pins: [], needs: [] });
    return { board: next, itemId: id, dup: false };
}

/** The change that gives the kept thing its state in this chat (logged, so it has an Undo). An item already had gets +amount. */
export function keptChange(board, st, colId, itemId, f) {
    const col = trackerOf(board, colId);
    const from = { state: itemState(st, col, itemId), amount: itemAmount(st, col, itemId) };
    const state = col.states.some(x => x.id === f.state) && f.state !== col.states[0].id ? f.state : col.states[1].id;
    const amount = col.amounts ? from.amount + Math.max(1, Number(f.amount) || 1) : from.amount;
    return { kind: 'item', key: `item:${colId}:${itemId}`, col: colId, item: itemId, from, to: { state, amount }, quote: f.q ?? f.quote ?? '', reason: f.why ?? f.reason ?? null, confidence: f.conf ?? f.confidence ?? null };
}

/** The notice for a new thing. */
export function describeFind(board, ch) {
    const col = trackerOf(board, ch.col);
    const st = stateLabel(col, ch.to?.state ?? ch.state);
    return `${col.name}: new — ${ch.name} (${st}${col.amounts && (ch.to?.amount ?? ch.amount) > 1 ? ` ×${ch.to?.amount ?? ch.amount}` : ''})`;
}

// ── what the writer and the judge get ───────────────────────────────────────

/**
 * Lines for the writer (with each item's content) or the judge (names only).
 * `contentOf(title)` returns an entry's text for an item's first linked entry (optional).
 */
export function collectionLines(board, st, { contentOf = null, forJudge = false } = {}) {
    const out = [];
    for (const col of runningCollections(board, st)) {
        const first = col.states[0].id, label = writerLabelOf(col);
        const kept = col.items.filter(it => itemState(st, col, it.id) !== first);
        for (const it of kept) {
            const sid = itemState(st, col, it.id), n = itemAmount(st, col, it.id);
            const showState = !(isInventory(col) && sid === col.states[1]?.id);
            const text = !forJudge && contentOf && it.entries[0] ? String(contentOf(it.entries[0]) || '').replace(/\s+/g, ' ').trim() : '';
            out.push(`${label}: ${it.name}${col.amounts && n > 1 ? ` ×${n}` : ''}${showState ? ` (${stateLabel(col, sid)})` : ''}${text ? ` · Content: ${text.length > 400 ? text.slice(0, 400).replace(/\s\S*$/, '') + '…' : text}` : ''}`);
        }
        for (const p of arr(col.purse)) out.push(`MONEY: ${fmtMoney(p, purseValue(st, col, p.id))}`);
    }
    return out;
}

/** Entries linked on an item exist only once the item is past its first state (and its collection runs). Pinned stay. */
export function filterByItems(entries, board, st, isPinned = () => false) {
    const owners = new Map();
    for (const col of collectionsOf(board)) for (const it of col.items) for (const title of it.entries) {
        const k = low(title);
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k).push({ col, it });
    }
    if (!owners.size) return entries;
    return entries.filter(e => {
        const own = owners.get(low(e?.title));
        if (!own || isPinned(e)) return true;
        // past its first state — or there to be found right now (so the writer can describe the glue on the shelf)
        return own.some(o => runOf(st, o.col) == null && (itemState(st, o.col, o.it.id) !== o.col.states[0].id || findingNow(board, st, o.col, o.it).length > 0));
    });
}
