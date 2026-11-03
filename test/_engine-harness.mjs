/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — the engine harness for the characterization tests (`13 engine on v2 plan.md`
 * step 0): a pretend SillyTavern (chat, chat_metadata, settings, a context, notices) and the REAL engine glue
 * loaded on top of it (_st-stub-loader.mjs). Tests script a chat, a board and the helper's answers.
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
register('./_st-stub-loader.mjs', import.meta.url, { data: { root } });

const notices = [];
const ST = globalThis.__ST = {
    chat: [], chat_metadata: {}, extension_settings: { onyxquill: { enabled: true, storyTrackerConnectionMode: 'profile', storyTrackerProfileId: 'test-profile' } },
    chatId: 'Claude test', character: { name: 'test bot 1', avatar: 'test bot 1.png' },
    helper: [],                 // scripted helper answers (objects), used in order
    calls: [],                  // what the helper was asked
    callAI: async (system, user, opts) => {
        ST.calls.push({ system, user, caller: opts?.caller });
        const next = ST.helper.shift();
        return { text: typeof next === 'string' ? next : JSON.stringify(next ?? {}), usage: {} };
    },
    swipes: 0,
    context() {
        return {
            chat: ST.chat, chatMetadata: ST.chat_metadata, extensionSettings: ST.extension_settings,
            characters: [{ ...ST.character }], characterId: 0, groupId: null, name1: 'Miinthe',
            getCurrentChatId: () => ST.chatId,
            swipe: { to: async () => { ST.swipes++; }, right: async () => { ST.swipes++; } },
        };
    },
};
globalThis.toastr = new Proxy({}, { get: (_t, kind) => (msg, title) => { notices.push({ kind, msg: String(msg).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), title }); return { on() {} }; } });
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {} }) };
globalThis.$ = () => ({ on() { return this; }, find() { return this; }, length: 0 });

export const st = ST;
export const takeNotices = () => notices.splice(0);

/** Load the real engine (after the pretend SillyTavern is in place). */
export async function engine() {
    const [trackers, autotrack, live, reeval, model, window_] = await Promise.all([
        import('../src/trackers.js'), import('../src/autotrack.js'), import('../src/board-live.js'),
        import('../src/reevaluate.js'), import('../src/board-model-pure.js'), import('../src/board-window-pure.js'),
    ]);
    return { trackers, autotrack, live, reeval, model, window: window_ };
}

/** A fresh chat: empty messages, metadata and boards (the settings keep the helper's profile). */
export function resetChat() {
    ST.chat.splice(0);
    for (const k of Object.keys(ST.chat_metadata)) delete ST.chat_metadata[k];
    for (const k of Object.keys(ST.extension_settings)) if (k !== 'onyxquill') delete ST.extension_settings[k];
    ST.helper.splice(0); ST.calls.splice(0); ST.swipes = 0; notices.splice(0);
}

/** Add messages: say('user', 'text') / say('ai', 'text'). Returns the new message's index. */
export function say(who, text) {
    ST.chat.push({ name: who === 'user' ? 'Miinthe' : 'test bot 1', is_user: who === 'user', is_system: false, mes: text, send_date: String(ST.chat.length), extra: {} });
    return ST.chat.length - 1;
}
