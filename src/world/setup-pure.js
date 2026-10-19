/**
 * World layer, stage 6 — setting up a story's world with Mero (Miinthe, 2026-10-18: "Setup: describe it to Mero; she suggests
 * voices and style; Miinthe approves"; "when making the world set up, the AI looks at the profiles and suggest world profiles").
 *
 * One call on Mero's own connection (board-window.js worldSetup): from what Miinthe says about the world (or nothing), the
 * board's own note and the people's cards, Mero proposes the look, how alive it is, the news and rumor accounts' names,
 * voices and regulars, and each person's dials, interests and quirks — with her reasons. Nothing is used until Miinthe ticks
 * it and presses "Use the ticked" (board.html). Replaces stage 4's "Suggest a mix" (one home).
 */
import { normHabits } from './feed-pure.js';
import { normAlive } from './alive-pure.js';

const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export const SETUP_SCHEMA = {
    name: 'world_setup', strict: false,
    value: { type: 'object', properties: {
        note: { type: 'string' },
        look: { type: 'object', properties: { value: { type: 'string', enum: ['phone', 'letters'] }, why: { type: 'string' } } },
        alive: { type: 'object', properties: { open: { type: 'boolean' }, big: { type: 'boolean' }, time: { type: 'boolean' }, every: { type: 'boolean' }, everyN: { type: 'integer' }, quiet: { type: 'boolean' }, why: { type: 'string' } } },
        newsName: { type: 'string' }, rumorName: { type: 'string' },
        voices: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' }, bio: { type: 'string' }, quirks: { type: 'string' }, g: { type: 'integer' }, m: { type: 'integer' }, p: { type: 'integer' }, interests: { type: 'array', items: { type: 'string' } } }, required: ['name'] } },
        people: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, g: { type: 'integer' }, m: { type: 'integer' }, p: { type: 'integer' }, interests: { type: 'array', items: { type: 'string' } }, quirks: { type: 'string' } }, required: ['name'] } },
    }, required: ['voices', 'people'] },
};

/**
 * o: { persona (Mero's own words about herself), user (Miinthe's name), storyName, about (what Miinthe told her), setting (the
 * board's note), people: [{ key, name, about }], existing: [voice names], look }
 */
export function setupPrompt({ persona = '', user = 'Miinthe', storyName = 'the story', about = '', setting = '', people = [], existing = [], look = 'phone' }) {
    return {
        system: `You are Mero ☆, ${user}'s co-writer and story bestie.${persona ? ` ${clip(persona, 600)}` : ''} You set up the WORLD LAYER of her roleplay: the world around the story — a feed with posts and comments, the news, rumors, and messages between people. Propose everything at once; she ticks what she keeps.
- note: two to four sentences in your own voice to ${user} — your take on this world and what you went for.
- look: "phone" (texting, a social feed) or "letters" (letters that take story time, notes pinned to a town board, a gazette) — whichever fits the setting's era; why in one sentence.
- alive: when the world catches up by itself — open (when she opens the panel), big (after big moments), time (when story days pass), every + everyN (every N exchanges), quiet (when nothing happens for a while) — and why. Lively settings more, quiet ones less.
- newsName and rumorName: names for the story's news account (a paper, a crier, a bulletin) and its anonymous rumor account, fitting the setting.
- voices: 1–2 VOICES (institutions or publications: a local paper, a shop, a guild board) and 3–4 REGULARS (recurring locals with a strong personality — a gossip, a grump, a conspiracy theorist, a cheerful neighbor). Each: name, kind ("voice" or "regular"), a short bio, quirks (how they write), dials 1–3 (g = gossips, m = sends messages, p = posts), 1–2 interests. Fit the era; no names that already exist.
- people: for each of the story's people below (exact names): dials, 1–2 interests, and quirks — how THEY would text or write, from their description (e.g. "short sulky texts, no capitals"). Never for ${user} herself.
Answer with JSON only: {"note": "...", "look": {"value": "phone", "why": "..."}, "alive": {"open": true, "big": true, "time": true, "every": false, "everyN": 10, "quiet": false, "why": "..."}, "newsName": "...", "rumorName": "...", "voices": [{"name": "...", "kind": "voice", "bio": "...", "quirks": "...", "g": 2, "m": 1, "p": 3, "interests": ["..."]}], "people": [{"name": "exact name", "g": 2, "m": 2, "p": 2, "interests": ["..."], "quirks": "..."}]}`,
        user: [`THE STORY: ${storyName}`, about ? `WHAT ${user.toUpperCase()} SAYS ABOUT THE WORLD:\n${clip(about, 1500)}` : `${user} said nothing about the world — go by the story, its note and its people.`,
            setting ? `THE BOARD'S NOTE:\n${clip(setting, 1200)}` : '', `NOW IT LOOKS LIKE: ${look === 'letters' ? 'letters' : 'phone'}`,
            `THE STORY'S PEOPLE\n${arr(people).map(p => `- ${p.name}: ${clip(p.about, 500) || '(no description)'}`).join('\n') || '- (nobody yet)'}`,
            arr(existing).length ? `VOICES AND REGULARS ALREADY THERE (don't repeat): ${existing.join(', ')}` : '',
            'Set up the world now.'].filter(Boolean).join('\n\n'),
    };
}

/** Read Mero's setup against the people there are; anything unusable is left out. */
export function parseSetup(text, people = []) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const keyOf = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p.key]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        const voices = arr(v.voices).filter(x => isObj(x) && typeof x.name === 'string' && x.name.trim()).slice(0, 6)
            .map(x => ({ name: clip(x.name, 60), kind: x.kind === 'regular' ? 'regular' : 'voice', bio: clip(x.bio, 400), quirks: clip(x.quirks, 400), ...normHabits(x) }));
        const ppl = arr(v.people).filter(x => isObj(x) && keyOf.has(String(x.name || '').trim().toLowerCase()))
            .map(x => ({ key: keyOf.get(String(x.name).trim().toLowerCase()), ...normHabits(x), quirks: clip(x.quirks, 400) }));
        const look = isObj(v.look) && ['phone', 'letters'].includes(v.look.value) ? { value: v.look.value, why: clip(v.look.why, 240) } : null;
        const alive = isObj(v.alive) ? { ...normAlive(v.alive), why: clip(v.alive.why, 240) } : null;
        const out = { note: clip(v.note, 800), look, alive, newsName: clip(v.newsName, 60), rumorName: clip(v.rumorName, 60), voices, people: ppl };
        return voices.length || ppl.length || look || alive ? out : null;
    }
    return null;
}

/** "Catches up when you open it, after big moments, every 10 exchanges" — the alive mix in words. */
export function aliveWords(a) {
    const al = normAlive(a), w = [];
    if (al.open) w.push('when you open it');
    if (al.big) w.push('after big moments');
    if (al.time) w.push('when story days pass');
    if (al.every) w.push(`every ${al.everyN} exchanges`);
    if (al.quiet) w.push('when nothing happens for a while');
    return (w.length ? `Catches up ${w.join(', ')}` : 'Only when you ask') + (al.pulse && al.movesMax ? `; ${al.movesMin}–${al.movesMax} little moves after every reply` : '');
}
