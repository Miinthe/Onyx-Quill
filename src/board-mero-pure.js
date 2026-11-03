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
    const quick = { gaps: 'Find gaps on this board: tiles without an entry that need one, a story line that stops too early, a missing tracker. At most 4 suggestions.',
        explain: 'Explain how this board is wired, in a few plain sentences: what drives the story, what waits on what. No suggestions.',
        build: 'Build what {{author}} describes: suggest a new tracker (with its steps), or steps for an existing one.' }[i.quick] || '';
    return {
        system: [who(me), 'Right now you help {{author}} set up their storyboard (trackers with steps; entries linked to tiles). Talk like yourself, short — two to five sentences.',
            'You may suggest changes; {{author}} accepts or refuses each one. Kinds: {"kind":"step","tracker":"<tracker id>","name":"…","why":"…"} adds a step at the end of a tracker; {"kind":"tracker","name":"…","icon":"<one emoji>","steps":["…"],"why":"…"} a new tracker with 2 to 7 steps; {"kind":"entry","tracker":"<tracker id>","step":<step number>,"title":"…","why":"…"} an entry for a step that has none.',
            'Use only tracker ids and step numbers that are on the board. No suggestions is fine.',
            // question cards (Miinthe, 2026-11-02: "would be useful for storyboard Mero as well")
            `When you need to know something from {{author}} to help (which tracker, what should happen, how it ends) and there are a few clear possible answers, ask it as a question card in "asks" instead of in your text: {"q":"the question?","pick":"one"|"many","options":["…","…"]} — 2 to 4 short answers that really differ (they can always write their own), at most ${MAX_ASKS} cards, only when you need to know.`,
            `${JSON_ONLY} {"text":"your answer","suggestions":[…],"asks":[…]}`].join('\n'),
        user: [boardText(i.brief), arr(i.talk).length ? `\nThis talk so far:\n${arr(i.talk).slice(-8).map(m => `${m.who === 'you' ? (me?.names?.you || 'The author') : (me?.names?.me || 'Mero')}: ${oneLine(m.t)}`).join('\n')}` : '', `\n${me?.names?.you || 'The author'}: ${quick || oneLine(i.message)}`].filter(Boolean).join('\n'),
    };
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
    if (task === 'talk' && !v && str(text).trim()) return { ok: true, text: oneLine(text).slice(0, 2000), suggestions: [], asks: [] };
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
