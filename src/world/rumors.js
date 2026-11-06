/**
 * World layer, stage 5 — rumors and the story (Miinthe, 2026-10-19; rules in rumor-pure.js).
 *
 * rumorTick: one call after the feed's tick — maybe a new rumor from the scene (only people who were there start one; it
 * spreads by itself, Undo on the notice), word of mouth with retellings that drift, and — only where a tracker's board
 * switch is on — a tracker move (Undo). spreadTip: a tip (or leaked messages) sent to the rumor account becomes one of
 * its posts, mixed with what others know; whoever tipped knows it was them. What people hear joins their Cast knowledge
 * (how: heard, via: rumor), so the main story's writer and the people's own voices know it too.
 */
import { getContext } from '../../../../../extensions.js';
import { resolveConnectionConfig } from '../../settings.js';
import { callAI } from '../ai/ai.js';
import { live, saveLiveState } from '../board-live.js';
import { applyCastChanges, personNow } from '../cast-pure.js';
import { undoCollections } from '../autotrack.js';
import { getTrackers, moveTracker } from '../trackers.js';
import * as K from '../kit/kit.js';
import { addRecord } from './world-pure.js';
import { newPost, updatePost, postsOf, mergeTaught } from './feed-pure.js';
import { USER, MAIN, personByKey, storyClock, stampText } from './messages-pure.js';
import { RUMOR, rumorName, seedRumorPrompt, parseSeed, SEED_SCHEMA, noticers, runningRumors, withHeard, withDrift, heardFact, rumorChanges, rumorPrompt, parseRumor, RUMOR_SCHEMA, tipPrompt, parseTip, TIP_SCHEMA, normRumor, namesTipper } from './rumor-pure.js';
import { nameOfKey as nameOf } from './messages.js';
import { everyone } from './feed.js';

const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lastI = () => (getContext()?.chat?.length ?? 0) - 1;
const clockNow = () => { const L = live(); return L ? storyClock(L.board, L.state) : null; };
const stampNow = () => { const c = clockNow(); return c ? { day: c.day, part: c.part || '' } : { msg: Math.max(0, lastI()) }; };
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

let H = null;
export function hookRumors(h) { H = h; }
let busy = false;

const connOk = conn => conn.mode === 'profile' && !!conn.profileId;
const mainKnows = () => H.store().records.filter(r => r.kind === 'mknow').map(r => r.fact);

/** Everyone the world knows, with where they are and what they know (for the rumor call). */
function peopleNow(w, { all = false } = {}) {
    const L = live(); if (!L) return [];
    return everyone(w).filter(p => all || !p.muted).map(p => {
        if (p.key === MAIN) return { ...p, here: true, knows: mainKnows() };
        const x = personByKey(L.board, p.key);
        if (!x) return { ...p, here: false, knows: [] };
        const now = personNow(L.state, x.cast, x.p);
        return { ...p, here: now.here, knows: now.knows.map(k => k.fact) };
    });
}

/**
 * Facts for people (by key): Cast people as knowledge (logged at the newest message, the world's), the main character on
 * the world's own list. Returns what to undo: { logIds, mknowIds }.
 */
function give(byKey) {
    const L = live(); if (!L) return { logIds: [], mknowIds: [] };
    const at = Math.max(0, lastI()), logIds = [], mknowIds = [];
    let state = L.state, st = H.store();
    for (const [key, facts] of byKey) {
        if (!facts.length) continue;
        if (key === MAIN) { for (const f of facts) { const r = { kind: 'mknow', id: newId('k'), fact: f, from: 'a rumor' }; st = addRecord(st, r, at); mknowIds.push(r.id); } continue; }
        const x = personByKey(L.board, key);
        if (!x) continue;
        const ch = rumorChanges(x.cast, x.p, facts, newId);
        state = applyCastChanges(L.board, state, ch, at, { who: 'world' });
        logIds.push(...ch.map(c => c.logId).filter(Boolean));
    }
    if (logIds.length) saveLiveState(state);
    if (mknowIds.length) H.save(st);
    return { logIds, mknowIds };
}
/** For the news (feed.js): people of the story who were quoted know they gave that statement. */
export function tellQuoted(keys, outlet, headline) { const m = new Map(); for (const k of keys || []) push(m, k, clip(`Gave a statement to ${outlet}: "${clip(headline, 110)}"`, 160)); return m.size ? give(m) : null; }
/** A deleted rumor brought back (its Undo): everyone who had heard it knows it again. Returns the new undo. */
export function regive(post) {
    const r = normRumor(post?.rumor), facts = new Map();
    for (const k of r.heard) push(facts, k, heardFact(post.text, ''));
    return give(facts);
}
export function ungive({ logIds = [], mknowIds = [] } = {}) {
    if (logIds.length) undoCollections(logIds);
    if (mknowIds.length) H.save({ ...H.store(), records: H.store().records.filter(r => !mknowIds.includes(r.id)) });
}
const push = (map, key, fact) => { if (key && key !== USER && !String(key).startsWith('v:') && key !== RUMOR) map.set(key, [...(map.get(key) || []), fact]); };

/** The trackers rumors may move: step trackers whose board switch is on ("news and rumors can move this"). */
function movable(L) {
    const on = new Set((L.board.trackers || []).filter(t => t.worldMoves === true && t.kind === 'steps').map(t => t.id));
    if (!on.size) return [];
    try { return getTrackers().filter(t => on.has(t.id) && Array.isArray(t.steps) && t.steps.length).map(t => ({ id: t.id, name: t.name, steps: t.steps.map(String), now: String(t.steps[t.index] ?? ''), index: t.index })); } catch { return []; }
}

/** One rumor call after the feed's tick (world.js). `scene`: the reply set it off, so the scene may start a rumor. */
export async function rumorTick(w, { scene = false } = {}) {
    if (!H || !w || busy || w.paused || !w.sections.feed) return;
    const L = live(); if (!L) return;
    const conn = resolveConnectionConfig('world'); if (!connOk(conn)) return;
    const ppl = peopleNow(w);
    if (!ppl.length) return;
    // readers notice posted rumors first (a fixed rule, no call) — the call then sees who's in the know
    // muted people still notice what's posted (a break from the world, not from hearing); they start and pass on nothing
    const readers = peopleNow(w, { all: true }).map(p => ({ ...p, muted: false }));
    for (const p of runningRumors(H.store(), 3)) {
        const seen = noticers(p, readers);
        if (!seen.length) continue;
        H.save(updatePost(H.store(), p.id, x => withHeard(x, seen.map(s => s.key))));
        const facts = new Map();
        for (const s of seen) push(facts, s.key, clip(`Saw it posted by ${nameOf(p.by)}: "${clip(p.text, 110)}"`, 160));
        const taught = give(facts);   // linked to the post, so deleting it undoes what they saw
        H.save(updatePost(H.store(), p.id, x => ({ taught: mergeTaught(x.taught, taught) })));
    }
    const rumors = runningRumors(H.store());
    const here = ppl.some(p => p.here && p.key !== MAIN);
    const sceneMsgs = scene && here ? (getContext()?.chat || []).filter(x => x && !x.is_system && typeof x.mes === 'string').slice(-6).map(x => ({ name: x.name, mes: x.mes })) : [];
    if (!sceneMsgs.length && !rumors.length) return;   // nothing to start from, nothing to pass on
    const trackers = movable(L), c = clockNow();
    busy = true;
    const cid = H.chat();
    try {
        const pr = rumorPrompt({ userName: nameOf(USER), accountName: rumorName(w), people: ppl.map(p => ({ ...p, here: p.here && sceneMsgs.length > 0 })), scene: sceneMsgs, rumors: rumors.map(p => ({ n: p.n, text: p.text, by: nameOf(p.by), heard: normRumor(p.rumor).heard.map(nameOf) })), trackers, look: w.look, when: c ? stampText({ day: c.day, part: c.part }) : '', newOk: sceneMsgs.length > 0 });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 900), caller: 'world', skipThrottle: true, jsonSchema: RUMOR_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        if (window.__dleWorldDebug) console.log('[Onyx Quill] world rumors', r?.text, '\n---\n', pr.user);
        if (H.chat() !== cid) return;
        const a = parseRumor(r?.text, ppl, rumors.map(p => p.n), trackers, [{ key: RUMOR, name: rumorName(w) }], Object.fromEntries(rumors.map(p => [p.n, p.text])));
        if (a.newRumor) startRumor(w, a.newRumor);
        // only someone in the know passes it on (or whoever posted it — readers notice the post)
        for (const s of a.spread) { const p = postsOf(H.store()).find(x => x.n === s.rumor); if (p && (s.by.key === p.by || normRumor(p.rumor).heard.includes(s.by.key))) passOn(s); }
        for (const m of a.moves) moveBy(trackers, m);
    } catch (err) { console.warn('[Onyx Quill] world: rumors failed', err?.message || err); }
    finally { busy = false; H.changed(); H.render(); }
}

/**
 * ◌ Start a rumor from this… (the reply menu on a main-chat message): who starts it, through the account or not, true /
 * twisted / made up, an optional wish — one call writes it, then it goes out like any rumor from the story (Undo).
 */
export function openRumorFrom(n, w) {
    const m = getContext()?.chat?.[n];
    if (!H || !w || !m || typeof m.mes !== 'string') return;
    const ppl = peopleNow(w);
    if (!ppl.length) { K.notify({ title: 'World', text: 'Nobody in this story could start a rumor yet: add people to the Cast on the board.', tone: 'warn' }); return; }
    let starter = ppl.find(p => p.here && p.key !== MAIN)?.key || ppl[0].key, kind = 'twisted', anon = true;
    const wrap = document.createElement('div'); wrap.className = 'dle-rumorfrom'; wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';   // inline: world.css may not be loaded yet
    const quote = document.createElement('p'); quote.className = 'dk-hint'; quote.textContent = `#${n} ${m.name}: ${clip(m.mes.replace(/\s+/g, ' '), 180)}`;
    const lab = t => { const l = document.createElement('div'); l.className = 'dk-label'; l.textContent = t; return l; };
    const sel = document.createElement('select'); sel.className = 'dk-field'; sel.setAttribute('aria-label', 'Who starts it');
    sel.innerHTML = ppl.map(p => `<option value="${p.key}"${p.key === starter ? ' selected' : ''}>${p.name.replace(/[<&]/g, '')}${p.here ? ' (in the scene)' : ''}</option>`).join('');
    sel.onchange = () => { starter = sel.value; };
    const anonBox = K.toggle({ checked: true, label: `Anonymously, through ${rumorName(w)}`, onChange: v => { anon = v; } });
    const anonRow = document.createElement('label'); anonRow.className = 'dle-rf-row'; anonRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer'; anonRow.append(anonBox, document.createTextNode(` Anonymously, through ${rumorName(w)}`));
    const kinds = K.seg({ options: [['true', 'True'], ['twisted', 'Twisted'], ['madeup', 'Made up']], value: kind, onChange: v => { kind = v; }, label: 'What kind of rumor' });
    const note = document.createElement('textarea'); note.className = 'dk-field'; note.rows = 2; note.placeholder = 'Anything it should say or hint at? (optional) e.g. make it sound like it was done on purpose';
    wrap.append(quote, lab('Who starts it'), sel, anonRow, lab('What kind'), kinds, lab('Your wish'), note);
    const go = K.button({ label: 'Start the rumor', kind: 'primary', onClick: async () => {
        go.disabled = true; go.textContent = 'Writing it…';
        const ok = await seedRumor(w, { n, starter, anon, kind, note: note.value.trim() });
        if (ok) win.close(); else { go.disabled = false; go.textContent = 'Start the rumor'; }
    } });
    const win = K.openWindow({ title: 'Start a rumor from this', body: [wrap], foot: [go], size: 'small' });
}
async function seedRumor(w, { n, starter, anon, kind, note }) {
    const conn = resolveConnectionConfig('world');
    if (!connOk(conn)) { K.notify({ title: 'World', text: 'Rumors need the world\'s AI connection: Settings › AI & connections › World.', tone: 'warn' }); return false; }
    const m = getContext()?.chat?.[n], ppl = peopleNow(w), st = ppl.find(p => p.key === starter);
    if (!m || !st) return false;
    const cid = H.chat();
    try {
        const pr = seedRumorPrompt({ starter: st.name, account: anon ? rumorName(w) : '', message: { name: m.name, text: m.mes }, kind, note, others: ppl.filter(p => p.key !== starter).map(p => p.name), look: w.look });
        const r = await callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'world', skipThrottle: true, jsonSchema: SEED_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        if (H.chat() !== cid) return false;
        const s = parseSeed(r?.text, ppl);
        if (!s) { K.notify({ title: 'World', text: 'The rumor came back unreadable. Try again.', tone: 'warn' }); return false; }
        startRumor(w, { starter: st, account: anon, text: s.text, kind, truth: s.truth, heard: s.heard }, { from: `Message #${n} (${m.name}), started on purpose` });
        return true;
    } catch (err) { K.notify({ title: 'World', text: `No rumor: ${err?.message || err}`, tone: 'warn' }); return false; }
    finally { H.changed(); H.render(); }
}

/** A new rumor from the scene: posted (under the starter's name or through the account), heard by a few — Undo. */
function startRumor(w, n, { from = '' } = {}) {
    const i = Math.max(0, lastI()), id = newId('p');
    const heard = [...new Set([n.starter.key, ...n.heard.map(x => x.key)])];
    const post = { ...newPost({ store: H.store(), by: n.account ? RUMOR : n.starter.key, text: n.text, stamp: stampNow(), id, crowd: Math.round(2 + Math.random() * 14), auto: true }),
        rumor: { kind: n.kind, truth: n.truth, from: from || `The scene at message #${i}`, who: n.starter.key, heard } };
    H.save(addRecord(H.store(), post, i));
    const facts = new Map();
    push(facts, n.starter.key, clip(n.account ? `Posted a rumor anonymously through ${rumorName(w)}: "${clip(n.text, 110)}"` : `Started a rumor: "${clip(n.text, 120)}"`, 160));
    for (const x of n.heard) push(facts, x.key, heardFact(n.text, n.account ? '' : n.starter.name));
    const undo = give(facts);
    H.save(updatePost(H.store(), id, p => ({ rumor: { ...p.rumor, undo } })));
    K.notify({ title: 'World', text: `A rumor is going around: "${clip(n.text, 90)}"`, undo: H.here(() => { ungive(undo); H.save({ ...H.store(), records: H.store().records.filter(r => r.id !== id) }); H.render(); }) });
}

/** Word of mouth: who heard it from whom, maybe a little changed. No notice (it shows in "Heard it so far"). */
function passOn(s) {
    const p = postsOf(H.store()).find(x => x.n === s.rumor);
    if (!p) return;
    const fresh = s.to.filter(x => !normRumor(p.rumor).heard.includes(x.key));
    if (!fresh.length) return;
    H.save(updatePost(H.store(), p.id, x => ({ ...withHeard(x, fresh.map(f => f.key)), ...(s.retold ? { rumor: withDrift({ ...x, ...withHeard(x, fresh.map(f => f.key)) }, s.by.key, s.retold).rumor } : {}) })));
    const facts = new Map();
    for (const x of fresh) push(facts, x.key, heardFact(s.retold || p.text, s.by.name));
    give(facts);
}

/** A rumor moved a tracker (its switch is on): the world's move, Undo puts it back. */
function moveBy(trackers, m) {
    const t = trackers.find(x => x.name === m.tracker);
    const to = t ? t.steps.indexOf(m.to) : -1;
    if (!t || to < 0) return;
    const r = moveTracker(t.name, { toIndex: to, who: 'world' });
    if (r?.error) return;
    K.notify({ title: 'World', text: `The talk of the town moved ${t.name}: ${t.now} → ${m.to}${m.why ? ` (${clip(m.why, 80)})` : ''}`, undo: H.here(() => moveTracker(t.name, { toIndex: t.index, who: 'world' })) });
}

/**
 * A tip to the rumor account (a message to it, or leaked messages): one post through the account, mixed with what
 * others know — the tipper knows it was them. Nothing when the tip holds no gossip.
 */
/** The witness check the rumor account is waiting on (one at a time), or null. */
export const openAsk = store => (store?.records || []).find(r => r.kind === 'ask' && r.stage !== 'done') || null;

export async function spreadTip(w, tipper, tip, { leak = false, talk = [], mayAsk = true } = {}) {
    if (!H || !w) return;
    const L = live(); if (!L) return;
    const conn = resolveConnectionConfig('world'); if (!connOk(conn)) return;
    const cid = H.chat();
    try {
        const others = peopleNow(w).filter(p => p.key !== tipper).map(p => ({ name: p.name, knows: p.knows }));
        // who it could check with first: the story's people (not the tipper, not muted), and only one check at a time
        const askable = mayAsk && !leak && !openAsk(H.store()) ? peopleNow(w).filter(p => p.key !== tipper && p.key !== USER && (p.kind === 'cast' || p.kind === 'main')) : [];
        const pr = tipPrompt({ accountName: rumorName(w), tipperName: nameOf(tipper), tip, talk, others, rumors: runningRumors(H.store()).map(p => p.text), look: w.look, canAsk: askable.map(p => p.name) });
        const ask = () => callAI(pr.system, pr.user, { ...conn, maxTokens: Math.max(Number(conn.maxTokens) || 0, 600), caller: 'world', skipThrottle: true, jsonSchema: TIP_SCHEMA, disableThinkingOnClaude: true, noReasoning: true, temperature: 0.9 });
        let t = parseTip((await ask())?.text);
        // the account never names who tipped it (Miinthe, 2026-10-19: it "DOXXED ME AND SPOON"): a post naming them is written again, once, then dropped
        if (t && !t.ask && namesTipper(t.text, nameOf(tipper))) { t = parseTip((await ask())?.text); if (t && !t.ask && namesTipper(t.text, nameOf(tipper))) t = null; }
        if (!t || H.chat() !== cid) return;
        // it checks with a witness first: the post waits; it texts them after a main exchange, they answer after another
        const witness = t.ask ? askable.find(p => p.name.toLowerCase() === t.ask.toLowerCase()) : null;
        if (witness) {
            const aid = newId('a');
            H.save(addRecord(H.store(), { kind: 'ask', id: aid, who: witness.key, tipper, tip: clip([...talk.slice(-3), tip].join('\n'), 1500), stage: 'wait', due: lastI() + 2, auto: true }, Math.max(0, lastI())));
            K.notify({ title: 'World', text: `${rumorName(w)} wants to check with ${witness.name} first.`, undo: H.here(() => { H.save({ ...H.store(), records: H.store().records.filter(r2 => r2.id !== aid) }); H.render(); }) });
            return;
        }
        if (!t.text) return;
        const i = Math.max(0, lastI()), id = newId('p');
        const post = { ...newPost({ store: H.store(), by: RUMOR, text: t.text, stamp: stampNow(), id, crowd: Math.round(3 + Math.random() * 18), auto: true }),
            rumor: { kind: t.kind, truth: t.truth, from: leak ? `Messages leaked by ${nameOf(tipper)}` : `A tip from ${nameOf(tipper)}`, who: tipper, heard: [tipper] } };
        H.save(addRecord(H.store(), post, i));
        const facts = new Map();
        push(facts, tipper, clip(`Tipped off ${rumorName(w)}; it now spreads: "${clip(t.text, 100)}"`, 160));
        const undo = give(facts);
        K.notify({ title: 'World', text: `${rumorName(w)} is spreading it: "${clip(t.text, 90)}"`, undo: H.here(() => { ungive(undo); H.save({ ...H.store(), records: H.store().records.filter(r2 => r2.id !== id) }); H.render(); }) });
    } catch (err) { console.warn('[Onyx Quill] world: the tip went nowhere', err?.message || err); }
    finally { H.changed(); H.render(); }
}
