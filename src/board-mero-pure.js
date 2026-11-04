/**
 * Overhaul (built 2026-10-17) — ☆ Mero on the board: what she is asked and how her answer is read. Pure; tested in
 * test/mero.test.mjs. The host (board-window.js → board-mero.js) makes ONE AI call per button press, on Mero's own
 * connection (Settings › AI & connections › Mero). Nothing she answers is written anywhere by itself: tiles go into the
 * Add window for "Use these", a draft fills the entries window (pink until changed) and is written only on Create /
 * Save, a suggestion on the board waits for Accept.
 *
 * Jobs (`task`):
 *   tiles  — the Add window's Ask Mero: names for a list (steps, places, states) from a few words.
 *   draft  — the entries window's Let Mero draft it: title, kind, keys, summary, text.
 *   field  — the entries window's Suggest: keys, or the summary.
 *   talk   — her window on the board: an answer, plus suggestions (a new step, a new tracker, an entry for a step).
 */

import { named, nameRule } from './mero-names-pure.js';
const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const oneLine = s => str(s).replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
/** Miinthe's vault is read in Obsidian: one paragraph = one line, a blank line between paragraphs. */
const paragraphs = s => str(s).split(/\n\s*\n/).map(oneLine).filter(Boolean).join('\n\n');
const low = s => str(s).trim().toLowerCase();

export const BOARD_MERO_TASKS = ['tiles', 'draft', 'field', 'talk'];
export const ENTRY_KINDS = ['character', 'location', 'lore', 'organization', 'story'];
const LIST_WORD = { steps: 'steps of a story line, in order', places: 'places where a scene can be', states: 'states an item moves through, from first to last' };

/** The board as Mero reads it: trackers with their tiles, and the connections written out. */
export function boardText(brief) {
    const b = brief && typeof brief === 'object' ? brief : {};
    const lines = [`Board: ${str(b.name) || '(unnamed)'}${arr(b.folders).length ? ` · reads the folders ${arr(b.folders).join(', ')}` : ''}`];
    for (const t of arr(b.trackers).slice(0, 40)) {
        const tiles = arr(t.steps).length ? arr(t.steps).map((s, i) => `${i}. ${str(s.name)}${arr(s.entries).length ? ` [entries: ${arr(s.entries).slice(0, 4).join('; ')}]` : ' [no entry]'}`).join(' → ')
            : arr(t.tiles).length ? arr(t.tiles).slice(0, 30).map(x => `${str(x.name)}${arr(x.entries).length ? ` [entries: ${arr(x.entries).slice(0, 4).join('; ')}]` : ' [no entry]'}`).join(', ')
            : [...arr(t.items), ...arr(t.places), ...arr(t.people)].slice(0, 30).join(', ');
        lines.push(`- tracker id "${str(t.id)}" · ${str(t.name)} (${str(t.kind) || 'steps'})${tiles ? `: ${tiles}` : ''}`);
    }
    if (!arr(b.trackers).length) lines.push('- (no trackers yet)');
    if (arr(b.wiring).length) lines.push('Connections:', ...arr(b.wiring).slice(0, 40).map(w => `- ${str(w)}`));
    return lines.join('\n');
}

const who = ({ persona = '', character = '' } = {}) => `You are Mero ☆, {{author}}'s co-writer and story bestie${character ? ` for their roleplay with ${character}` : ''}.${persona ? ` ${oneLine(persona)}` : ''}`;
import { normAsks, MAX_ASKS } from './ask-pure.js';

const JSON_ONLY = 'Answer with JSON only, no other text.';

/** What she knows of the story on the board, and how to stay true to it (Miinthe, 2026-11-04: "never make it up"). */
const NO_INVENTING = 'Never make up what happens in their story — who did what, why, a culprit, a cause, a secret. A name like "stolen" or "betrayal" is not a fact.';
export const BOARD_LOOKUPS = `The board below lists names (trackers, steps, entry titles), and you can read everything behind them with your lookups: search_lore and read_lore (the entries of this story — the board's own first), open_tracker (a tracker in detail), search_chat and read_messages (the roleplay), check_cast. When {{author}} asks about the story, or what is missing from it, look it up FIRST (read the entries of the line in question), then answer. Never say you can't see the story: look. ${NO_INVENTING} If the entries don't say it, ask {{author}} instead of guessing.`;
export const BOARD_NAMES_ONLY = `You see the board as names only (trackers, steps, entry titles) — not what the entries say, and you can't look them up with this connection. ${NO_INVENTING} Speak only about how the board is built (missing entries, short lines, missing links); when it depends on what happens in the story, ask {{author}}, or say clearly it is a hunch from the names.`;

/**
 * The prompt for one job. `input` per task (see the file header); `me` = { persona, character }.
 * @returns {{ system: string, user: string }}
 */
export function buildBoardMeroPrompt(task, input = {}, me = {}) {
    // the author's and Mero's names from her settings, in the instructions only (mero-names-pure.js)
    const r = boardPrompt(task, input, me);
    return { system: `${named(r.system, me?.names)}\n${nameRule(me?.names)}`, user: r.user };
}
function boardPrompt(task, input = {}, me = {}) {
    const i = input && typeof input === 'object' ? input : {};
    if (task === 'tiles') {
        const what = LIST_WORD[i.list] || LIST_WORD.states;
        return {
            system: [who(me), `{{author}} is adding "${str(i.name) || 'a new tracker'}" to their storyboard. Suggest the ${what}.`,
                'Short names (one to four words each), in story order, 3 to 7 of them. Fit them to their words; never repeat one they already have.',
                `${JSON_ONLY} {"tiles":["…","…"]}`].join('\n'),
            user: [`Their words: ${oneLine(i.words) || '(none — make a sensible start)'}`, arr(i.have).length ? `They already have: ${arr(i.have).join(', ')}` : '', i.brief ? `\n${boardText(i.brief)}` : ''].filter(Boolean).join('\n'),
        };
    }
    if (task === 'draft') {
        return {
            system: [who(me), 'Draft ONE lore entry for {{author}}\'s vault. It is sent to the story\'s writer when its keys come up, so write facts the writer can use, in plain prose — no headings, no lists, no markdown.',
                'Use what the board, the tile and the linked entries say; invent only small, fitting details and never contradict them. Keep it short: one to three paragraphs, each paragraph on ONE line.',
                'keys: 2 to 6 words or names that appear in the story when this entry matters. summary: one line saying WHEN the entry should be picked (not the secret it keeps).',
                `kind: one of ${ENTRY_KINDS.join(', ')}.`,
                `${JSON_ONLY} {"title":"…","kind":"…","keys":["…"],"summary":"…","text":"…"}`].join('\n'),
            user: [
                i.tile ? `The tile: ${str(i.tile)}${i.tracker ? ` (on the tracker ${str(i.tracker)})` : ''}` : 'A new entry, not tied to a tile.',
                i.title ? `Title they have in mind: ${oneLine(i.title)}` : '',
                `What it should be about: ${oneLine(i.words) || '(their choice: what this tile needs)'}`,
                arr(i.entries).length ? `\nLinked entries:\n${arr(i.entries).slice(0, 4).map(e => `### ${str(e.title)}\n${str(e.text).slice(0, 1500)}`).join('\n\n')}` : '',
                i.brief ? `\n${boardText(i.brief)}` : '',
            ].filter(Boolean).join('\n'),
        };
    }
    if (task === 'field') {
        const keys = i.field === 'keys';
        return {
            system: [who(me), keys ? 'Suggest the keys for a lore entry: 2 to 6 words or names that show up in the story when this entry matters. No generic words.'
                : 'Write the summary line for a lore entry: one line saying WHEN it should be picked (not the secret it keeps), at most 25 words.',
            `${JSON_ONLY} ${keys ? '{"keys":["…"]}' : '{"summary":"…"}'}`].join('\n'),
            user: [`Title: ${oneLine(i.title) || '(none yet)'}`, i.kind ? `Kind: ${str(i.kind)}` : '', i.tile ? `Tile: ${str(i.tile)}` : '', arr(i.keys).length ? `Keys so far: ${arr(i.keys).join(', ')}` : '', i.summary ? `Summary so far: ${oneLine(i.summary)}` : '', i.text ? `Text:\n${str(i.text).slice(0, 2500)}` : ''].filter(Boolean).join('\n'),
        };
    }
    // talk
    const quick = { gaps: `Find gaps on this board: tiles without an entry that need one, a story line that stops too early, a missing tracker. At most 4 suggestions.${i.lookups ? ' Look first: read the entries of the story lines (read_lore), and search the lore (search_lore) for this story\'s entries that no tile links yet — an entry that exists but isn\'t on the board is a gap too: suggest linking it to its step (kind "link").' : ''}`,
        explain: 'Explain how this board is wired, in a few plain sentences: what drives the story, what waits on what. No suggestions.',
        build: 'Build what {{author}} describes: suggest a new tracker (with its steps), or steps for an existing one.' }[i.quick] || '';
    return {
        system: [who(me), 'Right now you help {{author}} set up their storyboard (trackers with steps; entries linked to tiles). Talk like yourself, short — two to five sentences.',
            'You may suggest changes; {{author}} accepts or refuses each one. Kinds: {"kind":"step","tracker":"<tracker id>","name":"…","why":"…"} adds a step at the end of a tracker; {"kind":"tracker","name":"…","icon":"<one emoji>","steps":["…"],"why":"…"} a new tracker with 2 to 7 steps; {"kind":"entry","tracker":"<tracker id>","step":<step number>,"title":"…","why":"…"} a NEW entry for a step that has none; {"kind":"link","tracker":"<tracker id>","step":<step number>,"title":"<the exact title of an entry that already exists>","why":"…"} links an existing entry to a step (for a place, person or item use "tile":"<its name>" instead of "step") — prefer this when the lore already has the entry.',   // "link": Miinthe, 2026-11-04
            'Use only tracker ids and step numbers that are on the board. No suggestions is fine.',
            'When {{author}} tells you what they want, build it with them right away from what they gave you — don\'t question their premise or re-argue it; at most one question, after you\'ve built something. Planning ahead is not the current scene.',
            // Miinthe, 2026-11-04: Find gaps invented a poisoner for "A Stolen Eternity" from its name — there is no culprit
            i.lookups ? BOARD_LOOKUPS : BOARD_NAMES_ONLY,
            // question cards (Miinthe, 2026-11-02: "would be useful for storyboard Mero as well")
            `When you need to know something from {{author}} to help (which tracker, what should happen, how it ends) and there are a few clear possible answers, ask it as a question card in "asks" instead of in your text: {"q":"the question?","pick":"one"|"many","options":["…","…"]} — 2 to 4 short answers that really differ (they can always write their own), at most ${MAX_ASKS} cards, only when you need to know.`,
            `${i.lookups ? 'Look things up first if you need to (call the tools — don\'t describe them). Then your final answer is JSON only, no other text:' : JSON_ONLY} {"text":"your answer","suggestions":[…],"asks":[…]}`].join('\n'),
        user: [boardText(i.brief), arr(i.talk).length ? `\nThis talk so far:\n${arr(i.talk).slice(-8).map(m => `${m.who === 'you' ? (me?.names?.you || 'The author') : (me?.names?.me || 'Mero')}: ${oneLine(m.t)}`).join('\n')}` : '', `\n${me?.names?.you || 'The author'}: ${quick || oneLine(i.message)}`, i.handover ? `\n[What the entries say — handed to you for this message]\n${str(i.handover)}` : ''].filter(Boolean).join('\n'),
    };
}

/**
 * What the board talk hands Mero up front — no AI call (Miinthe, 2026-11-04: cheap models rarely choose to look things up
 * on their own, so Find gaps made up a poisoner from a name). A message that names a tracker or a step: the full text of
 * that tracker's linked entries. Find gaps / Explain: the summary of every linked entry. `entryOf(title)` → { summary,
 * content } or null (only entries this story may read). Returns { text, n } — text '' when there is nothing to hand.
 */
export function boardHandover(brief, said = '', quick = null, entryOf = () => null, max = 9000, unlinked = []) {
    const trackers = arr(brief?.trackers).filter(t => arr(t.steps).length);
    const q = ` ${low(said).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    const names = x => ` ${low(x).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const named = quick ? [] : trackers.filter(t => q.includes(names(t.name)) || arr(t.steps).some(st => low(st.name).length > 3 && q.includes(names(st.name))));
    const full = named.length > 0;
    const pick = full ? named : (quick === 'gaps' || quick === 'explain') ? trackers : [];
    const out = [], seen = new Set();
    let size = 0, n = 0;
    for (const t of pick) for (const [k, st] of arr(t.steps).entries()) for (const title of arr(st.entries)) {
        if (seen.has(`${t.id}|${title}`)) continue;
        seen.add(`${t.id}|${title}`);
        const e = entryOf(title); if (!e) continue;
        const body = full ? str(e.content || e.summary).trim() : oneLine(e.summary || str(e.content).slice(0, 240));
        if (!body) continue;
        const line = `${t.name} › ${k}. ${str(st.name)} › ${title}: ${full ? `\n${body}` : body}`;
        if (size + line.length > max) { out.push('[… more entries — look them up with read_lore if you need them]'); return { text: out.join('\n'), n, full, loose: 0 }; }
        out.push(line); size += line.length; n++;
    }
    // Find gaps: this story's entries no tile links yet — an entry that exists but isn't on the board is a gap too
    const loose = quick === 'gaps' ? arr(unlinked).filter(e => e && str(e.title)).slice(0, 30) : [];
    if (loose.length) {
        out.push(`${out.length ? '\n' : ''}[Entries of this story that no tile links yet${arr(unlinked).length > loose.length ? ` — ${loose.length} of ${arr(unlinked).length}` : ''}]`);
        for (const e of loose) { const line = `- ${str(e.title)}${e.summary ? `: ${oneLine(e.summary).slice(0, 140)}` : ''}`; if (size + line.length > max + 4000) break; out.push(line); size += line.length; }
    }
    return { text: out.join(full ? '\n\n' : '\n'), n, full, loose: loose.length };
}

/** Raw line breaks and tabs inside JSON strings (models write them) → escaped, so the answer still reads. */
function escapeInStrings(t) {
    let out = '', inStr = false, esc = false;
    for (const c of t) {
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            else if (c === '\n') { out += '\\n'; continue; }
            else if (c === '\r') continue;
            else if (c === '\t') { out += '\\t'; continue; }
        } else if (c === '"') inStr = true;
        out += c;
    }
    return out;
}

/** The JSON in an answer (a fenced block, or the outermost braces), or null. */
/**
 * An answer that isn't readable JSON — usually one cut off at the length limit (2026-11-04, DeepSeek on the board after 8
 * lookups): her "text" as far as it got, marked as cut, instead of raw JSON. Plain prose stays as it is.
 */
export function cutAnswer(text) {
    const t = str(text), m = t.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)("?)/);
    if (!m) return oneLine(t.replace(/^\s*```(?:json)?\s*/i, ''));
    let body = m[1];
    try { body = JSON.parse(`"${body.replace(/\\$/, '')}"`); } catch { body = body.replace(/\\n/g, ' ').replace(/\\"/g, '"'); }
    return oneLine(body) + (m[2] ? '' : ' … (her answer was cut off — ask again)');
}

export function readJson(text) {
    const raw = str(text).trim();
    const tries = [raw];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) tries.push(fence[1]);
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of [...tries, ...tries.map(escapeInStrings)]) { try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* the next form */ } }
    return null;
}

const cleanList = (list, max, len = 60) => [...new Set(arr(list).map(x => oneLine(x).slice(0, len)).filter(Boolean))].slice(0, max);

/**
 * Her answer → what the window can use, checked. Returns { ok: true, … } or { ok: false, error }.
 * tiles: { tiles } · draft: { title, type, keys, summary, body } · field: { keys } | { summary } · talk: { text, suggestions }.
 */
export function parseBoardMero(task, text, input = {}) {
    const v = readJson(text);
    if (task === 'talk' && !v && str(text).trim()) return { ok: true, text: cutAnswer(text).slice(0, 2000), suggestions: [], asks: [] };
    if (!v) return { ok: false, error: 'Mero\'s answer could not be read — try again' };
    if (task === 'tiles') {
        const have = new Set(arr(input.have).map(low));
        const tiles = cleanList(v.tiles, 8).filter(t => !have.has(low(t)));
        return tiles.length ? { ok: true, tiles } : { ok: false, error: 'Mero had nothing new to add' };
    }
    if (task === 'draft') {
        const title = oneLine(v.title).slice(0, 120), body = paragraphs(v.text ?? v.body);
        if (!title && !body) return { ok: false, error: 'Mero\'s draft came back empty — try again' };
        return { ok: true, title, type: ENTRY_KINDS.includes(low(v.kind ?? v.type)) ? low(v.kind ?? v.type) : '', keys: cleanList(v.keys, 8, 40), summary: oneLine(v.summary).slice(0, 300), body };
    }
    if (task === 'field') {
        if (input.field === 'keys') { const keys = cleanList(v.keys, 8, 40); return keys.length ? { ok: true, keys } : { ok: false, error: 'Mero had no keys to suggest' }; }
        const summary = oneLine(v.summary).slice(0, 300);
        return summary ? { ok: true, summary } : { ok: false, error: 'Mero had no summary to suggest' };
    }
    // talk: suggestions only for trackers / steps that are on the board
    const trackers = arr(input.brief?.trackers);
    const byId = new Map(trackers.map(t => [str(t.id), t]));
    const out = [];
    for (const s of arr(v.suggestions)) {
        if (!s || typeof s !== 'object' || out.length >= 6) continue;
        const why = oneLine(s.why).slice(0, 300);
        if (s.kind === 'step') {
            const t = byId.get(str(s.tracker)), name = oneLine(s.name).slice(0, 60);
            if (!t || !arr(t.steps).length || !name || arr(t.steps).some(x => low(x.name) === low(name))) continue;
            out.push({ kind: 'step', t: t.id, name, why, text: `Add the step ${name} to ${t.name}` });
        } else if (s.kind === 'tracker') {
            const name = oneLine(s.name).slice(0, 60), steps = cleanList(s.steps, 7);
            if (!name || steps.length < 2 || trackers.some(t => low(t.name) === low(name))) continue;
            out.push({ kind: 'tracker', name, icon: [...str(s.icon).trim()].slice(0, 2).join('') || '📶', steps, why, text: `A new tracker: ${name}` });
        } else if (s.kind === 'link') {
            // only an entry that exists (in what this story reads), by its exact title, not yet on that step
            const t = byId.get(str(s.tracker)), want = low(oneLine(s.title));
            const title = arr(input.known).find(k => low(k) === want);
            if (!t || !title) continue;
            const onTile = !arr(t.steps).length, i = Math.floor(Number(s.step));
            const st = onTile ? arr(t.tiles).find(x => low(x.name) === low(oneLine(s.tile ?? s.step))) : Number.isFinite(i) ? arr(t.steps)[i] : null;
            if (!st || arr(st.entries).some(e => low(e) === low(title))) continue;
            const where = onTile ? { tile: str(st.name) } : { i };
            if (out.some(o => o.kind === 'link' && o.t === t.id && o.title === title && (onTile ? o.tile === where.tile : o.i === i))) continue;
            out.push({ kind: 'link', t: t.id, ...where, title, why, text: `Link “${title}” to ${st.name}` });
        } else if (s.kind === 'entry') {
            const t = byId.get(str(s.tracker)), i = Math.floor(Number(s.step)), title = oneLine(s.title).slice(0, 120);
            const st = t && Number.isFinite(i) ? arr(t.steps)[i] : null;
            if (!st || !title) continue;
            out.push({ kind: 'entry', t: t.id, i, title, why, text: `An entry for ${st.name}: ${title}` });
        }
    }
    const answer = oneLine(v.text ?? v.answer).slice(0, 2000);
    const asks = normAsks(v.asks ?? v.ask);
    if (!answer && !out.length && !asks.length) return { ok: false, error: 'Mero\'s answer came back empty — try again' };
    return { ok: true, text: answer || (out.length ? 'Here’s what I’d add — it’s marked ✨ on the board.' : asks.length ? 'A quick question first:' : ''), suggestions: out, asks };
}

/** Why Mero can't help on the board right now ('' = she can). */
export function meroBoardBlock({ job = 'part', connected = false } = {}) {
    if (job === 'off') return 'Mero is off duty (her settings › Her job)';
    if (!connected) return 'Mero has no AI yet: Settings › AI & connections › Mero';
    return '';
}
