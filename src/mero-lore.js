/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — Mero ☆'s entry ideas: SillyTavern glue (rules: mero-lore-pure.js).
 *
 * Mero looks at the latest replies next to the entries that were sent with them — in the background, after a reply
 * arrived, as often as her chattiness says (Quiet: only on "Check the lore"). Each idea becomes a ☆ card in 📬 with
 * the exact before / after. Her "entry changes" setting: ask me (default) · apply on their own (then the card goes
 * straight to Answered, with Undo) · off.
 * Builder's notes kept (Miinthe's TunnelVision lesson): a card is gone with the message it came from (deleted / swiped);
 * a card whose entry was edited since it was made is re-shown against what the entry says now, never written blind.
 */
import { chat_metadata, eventSource, event_types } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { getSettings, resolveConnectionConfig, resolveWriteVault } from '../settings.js';
import { callAI } from './ai/ai.js';
import { readNote, writeNote } from './vault/obsidian-api.js';
import { buildIndexWithReuse } from './vault/vault.js';
import { vaultIndex } from './state.js';
import { getByMessageSync, getCurrentForChat } from './verdict/verdict-store.js';
import { meroSettings } from './mero.js';
import { splitOoc } from './mero-pure.js';
import { addRequest, onAnswer, requestsHere, updateRequest } from './requests.js';
import { resultText } from './requests-pure.js';
import { LORE_KEY, asLore, newReplies, dueToLook, buildLookPrompt, parseLook, applyChange, undoChange, beforeAfter } from './mero-lore-pure.js';

const MAX_REPLIES = 6, MAX_ENTRIES = 6;
const lore = () => asLore(chat_metadata?.[LORE_KEY]);
function putLore(l) { chat_metadata[LORE_KEY] = l; saveMetadataDebounced(); }
let looking = false;
const lookListeners = new Set();
export const meroLooking = () => looking;
export function onLookChanged(cb) { lookListeners.add(cb); }
const setLooking = v => { looking = v; for (const cb of lookListeners) { try { cb(); } catch { /* noop */ } } };

/** The vault an entry lives in (its own, by name), for reading and writing it back. */
const vaultOf = vaultName => resolveWriteVault('autoSuggest', getSettings(), vaultName || undefined);
async function readEntry(entry) {
    const v = vaultOf(entry.vault);
    if (!v?.host && !v?.port) return { ok: false, error: 'no vault set up' };
    return readNote(v.host, v.port, v.apiKey, entry.filename, !!v.https);
}
async function writeEntry(entry, content) {
    const v = vaultOf(entry.vault);
    const w = await writeNote(v.host, v.port, v.apiKey, entry.filename, content, !!v.https);
    if (w.ok) buildIndexWithReuse().catch(err => console.warn('[DLE] Mero: re-reading the vault after an entry change failed:', err?.message || err));
    return w;
}

/** The entries sent with these replies (each reply's own record; the latest one's as a fallback). */
function entriesFor(idx) {
    const chatId = getContext()?.getCurrentChatId?.();
    const seen = new Map();
    const take = list => { for (const x of list || []) if (x?.title && x.filename && !seen.has(x.title)) seen.set(x.title, x); };
    for (const k of idx.slice().reverse()) take(getByMessageSync(k, chatId)?.injectedSources);
    if (!seen.size) take(getCurrentForChat(chatId)?.injectedSources);
    return [...seen.values()].slice(0, MAX_ENTRIES).map(x => {
        const e = (vaultIndex || []).find(v => v.title === x.title && (!x.vaultSource || v.vaultSource === x.vaultSource));
        return e ? { title: e.title, filename: e.filename || x.filename, vault: e.vaultSource || x.vaultSource || '', content: e.content || '' } : null;
    }).filter(Boolean);
}

const msgStart = m => String(m?.mes ?? '').slice(0, 80);

/**
 * Mero looks. `force` (Check the lore): even when it isn't time, at the latest replies. Returns { ok, found } or
 * { ok: false, error } — never throws.
 */
export async function lookAtLore({ force = false } = {}) {
    const st = meroSettings();
    if (st.job === 'off') return { ok: false, error: 'Mero is off duty (☆ settings → Mero\'s job)' };
    if (looking) return { ok: false, error: 'Mero is already looking' };
    const ctx = getContext(), chat = ctx?.chat || [];
    const isAi = k => !!chat[k] && !chat[k].is_user && !chat[k].is_system;
    const L = lore();
    let idx = newReplies(Math.min(L.last, chat.length - 1), chat.length, isAi);
    if (!force && !dueToLook(st.job, idx.length)) return { ok: true, found: 0, notYet: true };
    if (force && !idx.length) idx = newReplies(-1, chat.length, isAi);
    idx = idx.slice(-MAX_REPLIES);
    if (!idx.length) return { ok: false, error: 'no replies to look at yet' };
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) return { ok: false, error: 'Mero has no connection yet — DeepLore settings → AI Connections → Mero ☆' };
    const entries = entriesFor(idx);
    putLore({ ...L, last: chat.length - 1 });   // looked at, whatever comes of it — the next look starts after these
    if (!entries.length) return { ok: true, found: 0, noEntries: true };
    const chatId = ctx?.getCurrentChatId?.();
    setLooking(true);
    try {
        const replies = idx.map(k => ({ i: k, name: chat[k].name, text: splitOoc(chat[k].mes).clean.slice(0, 2500) }));
        const { system, user } = buildLookPrompt({ entries, replies, persona: st.persona });
        const r = await callAI(system, user, { ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true });
        if (getContext()?.getCurrentChatId?.() !== chatId) return { ok: false, error: 'the chat changed while Mero was looking' };
        const waiting = requestsHere().waiting.filter(x => x.kind === 'entry');
        const ideas = parseLook(r?.text ?? '', { titles: entries.map(e => e.title), lore: lore(), waiting });
        let found = 0;
        for (const idea of ideas) {
            const e = entries.find(x => x.title === idea.title);
            const file = await readEntry(e);
            if (!file.ok) { console.warn('[DLE] Mero: could not read', e.filename, file.error); continue; }
            if (applyChange(file.content, idea.change).error) continue;   // a rewrite of text that isn't there
            const i = idx.includes(idea.i) ? idea.i : idx[idx.length - 1];
            const card = {
                id: `entry:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from: 'mero', kind: 'entry',
                title: `${idea.change.find ? 'Change' : 'Add to'} “${e.title}”?`, q: idea.q, why: idea.why,
                entry: { title: e.title, filename: e.filename, vault: e.vault }, change: idea.change,
                ba: beforeAfter(file.content, idea.change), seen: file.content, made: { i, mes: msgStart(chat[i]), at: new Date().toISOString() },
            };
            if (!st.signoff) {
                const res = await applyNow(card, file.content);
                if (!res.ok) { addRequest(card); found++; continue; }   // couldn't write: ask instead
                addRequest({ ...card, done: resultText('auto'), choice: 'auto', doneAt: new Date().toISOString(), applied: true });
            } else addRequest(card);
            found++;
        }
        return { ok: true, found };
    } catch (err) {
        console.warn('[DLE] Mero could not look at the lore:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    } finally { setLooking(false); }
}

async function applyNow(card, content) {
    const next = applyChange(content, card.change);
    if (next.error) return { ok: false, msg: next.error };
    const w = await writeEntry(card.entry, next.content);
    return w.ok ? { ok: true } : { ok: false, msg: `the vault refused it (${w.error})` };
}

/**
 * An answer on a ☆ entry card: 'apply' (with `extra.text` when Miinthe edited the new text first) · 'notcanon'.
 * The entry is read again first: edited since the card was made → the card is re-shown against it, nothing written.
 */
async function answerEntry(r, choice, n, extra) {
    if (choice === 'notcanon') {
        const L = lore();
        putLore({ ...L, notCanon: [...L.notCanon, { title: r.entry.title, q: r.q }].slice(-200) });
        return true;
    }
    if (choice !== 'apply') return false;
    const file = await readEntry(r.entry);
    if (!file.ok) return { ok: false, msg: `Couldn't read ${r.entry.filename} (${file.error}) — nothing was written.` };
    const edited = typeof extra?.text === 'string' && extra.text.trim();
    if (edited) r.change = r.change.find ? { find: r.change.find, replace: edited.replace(/\s*\n\s*/g, ' ') } : { add: edited.replace(/\s*\n\s*/g, ' ') };
    if (file.content !== r.seen) {
        if (applyChange(file.content, r.change).error) return { ok: false, msg: `“${r.entry.title}” was edited since and that passage is gone — the card can't be applied. Say Not canon, or ask Mero again.` };
        r.seen = file.content; r.ba = beforeAfter(file.content, r.change);
        return { ok: false, msg: `“${r.entry.title}” was edited since this card was made — here it is again, against what the entry says now.` };
    }
    const res = await applyNow(r, file.content);
    if (!res.ok) return { ok: false, msg: `Nothing was written: ${res.msg}.` };
    r.applied = true;
    if (edited) r.edited = true;
    return true;
}

/** Undo an entry change Mero made (on her own, or on Miinthe's yes) — only while the entry still reads as she left it. */
export async function undoEntry(id) {
    const r = requestsHere().answered.find(x => x.id === id);
    if (!r?.applied || r.undone) return { ok: false, msg: 'Nothing to undo.' };
    const file = await readEntry(r.entry);
    if (!file.ok) return { ok: false, msg: `Couldn't read ${r.entry.filename} (${file.error}).` };
    const back = undoChange(file.content, r.change);
    if (back.error) return { ok: false, msg: `Not undone: ${back.error}.` };
    const w = await writeEntry(r.entry, back.content);
    if (!w.ok) return { ok: false, msg: `Not undone: the vault refused it (${w.error}).` };
    updateRequest(id, x => { x.undone = true; x.done = `${x.done} · ${resultText('undone')}`; });
    return { ok: true };
}

/** Wire once: answers for ☆ entry cards; a look after a new reply when Mero's chattiness says it's time. */
export function initMeroLore() {
    onAnswer('entry', answerEntry);
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => { lookAtLore().then(r => { if (r?.ok === false && !/off duty|already looking|no connection|no replies/.test(r.error || '')) console.warn('[DLE] Mero look:', r.error); }); }, 2500); };
    try { eventSource.on(event_types.MESSAGE_RECEIVED, soon); } catch { /* noop */ }
    try { eventSource.on(event_types.CHAT_CHANGED, () => clearTimeout(timer)); } catch { /* noop */ }
}
