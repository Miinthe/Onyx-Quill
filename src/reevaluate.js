/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — Re-evaluate + swipe (triggers + odds, part 3; roadmap §4 G2 point 5).
 * Rules in reevaluate-pure.js. A normal swipe keeps what the board did; this one undoes everything
 * the newest reply's turn changed, runs the helper and the board again as if the message had just
 * been sent, makes the judge ask fresh, and swipes. Costs one helper call and one judge call.
 *
 * WIP controls (the real home is the DeepLore bar, still being designed): /dle-reevaluate and a
 * button in the Story tab.
 */
import { getContext } from '../../../../extensions.js';
import { chat_metadata } from '../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { escapeHtml } from '../../../../utils.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE } from '../../../../slash-commands/SlashCommandArgument.js';
import { turnOf, turnChanges } from './reevaluate-pure.js';
import { getTrackers, rewindTurn, boardTick } from './trackers.js';
import { runAutoTrack } from './autotrack.js';
import { STATE_KEY } from './board-live.js';
import { resetAiSearchCache } from './state.js';
import { setTurnIndex } from './turn-index.js';

let busy = false;
const say = (msg, kind = 'info') => { try { toastr[kind](msg, 'Re-evaluate'); } catch { /* noop */ } };

/** Re-evaluate the newest reply's turn and swipe. `confirm`: ask first (lists what will be undone). */
export async function reEvaluate({ confirm = true } = {}) {
    if (busy) return false;
    const ctx = getContext();
    const chat = ctx?.chat;
    const turn = turnOf(chat);
    if (!turn) { say('Nothing to re-evaluate: it works on the newest reply, after a message of yours.'); return false; }
    const changes = turnChanges(getTrackers(), chat_metadata?.[STATE_KEY]?.log, turn.start);
    if (confirm) {
        const list = changes.count ? `<ul>${changes.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '<p>Nothing on the board changed in this turn — only the judge is asked again.</p>';
        const ok = await callGenericPopup(`<h3>Re-evaluate and swipe?</h3><p>This undoes what the newest turn changed:</p>${list}
            <p style="opacity:.75;font-size:.9em">Then the helper and the judge are asked again (two AI calls) and a new swipe is written. A normal swipe keeps all of this.</p>`,
        POPUP_TYPE.CONFIRM, '', { okButton: 'Re-evaluate and swipe', cancelButton: 'Cancel' });
        if (!ok) return false;
    }
    busy = true;
    try {
        // 1. undo everything this turn caused
        rewindTurn(turn.keep, turn.start);
        // 2. the helper and the board again, as when the message was sent (recorded at that message)
        setTurnIndex(turn.at);
        try {
            await runAutoTrack(chat.slice(0, turn.reply), 'normal');
            boardTick();
        } finally { setTurnIndex(null); }
        // 3. the judge asks fresh
        resetAiSearchCache();
        // 4. a real new swipe
        const msg = chat[turn.reply];
        if (ctx.swipe?.to) await ctx.swipe.to(null, 'right', { forceSwipeId: Array.isArray(msg?.swipes) ? msg.swipes.length : 1 });
        else await ctx.swipe?.right?.();
        return true;
    } catch (err) {
        console.warn('[DLE] re-evaluate failed:', err?.message || err);
        say(`Re-evaluate stopped: ${err?.message || err}`, 'warning');
        return false;
    } finally { busy = false; }
}

export function registerReevaluateCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dle-reevaluate',
        returns: ARGUMENT_TYPE.STRING,
        callback: async () => { await reEvaluate({ confirm: true }); return ''; },
        helpString: 'Re-evaluate and swipe: undo what the newest turn changed on the board, ask the helper and the judge again, then write a new swipe.',
    }));
}
