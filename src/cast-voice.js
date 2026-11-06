/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — the Cast, step 3: an NPC's own message, SillyTavern glue (rules: cast-voice-pure.js).
 *
 * speakAs(cast, person): SillyTavern's own generate runs (streaming, swipes, stop — all as usual); while the NPC speaks
 * the prompt is swapped for hers at CHAT_COMPLETION_PROMPT_READY, DeepLore's lore pipeline stays out of it (index.js asks
 * npcTurnActive()), and the new message gets her name, avatar and mark. A swipe on her message is her again.
 * postAs(cast, person, text): Miinthe writes as her — a message under her name, nothing generated.
 * Every other reply: her messages reach the main writer as someone else talking (writerSeesNpcs).
 *
 * Chat Completion only for now (Miinthe's setup); Text Completion says so instead of writing in the wrong voice.
 */
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { escapeHtml } from '../../../../utils.js';
import { live, saveLiveState, liveWriterLines, entryText } from './board-live.js';
import { personOf, personNow, handChange, applyCastChanges } from './cast-pure.js';
import { echo } from './echo.js';
import { undoCollection } from './autotrack.js';
import { checkExit, checkReturns } from './cast.js';
import { npcPrompt, storyLinesFor, stripName, writerSeesNpcs, npcMessagesOf, npcOfMessage, NPC_WINDOW } from './cast-voice-pure.js';
import { turnIndex } from './turn-index.js';
import { vaultIndex } from './state.js';
import { writerSinkLines } from './mero.js';

const sinkLines = type => { try { return writerSinkLines(type); } catch { return []; } };

let npcTurn = null;          // { cast, person, name, avatar, swipe, patched, exit? }
let wired = false;
let endWaiters = [];

/** Is an NPC speaking right now? (DeepLore's generate interceptor stays out then.) */
export const npcTurnActive = () => !!npcTurn;
export const npcSpeaking = () => (npcTurn ? { cast: npcTurn.cast, person: npcTurn.person, name: npcTurn.name } : null);

const thumb = avatar => `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
const cardOf = p => (p?.card ? (getContext()?.characters || []).find(c => c.avatar === p.card) : null);
const isGenerating = () => { const b = document.getElementById('mes_stop'); return !!b && getComputedStyle(b).display !== 'none'; };
/**
 * Wait until SillyTavern is free (no reply being written, no NPC speaking) — up to `ms`. Between two turns of a round the
 * stop button stays up a moment longer (live 2026-10-13: ▶ Go spoke for one NPC, then gave up). Resolves true when free.
 */
export async function waitForIdle(ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (!isGenerating() && !npcTurn) { await new Promise(r => setTimeout(r, 300)); if (!isGenerating() && !npcTurn) return true; }
        await new Promise(r => setTimeout(r, 250));
    }
    return false;
}
/** Resolves when the generation running now ends (or was stopped). */
export const generationDone = () => new Promise(r => endWaiters.push(r));

function who(castId, personId) {
    const L = live();
    const cast = L?.board?.trackers?.find(t => t.id === castId), p = personOf(cast, personId);
    return L && p ? { L, cast, p } : null;
}

/** Mark message `id` as the person's: name, avatar, the mark; her "Kettle:" taken off. */
function mark(id, t) {
    const ctx = getContext(), m = ctx?.chat?.[id];
    if (!m || !t) return;
    m.name = t.name;
    m.is_user = false;
    if (t.avatar) { m.force_avatar = thumb(t.avatar); m.original_avatar = t.avatar; }
    m.extra = { ...(m.extra || {}), dle_npc: { cast: t.cast, person: t.person, ...(t.avatar ? { avatar: t.avatar } : {}) } };
    if (t.sources) { if (t.sources.length) m.extra.deeplore_sources = t.sources; else delete m.extra.deeplore_sources; }
    m.mes = stripName(t.name, m.mes);
    if (Array.isArray(m.swipes) && Number.isInteger(m.swipe_id) && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = m.mes;
}
/** One entry given to an NPC, in the shape of the reply's sources (index.js injectedSourceRecords). */
function sourceOf(title, name) {
    const e = (vaultIndex || []).find(x => x.title === title) || {};
    return { title, filename: e.filename || '', matchedBy: `Linked to ${name} on the board`, priority: e.priority, tokens: e.tokenEstimate, vaultSource: e.vaultSource || '' };
}
/** Redraw a message's name and avatar (SillyTavern drew it as the main character while it streamed). */
function redraw(id) {
    const ctx = getContext(), m = ctx?.chat?.[id];
    const el = document.querySelector(`#chat .mes[mesid="${id}"]`);
    if (!m || !el) return;
    const n = el.querySelector('.name_text'); if (n) n.textContent = m.name;
    const img = el.querySelector('.avatar img'); if (img && m.force_avatar) img.src = m.force_avatar;
    el.setAttribute('ch_name', m.name);
    try { ctx.updateMessageBlock?.(id, m); } catch { /* noop */ }
}

function wire() {
    if (wired) return;
    const ctx = getContext(), es = ctx?.eventSource, et = ctx?.eventTypes || ctx?.event_types;
    if (!es || !et) return;
    wired = true;
    // a swipe on an NPC's message is her again
    es.on(et.GENERATION_STARTED, (type, _o, dryRun) => {
        if (dryRun || npcTurn) return;
        const last = getContext()?.chat?.at(-1), np = npcOfMessage(last);
        if (!np) return;
        if (type === 'swipe') {
            const w = who(np.cast, np.person);
            // a swipe on her goodbye is a goodbye again (she is already gone)
            if (w) npcTurn = { cast: np.cast, person: np.person, name: w.p.name, avatar: w.p.card || last.original_avatar || null, swipe: true, ...(!personNow(w.L.state, w.cast, w.p).here ? { exit: { why: null } } : {}) };
        } else if (type === 'continue') {
            try { toastr.info(`Continue on ${escapeHtml(last.name)}'s message writes in the main character's voice for now — swipe it instead for a new one of hers.`, 'Cast', { escapeHtml: false, timeOut: 9000 }); } catch { /* noop */ }
        }
    });
    es.on(et.CHAT_COMPLETION_PROMPT_READY, data => {
        if (!data || data.dryRun || !Array.isArray(data.chat)) return;
        const chat = getContext()?.chat || [];
        if (!npcTurn) { try { writerSeesNpcs(data.chat, npcMessagesOf(chat)); } catch (err) { console.warn('[Onyx Quill] cast: writer view skipped:', err?.message || err); } return; }
        const w = who(npcTurn.cast, npcTurn.person);
        if (!w) return;
        const card = cardOf(w.p) || {};
        const ctx = getContext();
        let msgs = chat.filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim());
        if (npcTurn.swipe) msgs = msgs.slice(0, -1);
        const loreTitles = (w.p.entries || []).filter(t => (w.p.kinds || {})[t] !== 'judge' && entryText(t));
        const lore = loreTitles.map(t => entryText(t)).join('\n\n');
        // what she was given, for the message's ⋯ → Why these entries (Miinthe 2026-10-18: "no lore used" on every NPC message)
        npcTurn.sources = loreTitles.map(t => sourceOf(t, w.p.name));
        let story = [];
        try { story = storyLinesFor(liveWriterLines()); } catch { /* no board */ }
        const prompt = npcPrompt({ npc: { name: w.p.name, description: card.description || card.data?.description || '', personality: card.personality || card.data?.personality || '', mes_example: card.mes_example || card.data?.mes_example || '' },
            userName: ctx?.name1 || 'User', mainName: ctx?.name2 || 'Character', now: personNow(w.L.state, w.cast, w.p), storyLines: story, lore, messages: msgs.slice(-NPC_WINDOW).map(m => ({ name: m.name, mes: m.mes })), exit: npcTurn.exit || null, notes: sinkLines(npcTurn.swipe ? 'swipe' : 'normal') });
        data.chat.splice(0, data.chat.length, ...prompt);
    });
    // streaming: the message exists from the first token on — make it hers at once
    es.on(et.STREAM_TOKEN_RECEIVED, () => {
        if (!npcTurn || npcTurn.swipe || npcTurn.patched) return;
        npcTurn.patched = true;
        const id = (getContext()?.chat?.length ?? 1) - 1;
        mark(id, npcTurn); redraw(id);
    });
    es.on(et.MESSAGE_RECEIVED, id => { if (npcTurn && !npcTurn.swipe) mark(Number(id), npcTurn); });
    const end = async () => {
        const t = npcTurn;
        if (t) {
            const ctx = getContext(), id = (ctx?.chat?.length ?? 1) - 1, m = ctx?.chat?.[id];
            if (m && !m.is_user && (t.swipe ? npcOfMessage(m)?.person === t.person : true)) { mark(id, t); redraw(id); try { await ctx.saveChat?.(); } catch { /* noop */ } }
            npcTurn = null;
        }
        const w = endWaiters; endWaiters = []; w.forEach(r => r());
        // someone who just left: does this new reply stop them or bring them back? (in the background)
        const c2 = getContext()?.chat, last = c2?.at(-1);
        if (last && !last.is_user && last.mes?.trim()) checkReturns(c2.length - 1, last.name, last.mes).catch(() => {});
    };
    es.on(et.GENERATION_ENDED, end);
    es.on(et.GENERATION_STOPPED, end);
}

/** Make sure they are in the scene (speaking means being here) — logged like a hand change. */
function bringIn(w) {
    if (personNow(w.L.state, w.cast, w.p).here) return;
    saveLiveState(handChange(w.L.board, w.L.state, w.cast.id, w.p.id, 'here', true, turnIndex(getContext()?.chat)));
}

/** Can an NPC speak now? Returns a reason when not. */
export function cannotSpeak() {
    const ctx = getContext();
    if (!ctx?.chat || ctx.groupId) return 'Open a one-on-one chat first.';
    if ((ctx.mainApi ?? ctx.main_api) && (ctx.mainApi ?? ctx.main_api) !== 'openai') return 'NPCs speak with Chat Completion only for now — your connection is Text Completion.';
    if (isGenerating() || npcTurn) return 'Something is being written right now — wait for it, or stop it.';
    return null;
}

/**
 * SillyTavern's generate('normal') sends whatever is in the chat box as your message: what you are typing is taken out
 * while the AI writes and given back after, with anything typed meanwhile kept behind it (Miinthe, 2026-10-19: "my reply
 * gets sent early regularly" — half a sentence went out when the round moved on to Toaster).
 */
export function holdBox() {
    const box = document.getElementById('send_textarea');
    const kept = box?.value ?? '';
    if (!box || !kept) return () => {};
    box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
    // what was typed meanwhile goes behind it — with a space, so two words never run together
    return () => { const typed = box.value; box.value = kept + (typed && !/\s$/.test(kept) && !/^\s/.test(typed) ? ' ' : '') + typed; box.dispatchEvent(new Event('input', { bubbles: true })); };
}

/**
 * The NPC writes her own message now. Resolves when it is done (true) or couldn't start (false). `exit`: { why } — in
 * this message she walks out of the scene, saying so; right after it she is gone (logged, Undo).
 */
export async function speakAs(castId, personId, { exit = null } = {}) {
    wire();
    const w = who(castId, personId);
    if (!w) return false;
    await waitForIdle();
    const why = cannotSpeak();
    if (why) { try { toastr.info(why, 'Cast'); } catch { /* noop */ } return false; }
    bringIn(w);
    const ctx = getContext();
    const giveBack = holdBox();
    const turn = npcTurn = { cast: w.cast.id, person: w.p.id, name: w.p.name, avatar: w.p.card || null, swipe: false, ...(exit ? { exit } : {}) };
    const before = ctx.chat.length;
    const done = generationDone();
    try { await ctx.generate('normal'); } catch (err) { console.warn('[Onyx Quill] cast: speaking failed:', err?.message || err); }
    await Promise.race([done, new Promise(r => setTimeout(r, 1500))]);
    if (npcTurn) await Promise.race([done, new Promise(r => setTimeout(r, 120000))]);
    // a generation that never got going (no connection, the server unreachable) ends without GENERATION_ENDED: her turn
    // is over all the same — left set, the next reply of the main character would be written and marked as hers
    if (npcTurn === turn) npcTurn = null;
    // she said goodbye in her message: now she is gone
    if (exit && getContext().chat.length > before && npcOfMessage(getContext().chat.at(-1))?.person === w.p.id) {
        const L = live();
        if (L) {
            const ch = { kind: 'cast', col: w.cast.id, person: w.p.id, field: 'here', from: true, to: false, who: 'npc', reason: `walks out${exit.why ? ` — ${exit.why}` : ''}` };
            saveLiveState(applyCastChanges(L.board, L.state, [ch], turnIndex(getContext().chat), { who: 'npc' }));
            echo(() => toastr.info(`🎭 ${escapeHtml(w.p.name)} leaves the scene${exit.why ? ` — ${escapeHtml(exit.why)}` : ''}<br><u>Undo</u>`, 'Cast', { escapeHtml: false, timeOut: 10000, onclick: () => undoCollection(ch.logId) }));
        }
    } else if (!exit && getContext().chat.length > before && npcOfMessage(getContext().chat.at(-1))?.person === w.p.id) {
        // she may have walked out on her own: that counts now, not one message later
        await checkExit(w.cast.id, w.p.id, getContext().chat.at(-1).mes);
    }
    giveBack();
    // no new message from her: the generation failed (the model crashed, a stop) — the round must stop, not go on
    // firing request after request (live 2026-10-14: a round kept sending to a crashed model)
    const spoke = getContext().chat.length > before && npcOfMessage(getContext().chat.at(-1))?.person === w.p.id;
    if (!spoke) { try { toastr.warning(`${escapeHtml(w.p.name)} didn't get a message out — the round stops here.`, 'Cast', { escapeHtml: false }); } catch { /* noop */ } }
    return spoke;
}

/** Miinthe writes as the NPC: a message under her name and avatar, nothing generated. */
export async function postAs(castId, personId, text) {
    wire();
    const w = who(castId, personId);
    const mes = String(text ?? '').trim();
    if (!w || !mes) return false;
    bringIn(w);
    const ctx = getContext();
    const m = { name: w.p.name, is_user: false, is_system: false, send_date: new Date().toLocaleString(), mes, swipes: [mes], swipe_id: 0, swipe_info: [{}],
        extra: { dle_npc: { cast: w.cast.id, person: w.p.id, ...(w.p.card ? { avatar: w.p.card } : {}), byYou: true } },
        ...(w.p.card ? { force_avatar: thumb(w.p.card), original_avatar: w.p.card } : {}) };
    ctx.chat.push(m);
    ctx.addOneMessage?.(m);
    try { await ctx.saveChat?.(); } catch { /* noop */ }
    saveMetadataDebounced();
    await checkExit(w.cast.id, w.p.id, mes);   // a line you wrote where they leave: they're gone now
    await checkReturns(ctx.chat.length - 1, w.p.name, mes);   // … or one where they hold someone back who just left
    return true;
}

/** Wire the hooks (index.js at start-up). */
export function initCastVoice() { wire(); }
