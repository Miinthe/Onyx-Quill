/**
 * Overhaul round 2a (2026-10-15) — one DeepLore ⋯ on each reply, in DeepLore's color, instead of the separate
 * 📖 Why? and 💡 Pitch buttons (Miinthe's decision; mock-up v13, spot 2). It holds:
 *   Pitch from here · Why these entries · What this changed · Branch here as a new run · Re-evaluate and swipe
 * Each item is today's function: the Why? pop-up (cartographer.js), Mero's pitches (pitches.js), the What changed
 * fold (the Story tab, src/panel/story-view.js), SillyTavern's own branch (the new branch then offers to become a run, branch-run.js), and
 * Re-evaluate (reevaluate.js, which works on the newest reply only).
 */
import { chat, eventSource, event_types } from '../../../../../script.js';
import { feedOf } from './echo.js';
import * as K from './kit/kit.js';

const BTN_CLASS = 'mes_dle_more';
const html = `<div title="Onyx Quill" class="mes_button ${BTN_CLASS}" role="button" tabindex="0" aria-label="Onyx Quill: this message" aria-haspopup="menu">${K.icon('book')}</div>`;

function addButtons() {
    // on the message itself, next to SillyTavern's own ⋯ and Edit (mock-up v13) — not inside SillyTavern's folded
    // extra row, where the old Why? and 💡 sat out of sight
    const put = holder => {
        if (!holder || holder.querySelector('.' + BTN_CLASS)) return;
        const edit = holder.querySelector(':scope > .mes_edit');
        if (edit) edit.insertAdjacentHTML('beforebegin', html); else holder.insertAdjacentHTML('beforeend', html);
    };
    put(document.querySelector('#message_template .mes_buttons'));
    document.querySelectorAll('#chat .mes .mes_buttons').forEach(put);
    // the two old buttons this one replaces
    document.querySelectorAll('#chat .mes_deeplore_sources, #chat .mes_dle_pitch, #message_template .mes_dle_pitch').forEach(b => b.remove());
}

/** The newest reply after a message of Miinthe's (what Re-evaluate works on). */
function isNewestReply(n) {
    const c = chat || [];
    // the very last message, as SillyTavern swipes it — skipping a hidden one offered a swipe that couldn't run (bug hunt 2026-11-03)
    return n === c.length - 1 && !c[n]?.is_user && !c[n]?.is_system;
}

function items(n) {
    const m = chat?.[n] || {};
    const sources = m.extra?.deeplore_sources;
    const changes = feedOf().filter(x => x.i === n).length;
    return [
        { heading: `Onyx Quill · message #${n}` },
        { label: 'Pitch from here', icon: 'pitch', onClick: () => window.__dleOpenPitches?.(n) },
        // Miinthe, 2026-10-19: Mero opens with this message attached (also: 📎 in her box, or @reply-#n)
        { label: 'Ask Mero about this', icon: 'mero', onClick: () => window.__dleAskMero?.({ label: `#${n} ${m.name}: ${String(m.mes || '').replace(/\s+/g, ' ').slice(0, 60)}`, text: `#${n} ${m.name}: ${String(m.mes || '').slice(0, 2500)}` }) },
        sources?.length
            ? { label: 'Why these entries', icon: 'why', sub: `${sources.length} ${sources.length === 1 ? 'entry' : 'entries'}`, onClick: () => why(n) }
            : { label: 'Why these entries', icon: 'why', sub: m.extra?.dle_npc ? 'no entries linked to them on the board' : 'no lore used', disabled: true },
        { label: 'What this changed', icon: 'history', sub: changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : undefined, onClick: () => whatChanged(n) },
        { label: 'Branch here as a new run', icon: 'newrun', onClick: () => branch(n) },
        // world layer stage 5 (Miinthe, 2026-10-19: "how can I start a rumor from a scene or message") — only where the world is on
        window.__dleWorldRumorsOn?.() ? { label: 'Start a rumor from this…', icon: 'leak', sub: 'someone spreads it', onClick: () => window.__dleWorldRumorFrom?.(n) } : null,
        'sep',
        // guided swipe + compare (Miinthe, 2026-11-02; mock-up https://claude.ai/artifact/ByQff64nfdyDB4acfqYm7N view 3)
        isNewestReply(n)
            ? { label: 'Guided swipe…', icon: 'wand', sub: 'swipe with a direction', onClick: async () => (await import('./guided-swipe.js')).openGuide(n) }
            : { label: 'Guided swipe…', icon: 'wand', sub: 'newest reply only', disabled: true },
        (m.swipes?.length || 0) > 1
            ? { label: 'Compare swipes', icon: 'eye', sub: `${m.swipes.length} swipes`, onClick: async () => (await import('./guided-swipe.js')).compareSwipes(n) }
            : null,
        isNewestReply(n)
            ? { label: 'Re-evaluate and swipe', icon: 'reev', sub: 'undoes its changes', onClick: async () => { const { reEvaluate } = await import('./reevaluate.js'); reEvaluate(); } }
            : { label: 'Re-evaluate and swipe', icon: 'reev', sub: 'newest reply only', disabled: true },
    ];
}

async function why(n) {
    const m = chat?.[n];
    const sources = m?.extra?.deeplore_sources;
    if (!sources?.length) return;
    const { showSourcesPopup } = await import('./ui/cartographer.js');
    showSourcesPopup(sources, { aiNotes: m?.extra?.deeplore_ai_notes, msgIdx: n });
}

function whatChanged(n) {
    window.__dleOpenChanges?.(n);   // the Story tab's "What changed" fold, scrolled to this message (src/panel/story-view.js)
}

async function branch(n) {
    try {
        const { branchChat } = await import('../../../../bookmarks.js');
        await branchChat(n);   // SillyTavern opens the branch; branch-run.js then offers to make it a new run
    } catch (err) { K.notify({ text: `Could not branch here: ${err?.message || err}`, tone: 'bad' }); }
}

/** Wire once. */
export function initReplyMenu() {
    const open = el => {
        const n = Number(el.closest('.mes')?.getAttribute('mesid'));
        if (Number.isInteger(n)) K.openMenu(el, items(n));
    };
    document.addEventListener('click', e => {
        const b = e.target.closest?.('.' + BTN_CLASS);
        if (b) { e.stopPropagation(); open(b); }
    }, true);
    document.addEventListener('keydown', e => {
        const b = e.target.closest?.('.' + BTN_CLASS);
        if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(b); }
    });
    try {
        eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(addButtons, 200));
        for (const ev of [event_types.MESSAGE_RECEIVED, event_types.MESSAGE_SENT, event_types.CHARACTER_MESSAGE_RENDERED, event_types.USER_MESSAGE_RENDERED, event_types.MESSAGE_SWIPED]) {
            if (ev) eventSource.on(ev, () => setTimeout(addButtons, 50));
        }
    } catch { /* noop */ }
    setTimeout(addButtons, 1000);
}
