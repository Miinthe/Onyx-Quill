/**
 * World layer, stage 4 — the feed (Chatter and News), the pure part (Miinthe, 2026-10-19; design §2c–2f, mock-up v5).
 *
 * Who posts: the Cast and the main character (their keys), the story's own VOICES (a newspaper, a shop, an office —
 * key 'v:<id>') and REGULARS (recurring commenters with a personality — key 'v:<id>' too, kind 'regular'), all set up on
 * the board's World tab. Everyone has three dials (gossips · sends messages · posts: 1 low, 2 average, 3 high) and one or
 * two interests. Passers-by stay nameless: they only make the numbers ("and 23 others like this").
 *
 * Per chat (the world store): posts (`kind: 'post'`; `news: true` + a title for articles), each with its likes and
 * comments; WORLD STORIES (`kind: 'wstory'`) — a seed the world plans into a few phases and tells over several story
 * days, one phase at a time. Everything the world makes by itself is `auto` (swipes never touch the world).
 */
const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const dial = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : 2; };
// gossip and posts may also be NEVER (0) (Miinthe, 2026-10-26: "a cast member just never gossips (or posts) period")
const dial0 = v => { if (v === null || v === undefined || v === '') return 2; const n = Math.round(Number(v)); return n >= 0 && n <= 3 ? n : 2; };

// ── who is in the world ─────────────────────────────────────────────────────

/** Someone's habits: { g (gossips), m (sends messages), p (posts), interests: [≤3] }. */
export function normHabits(h) {
    const x = isObj(h) ? h : {};
    return { g: dial0(x.g), m: dial(x.m), p: dial0(x.p), interests: arr(x.interests).map(s => clip(s, 60)).filter(Boolean).slice(0, 3) };
}
/** A story voice or a regular, repaired (null when unusable). */
export function normVoice(v) {
    if (!isObj(v) || typeof v.id !== 'string' || !v.id || !String(v.name || '').trim()) return null;
    return {
        id: v.id, name: clip(v.name, 60), kind: v.kind === 'regular' ? 'regular' : 'voice',
        bio: clip(v.bio, 400), quirks: clip(v.quirks, 600), ...normHabits(v),
        ...(v.muted === true ? { muted: true } : {}),
    };
}
export const normVoices = list => arr(list).map(normVoice).filter(Boolean).slice(0, 40);
export const voiceKey = v => `v:${v.id}`;

/**
 * Everyone who can post, with what the world needs: [{ key, name, kind ('cast'|'main'|'voice'|'regular'), about, quirks,
 * g, m, p, interests, muted }]. `people` = world.people (Cast + main habits/quirks/muted); `cast` = [{ key, name, about }].
 */
export function posters({ main = null, cast = [], voices = [], people = {}, userName = 'the player' }) {
    const habitsOf = k => normHabits(people?.[k]);
    const base = (key, name, kind, about) => ({ key, name, kind, about: clip(about, 600), quirks: clip(people?.[key]?.quirks, 600), ...habitsOf(key), muted: people?.[key]?.muted === true });
    const list = [
        ...(main ? [base('main', main.name, 'main', main.about)] : []),
        ...arr(cast).map(c => base(c.key, c.name, 'cast', c.about)),
        ...normVoices(voices).map(v => ({ key: voiceKey(v), name: v.name, kind: v.kind, about: v.bio, quirks: v.quirks, g: v.g, m: v.m, p: v.p, interests: v.interests, muted: v.muted === true })),
    ];
    // who they never gossip about (Miinthe, 2026-10-26), as names — keys the list doesn't know are dropped
    const nameOfKey = new Map(list.map(p => [p.key, p.name]));
    for (const p of list) {
        const hush = arr(people?.[p.key]?.hush).map(k => (k === 'user' ? userName : nameOfKey.get(k))).filter(Boolean);
        if (hush.length) p.hush = hush;
    }
    return list;
}

// ── posts in the store ──────────────────────────────────────────────────────

export const postsOf = store => arr(store?.records).filter(r => r.kind === 'post');
export const storiesOf = store => arr(store?.records).filter(r => r.kind === 'wstory');
export const nextPostN = store => postsOf(store).reduce((mx, p) => Math.max(mx, Number(p.n) || 0), 0) + 1;

/** A new post (the caller adds it with addRecord). */
export function newPost({ store, by, text, title = '', news = false, story = null, stamp = null, id, crowd = 0, auto = false }) {
    return {
        kind: 'post', id, n: nextPostN(store), by, text: clip(text, 3000), ...(news ? { news: true, title: clip(title, 160) } : {}),
        ...(story ? { story } : {}), ...(stamp ? { stamp } : {}),
        likes: [], crowd: Math.max(0, Math.round(Number(crowd) || 0)), comments: [], ...(auto ? { auto: true } : {}),
    };
}
/** Change one post (a copy). */
export function updatePost(store, id, fn) {
    return { ...store, records: arr(store?.records).map(r => (r.kind === 'post' && r.id === id ? { ...r, ...fn(r) } : r)) };
}
/** A post's versions ([{ title, text }]); a post written once has one. */
const versions = p => (arr(p.alts).length ? p.alts : [{ title: p.title || '', text: p.text }]);
/** ↻ wrote it again: the new version is added and shown. */
export const addPostVersion = (p, v) => { const alts = [...versions(p), { title: clip(v.title || '', 160), text: clip(v.text, 3000) }]; return { alts, s: alts.length - 1, title: alts.at(-1).title || p.title, text: alts.at(-1).text }; };
/** ‹ › between a post's versions. */
export const showPostVersion = (p, by) => { const alts = versions(p), s = Math.max(0, Math.min(alts.length - 1, (Number(p.s) || 0) + by)); return { s, title: alts[s].title || p.title, text: alts[s].text }; };
/** ✎ on a post: the shown version changes. */
export const editPost = (p, { title, text }) => { const alts = versions(p).map((a, k) => (k === (Number(p.s) || 0) ? { title: title ?? a.title, text } : a)); return { ...(arr(p.alts).length ? { alts } : {}), text: clip(text, 3000), ...(title != null ? { title: clip(title, 160) } : {}) }; };
/**
 * What a post taught people (Miinthe, 2026-10-26: "removing a post … should also delete the knowledge about it"): the undo ids
 * of every knowledge step that came from it — a quoted story person, readers noticing a rumor — merged, so deleting it undoes them.
 */
export const mergeTaught = (a, b) => ({
    logIds: [...new Set([...arr(a?.logIds), ...arr(b?.logIds)])],
    mknowIds: [...new Set([...arr(a?.mknowIds), ...arr(b?.mknowIds)])],
});
export const removePost = (store, id) => ({ ...store, records: arr(store?.records).filter(r => !(r.kind === 'post' && r.id === id)) });
export const editComment = (p, cid, text) => ({ comments: arr(p.comments).map(c => (c.id === cid ? { ...c, text: clip(text, 1200) } : c)) });
export const removeComment = (p, cid) => ({ comments: arr(p.comments).filter(c => c.id !== cid) });
export const toggleLike = (post, key) => (arr(post.likes).includes(key) ? { likes: post.likes.filter(k => k !== key) } : { likes: [...arr(post.likes), key] });
export const addComment = (post, c) => ({ comments: [...arr(post.comments), { id: c.id, by: c.by, text: clip(c.text, 1200), ...(c.auto ? { auto: true } : {}) }] });

/** "{{user}}, Spoon and 23 others like this" — people known by name first, then the crowd (Miinthe's pick). */
export function likesLine(post, nameOf, letters = false) {
    const names = arr(post.likes).map(nameOf).filter(Boolean);
    const n = Math.max(0, Number(post.crowd) || 0);
    const verb = letters ? 'nod along' : 'like this';
    if (!names.length && !n) return '';
    if (!names.length) return `${n} ${n === 1 ? (letters ? 'person nods along' : 'person likes this') : (letters ? 'people nod along' : 'people like this')}`;
    if (!n) return `${names.join(', ')} ${names.length === 1 ? (letters ? 'nods along' : 'likes this') : verb}`;
    return `${names.join(', ')} and ${n} other${n === 1 ? '' : 's'} ${verb}`;
}

/** The feed, newest first, with a filter: 'all' · 'news' · 'rumor' · 'cast' (the Cast, the main character and {{user}}). */
export function feedView(store, filter = 'all', kindOf = () => '') {
    const ps = postsOf(store).slice().sort((a, b) => b.n - a.n);
    if (filter === 'news') return ps.filter(p => p.news);
    if (filter === 'rumor') return ps.filter(p => isObj(p.rumor));   // stage 5: ◌ Rumors
    if (filter === 'cast') return ps.filter(p => ['cast', 'main', 'user'].includes(kindOf(p.by)));
    return ps;
}

// ── world stories (the stolen sheep) ────────────────────────────────────────

export const STORY_PHASES_MAX = 5;
/** A world story, repaired: { id, title, seed, phases: [text], at (next phase to tell), done }. */
export function normStory(s) {
    if (!isObj(s) || typeof s.id !== 'string') return null;
    const phases = arr(s.phases).map(x => clip(x, 300)).filter(Boolean).slice(0, STORY_PHASES_MAX);
    const at = Math.max(0, Math.min(phases.length, Math.round(Number(s.at) || 0)));
    return { id: s.id, title: clip(s.title || s.seed, 100), seed: clip(s.seed, 400), phases, at, done: at >= phases.length, toldAt: Number.isInteger(s.toldAt) ? s.toldAt : -1 };
}
/** The stories still running (a phase left to tell). */
export const runningStories = store => storiesOf(store).map(normStory).filter(s => s && !s.done);

/**
 * The one running story to move on this tick: the one told longest ago (never told first), so several running stories
 * take turns (Miinthe, E4: two stories started, they never moved on — the AI wrote about them without saying which).
 */
export const storyToTell = stories => arr(stories).reduce((best, s) => (!best || s.toldAt < best.toldAt ? s : best), null);

/** Does a post tell this story — its distinctive words (title and the phase due) show up in it? For a post the AI forgot to tag. */
const STOP = new Set(['about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'every', 'still', 'never', 'other', 'being', 'would', 'could', 'should', 'night', 'today', 'everyone', 'nobody', 'people', 'story', 'world']);
export function tellsStory(post, story) {
    const words = s => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || [];
    const key = new Set([...words(story?.title), ...words(story?.phases?.[story.at])].filter(w => !STOP.has(w)));
    const have = new Set(words(`${post?.title || ''} ${post?.text || ''}`));
    return [...key].some(w => have.has(w));
}

// ── the feed's own call ─────────────────────────────────────────────────────

export const FEED_SCHEMA = {
    name: 'world_feed', strict: false,
    value: { type: 'object', properties: {
        posts: { type: 'array', items: { type: 'object', properties: { by: { type: 'string' }, text: { type: 'string' }, title: { type: ['string', 'null'] }, where: { type: ['string', 'null'] }, story: { type: ['string', 'null'] }, quoted: { type: 'array', items: { type: 'string' } }, askUser: { type: 'boolean' }, likes: { type: 'array', items: { type: 'string' } }, crowd: { type: 'integer' } }, required: ['by', 'text'] } },
        comments: { type: 'array', items: { type: 'object', properties: { post: { type: 'integer' }, by: { type: 'string' }, text: { type: 'string' } }, required: ['post', 'by', 'text'] } },
        stories: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, told: { type: 'boolean' } }, required: ['id', 'told'] } },
        newStory: { type: ['object', 'null'], properties: { title: { type: 'string' }, phases: { type: 'array', items: { type: 'string' } } } },
    }, required: ['posts'] },
};

const DIAL = ['never', 'low', 'average', 'high'];   // 0 = never (gossip, posts)

/**
 * Who news may quote (Miinthe, 2026-10-19: "it can involve the kettle as a witness statement … but I think it should tend to just
 * random people, because if the news is about Spain while the story in Poland …"): mostly passers-by; someone from the story
 * only where the news happens where they are, or concerns them — and they then know they gave that statement.
 */
/**
 * Who people never gossip about (Miinthe, 2026-10-26: "Ottilie wouldn't gossip about Lucan like that … or Seraphine about
 * Corvin"): loyalty first — read from who they are — then the board's own "never gossips about" and "gossips: never".
 */
export const GOSSIP_RULE = 'Loyalty: people never gossip about, mock or leak the private business of those they serve, love or are loyal to — their commander or lord, their partner, their family, their own people. Read who that is from each person\'s description and the story (a loyal second never gossips about her commander). Where a person is marked "never gossips", they never pass on rumors or talk about others\' private business at all.';
/** One line on a person's discretion for a prompt ('' when nothing is set). */
export function discretion(p) {
    if (!p) return '';
    if (typeof p.discretion === 'string') return p.discretion;
    const bits = [];
    if (p.g === 0) bits.push(`${p.name} never gossips — never passes on rumors or talks about others' private business`);
    if (arr(p.hush).length) bits.push(`${p.name} never gossips about ${p.hush.join(', ')}`);
    return bits.length ? bits.join('; ') + '.' : '';
}

export const QUOTE_RULE = 'Quotes in news: like a reporter asking around — mostly unnamed passers-by or locals you make up (a name and what they do). First decide "where": "here" (it happens where the story is) or "elsewhere". When it is "here" and about something that really happened in the story, the people of the story who were involved may give their opinion or a comment; otherwise quote them only when it happens right where they are, and rarely. "elsewhere": NO quotes from the people of the story at all — not even a "local angle". Never quote the player — unless the author\'s idea gives their words; then use exactly those. List anyone of the story you quoted in "quoted" (exact names). "askUser": true only when it is "here" and the player was involved — the reporter will then message them for a comment (not when the author\'s idea already gives their words).';

/**
 * The feed's prompt: what the people of the story post now. One call per tick.
 * o: { userName, people (posters()), recent: [{ n, by (name), text }], stories (runningStories), reason, look, when, max, mix }
 */
export function feedPrompt({ userName, people, recent = [], old = [], stories = [], reason = '', look = 'phone', when = '', max = 3, newStoryOk = true }) {
    const letters = look === 'letters';
    const where = letters ? 'notes pinned to the town board ("talk of the town") and the local gazette' : 'the local social feed and the news';
    const sys = `You run ${where} in a roleplay's world. ${userName} is the player. ${reason ? `Right now: ${reason}.` : ''}
Write what the people below post now — the world going on by itself, mostly NOT about ${userName}. Only the people listed post, like and comment — never ${userName} (the player writes their own posts). Rules:
- A good mix: ordinary life (weather, food, a lost cat, a sale, a petty argument, hobbies, gossip about people they know) and, now and then, the running world stories below.
- Now and then a post has a photo: describe it inside the text as [photo: what it shows]. People may tag each other as @Name.
- Who posts follows their dials: people with "posts: high" post often, "posts: low" rarely. Voices (a newspaper, a shop) post as institutions; news gets a "title" — and ONLY voices post news. The people of the story never write headlines; they may talk about the news.
- Each in their own voice, following their quirks; about what they care about (their interests). Never more than they could know — nobody here saw the main scene.
- Likes: name a few of the listed people who'd like it (by exact name), and a crowd number for everyone else (0–60; a popular voice gets more).
- ${QUOTE_RULE.replaceAll('the player', userName)}
- ${GOSSIP_RULE}
- Comments: someone may answer one of the recent posts below ("post": its #number) or one of the new posts ("post": 0 = the first new post, -1 the second, -2 the third). People argue, joke, agree — and answer each other's comments (start with @Name), so a little discussion grows.
- World stories: if one of the running stories should move on now, write its next phase as a post or news item ("story": its id) and list it as {"id", "told": true}. ${newStoryOk ? 'You may start ONE new small world story (something that happens in town and plays out over a few days) — give it a title and 3–5 short phases; tell the first phase now.' : 'No new world story now.'}
Answer with JSON only: {"posts": [{"by": "exact name", "text": "...", "title": null, "where": null, "story": null, "quoted": [], "askUser": false, "likes": ["name"], "crowd": 12}], "comments": [{"post": 3, "by": "name", "text": "..."}], "stories": [{"id": "...", "told": true}], "newStory": null} — at most ${max} posts, often 1–2; comments 0–3.`;
    const who = arr(people).filter(p => p.p !== 0).map(p => `- ${p.name} (${p.kind === 'main' ? 'the main character' : p.kind === 'cast' ? 'one of the people of the story' : p.kind === 'regular' ? 'a regular in the feed' : 'a voice: an institution or publication'}) — posts: ${DIAL[p.p] || 'average'}, gossips: ${DIAL[p.g] || 'average'}${p.interests?.length ? `; cares about: ${p.interests.join(', ')}` : ''}${p.about ? `\n  ${clip(p.about, 300)}` : ''}${p.quirks ? `\n  How they write (follow it): ${clip(p.quirks, 300)}` : ''}${discretion(p) ? `\n  ${discretion(p)}` : ''}`);
    const user = [when ? `IN THE STORY IT IS NOW ${when}.` : '',
        `THE PEOPLE WHO CAN POST\n${who.join('\n')}`,
        arr(stories).length ? `THE WORLD STORY TO MOVE ON NOW (tell its next phase in ONE post or news item, with "story": its id, and list it in "stories" as told)\n${stories.map(s => `- id ${s.id}: "${s.title}" — told so far: ${s.phases.slice(0, s.at).join(' / ') || '(nothing yet)'}; next: ${s.phases[s.at]}`).join('\n')}` : '',
        arr(recent).length ? `RECENT POSTS (newest last; don't repeat them)\n${recent.map(postLines).join('\n')}` : 'The feed is empty so far.',
        arr(old).length ? `OLDER POSTS THAT FIT WHAT'S GOING ON NOW (someone may dig one up with a comment: "post": its #number)\n${old.map(postLines).join('\n')}` : '',
        'What gets posted now?'].filter(Boolean).join('\n\n');
    return { system: sys, user };
}

/** A post for a prompt: its line, then its comments (↳), so people can answer each other. p: { n, by, text, comments: [{ by, text }] } */
const postLines = p => [`#${p.n} ${p.by}: ${clip(p.text, 220)}`, ...arr(p.comments).slice(-4).map(c => `   ↳ ${c.by}: ${clip(c.text, 140)}`)].join('\n');

// ── old posts that fit again; the world's small moves after every reply (Miinthe, 2026-10-19) ──

const STOP_OLD = new Set(['about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'every', 'still', 'never', 'other', 'being', 'would', 'could', 'should', 'right', 'really', 'something', 'nothing', 'little', 'thing', 'think', 'looks', 'gives', 'makes']);
const keyWords = s => new Set((String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || []).filter(w => !STOP_OLD.has(w)));
/**
 * Older posts that fit what's going on now (Miinthe: "pick up an old post when it became relevant again"): not among the
 * recent ones, sharing at least two distinctive words with `now` (the newest main messages). Best first, at most `max`.
 */
export function relevantOld(store, now, { skip = [], max = 2 } = {}) {
    const want = keyWords(now);
    if (!want.size) return [];
    return postsOf(store).filter(p => !skip.includes(p.n))
        .map(p => ({ p, hits: [...keyWords(`${p.title || ''} ${p.text}`)].filter(w => want.has(w)).length }))
        .filter(x => x.hits >= 2).sort((a, b) => b.hits - a.hits || b.p.n - a.p.n).slice(0, max).map(x => x.p);
}

export const PULSE_SCHEMA = { name: 'world_pulse', strict: false, value: { type: 'object', properties: {
    moves: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['post', 'comment', 'text', 'group'] }, by: { type: 'string' }, to: { type: ['string', 'null'] }, post: { type: ['integer', 'null'] }, group: { type: ['string', 'null'] }, text: { type: 'string' } }, required: ['kind', 'by', 'text'] } },
}, required: ['moves'] } };

/**
 * After every main reply: 0–4 small moves of the world going on by itself — a post, a comment (answering a post, a
 * comment, or an old post that fits again), and now and then one private text between two people who know each other,
 * for a reason of theirs. One call; small on purpose.
 * o: { userName, people (posters()), recent, old, texters: [{ name, knows, plans, wants }], open: ["A ↔ B"], story: [text], feed, msgs, look, when }
 */
export function pulsePrompt({ userName, people = [], recent = [], old = [], texters = [], open = [], story = [], feed = true, msgs = true, look = 'phone', when = '', min = 0, max = 4, groups = [] }) {
    const letters = look === 'letters';
    const kinds = [feed ? `"post" (${letters ? 'a note on the town board' : 'a short post'})` : '', feed ? `"comment" ("post": the #number — answering it, answering someone's comment there with @Name, or digging up an older post that fits again)` : '', msgs && texters.length > 1 ? `"text" (${letters ? 'a short letter' : 'a private text'} from one of the story's people to another — "to": exact name — only with a reason of theirs: a plan, a secret, a worry, something they heard, a fight; at most one)` : '', msgs && arr(groups).length ? `"group" (one member writes in one of the group chats below — "group": its exact name — a follow-up, a joke, a worry; at most one)` : ''].filter(Boolean);
    const sys = `You keep a roleplay's world going on by itself, in small ways, while the story moves on. ${userName} is the player.
Make ${min === max ? max : `${min} to ${max}`} small moves now — ${min === 0 ? 'sometimes none when nothing fits, ' : ''}a different number each time. Kinds: ${kinds.join('; ')}.
- Mostly NOT about ${userName}, never written by ${userName}. Each person in their own voice and quirks, knowing only what they could know (nobody here saw the main scene unless it says so).
- Short and everyday: a reply in an argument, a joke, a worry, a follow-up. Don't repeat what's already there.
- ${GOSSIP_RULE}
Answer with JSON only: {"moves": [{"kind": "${feed ? 'comment' : 'text'}", "by": "exact name", ${feed ? '"post": 12' : '"to": "exact name"'}, "text": "..."}]}`;
    const who = arr(people).filter(p => p.p !== 0).map(p => `- ${p.name}${p.kind === 'main' ? ' (the main character)' : p.kind === 'voice' ? ' (a voice: an institution)' : p.kind === 'regular' ? ' (a regular)' : ''}${p.quirks ? ` — writes: ${clip(p.quirks, 160)}` : ''}${p.interests?.length ? `; cares about: ${p.interests.join(', ')}` : ''}${discretion(p) ? ` — ${discretion(p)}` : ''}`);
    const tx = arr(texters).map(t => `- ${t.name}${t.wants ? ` — wants: ${clip(t.wants, 120)}` : ''}${arr(t.plans).length ? `; set on: ${t.plans.slice(-2).map(x => clip(x, 100)).join(' · ')}` : ''}${arr(t.knows).length ? `; knows: ${t.knows.slice(-4).map(x => clip(x, 110)).join(' · ')}` : ''}`);
    const user = [when ? `IN THE STORY IT IS NOW ${when}.` : '',
        arr(story).length ? `THE STORY JUST NOW (the main scene; only those there know it)\n${story.map(x => clip(x, 400)).join('\n')}` : '',
        `WHO CAN POST AND COMMENT\n${who.join('\n')}`,
        msgs && tx.length > 1 ? `THE STORY'S PEOPLE (they know each other and may text each other)\n${tx.join('\n')}${arr(open).length ? `\nAlready texting (leave them be): ${open.join(', ')}` : ''}` : '',
        msgs && arr(groups).length ? `GROUP CHATS (members only write there)\n${groups.map(g => `- "${g.name}" — members: ${g.members.join(', ')}${arr(g.last).length ? `\n${g.last.map(l => `   ${clip(l, 160)}`).join('\n')}` : ''}`).join('\n')}` : '',
        feed && arr(recent).length ? `RECENT POSTS\n${recent.map(postLines).join('\n')}` : '',
        feed && arr(old).length ? `OLDER POSTS THAT FIT AGAIN\n${old.map(postLines).join('\n')}` : '',
        `Your moves now (${min}–${max}):`].filter(Boolean).join('\n\n');
    return { system: sys, user };
}

/** Read the moves against the names there are: at most `max`, at most one text, unknown names dropped. */
export function parsePulse(text, people, texters = [], max = 4, groups = []) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    const tByName = new Map(arr(texters).map(p => [String(p.name).trim().toLowerCase(), p]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        const out = []; let texted = false, grouped = false;
        for (const m of arr(v.moves)) {
            if (!isObj(m) || typeof m.text !== 'string' || !m.text.trim() || out.length >= max) continue;
            const key = s => String(s || '').trim().toLowerCase();
            if (m.kind === 'group') {
                const g = arr(groups).find(x => String(x.name).trim().toLowerCase() === key(m.group)), who = tByName.get(key(m.by));
                if (!g || !who || grouped || !g.keys.includes(who.key)) continue;
                grouped = true; out.push({ kind: 'group', group: g, who, text: clip(m.text, 1200) });
            } else if (m.kind === 'text') {
                const from = tByName.get(key(m.by)), to = tByName.get(key(m.to));
                if (!from || !to || from.key === to.key || texted) continue;
                texted = true; out.push({ kind: 'text', from, to, text: clip(m.text, 1200) });
            } else {
                const who = byName.get(key(m.by));
                if (!who || who.muted || who.p === 0) continue;   // "posts: never" posts and comments nothing
                if (m.kind === 'comment' && Number.isFinite(Number(m.post))) out.push({ kind: 'comment', who, post: Math.round(Number(m.post)), text: clip(m.text, 1200) });
                else if (m.kind === 'post') out.push({ kind: 'post', who, text: clip(m.text, 3000) });
            }
        }
        return out;
    }
    return [];
}

/** Read the feed's answer against the names there are. Unknown names dropped; muted people never post. */
export function parseFeed(text, people, max = 3) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    const find = n => byName.get(String(n || '').trim().toLowerCase()) || null;
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        const posts = arr(v.posts).filter(p => isObj(p) && typeof p.text === 'string' && p.text.trim()).map(p => ({ who: find(p.by), text: clip(p.text, 3000), title: typeof p.title === 'string' && p.title.trim() ? clip(p.title, 160) : '', story: typeof p.story === 'string' && p.story ? p.story : null, quoted: p.where === 'elsewhere' ? [] : arr(p.quoted).map(find).filter(x => x && (x.kind === 'cast' || x.kind === 'main')).map(x => x.key), askUser: p.where === 'here' && p.askUser === true && !!p.title, likes: arr(p.likes).map(find).filter(Boolean).map(x => x.key), crowd: Math.max(0, Math.min(500, Math.round(Number(p.crowd) || 0))) }))
            .filter(p => p.who && !p.who.muted && p.who.p !== 0).slice(0, max)
            // a headline from someone who isn't a voice: the news is the newspaper's (or it stays a plain post)
            .map(p => (p.title && p.who.kind !== 'voice' ? (newsWriter(people) ? { ...p, who: newsWriter(people) } : { ...p, title: '' }) : p));
        const comments = arr(v.comments).filter(c => isObj(c) && typeof c.text === 'string' && c.text.trim() && Number.isFinite(Number(c.post))).map(c => ({ post: Math.round(Number(c.post)), who: find(c.by), text: clip(c.text, 1200) }))
            .filter(c => c.who && !c.who.muted && c.who.p !== 0).slice(0, 4);
        const told = arr(v.stories).filter(s => isObj(s) && s.told === true && typeof s.id === 'string').map(s => s.id);
        const ns = isObj(v.newStory) && typeof v.newStory.title === 'string' && arr(v.newStory.phases).length >= 2 ? { title: clip(v.newStory.title, 100), phases: arr(v.newStory.phases).map(x => clip(x, 300)).filter(Boolean).slice(0, STORY_PHASES_MAX) } : null;
        return { posts, comments, told, newStory: ns };
    }
    return { posts: [], comments: [], told: [], newStory: null };
}

// ── answering {{user}}'s post or comment ────────────────────────────────────

export const REACT_SCHEMA = {
    name: 'world_react', strict: false,
    value: { type: 'object', properties: {
        comments: { type: 'array', items: { type: 'object', properties: { by: { type: 'string' }, text: { type: 'string' } }, required: ['by', 'text'] } },
        likes: { type: 'array', items: { type: 'string' } }, crowd: { type: 'integer' },
    }, required: ['comments'] },
};
/** Who answers a post (or a comment) by {{user}} or someone she writes as: 0–2 comments, a few likes, a crowd number. */
/**
 * How many comments this time (Miinthe, 2026-10-19: "comments seems to only come in a double pack, maybe some variety?"):
 * a weighted roll — sometimes none, often one, now and then a pile-on. rand() in [0, 1).
 */
export function commentCount(rand = Math.random) {
    const r = rand();
    return r < 0.12 ? 0 : r < 0.45 ? 1 : r < 0.72 ? 2 : r < 0.9 ? 3 : 4;
}
export function reactPrompt({ authorName, post, comment = '', people, look = 'phone', tagged = [], count = null }) {
    const letters = look === 'letters';
    return {
        system: `You run the ${letters ? 'town board (notes pinned up, answers scribbled underneath)' : 'local social feed'} of a roleplay's world. ${authorName} just ${comment ? 'commented on a post' : 'posted'}. Who of the people below reacts — in their own voice, following their quirks, only if it fits who they are? ${count == null ? 'Usually one or two comment' : count === 0 ? 'This time nobody comments (unless someone was tagged)' : (count === 1 ? 'This time one person comments' : `This time ${count} comments — from different people, or a short back-and-forth`)}, some like it, and a crowd number for everyone else (0–40). Nobody saw the main scene; never more than they could know.${arr(tagged).length ? ` ${tagged.join(' and ')} ${tagged.length === 1 ? 'was' : 'were'} tagged — they answer.` : ''}
${GOSSIP_RULE}\nAnswer with JSON only: {"comments": [{"by": "exact name", "text": "..."}], "likes": ["name"], "crowd": 5}`,
        user: `THE POST${post.title ? ` (news: ${post.title})` : ''}, by ${post.byName}:\n${clip(post.text, 1500)}${arr(post.comments).length ? `\n\nCOMMENTS SO FAR:\n${post.comments.map(c => `${c.byName}: ${clip(c.text, 300)}`).join('\n')}` : ''}${comment ? `\n\n${authorName.toUpperCase()}'S NEW COMMENT:\n${clip(comment, 800)}` : ''}\n\nTHE PEOPLE\n${arr(people).filter(p => p.p !== 0).map(p => `- ${p.name}${p.quirks ? ` (writes: ${clip(p.quirks, 160)})` : ''}${p.interests?.length ? ` — cares about ${p.interests.join(', ')}` : ''}`).join('\n')}`,
    };
}
export function parseReact(text, people) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    const find = n => byName.get(String(n || '').trim().toLowerCase()) || null;
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v)) continue;
        return {
            comments: arr(v.comments).filter(c => isObj(c) && typeof c.text === 'string' && c.text.trim()).map(c => ({ who: find(c.by), text: clip(c.text, 1200) })).filter(c => c.who && !c.who.muted && c.who.p !== 0).slice(0, 4),   // up to 4 (it was capped at 2: "only come in a double pack")
            likes: arr(v.likes).map(find).filter(x => x && !x.muted).map(x => x.key),
            crowd: Math.max(0, Math.min(200, Math.round(Number(v.crowd) || 0))),
        };
    }
    return { comments: [], likes: [], crowd: 0 };
}

// ── a world story she starts herself (News › Start a world story) ───────────

export const STORY_SCHEMA = { name: 'world_story', strict: false, value: { type: 'object', properties: { title: { type: 'string' }, kind: { type: 'string' }, phases: { type: 'array', items: { type: 'string' } } }, required: ['title', 'phases'] } };
/** Plan a seed ("twenty sheep stolen overnight") into its phases — a done thing (a dog found) gets one or two, an open one more. */
export function storyPrompt({ seed, setting = '', look = 'phone' }) {
    return {
        system: `You plan a small world story for the background of a roleplay — something that happens in town and is told in the ${look === 'letters' ? 'gazette and the talk of the town' : 'news and the social feed'} over a few story days, by itself, not about the main characters. First judge the seed: already resolved (one or two phases), a short developing story (3–4), or an ongoing issue (4–5). Then write the phases in order, each one short line (what becomes known, what people think), ending in a conclusion — or a lingering joke.
Answer with JSON only: {"title": "short headline-like title", "kind": "resolved|developing|ongoing", "phases": ["...", "..."]}`,
        user: `THE SEED: ${clip(seed, 400)}${setting ? `\nTHE SETTING: ${clip(setting, 800)}` : ''}`,
    };
}
export function parseStory(text, seed = '') {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        const phases = arr(v?.phases).map(x => clip(x, 300)).filter(Boolean).slice(0, STORY_PHASES_MAX);
        if (phases.length) return { title: clip(v.title || seed, 100), seed: clip(seed, 400), phases };
    }
    return null;
}

// ── one news item, now (Miinthe, 2026-10-19: "news should have a generate news story … either completely new (but world aware) or with input idea from me") ──

export const NEWS_SCHEMA = { name: 'world_news', strict: false, value: { type: 'object', properties: { where: { type: 'string', enum: ['here', 'elsewhere'] }, by: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, quoted: { type: 'array', items: { type: 'string' } }, askUser: { type: 'boolean' } }, required: ['by', 'title', 'text'] } };
/** Write one news item now — from her idea, or (no idea) something fitting and new that the world would report. */
export function newsPrompt({ idea = '', people, recent = [], stories = [], look = 'phone', when = '', userName = 'the player' }) {
    const letters = look === 'letters';
    const voices = arr(people).filter(p => p.kind === 'voice');
    return {
        system: `You write one ${letters ? 'gazette article' : 'local news item'} for the background world of a roleplay. ${idea ? 'The author gave the idea below — report it.' : 'Pick something fitting and new that this world would report: ordinary local life, a small scandal, an event, prices, the weather — not about the main characters, and not a repeat of what was already posted.'} It is written by one of the listed people — a voice (newspaper, office) if there is one — in their own voice and following their quirks. A headline, then two or three short paragraphs. Nobody saw the main scene; never more than they could know.
${QUOTE_RULE.replaceAll('the player', userName)}
Answer with JSON only: {"where": "here" | "elsewhere", "by": "exact name", "title": "the headline", "text": "the article", "quoted": [], "askUser": false}`,
        user: [when ? `IN THE STORY IT IS NOW ${when}.` : '', idea ? `THE IDEA: ${clip(idea, 600)}` : '',
            `WHO CAN WRITE IT\n${(voices.length ? voices : arr(people)).map(p => `- ${p.name}${p.about ? `: ${clip(p.about, 200)}` : ''}${p.quirks ? ` (writes: ${clip(p.quirks, 160)})` : ''}`).join('\n')}`,
            arr(people).some(p => p.kind === 'cast' || p.kind === 'main') ? `THE PEOPLE OF THE STORY (quote them only by the rule)\n${arr(people).filter(p => p.kind === 'cast' || p.kind === 'main').map(p => `- ${p.name}${p.about ? `: ${clip(p.about, 140)}` : ''}`).join('\n')}` : '',
            arr(stories).length ? `RUNNING WORLD STORIES: ${stories.map(s => s.title).join('; ')}` : '',
            arr(recent).length ? `ALREADY POSTED (don't repeat)\n${recent.map(p => `- ${p.by}: ${clip(p.text, 140)}`).join('\n')}` : ''].filter(Boolean).join('\n\n'),
    };
}
/** Who writes news: a voice (a newspaper first), else nobody. */
const newsWriter = people => arr(people).find(p => p.kind === 'voice' && !p.muted) || null;
export function parseNews(text, people) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v) || typeof v.text !== 'string' || !v.text.trim()) continue;
        const named = byName.get(String(v.by || '').trim().toLowerCase());
        const who = (named?.kind === 'voice' ? named : null) || newsWriter(people) || named || arr(people)[0] || null;   // news comes from a voice
        // the headline repeated as the article's first line (live) is dropped
        const title = clip(v.title || '', 160), lines = String(v.text).trim().split('\n');
        const body = title && lines[0].replace(/[#*_\s]/g, '').toLowerCase() === title.replace(/[#*_\s]/g, '').toLowerCase() ? lines.slice(1).join('\n').trim() : String(v.text).trim();
        const quoted = v.where === 'elsewhere' ? [] : arr(v.quoted).map(n => byName.get(String(n || '').trim().toLowerCase())).filter(x => x && (x.kind === 'cast' || x.kind === 'main')).map(x => x.key);
        return who && !who.muted ? { who, title, text: clip(body || v.text, 3000), quoted, askUser: v.where === 'here' && v.askUser === true } : null;
    }
    return null;
}

// ── fake photos and @-tags (Miinthe, 2026-10-19: "a fake feature to add photos. Not actual photo but like: [attached picture]"
// · "fake tagging. Like @ and then it suggest whatever name matches") ──

const PHOTO_RE = /\[(?:photo|picture|attached picture|image|pic)\s*:\s*([^\]]{1,300})\]/gi;
/** The pictures a text describes: ["Spoon glaring from the sink", …]. */
export const photosIn = text => [...String(text ?? '').matchAll(PHOTO_RE)].map(m => m[1].trim()).filter(Boolean);
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Who is tagged: the keys of the known names written as @Name (longest names first, so "@Auntie Colander" wins over "@Auntie"). */
export function mentionsIn(text, people) {
    const t = String(text ?? '').toLowerCase(), out = [];
    for (const p of arr(people).slice().sort((a, b) => String(b.name).length - String(a.name).length)) {
        const n = String(p.name || '').toLowerCase();
        if (n && t.includes('@' + n) && !out.includes(p.key)) out.push(p.key);
    }
    return out;
}
/**
 * A post's or message's text as HTML: escaped, line breaks kept, every [photo: …] as a photo card, every @Name of someone
 * known highlighted.
 */
export function richText(text, people = [], pics = null) {
    const names = arr(people).map(p => String(p.name || '')).filter(Boolean).sort((a, b) => b.length - a.length);
    let html = '', last = 0;
    const src = String(text ?? '');
    for (const m of src.matchAll(PHOTO_RE)) {
        html += italics(tagged(escH(src.slice(last, m.index)), names));
        const d = m[1].trim(), pic = pics ? pics(d) : null;
        // 🎨 (2026-11-03) pics(d): { url } drawn · 'busy' being drawn · 'make' can be drawn by hand · null as before
        if (pic?.url) html += `<a class="photo pic" href="${escH(pic.url)}" target="_blank" rel="noopener" title="${escH(d)}"><img src="${escH(pic.url)}" alt="${escH(d)}" loading="lazy"></a>`;
        else html += `<span class="photo" role="img" aria-label="Photo: ${escH(d)}"><span class="ph-i">📷</span><span class="ph-c">${escH(d)}</span>${pic === 'busy' ? '<span class="ph-b">🎨 drawing…</span>' : pic === 'make' ? `<button type="button" class="ph-b" data-pic="${escH(d)}" title="Make it a real picture (SillyTavern's Image Generation)">🎨</button>` : ''}</span>`;
        last = m.index + m[0].length;
    }
    html += italics(tagged(escH(src.slice(last)), names));
    return html.replace(/\n/g, '<br>');
}
/** *actions* in italics, as the main chat shows them (found in the bug hunt: they showed with raw asterisks). */
const italics = s => s.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>');
function tagged(escaped, names) {
    let s = escaped;
    for (const n of names) {
        const e = escH(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(`@${e}(?![\\w])`, 'gi'), m => `<span class="wd-at">${m}</span>`);
    }
    return s;
}
/** The @-suggestion for what is being typed before the cursor: { q, from } or null. */
export function tagQuery(before) {
    const m = /(?:^|\s)@([^\s@][^@\n]{0,30})?$/.exec(String(before ?? ''));
    if (!m) return null;
    return { q: (m[1] || '').toLowerCase(), from: String(before).length - (m[1] || '').length - 1 };
}
export const tagMatches = (q, people) => arr(people).filter(p => String(p.name || '').toLowerCase().startsWith(q) || String(p.name || '').toLowerCase().includes(' ' + q)).slice(0, 6);
