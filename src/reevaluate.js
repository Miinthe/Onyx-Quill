/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — Re-evaluate + swipe (triggers + odds, part 3; roadmap §4 G2 point 5).
 * Rules in reevaluate-pure.js. A normal swipe keeps what the board did; this one undoes everything
 * the newest reply's turn changed, runs the helper and the board again as if the message had just
 * been sent, makes AI search pick fresh, and swipes. Costs one helper call and one AI search call.
 *
 * Controls: /oq-reevaluate and the bar's Re-evaluate and swipe button (Settings › Interface, "Button: Re-evaluate
 * and swipe").
 */
import { getContext } from '../../../../extensions.js';
import { chat_metadata } from '../../../../../script.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE } from '../../../../slash-commands/SlashCommandArgument.js';
import { turnOf } from './reevaluate-pure.js';
import { keepBoardForReevaluate, undoReevaluateKeep } from './swipe-board.js';
import { getTrackers, rewindTurn, boardTick } from './trackers.js';
import { runAutoTrack } from './autotrack.js';
import { STATE_KEY } from './board-live.js';
import { resetAiSearchCache } from './state.js';
import { setTurnIndex } from './turn-index.js';

let busy = false;
const say = (msg, kind = 'info') => { try { toastr[kind](msg, 'Re-evaluate'); } catch { /* noop */ } };

/**
 * Re-evaluate the newest reply's turn and swipe. No popup (Miinthe, 2026-11-04: "reevaluate doesn't delete anything, since
 * it's a swipe each swipe should keep the info"): the board of the swipe on screen is kept with that swipe
 * (swipe-board.js) — flipping back to it brings it back — and the new swipe gets a fresh evaluation.
 */
export async function reEvaluate() {
    if (busy) return false;
    const ctx = getContext();
    const chat = ctx?.chat;
    const turn = turnOf(chat);
    if (!turn) { say('Nothing to re-evaluate: it works on the newest reply, after a message of yours.'); return false; }
    keepBoardForReevaluate();
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
        console.warn('[Onyx Quill] re-evaluate failed:', err?.message || err);
        undoReevaluateKeep();   // the board of the swipe on screen, as it was before the rewind
        say(`Re-evaluate stopped: ${err?.message || err}`, 'warning');
        return false;
    } finally { busy = false; }
}

export function registerReevaluateCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'oq-reevaluate',
        returns: ARGUMENT_TYPE.STRING,
        callback: async () => { await reEvaluate(); return ''; },
        helpString: 'Re-evaluate and swipe: a new swipe with a fresh look at the newest turn — the story helper and AI search are asked again. Each swipe keeps its own board; flipping back brings it back.',
    }));
}
