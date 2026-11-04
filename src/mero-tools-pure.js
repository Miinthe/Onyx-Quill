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
    fn('search_lore', 'Search the lore of this story (the entries about characters, places, history, plot — only the folders this story reads; the open board\'s own entries come first). Returns matching entry titles with a short look at each. Use it before saying anything about lore you were not given.',
        { query: { type: 'string', description: 'A name or a few words to look for' } }, ['query']),
    fn('read_lore', 'Read one lore entry in full, by its title (from search_lore or from what you were given).',
        { title: { type: 'string', description: 'The entry title' } }, ['title']),
    fn('open_tracker', 'Open one tracker of the storyboard: for a step tracker, each of its steps, which one is now, which are done and to come, and what each step is about; for any other tracker (a meter, a collection, a place, the state, the Cast), where it stands now.',
        { name: { type: 'string', description: 'The tracker\'s name, or one of its step names' } }, ['name']),
    fn('search_chat', 'Search the whole roleplay chat (not only the latest replies) for a word or a name. Returns the matching messages with their numbers and a short look.',
        { query: { type: 'string', description: 'Words to look for' } }, ['query']),
    fn('read_messages', 'Read messages of the roleplay chat by number, e.g. from 40 to 44 (at most 6 at once).',
        { from: { type: 'integer', description: 'First message number' }, to: { type: 'integer', description: 'Last message number' } }, ['from']),
    fn('check_cast', 'Look at someone in the story\'s Cast: whether they are in the scene, what they want, plan and know.',
        { name: { type: 'string', description: 'The person\'s name' } }, ['name']),
];

/**
 * 🌐 The web (Miinthe, 2026-11-03: "adding a browser function to mero chat"; her pick: Mero searches when she needs to, with
 * a switch). Offered only when the switch is on and a search is set up in SillyTavern (mero-web.js: the Web Search
 * extension, whatever service it uses — or a saved Tavily key); pages come through SillyTavern's /api/search/visit.
 */
export const WEB_DEFS = [
    fn('search_web', 'Search the internet for real-world facts you don\'t know or need to check — e.g. the official lore of a book, film or game the story is based on, a real place, a word or a custom. NOT for the author\'s own story: their lore, board and chat always win over the web when they disagree. Returns what the search found (with links when the search gives them).',
        { query: { type: 'string', description: 'What to search for, like you would type it into a search engine' } }, ['query']),
    fn('read_page', 'Read one web page as plain text, by its link (from search_web, or one you know).',
        { url: { type: 'string', description: 'The full link, starting with https://' } }, ['url']),
];
export const WEB_TOOLS = new Set(WEB_DEFS.map(d => d.function.name));

const hostOf = u => { try { return new URL(str(u)).hostname.replace(/^www\./, ''); } catch { return clip(u, 50); } };

/** A Tavily answer → { text (for Mero), got (for Miinthe) }. */
export function webResults(json, query = '', n = 6) {
    const list = arr(json?.results).filter(r => r && (r.url || r.title)).slice(0, n);
    const answer = str(json?.answer).trim();
    if (!list.length && !answer) return { text: `The web search for “${str(query)}” found nothing.`, got: 'nothing found' };
    const text = [answer ? `Short answer (from the search engine, may be wrong): ${clip(answer, 600)}` : '',
        ...list.map((r, k) => `${k + 1}. ${clip(r.title, 120)} — ${str(r.url)}\n   ${clip(r.content, 400)}`)].filter(Boolean).join('\n');
    return { text, got: list.length ? `${list.length} results: ${[...new Set(list.map(r => hostOf(r.url)))].slice(0, 3).join(' · ')}` : 'a short answer' };
}

/** What the Web Search extension's /websearch gave back (plain text, any service) → { text, got }. */
export function webSnippets(out, query = '') {
    const t = str(out).trim();
    if (!t) return { text: `The web search for “${str(query)}” found nothing (or no search service is set up).`, got: 'nothing found' };
    const lines = t.split(/\n+/).filter(l => l.trim());
    return { text: t.length > 6000 ? t.slice(0, 6000).replace(/\s\S*$/, '') + '\n[… cut]' : t, got: `${lines.length} snippet${lines.length > 1 ? 's' : ''}` };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = t => str(t).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? (c => (Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '))(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
/** A web page's HTML → its readable text (the main part when the page marks one), at most `max` characters. */
export function pageText(html, max = 6000) {
    let h = str(html);
    const title = clip(decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''), 160);
    h = h.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    const main = h.match(/<main\b[\s\S]*?<\/main>/i) || h.match(/<article\b[\s\S]*?<\/article>/i);
    if (main) h = main[0];
    else h = h.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
    let t = decode(h.replace(/<\/(p|div|li|tr|h[1-6]|section|blockquote|dd|dt)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
    t = t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (t.length > max) t = t.slice(0, max).replace(/\s\S*$/, '') + '\n[… the rest of the page is cut]';
    return { title, text: t };
}

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
        case 'search_web': return `🌐 Searched the web: “${clip(a.query, 60)}”`;
        case 'read_page': return `🌐 Read a page: ${hostOf(a.url)}`;
        default: return `🔧 ${clip(name, 40)}`;
    }
}

// ── the lore ─────────────────────────────────────────────────────────────────

/** The board's own entries and folders, for ranking (Miinthe, 2026-11-04: "the board does have priority"). */
const onBoard = (e, prefer) => {
    if (!prefer) return 0;
    if (arr(prefer.titles).some(t => low(t) === low(e.title))) return 2;
    const f = str(e.folderPath);
    return f && arr(prefer.folders).some(x => { const d = str(x).replace(/\/+$/, ''); return d && (f === d || f.startsWith(d + '/')); }) ? 1 : 0;
};

/**
 * Entries ranked for a query: title words count most, then keys, then the text. `prefer` = { titles, folders } of the
 * open board: its linked entries rank first, then entries in its folders (only among real hits — it never adds one).
 */
export function searchLore(entries, query, n = 8, prefer = null) {
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
        if (s > 0 && (all || s >= 12)) out.push({ e, s: s + (all ? 5 : 0) + [0, 10, 25][onBoard(e, prefer)] });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, n).map(x => x.e);
}

/**
 * The entries her message names, as Mero is handed them — no AI call (Miinthe, 2026-11-04: cheap models rarely choose a
 * lookup on their own; "looking it up would work similar like just vanilla deeplore"). `hits` = the entries whose keys
 * DeepLore's own matcher found in her words. The open board's first; the first `full` in full (each at most 2000
 * characters), the next few as their summary; all of it at most `max` characters. Returns { text, titles }.
 */
export function handedLore(hits, prefer = null, { full = 3, more = 5, max = 6000 } = {}) {
    const list = arr(hits).filter(e => e && !e.guide && str(e.title)).map((e, i) => ({ e, i, b: onBoard(e, prefer) })).sort((a, b) => b.b - a.b || a.i - b.i).map(x => x.e);
    const out = [], titles = [];
    let size = 0;
    for (const [k, e] of list.slice(0, full + more).entries()) {
        const body = k < full ? str(e.content || e.summary).trim().slice(0, 2000) : clip(e.summary || e.content, 240);
        if (!body) continue;
        const line = k < full ? `### ${e.title}\n${body}` : `- ${e.title}: ${body}`;
        if (size + line.length > max) break;
        out.push(line); titles.push(e.title); size += line.length;
    }
    if (list.length > titles.length) out.push(`(${list.length - titles.length} more named — read_lore if you need them)`);
    return { text: out.join('\n\n'), titles };
}

/** The entry with this title (exact first, then the closest one). */
export function findLore(entries, title, prefer = null) {
    const q = low(title).trim();
    if (!q) return null;
    // the board's own entries first, so a title two stories share opens this board's one
    const list = arr(entries).filter(e => e && !e.guide && str(e.title)).map((e, i) => ({ e, i, b: onBoard(e, prefer) })).sort((a, b) => b.b - a.b || a.i - b.i).map(x => x.e);
    return list.find(e => low(e.title) === q) || list.find(e => low(e.title).includes(q)) || list.find(e => q.includes(low(e.title))) || searchLore(list, title, 1, prefer)[0] || null;
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
 * Run one tool. data: { entries (already only what this story may read), prefer ({ titles, folders } of the open board), chat: [{ i, name, text }] (the whole chat), board, state, entryText(title),
 * castText(name) → text or '', castNames: [names] }. Returns { text (for Mero), got (a few words for Miinthe) }.
 */
export function runTool(name, a = {}, data = {}) {
    const entries = arr(data.entries), chat = arr(data.chat);
    if (name === 'search_lore') {
        const hits = searchLore(entries, a.query, 8, data.prefer);
        if (!hits.length) return { text: `Nothing in the lore matches “${str(a.query)}”.`, got: 'nothing found' };
        return {
            text: hits.map(e => `- ${e.title}${arr(e.keys).length ? ` (keys: ${arr(e.keys).slice(0, 6).join(', ')})` : ''}: ${clip(e.summary || e.content, 200)}`).join('\n'),
            got: (n => `${hits.length} found: ${n.slice(0, 4).join(' · ')}${n.length > 4 ? ' …' : ''}`)([...new Set(hits.map(e => e.title))]),
        };
    }
    if (name === 'read_lore') {
        const e = findLore(entries, a.title, data.prefer);
        if (!e) return { text: `No entry called “${str(a.title)}”. Try search_lore.`, got: 'not found' };
        const body = str(e.content || e.summary).trim();
        return { text: `### ${e.title}\n${body.slice(0, 6000)}${body.length > 6000 ? '\n[… cut]' : ''}`, got: e.title === str(a.title) ? 'read' : `found “${e.title}”` };
    }
    if (name === 'open_tracker') {
        const board = data.board, trackers = arr(board?.trackers).filter(t => t?.kind === 'steps' && arr(t.steps).length);
        let id = namedTrackers(a.name, board, 1)[0];
        if (!id) id = trackers.find(t => low(t.name).includes(low(a.name).trim()) && low(a.name).trim())?.id;
        if (!id && board) {
            // a tracker without steps (a meter, a collection, a place, the state, the Cast…): what the writer is told about it
            // (Miinthe, 2026-11-03: Mero couldn't open "Where" or "Cast" — "her being able to see the board is kind of important")
            const q = low(a.name).trim(), other = q && arr(board.trackers).find(t => t && !trackers.includes(t) && (low(t.name) === q || low(t.name).includes(q) || q.includes(low(t.name))));
            if (other) {
                // the writer's lines are labeled by kind (PLACE:, IN THE SCENE:), not by the tracker's name: the whole state, its own lines first
                const all = arr(data.boardLines).filter(l => !/^\[(?:Where the story currently stands|End of story state)\]$/.test(str(l).trim()));
                const own = all.filter(l => low(l).includes(low(other.name)));
                const lines = [...own, ...all.filter(l => !own.includes(l))];
                const body = lines.join('\n');
                return { text: `${other.name} (${other.kind || 'tracker'}) — where the story stands now:\n${body ? body.slice(0, 4000) : 'Nothing about it in this chat yet.'}`, got: lines.length ? clip(lines[0], 60) : 'empty' };
            }
        }
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
    // "Service is too busy" (DeepSeek, Miinthe 2026-11-03: it switched lookups off for the whole session)
    return /timed? ?out|timeout|\b429\b|rate.?limit|too many requests|\b5\d\d\b|bad gateway|unavailable|overloaded|too busy|\bbusy\b|capacity|try again|server error|network|failed to fetch|fetch failed|ECONN|socket|aborted/i.test(m);
}

/** What a reply keeps of its lookups (shown when Miinthe opens the header): the line and the few words of what came back. */
export const keptStep = (label, got) => ({ label: clip(label, 120), ...(got ? { got: clip(got, 160) } : {}) });
export const normSteps = v => arr(v).filter(s => s && str(s.label).trim()).slice(0, MAX_LOOKUPS + 1).map(s => keptStep(s.label, s.got));   // + 1: "📖 Handed to her" (2026-11-04)
