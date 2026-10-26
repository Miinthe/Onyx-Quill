/**
 * World layer — group chats (Miinthe, 2026-10-19; mock-up https://claude.ai/artifact/J4WdnTXjzgPTdY9DUtEL7i).
 *
 * Only she starts a group: a name and its members — {{user}}, the main character and the Cast (no regulars, no voices).
 * A group without {{user}} is one she peeks at. A group is a world record (`kind: 'group'`); its messages are ordinary
 * `msg` records with `group` (its id) and `conv: 'g:<id>'`, so they never mix with the two-person conversations. When
 * someone writes, the members who have something to add answer — as many as the board's pace allows (Quiet 1, Normal
 * 1–2, Lively 1–3) — each in their own time (reply times, messages-pure.js). Off with the Letters look.
 */
import { GOSSIP_RULE } from './feed-pure.js';   // who people never gossip about (Miinthe 2026-10-26)
const arr = v => (Array.isArray(v) ? v : []);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export const groupConv = id => 'g:' + id;
export const groupsOf = store => arr(store?.records).filter(r => r.kind === 'group' && typeof r.id === 'string' && Array.isArray(r.members));
export const groupMsgs = (store, id) => arr(store?.records).filter(r => r.kind === 'msg' && r.group === id).sort((a, b) => a.n - b.n);
/** A new group (the caller adds it with addRecord). At least three people; names trimmed. */
export function newGroup({ id, name, members }) {
    const ms = [...new Set(arr(members).filter(k => typeof k === 'string' && k))];
    if (ms.length < 3) return null;
    return { kind: 'group', id, name: clip(name, 60) || 'Group', members: ms };
}
/** How many may answer one message, by the board's pace. */
export const groupMax = pace => (pace === 'quiet' ? 1 : pace === 'lively' ? 3 : 2);
/** Her unread group messages (groups she is in). */
export function groupUnread(store, me) {
    const mine = new Set(groupsOf(store).filter(g => g.members.includes(me)).map(g => g.id));
    return arr(store?.records).filter(r => r.kind === 'msg' && mine.has(r.group) && r.from !== me && !r.read && !r.later).length;
}

export const GROUP_SCHEMA = { name: 'world_group', strict: false, value: { type: 'object', properties: {
    replies: { type: 'array', items: { type: 'object', properties: { by: { type: 'string' }, text: { type: 'string' } }, required: ['by', 'text'] } },
}, required: ['replies'] } };

/**
 * One call: who of the candidates answers the newest message in the group, and what they write.
 * o: { groupName, people: [{ name, card, knows, quirks }] (the candidates), others: [names] (the rest of the group),
 *      thread: [{ who, text }], max, userName, alone (only one may answer, e.g. a late reply) }
 */
export function groupPrompt({ groupName, people = [], others = [], thread = [], max = 2, userName = 'the player', alone = false }) {
    const sys = `You write a group chat called "${groupName}" in a roleplay's world. ${userName} is the player.
${alone ? 'The person below may answer the newest messages now — or pass if they have nothing to add.' : `Of the people below, those who have something to add to the newest message answer it — at most ${max}, at least one. Someone with nothing to add stays quiet; a group chat doesn't need everyone.`}
Each writes ONE short text message in their own voice and quirks, knowing only what they know. Never write for anyone not listed below as able to answer.
${GOSSIP_RULE}
Answer with JSON only: {"replies": [{"by": "exact name", "text": "..."}]}${alone ? ' — an empty list to pass' : ''}`;
    const user = [`WHO CAN ANSWER NOW\n${arr(people).map(p => `- ${p.name}${p.card ? `: ${clip(p.card, 600)}` : ''}${arr(p.knows).length ? `\n  Knows: ${p.knows.slice(-6).map(k => clip(k, 120)).join(' · ')}` : ''}${p.quirks ? `\n  How they write (follow it): ${clip(p.quirks, 200)}` : ''}${p.discretion ? `\n  ${p.discretion}` : ''}`).join('\n')}`,
        arr(others).length ? `ALSO IN THE GROUP (not answering now): ${others.join(', ')}` : '',
        `THE GROUP SO FAR (newest last)\n${arr(thread).slice(-14).map(m => `${m.who}: ${clip(m.text, 400)}`).join('\n')}`,
        'Who answers, and what?'].filter(Boolean).join('\n\n');
    return { system: sys, user };
}
/** The replies, against the candidates' names: known names only, once each, at most `max`. */
export function parseGroup(text, people, max = 2) {
    const raw = String(text ?? '').trim(), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const byName = new Map(arr(people).map(p => [String(p.name).trim().toLowerCase(), p]));
    for (const t of [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : '']) {
        let v; try { v = JSON.parse(t); } catch { continue; }
        if (!isObj(v) || !Array.isArray(v.replies)) continue;
        const seen = new Set(), out = [];
        for (const r of v.replies) {
            const p = isObj(r) && typeof r.text === 'string' && r.text.trim() ? byName.get(String(r.by || '').trim().toLowerCase()) : null;
            if (!p || seen.has(p.key) || out.length >= max) continue;
            seen.add(p.key); out.push({ who: p, text: clip(r.text, 1200) });
        }
        return out;
    }
    return [];
}
