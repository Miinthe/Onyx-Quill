/**
 * LOCAL PATCH (Miinthe, 2026-10-05) — test-only ESM loader: a pretend SillyTavern, so the REAL engine glue
 * (trackers.js, autotrack.js, board-live.js, reevaluate.js …) runs in plain Node for the characterization tests
 * of `13 engine on v2 plan.md` step 0. No production code changes.
 *
 * - Every import that points outside the repo (SillyTavern's script.js, extensions.js, popup.js …) is served as a
 *   small stub module; the live state (chat, chat_metadata, extension_settings, the context) comes from
 *   `globalThis.__ST`, which the test fills before importing anything.
 * - `src/ai/ai.js` is served with one change: `callAI` first asks `globalThis.__ST.callAI` (the scripted helper).
 *
 * Registered from a test via: register('./_st-stub-loader.mjs', import.meta.url, { data: { root } });
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let ROOT = '';
export async function initialize(data) { ROOT = data.root; }

const S = 'const S = () => globalThis.__ST;\n';
const STUBS = {
    'script.js': S + `
export const chat_metadata = S().chat_metadata;
export const chat = S().chat;
export const saveSettingsDebounced = () => {};
export const main_api = 'openai';
export const CONNECT_API_MAP = {};
export const amount_gen = 400;
export const generateQuietPrompt = async () => '';
export const getCurrentChatId = () => S().chatId;
export const name1 = 'Miinthe';
export const eventSource = { on() {}, once() {}, emit: async () => {}, removeListener() {}, makeLast() {}, makeFirst() {} };
export const event_types = new Proxy({}, { get: (_t, p) => String(p) });`,
    'extensions.js': S + `
export const getContext = () => S().context();
export const saveMetadataDebounced = () => {};
export const extension_settings = S().extension_settings;`,
    'popup.js': S + `
export const callGenericPopup = async () => (S().popupAnswer ?? 1);
export const POPUP_TYPE = { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4 };
export const POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };`,
    'utils.js': `
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);`,
    'SlashCommandParser.js': 'export const SlashCommandParser = { addCommandObject() {}, commands: {} };',
    'SlashCommand.js': 'export const SlashCommand = { fromProps: x => x };',
    'SlashCommandArgument.js': `export const SlashCommandArgument = { fromProps: x => x };
export const ARGUMENT_TYPE = { STRING: 'string', NUMBER: 'number', BOOLEAN: 'bool', LIST: 'list' };
export const SlashCommandNamedArgument = { fromProps: x => x };`,
    'shared.js': 'export const ConnectionManagerRequestService = { sendRequest: async () => ({ content: "" }) };',
    'openai.js': 'export const oai_settings = {};',
    'i18n.js': `export const addLocaleData = () => {};
export const getCurrentLocale = () => 'en';
export const translate = s => s;
export const t = (strings, ...vals) => (Array.isArray(strings) ? strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '') : String(strings));`,
    'tokenizers.js': 'export const getTokenCountAsync = async s => Math.ceil(String(s ?? "").length / 4);',
};
const EMPTY = 'export default {};';

export async function resolve(specifier, context, next) {
    if (context.parentURL?.startsWith('file:') && (specifier.startsWith('.') || specifier.startsWith('/'))) {
        const url = new URL(specifier, context.parentURL);
        if (url.protocol === 'file:' && !fileURLToPath(url).startsWith(ROOT)) {
            return { url: `st-stub:${specifier.split('/').pop()}`, shortCircuit: true };
        }
    }
    return next(specifier, context);
}

export async function load(url, context, next) {
    if (url.startsWith('st-stub:')) {
        const name = url.slice('st-stub:'.length);
        return { format: 'module', shortCircuit: true, source: STUBS[name] ?? EMPTY };
    }
    if (url.endsWith('/src/ai/ai.js')) {
        let source = await readFile(fileURLToPath(url), 'utf8');
        source = source.replace('export async function callAI(', 'export async function callAI(...a) { if (globalThis.__ST?.callAI) return globalThis.__ST.callAI(...a); return _realCallAI(...a); }\nasync function _realCallAI(');
        return { format: 'module', shortCircuit: true, source };
    }
    return next(url, context);
}
