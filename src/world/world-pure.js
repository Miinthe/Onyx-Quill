/**
 * World layer (Miinthe, 2026-10-18; design: docs/storyboard/19 world layer design.md) — the pure part.
 *
 * Stage 0: the board's world settings, the panel's side and sections, and the per-chat world
 * store. Everything the world writes is logged by message, so a delete takes it back and a swipe
 * or a new reply at that message replaces it (the pitches pattern, pitches-pure.js rewindPlan).
 */

import { normAlive, normFirst } from './alive-pure.js';
import { normHabits, normVoices } from './feed-pure.js';
export { aliveWords } from './setup-pure.js';   // the board's ☆ Set up with Mero shows the alive mix in words

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** The sections on the rail, in order. People is always there; the others can be switched off per board. */
export const SECTIONS = ['feed', 'news', 'msgs', 'people'];
export const OPTIONAL_SECTIONS = ['feed', 'news', 'msgs'];
export const LOOKS = ['phone', 'letters'];

const TITLES = {
    feed: { phone: 'Chatter', letters: 'Talk of the town' },
    news: { phone: 'News', letters: 'The Gazette' },
    msgs: { phone: 'Messages', letters: 'Letters' },
    people: { phone: 'People', letters: 'People' },
};

/** A board's world settings, repaired. Off unless switched on (Miinthe: "if selected no, the world layer doesn't make an appearance at all"). */
export function normWorld(raw) {
    const w = isObj(raw) ? raw : {};
    const sec = isObj(w.sections) ? w.sections : {};
    return {
        on: w.on === true,
        look: LOOKS.includes(w.look) ? w.look : 'phone',
        sections: Object.fromEntries(OPTIONAL_SECTIONS.map(k => [k, sec[k] !== false])),
        alive: normAlive(w.alive), paused: w.paused === true, first: normFirst(w.first),   // stage 2 (2026-10-19)
        // stage 3: planned messages — kept as stored here; planned-pure.js repairs each one where it is used
        // (normalizing conditions here would import board-model-pure, which imports this file)
        planned: (Array.isArray(w.planned) ? w.planned : []).filter(p => isObj(p) && typeof p.id === 'string' && p.id),
        // each person's quirks (Miinthe, 2026-10-19: "sends multiple messages after each other. or makes spelling mistakes, or uses a lot of emojis")
        people: Object.fromEntries(Object.entries(isObj(w.people) ? w.people : {}).filter(([k, v]) => k && isObj(v))
            .map(([k, v]) => [k, { quirks: typeof v.quirks === 'string' ? v.quirks.slice(0, 600) : '', ...(v.muted === true ? { muted: true } : {}),
                // not in the world at all (Miinthe, 2026-10-19: "I want to remove character from the world cast list") — still in the Cast's scenes
                ...(v.out === true ? { out: true } : {}),
                // who they never talk to (Miinthe, 2026-10-19: "don't allow this npc to dm X person" — as safety); both ways, see neverTalk
                ...(Array.isArray(v.never) && v.never.some(x => typeof x === 'string' && x && x !== k) ? { never: [...new Set(v.never.filter(x => typeof x === 'string' && x && x !== k))].slice(0, 40) } : {}),
                // stage 4: their dials and interests (feed-pure.js normHabits), kept once set
                ...(['g', 'm', 'p'].some(d => v[d] != null) || (Array.isArray(v.interests) && v.interests.length) ? (({ g, m, p, interests }) => ({ g, m, p, interests }))(normHabits(v)) : {}) }])
            .filter(([, v]) => v.quirks.trim() || v.muted || v.out || v.g != null || v.never)),
        // stage 4: the story's own voices (a newspaper, a shop) and regulars (recurring locals)
        voices: normVoices(w.voices),
        // stage 5: the story's one rumor account, named per board (Miinthe: "the rumor chat name per story board sounds right")
        ...(typeof w.rumorName === 'string' && w.rumorName.trim() ? { rumorName: w.rumorName.trim().slice(0, 60) } : {}),
        ...(typeof w.newsName === 'string' && w.newsName.trim() ? { newsName: w.newsName.trim().slice(0, 60) } : {}),   // the news account (rumor-pure.js)
    };
}

/** The world settings of a board, or null when the world layer is off for it. */
export function worldOf(board) {
    const w = normWorld(board?.world);
    return w.on ? w : null;
}

/** Never talk to each other (either one's list names the other): no texts, no answers to each other's posts or comments. */
export function neverTalk(world, a, b) {
    if (!a || !b || a === b) return false;
    const ppl = normWorld(world).people;
    return !!(ppl[a]?.never?.includes(b) || ppl[b]?.never?.includes(a));
}

/** Muted by {{user}} (Miinthe, 2026-10-19: "block her from messaging or posting"): never writes to {{user}} first, posts nothing. */
export const isMuted = (world, key) => normWorld(world).people[key]?.muted === true;

/** The sections shown on the rail for these settings. */
export function railSections(world) {
    const w = normWorld(world);
    return SECTIONS.filter(k => k === 'people' || w.sections[k]);
}

/** The heading for a section in a look ("Chatter", or "Talk of the town" with letters). */
export function sectionTitle(section, look = 'phone') {
    const t = TITLES[section] || TITLES.feed;
    return t[look] || t.phone;
}

/** Which section the panel opens on: Messages while one is waiting, else Chatter (Miinthe, 2026-10-19). Falls back to the first section shown. */
export function openingSection(world, { unread = 0 } = {}) {
    const shown = railSections(world);
    if (unread > 0 && shown.includes('msgs')) return 'msgs';
    return shown[0];
}

/** The world panel always takes the side opposite DeepLore's side panel, so both can be open. */
export function panelSide(drawerSide) {
    return drawerSide === 'left' ? 'right' : 'left';
}

// ── the per-chat world store ──────────────────────────────────────────────────

export const STORE_VERSION = 1;

/** An empty store: a list of records, each tagged with the message index it belongs to. */
export function emptyStore() {
    return { v: STORE_VERSION, records: [] };
}

/** A stored world, repaired. Never throws. */
export function normStore(raw) {
    const s = isObj(raw) ? raw : {};
    const records = (Array.isArray(s.records) ? s.records : [])
        .filter(r => isObj(r) && Number.isInteger(r.i) && r.i >= 0 && typeof r.kind === 'string');
    const seen = isObj(s.seen) ? { news: Number(s.seen.news) || 0, feed: Number(s.seen.feed) || 0 } : null;
    // pinned conversations (Miinthe, 2026-10-19: "favoritize chats to stick to the top"): person keys and 'g:<group id>'
    const pins = Array.isArray(s.pins) ? [...new Set(s.pins.filter(k => typeof k === 'string' && k))].slice(0, 50) : [];
    return { v: STORE_VERSION, records, ...(seen ? { seen } : {}), ...(pins.length ? { pins } : {}) };
}

/**
 * What came in since {{user}} last looked at News / Chatter — the globe's colored dots (Miinthe, 2026-10-19: "Blue for news,
 * green for message, and orange for rumor"). Posts are counted by their number; her own posts never count.
 */
export function freshPosts(store) {
    const s = normStore(store), seen = s.seen || { news: 0, feed: 0 };
    const theirs = s.records.filter(r => r.kind === 'post' && r.by !== 'user' && !r.mine);
    return {
        news: theirs.some(p => (p.news || p.story) && (Number(p.n) || 0) > seen.news),
        rumor: theirs.some(p => isObj(p.rumor) && (Number(p.n) || 0) > seen.feed),
    };
}

/** Pin or unpin a conversation (a copy of the store). */
export const togglePin = (store, key) => { const s = normStore(store), p = s.pins || []; return { ...s, pins: p.includes(key) ? p.filter(k => k !== key) : [...p, key] }; };

/** The store with News (or Chatter) marked as seen up to its newest post — the same store when nothing changes. */
export function markSeen(store, section) {
    const s = normStore(store), k = section === 'news' ? 'news' : 'feed';
    const top = s.records.filter(r => r.kind === 'post').reduce((m, p) => Math.max(m, Number(p.n) || 0), 0);
    const seen = s.seen || { news: 0, feed: 0 };
    return seen[k] === top ? null : { ...s, seen: { ...seen, [k]: top } };
}

/** Add a record at message index i (a copy; the store is not changed). */
export function addRecord(store, record, i) {
    const s = normStore(store);
    if (!isObj(record) || !Number.isInteger(i) || i < 0) return s;
    return { ...s, records: [...s.records, { ...record, i }] };
}

/** Undo everything at or after message index `from` — a swipe or a new reply at that message replaces it. */
export function rewindFrom(store, from) {
    const s = normStore(store);
    return { ...s, records: s.records.filter(r => r.i < from) };
}

/** After a delete (or opening a branch): keep only records up to the chat's last message. */
export function pruneTo(store, lastIndex) {
    return rewindFrom(store, lastIndex + 1);
}
