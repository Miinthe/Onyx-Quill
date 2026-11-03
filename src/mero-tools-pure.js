/**
 * Mero's lookups (Miinthe, 2026-11-02: "give the mero chat tool calls and then also show me what tool calls it does").
 * Pure; tested in test/mero-tools.test.mjs. The glue (gathering the lore, the chat, the board, the Cast and running
 * the rounds) is in mero.js; the request itself in ai/tool-call.js.
 *
 * Why: Mero only sees the latest replies, the lore of the last reply and a summary of the board. When Miinthe said "it's
 * the last interlude, feel free to look it up", there was nothing to look it up with — and Mero answered as if she had.
 * Every tool here only READS: nothing Mero does with them changes the story, the lore or the board.
 */
import { namedTrackers, trackerDetails } from './mero-board-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const low = s => str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const clip = (s, n) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : t; };
const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'what', 'that', 'this', 'from', 'into', 'all', 'any', 'was', 'are', 'his', 'her', 'its', 'who', 'how', 'why', 'when', 'where']);
const wordsOf = q => (low(q).match(/[\p{L}\p{N}']{3,}/gu) || []).filter(w => !STOP.has(w));
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where `w` starts a word in `text` (so "ren" finds "Rén Lú" but not "Lorenzo"). */
const wordAt = (text, w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(w)}`, 'gu');
const hasWord = (text, w) => wordAt(text, w).test(text);

/** At most this many rounds of lookups per answer; the last round has no tools, so she has to answer. */
export const MAX_TOOL_ROUNDS = 4;
/** At most this many lookups per answer, all rounds together. */
export const MAX_LOOKUPS = 8;

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

/** The tools, in the OpenAI function format (SillyTavern passes them on to the provider). */
export const TOOL_DEFS = [
    fn('search_lore', 'Search Miinthe\'s lore vault (the entries about characters, places, history, plot). Returns matching entry titles with a short look at each. Use it before saying anything about lore you were not given.',
        { query: { type: 'string', description: 'A name or a few words to look for' } }, ['query']),
    fn('read_lore', 'Read one lore entry in full, by its title (from search_lore or from what you were given).',
        { title: { type: 'string', description: 'The entry title' } }, ['title']),
    fn('open_tracker', 'Open one tracker of the storyboard: each of its steps, which one is now, which are done and to come, and what each step is about.',
        { name: { type: 'string', description: 'The tracker\'s name, or one of its step names' } }, ['name']),
    fn('search_chat', 'Search the whole roleplay chat (not only the latest replies) for a word or a name. Returns the matching messages with their numbers and a short look.',
        { query: { type: 'string', description: 'Words to look for' } }, ['query']),
    fn('read_messages', 'Read messages of the roleplay chat by number, e.g. from 40 to 44 (at most 6 at once).',
        { from: { type: 'integer', description: 'First message number' }, to: { type: 'integer', description: 'Last message number' } }, ['from']),
    fn('check_cast', 'Look at someone in the story\'s Cast: whether they are in the scene, what they want, plan and know.',
        { name: { type: 'string', description: 'The person\'s name' } }, ['name']),
];

/** The arguments as the model sent them (a JSON string, usually) — {} when they are not readable. */
export function argsOf(raw) {
    if (raw && typeof raw === 'object') return raw;
    try { const v = JSON.parse(str(raw) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** One line for Miinthe, while Mero works and in the reply's header afterwards. */
export function toolLabel(name, a = {}) {
    switch (name) {
        case 'search_lore': return `🔎 Searched the lore: “${clip(a.query, 60)}”`;
        case 'read_lore': return `📖 Read: ${clip(a.title, 70)}`;
        case 'open_tracker': return `🪜 Opened the tracker: ${clip(a.name, 60)}`;
        case 'search_chat': return `📜 Searched the chat: “${clip(a.query, 60)}”`;
        case 'read_messages': { const f = Math.round(Number(a.from)), t = Math.round(Number(a.to ?? a.from)); return `📜 Read message${t > f ? `s #${f}–#${t}` : ` #${f}`}`; }
        case 'check_cast': return `🎭 Checked: ${clip(a.name, 60)}`;
        default: return `🔧 ${clip(name, 40)}`;
    }
}

// ── the lore ─────────────────────────────────────────────────────────────────

/** Entries ranked for a query: title words count most, then keys, then the text. */
export function searchLore(entries, query, n = 8) {
    const ws = wordsOf(query), q = low(query).trim();
    if (!ws.length) return [];
    const out = [];
    for (const e of arr(entries)) {
        if (!e || e.guide || !str(e.title)) continue;
        const t = low(e.title), keys = arr(e.keys).map(low), body = low(e.content || e.summary);
        let s = 0;
        if (t === q) s += 60; else if (hasWord(t, q)) s += 30;
        for (const w of ws) {
            if (hasWord(t, w)) s += 12;
            if (keys.some(k => k === w || hasWord(k, w))) s += 8;
            s += Math.min(5, (body.match(wordAt(body, w)) || []).length);
        }
        // every word somewhere: a real hit, not one common word
        const all = ws.every(w => hasWord(t, w) || keys.some(k => hasWord(k, w)) || hasWord(body, w));
        if (s > 0 && (all || s >= 12)) out.push({ e, s: s + (all ? 5 : 0) });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, n).map(x => x.e);
}

/** The entry with this title (exact first, then the closest one). */
export function findLore(entries, title) {
    const q = low(title).trim();
    if (!q) return null;
    const list = arr(entries).filter(e => e && !e.guide && str(e.title));
    return list.find(e => low(e.title) === q) || list.find(e => low(e.title).includes(q)) || list.find(e => q.includes(low(e.title))) || searchLore(list, title, 1)[0] || null;
}

// ── the chat ─────────────────────────────────────────────────────────────────

/** Messages containing every word of the query: [{ i, name, text }] with a short look around the first hit. */
export function searchChat(chat, query, n = 10) {
    const ws = wordsOf(query).length ? wordsOf(query) : (low(query).match(/[\p{L}\p{N}']{2,}/gu) || []);
    if (!ws.length) return [];
    const out = [];
    for (const m of arr(chat)) {
        const t = low(m?.text);
        if (!ws.every(w => hasWord(t, w))) continue;
        const at = Math.max(0, t.indexOf(ws[0]) - 90);
        out.push({ i: m.i, name: m.name, text: (at ? '…' : '') + clip(str(m.text).slice(at), 240) });
    }
    return out.slice(-n);   // the newest hits
}

/** The first choice's message in either shape: OpenAI-style (most sources) or Claude's content blocks. */
export function readReply(json) {
    const m = json?.choices?.[0]?.message;
    if (m) {
        const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).filter(c => c?.function?.name).map((c, k) => ({ id: String(c.id || `call_${k}`), name: String(c.function.name), args: c.function.arguments ?? '{}' }));
        return { text: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(x => x?.text || '').join('') : '', calls, reasoning: typeof m.reasoning_content === 'string' ? m.reasoning_content : (typeof m.reasoning === 'string' ? m.reasoning : '') };
    }
    if (Array.isArray(json?.content)) {   // Claude
        const calls = json.content.filter(b => b?.type === 'tool_use').map(b => ({ id: String(b.id), name: String(b.name), args: JSON.stringify(b.input || {}) }));
        return { text: json.content.filter(b => b?.type === 'text').map(b => b.text).join(''), calls, reasoning: '' };
    }
    return { text: typeof json === 'string' ? json : '', calls: [], reasoning: '' };
}

// ── running one ──────────────────────────────────────────────────────────────

/**
 * Run one tool. data: { entries, chat: [{ i, name, text }] (the whole chat), board, state, entryText(title),
 * castText(name) → text or '', castNames: [names] }. Returns { text (for Mero), got (a few words for Miinthe) }.
 */
export function runTool(name, a = {}, data = {}) {
    const entries = arr(data.entries), chat = arr(data.chat);
    if (name === 'search_lore') {
        const hits = searchLore(entries, a.query);
        if (!hits.length) return { text: `Nothing in the lore matches “${str(a.query)}”.`, got: 'nothing found' };
        return {
            text: hits.map(e => `- ${e.title}${arr(e.keys).length ? ` (keys: ${arr(e.keys).slice(0, 6).join(', ')})` : ''}: ${clip(e.summary || e.content, 200)}`).join('\n'),
            got: (n => `${hits.length} found: ${n.slice(0, 4).join(' · ')}${n.length > 4 ? ' …' : ''}`)([...new Set(hits.map(e => e.title))]),
        };
    }
    if (name === 'read_lore') {
        const e = findLore(entries, a.title);
        if (!e) return { text: `No entry called “${str(a.title)}”. Try search_lore.`, got: 'not found' };
        const body = str(e.content || e.summary).trim();
        return { text: `### ${e.title}\n${body.slice(0, 6000)}${body.length > 6000 ? '\n[… cut]' : ''}`, got: e.title === str(a.title) ? 'read' : `found “${e.title}”` };
    }
    if (name === 'open_tracker') {
        const board = data.board, trackers = arr(board?.trackers).filter(t => t?.kind === 'steps' && arr(t.steps).length);
        let id = namedTrackers(a.name, board, 1)[0];
        if (!id) id = trackers.find(t => low(t.name).includes(low(a.name).trim()) && low(a.name).trim())?.id;
        if (!id) {
            const others = arr(board?.trackers).filter(t => t && !trackers.includes(t)).map(t => `${t.name} (${t.kind || 'other'})`);
            const text = !board ? 'There is no storyboard in this chat.'
                : trackers.length ? `No tracker called “${str(a.name)}”. The trackers with steps: ${trackers.map(t => t.name).join(', ')}.`
                    : `The storyboard${board.name ? ` “${board.name}”` : ''} has no trackers with steps${others.length ? ` — only: ${others.join(', ')}` : ''}.`;
            return { text, got: 'not found' };
        }
        const d = trackerDetails(board, String(id), data.state, data.entryText || (() => ''), { perStep: 800 });
        return { text: d || 'That tracker has no steps.', got: d ? `“${d.split('\n')[0]}”` : 'empty' };
    }
    if (name === 'search_chat') {
        const hits = searchChat(chat, a.query);
        if (!hits.length) return { text: `No message in the chat has “${str(a.query)}”.`, got: 'nothing found' };
        return { text: hits.map(m => `#${m.i} ${m.name}: ${m.text}`).join('\n\n'), got: `${hits.length} message${hits.length > 1 ? 's' : ''}: ${hits.map(m => '#' + m.i).slice(-6).join(' ')}` };
    }
    if (name === 'read_messages') {
        const last = chat.length ? chat[chat.length - 1].i : -1;
        let f = Math.round(Number(a.from)), t = Math.round(Number(a.to ?? a.from));
        if (!Number.isFinite(f)) return { text: 'Give a message number in "from".', got: 'no number' };
        if (!Number.isFinite(t) || t < f) t = f;
        f = Math.max(0, f); t = Math.min(t, f + 5, last);
        const list = chat.filter(m => m.i >= f && m.i <= t);
        if (!list.length) return { text: `There is no message #${f} (the chat goes up to #${last}).`, got: 'not there' };
        return { text: list.map(m => `#${m.i} ${m.name}: ${str(m.text).slice(0, 3000)}`).join('\n\n'), got: `${list.length} message${list.length > 1 ? 's' : ''}` };
    }
    if (name === 'check_cast') {
        const t = typeof data.castText === 'function' ? str(data.castText(a.name)) : '';
        if (!t) { const n = arr(data.castNames); return { text: n.length ? `No one called “${str(a.name)}” in the Cast. In the Cast: ${n.join(', ')}.` : 'There is no Cast in this story.', got: 'not found' }; }
        return { text: t, got: clip(t.split('\n')[0], 60) };
    }
    return { text: `There is no tool called ${str(name)}.`, got: 'unknown tool' };
}

/**
 * Was a failed lookups call only a passing hiccup (timeout, rate limit, server or network trouble)? Then lookups stay on
 * for the next answer. Anything else (a 400, a template that can't take tools or tool results) means this connection
 * can't do lookups — remembered for the session (bug hunt 2026-11-03: one DeepSeek timeout switched them off for good).
 */
export function passingError(err) {
    const m = String(err?.message || err || '') + ' ' + String(err?.status ?? err?.cause?.status ?? '');
    return /timed? ?out|timeout|\b429\b|rate.?limit|too many requests|\b5\d\d\b|bad gateway|unavailable|overloaded|network|failed to fetch|fetch failed|ECONN|socket|aborted/i.test(m);
}

/** What a reply keeps of its lookups (shown when Miinthe opens the header): the line and the few words of what came back. */
export const keptStep = (label, got) => ({ label: clip(label, 120), ...(got ? { got: clip(got, 160) } : {}) });
export const normSteps = v => arr(v).filter(s => s && str(s.label).trim()).slice(0, MAX_LOOKUPS).map(s => keptStep(s.label, s.got));
