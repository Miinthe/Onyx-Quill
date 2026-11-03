/**
 * 🌐 Mero's web lookups (Miinthe, 2026-11-03: "adding a browser function to mero chat (via a browser … key of course)").
 * Neutral about the search service (Miinthe: "not everyone uses the same … key providers"): the search goes through the Web
 * Search extension's own /websearch command, so whatever service is picked there is used (Tavily, SerpApi, SearXNG,
 * Serper …). Without that extension, a Tavily key saved in SillyTavern still works (SillyTavern's /api/search/tavily).
 * Pages are read with SillyTavern's /api/search/visit. Keys stay on the server; nothing here stores anything.
 * The rules (tool definitions, labels, turning results and pages into text) are in mero-tools-pure.js.
 */
import { getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { secret_state } from '../../../../secrets.js';
import { webResults, webSnippets, pageText } from './mero-tools-pure.js';

const searchCommand = () => { try { return getContext()?.SlashCommandParser?.commands?.websearch || null; } catch { return null; } };
const tavilyKey = () => { try { const s = secret_state?.api_key_tavily; return Array.isArray(s) ? s.length > 0 : !!s; } catch { return false; } };

/** Can Mero search? The Web Search extension is there, or a Tavily key is saved. */
export function webReady() { return !!searchCommand()?.callback || tavilyKey(); }

async function post(path, body, ms = 25000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetch(path, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body), signal: ctl.signal });
        if (!r.ok) throw new Error(r.status === 400 ? 'no search key, or a bad link' : `the server said ${r.status}`);
        return r;
    } catch (err) { throw new Error(err?.name === 'AbortError' ? 'it took too long' : err?.message || String(err)); }
    finally { clearTimeout(timer); }
}

/** Run search_web / read_page. Returns { text (for Mero), got (a few words for Miinthe) }; never throws. */
export async function runWebTool(name, a = {}) {
    try {
        if (name === 'search_web') {
            const q = String(a.query ?? '').trim();
            if (!q) return { text: 'Give the search some words in "query".', got: 'no words' };
            const cmd = searchCommand();
            if (cmd?.callback) return webSnippets(await cmd.callback({ snippets: 'true', links: 'false' }, q), q);
            const r = await post('/api/search/tavily', { query: q });
            return webResults(await r.json(), q);
        }
        if (name === 'read_page') {
            const url = String(a.url ?? '').trim();
            if (!/^https?:\/\//i.test(url)) return { text: 'Give a full link starting with https://.', got: 'not a link' };
            const r = await post('/api/search/visit', { url, html: true });
            const { title, text } = pageText(await r.text());
            if (!text) return { text: `The page ${url} had no readable text.`, got: 'nothing readable' };
            return { text: `${title ? `# ${title}\n` : ''}${url}\n\n${text}`, got: title || 'read' };
        }
        return { text: `There is no tool called ${name}.`, got: 'unknown tool' };
    } catch (err) {
        return { text: `The web lookup failed (${err?.message || err}). Answer without it, and say you couldn't check.`, got: `failed: ${err?.message || err}` };
    }
}
