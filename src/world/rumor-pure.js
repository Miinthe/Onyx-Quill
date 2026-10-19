/**
 * World layer, stage 5 — rumors and the story, the pure part (Miinthe, 2026-10-18/19; design §2c–2f, mock-up v5).
 *
 * A rumor is a post in Chatter with a `rumor` part: { kind: true · twisted · madeup · planned · '' (nobody knows),
 * truth (what's really behind it, for her eyes), from (where it started), who (who really put it out — the rumor
 * account hides it), heard: [keys] (who has heard it so far), drift: [{ by, text }] (how it changed when retold) }.
 *
 * - One rumor account per story (Miinthe: "just one rumor account then it doesn't matter from who it comes as long as the
 *   NPC knows it comes from them"), named on the board (default "Whispers"; with Letters "An unsigned note"). Anyone can
 *   post through it without a name; she can peek (👁 "Who posted?"). She can message it a tip: it answers in character,
 *   then spreads a version mixed with what others know (tipPrompt).
 * - From the story: people in the scene may turn what happened into a rumor (true, twisted or made up) — only what they
 *   saw or heard. It spreads by itself, with Undo.
 * - Three cheap additions (Claude's, Miinthe: "that sounds good especially because they're cheap"): word of mouth (high
 *   gossipers pass rumors on to people without posting — "Heard it so far"), retellings drift (each pass may twist it a
 *   little — "How it changed"), interests decide who notices.
 * - A tracker moves only where its board switch is on ("news and rumors can move this", off unless switched on).
 * All of it in ONE small call per tick (rumorPrompt), after the feed's.
 */
const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export const RUMOR = 'rumor';   // the rumor account's key (like USER and MAIN)
/**
 * The story's built-in news account (Miinthe, 2026-10-19: "why is kettle posting it? should it not be like a news account"):
 * used when the board has no newspaper voice of its own; named on the board (default "Local News"; Letters: "The Gazette").
 */
export const NEWS = 'news';
export const DEFAULT_NEWS_NAME = 'Local News';
export const newsName = (world, look = world?.look) => clip(world?.newsName, 60) || (look === 'letters' ? 'The Gazette' : DEFAULT_NEWS_NAME);
/** The reporter's "card" when {{user}} answers a request for a comment (messages.js answer). */
export const reporterCard = (name, look = 'phone') => `${name}: ${look === 'letters' ? 'the local gazette\'s correspondent, writing by letter' : 'a reporter for the local news, texting'}. Polite, curious, a little pushy. When someone gives a comment: thank them briefly — it goes in as they said it, so never ask whether to quote it; at most one short follow-up question about the story. Never put words in their mouth.`;
/** The request itself (no AI call): the news account asks {{user}} for a comment on an article. */
export const commentAsk = (outlet, headline, look = 'phone') => (look === 'letters'
    ? `We are preparing a piece for ${outlet}: "${headline}". Would you care to give a statement? Anything you write may be printed.`
    : `Hi! ${outlet} here 👋 We're running a story: "${headline}". Would you like to comment? Anything you say may be quoted.`);
/** Her answer goes into the article as an update. */
export const withComment = (post, who, outlet, words) => ({ text: `${String(post.text || '').trim()}\n\nUpdate: ${who} told ${outlet}: "${clip(words, 600)}"` });

/** The news account as a poster (feed-pure.js posters' shape) — only when the board has no voice of its own. */
export const newsAccount = world => ({ key: NEWS, name: newsName(world), kind: 'voice', about: 'The local news: reports what happens around here, plainly and a little dramatically.', quirks: '', g: 1, m: 1, p: 2, interests: ['local events'], muted: false });
export const RUMOR_KINDS = ['true', 'twisted', 'madeup', 'planned'];
export const KIND_WORDS = { true: 'True', twisted: 'Twisted', madeup: 'Made up', planned: 'Planned on the board', '': 'Nobody knows yet' };
export const DEFAULT_RUMOR_NAME = 'Whispers';
export const MAX_HEARD = 40;

/** The rumor account's name on this board (Letters: an unsigned note). */
export const rumorName = (world, look = world?.look) => (look === 'letters' ? 'An unsigned note' : clip(world?.rumorName, 60) || DEFAULT_RUMOR_NAME);

/** A rumor part, repaired (null when it isn't one). */
export function normRumor(r) {
    if (!isObj(r)) return null;
    return {
        kind: RUMOR_KINDS.includes(r.kind) ? r.kind : '', truth: clip(r.truth, 500), from: clip(r.from, 200), who: typeof r.who === 'string' ? r.who : '',
        heard: [...new Set(arr(r.heard).filter(k => typeof k === 'string' && k))].slice(0, MAX_HEARD),
        drift: arr(r.drift).filter(d => isObj(d) && typeof d.text === 'string' && d.text.trim()).map(d => ({ by: String(d.by || ''), text: clip(d.text, 400) })).slice(-8),
    };
}
export const rumorsOf = store => arr(store?.records).filter(r => r.kind === 'post' && isObj(r.rumor));
/** The rumors going around now, newest first (the ones the world still talks about). */
export const runningRumors = (store, max = 6) => rumorsOf(store).slice().sort((a, b) => b.n - a.n).slice(0, max);

/** Who heard it: add these (a copy of the post's rumor part). */
export const withHeard = (post, keys) => ({ rumor: { ...normRumor(post.rumor), heard: [...new Set([...arr(post.rumor?.heard), ...arr(keys)])].slice(0, MAX_HEARD) } });
/** A retelling that changed it a little. */
export const withDrift = (post, by, text) => ({ rumor: { ...normRumor(post.rumor), drift: [...arr(post.rumor?.drift), { by, text: clip(text, 400) }].slice(-8) } });

/** The fact someone keeps when they hear a rumor (their Cast knowledge; how: heard, via: rumor). */
export const heardFact = (text, fromName = '') => clip(`Heard a rumor${fromName ? ` from ${fromName}` : ''}: "${clip(text, 120)}"`, 160);
/** Cast "knows" changes for one listener. */
export function rumorChanges(cast, p, facts, newIdFn, reason = 'a rumor') {
    return arr(facts).map(fact => ({
        kind: 'cast', col: cast.id, person: p.id, field: 'knows', key: `knows:${cast.id}:${p.id}`,
        add: { id: newIdFn('k'), fact, how: 'heard', via: 'rumor' }, quote: null, who: 'world', reason,
    }));
}

/**
 * Who notices a POSTED rumor now (no AI call — "interests decide what people notice"): each person not in the know may
 * read it, more likely the more they gossip, much more when it touches what they care about. At most `max` per tick.
 * people: [{ key, name, g, interests, muted }].
 */
export const NOTICE_ODDS = [0, 0.1, 0.25, 0.45];
export function noticers(post, people, rand = Math.random, max = 2) {
    const heard = new Set(normRumor(post?.rumor)?.heard || []), text = String(post?.text || '').toLowerCase();
    const cares = p => arr(p.interests).some(i => String(i).toLowerCase().split(/[\s,]+/).some(w => w.length > 3 && text.includes(w)));
    const names = p => text.includes(String(p.name || '').toLowerCase()) ? 0.2 : 0;   // a rumor about you gets back to you
    return arr(people).filter(p => p && p.key && !p.muted && !heard.has(p.key) && post.by !== p.key)
        .filter(p => rand() < (NOTICE_ODDS[p.g] ?? 0.25) + (cares(p) ? 0.3 : 0) + names(p)).slice(0, max);
}

// ── the rumor call (one per tick) ───────────────────────────────────────────

export const RUMOR_SCHEMA = {
    name: 'world_rumors', strict: false,
    value: { type: 'object', properties: {
        newRumor: { type: ['object', 'null'], properties: { starter: { type: 'string' }, account: { type: 'boolean' }, text: { type: 'string' }, kind: { type: 'string' }, truth: { type: 'string' }, heard: { type: 'array', items: { type: 'string' } } } },
        spread: { type: 'array', items: { type: 'object', properties: { rumor: { type: 'integer' }, by: { type: 'string' }, to: { type: 'array', items: { type: 'string' } }, retold: { type: ['string', 'null'] } }, required: ['rumor', 'by', 'to'] } },
        moves: { type: 'array', items: { type: 'object', properties: { tracker: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } }, required: ['tracker', 'to'] } },
    } },
};
const DIAL = ['', 'low', 'average', 'high'];

/**
 * o: { userName, accountName, people: [{ name, kind, g, interests, here, knows: [fact] }], scene: [{ name, mes }] (the main
 * story's newest messages — only when someone listed was in it), rumors: [{ n, text, kind, heard: [names] }],
 * trackers: [{ name, steps: [name], now }] (only those switched on), look, when, newOk }
 */
export function rumorPrompt({ userName, accountName, people, scene = [], rumors = [], trackers = [], look = 'phone', when = '', newOk = true }) {
    const letters = look === 'letters';
    const sys = `You decide how rumors move in a roleplay's world. ${userName} is the player. ${when ? `In the story it is now ${when}.` : ''}
Rules:
- People only know what they saw, heard or were told. Someone "in the scene" saw the main story below; nobody else did.
- ${newOk ? `NEW RUMOR (at most one, often none): if something in the scene is worth gossiping about, someone who was there may start one — true, twisted, or made up (a made-up one serves what they want). "starter": their exact name; "account": true when they'd rather post it anonymously through ${accountName}${letters ? ' (an unsigned note)' : ''}; "text": the rumor as it would be posted, short, in their voice; "kind": "true" | "twisted" | "madeup"; "truth": one sentence, what's really behind it; "heard": who hears it straight away (exact names).` : 'No new rumor now.'}
- WORD OF MOUTH: people with "gossips: high" pass rumors they heard on to people they know, without posting; "average" sometimes; "low" rarely. A rumor that is POSTED can also be noticed by anyone who reads the feed — then "by" is whoever posted it ("posted by" below). ${userName} is the player: never "by", never in "to" — only the people listed. Who picks a rumor up follows what they care about. Each pass may change it a little (a detail added, a name swapped) — then give "retold": the new version; else null. 0–3 spreads, often 1.
${trackers.length ? `- TRACKERS: only if a rumor would really change one of these story trackers, move it to the named step ("moves"); almost always none.` : ''}
Answer with JSON only: {"newRumor": null, "spread": [{"rumor": 3, "by": "name", "to": ["name"], "retold": null}]${trackers.length ? ', "moves": []' : ''}}`;
    const who = arr(people).map(p => `- ${p.name}${p.here ? ' (in the scene)' : ''} — gossips: ${DIAL[p.g] || 'average'}${arr(p.interests).length ? `; cares about: ${p.interests.join(', ')}` : ''}${arr(p.knows).length ? `\n  knows: ${p.knows.slice(-5).join(' · ')}` : ''}`);
    const user = [
        arr(scene).length ? `THE SCENE (the main story, newest last)\n${scene.map(m => `${m.name}: ${clip(m.mes, 500)}`).join('\n')}` : 'Nobody listed was in the main scene just now.',
        `THE PEOPLE\n${who.join('\n')}`,
        arr(rumors).length ? `RUMORS GOING AROUND\n${rumors.map(r => `#${r.n} "${clip(r.text, 200)}"${r.by ? ` — posted by ${r.by}` : ''} — heard so far: ${arr(r.heard).join(', ') || 'nobody yet'}`).join('\n')}` : 'No rumors going around yet.',
        trackers.length ? `TRACKERS RUMORS MAY MOVE\n${trackers.map(t => `- ${t.name}: now "${t.now}"; steps: ${t.steps.join(' → ')}`).join('\n')}` : '',
        'What happens with rumors now?',
    ].filter(Boolean).join('\n\n');
    return { system: sys, user };
}

/** Read the rumor call against the names, rumor numbers and trackers there are; unknowns dropped. */
export function parseRumor(text, people, rumorNs = [], trackers = [], posters = []) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    // who may pass a rumor on: anyone listed, and whoever posted one (the rumor account) — readers notice the post
    const teller = new Map([...byName, ...arr(posters).map(p => [String(p.name).trim().toLowerCase(), p])]);
    const findBy = n => teller.get(String(n || '').trim().toLowerCase()) || null;
    const find = n => byName.get(String(n || '').trim().toLowerCase()) || null;
    const ns = new Set(arr(rumorNs));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        const r = isObj(v.newRumor) && typeof v.newRumor.text === 'string' && v.newRumor.text.trim() && find(v.newRumor.starter) ? v.newRumor : null;
        const newRumor = r ? { starter: find(r.starter), account: r.account === true, text: clip(r.text, 1200), kind: ['true', 'twisted', 'madeup'].includes(r.kind) ? r.kind : '', truth: clip(r.truth, 500), heard: arr(r.heard).map(find).filter(Boolean) } : null;
        const spread = arr(v.spread).filter(s => isObj(s) && ns.has(Math.round(Number(s.rumor))) && findBy(s.by)).map(s => ({
            rumor: Math.round(Number(s.rumor)), by: findBy(s.by), to: arr(s.to).map(find).filter(Boolean).filter(x => x.name !== findBy(s.by).name),
            retold: typeof s.retold === 'string' && s.retold.trim() ? clip(s.retold, 400) : null,
        })).filter(s => s.to.length).slice(0, 3);
        const moves = arr(v.moves).map(m => {
            const tr = arr(trackers).find(x => String(x.name).toLowerCase() === String(m?.tracker || '').trim().toLowerCase());
            const to = tr && tr.steps.find(s => String(s).toLowerCase() === String(m?.to || '').trim().toLowerCase());
            return tr && to && to !== tr.now ? { tracker: tr.name, to, why: clip(m.why, 200) } : null;
        }).filter(Boolean).slice(0, 1);
        return { newRumor, spread, moves };
    }
    return { newRumor: null, spread: [], moves: [] };
}

// ── a rumor from a message, on purpose (the reply menu; Miinthe, 2026-10-19: "how can I start a rumor from a scene or message") ──

export const SEED_SCHEMA = { name: 'world_seed_rumor', strict: false, value: { type: 'object', properties: { text: { type: 'string' }, truth: { type: 'string' }, heard: { type: 'array', items: { type: 'string' } } }, required: ['text'] } };
/** o: { starter (name), account (name or ''), message: { name, text }, kind ('true'|'twisted'|'madeup'), note, others: [names], look } */
export function seedRumorPrompt({ starter, account = '', message, kind = 'twisted', note = '', others = [], look = 'phone' }) {
    const how = { true: 'true — what really happened, told as gossip', twisted: 'twisted — based on what happened, but bent: a detail changed, a motive guessed, blown up', madeup: 'made up — inspired by it, but invented; it serves what the starter wants' }[kind] || 'twisted';
    return {
        system: `You write ONE rumor in a roleplay's world. ${starter} starts it${account ? `, posting it anonymously through ${account}${look === 'letters' ? ' (an unsigned note)' : ''} — never naming ${starter}` : ', under their own name'}. It comes from the moment below, and it is ${how}. Short and juicy, in ${account ? 'a gossip columnist\'s' : `${starter}'s`} voice.${note ? ` The author wants: ${clip(note, 400)}` : ''}
Answer with JSON only: {"text": "the rumor as posted", "truth": "one sentence: what's really behind it", "heard": ["who hears it straight away — exact names from the list, 0–2"]}`,
        user: `THE MOMENT (${clip(message?.name, 60)})\n${clip(message?.text, 2500)}\n\nPEOPLE WHO COULD HEAR IT: ${arr(others).join(', ') || 'nobody listed'}\n\nWrite the rumor now.`,
    };
}
export function parseSeed(text, people = []) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (isObj(v) && typeof v.text === 'string' && v.text.trim()) return { text: clip(v.text, 1200), truth: clip(v.truth, 500), heard: arr(v.heard).map(n => byName.get(String(n || '').trim().toLowerCase())).filter(Boolean).slice(0, 2) };
    }
    return null;
}

// ── a tip to the rumor account ──────────────────────────────────────────────

/** The account's "card" for its answers: who it is. */
export const accountCard = (name, look = 'phone') => (look === 'letters'
    ? `${name}: the town's anonymous notes — pinned to the board at night, unsigned. Delights in secrets, promises discretion, never reveals a source.`
    : `${name}: the story's anonymous gossip account. Anyone can send it a tip; it posts without names. Sly, delighted by secrets, promises discretion, never reveals a source. Talks like a gossip columnist.`);

export const TIP_SCHEMA = { name: 'world_tip', strict: false, value: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['true', 'twisted', 'madeup'] }, truth: { type: 'string' }, ask: { type: ['string', 'null'] } }, required: ['text', 'kind', 'truth'] } };
/**
 * After a tip (or a leak): the account spreads a version of it, mixed with what others know, maybe twisted or embellished.
 * o: { accountName, tipperName, tip, others: [{ name, knows: [fact] }], rumors: [text], look }
 */
export function tipPrompt({ accountName, tipperName, tip, talk = [], others = [], rumors = [], look = 'phone', canAsk = [] }) {
    const letters = look === 'letters';
    // checking with a witness first (Miinthe, F1: "ask Spoon" → an NPC-to-NPC chat, spaced over an exchange or two)
    const ask = arr(canAsk).length ? ` If the tip says to check with someone (“ask Spoon, she saw it too”) and they are one of: ${canAsk.join(', ')} — you may check with them first: give their exact name in "ask" and hold the post ("text": ""); you'll ${letters ? 'write to' : 'text'} them yourself and post once you've heard back. Only when the tip asks for it.` : '';
    return {
        system: `You are ${accountName}, ${letters ? 'the anonymous notes pinned to the town board' : 'an anonymous gossip account'} in a roleplay's world. Someone sent you a tip. Turn it into ONE ${letters ? 'unsigned note' : 'post'}: short, juicy, in your voice. Sources stay secret: never name who tipped you, and never name anyone the tip gives as a witness or source ("ask Spoon, she saw it too") — say "a little bird", "someone who was there". If the new message only adds to a tip from earlier in your talk, write the post about the whole of it. Mix in what others below already know where it fits; you may twist or embellish it a little. If the message holds nothing worth spreading (a greeting, small talk), answer {"text": ""}. Otherwise answer with JSON only: {"text": "the post", "kind": "true" | "twisted" | "madeup", "truth": "one sentence: what's really behind it and what you changed"${ask ? ', "ask": null' : ''}}.${ask}`,
        user: [arr(talk).length ? `YOUR TALK WITH ${tipperName} SO FAR\n${talk.map(l => clip(l, 300)).join('\n')}` : '',
            `THE TIP (from ${tipperName} — never name them)\n${clip(tip, 1500)}`,
            arr(others).filter(o => arr(o.knows).length).length ? `WHAT OTHERS KNOW\n${others.filter(o => arr(o.knows).length).map(o => `- ${o.name}: ${o.knows.slice(-4).join(' · ')}`).join('\n')}` : '',
            arr(rumors).length ? `ALREADY GOING AROUND (don't repeat)\n${rumors.map(t => `- ${clip(t, 160)}`).join('\n')}` : '',
            'Write the post now.'].filter(Boolean).join('\n\n'),
    };
}
/** Does a post name the one who tipped (a whole-word match, any case)? */
export function namesTipper(text, name) {
    const n = String(name ?? '').trim();
    if (!n) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(String(text ?? ''));
}
export function parseTip(text) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        const ask = typeof v.ask === 'string' && v.ask.trim() ? clip(v.ask, 80) : '';
        if ((typeof v.text === 'string' && v.text.trim()) || ask) return { text: clip(v.text, 1200), kind: ['true', 'twisted', 'madeup'].includes(v.kind) ? v.kind : '', truth: clip(v.truth, 500), ...(ask ? { ask } : {}) };
    }
    return null;
}

// ── the world, told to the main story's writer (Miinthe, 2026-10-19: "such a sentence would be nice") ──

/**
 * One line for the writer: what's PUBLIC in the world lately — news items and how far each world story has got — so the
 * main story can feel it where it fits. Rumors and messages stay out (not everyone has heard them). Only what came within
 * the last `within` main-chat messages, so old news drops off by itself. '' when there's nothing.
 */
export function worldNewsLine(store, lastI, { within = 40, max = 3, heardBy = '', name = '' } = {}) {
    const recs = arr(store?.records), fresh = r => Number.isInteger(r.i) && r.i >= lastI - within;
    const news = recs.filter(r => r.kind === 'post' && r.news && !isObj(r.rumor) && fresh(r)).sort((a, b) => b.n - a.n).slice(0, max)
        .map(p => clip(p.title || p.text, 140));
    const stories = recs.filter(r => r.kind === 'wstory' && Number(r.at) > 0).map(s => {
        const told = arr(s.phases).slice(0, Number(s.at)), last = told.at(-1);
        return last ? `${clip(s.title || s.seed, 60)}: ${clip(last, 140)}` : '';
    }).filter(Boolean).slice(-2);
    const items = [...new Set([...stories, ...news])].slice(0, max + 1);
    // the rumors the main character has heard himself (Miinthe, H1: asked what everyone is talking about, "He acts dumb?")
    const talk = heardBy ? rumorsOf(store).filter(p => fresh(p) && normRumor(p.rumor).heard.includes(heardBy)).sort((a, b) => b.n - a.n).slice(0, 2).map(p => clip(p.text, 140)) : [];
    const lines = [];
    if (items.length) lines.push(`IN THE WORLD LATELY (public news most people around have heard; let it come up where it fits, and when someone asks what's going on, they know it): ${items.join('; ')}`);
    if (talk.length) lines.push(`GOING AROUND (rumors ${name || 'the main character'} has heard; may be untrue): ${talk.join('; ')}`);
    return lines.join('\n');
}

// ── the world, told to Mero (Miinthe, 2026-10-19: "a short summary of the world for Mero") ──

/** A few lines: rumors going around, the latest posts and news, running world stories, recent messages with {{user}}. */
export function worldDigest(store, nameOf, { posts = 5, rumors = 4, msgs = 4, stories = [] } = {}) {
    const recs = arr(store?.records);
    const ps = recs.filter(r => r.kind === 'post').sort((a, b) => b.n - a.n);
    const rs = ps.filter(p => isObj(p.rumor)).slice(0, rumors);
    const plain = ps.filter(p => !isObj(p.rumor)).slice(0, posts);
    const ms = recs.filter(r => r.kind === 'msg').sort((a, b) => b.n - a.n).slice(0, msgs).reverse();
    const out = [];
    if (rs.length) out.push('Rumors going around:\n' + rs.map(p => { const r = normRumor(p.rumor); return `- "${clip(p.text, 160)}" (${KIND_WORDS[r.kind]}${r.truth ? ': ' + clip(r.truth, 120) : ''}; heard by ${r.heard.map(nameOf).join(', ') || 'nobody yet'})`; }).join('\n'));
    if (plain.length) out.push('Latest in the feed:\n' + plain.map(p => `- ${nameOf(p.by)}: ${p.title ? clip(p.title, 100) + ' — ' : ''}${clip(p.text, 160)}`).join('\n'));
    if (arr(stories).length) out.push('World stories running:\n' + stories.map(s => `- ${s.title} (next: ${clip(s.phases?.[s.at] || '', 100)})`).join('\n'));
    if (ms.length) out.push('Recent messages:\n' + ms.map(m => `- ${nameOf(m.from)} → ${nameOf(m.to)}: ${clip(Array.isArray(m.alts) ? m.alts[m.s || 0] : m.text, 140)}`).join('\n'));
    return out.join('\n\n');
}
