/**
 * LOCAL PATCH suite — Cast ties (Miinthe, 2026-11-02: "some lowkey cast relationship board that includes towards user and
 * main lead"). Failures to avoid: a tie made up without a line that shows it; a tie to nobody; a pinned tie changed by
 * the AI; ties of someone away told to the writer; the list growing without end.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, normalizeState, freshState } from '../src/board-model-pure.js';
import { personNow, validateDirector, applyCastChanges, revertCast, castLines, directorUser, describeCastChange, MAX_TIES, withTie, withSug, seedSugs, seedUser, turnDown, tieModeOf, handChanges, TIE_HISTORY, MAX_TIE_SUGS } from '../src/cast-pure.js';

// the tests before smart ties (2026-11-03) are about the director writing ties: the Cast's tie mode 'write'
const board = (mode = 'write') => normalizeBoard({ v: 2, name: 'T', trackers: [{ id: 'cast', kind: 'cast', name: 'Cast', ...(mode === 'suggest' ? {} : { ties: mode }), people: [{ id: 'jun', name: 'Jun' }, { id: 'mara', name: 'Mara' }] }] });
const here = (b, extra = {}) => { const st = freshState(b); st.cast.cast.jun = { here: true, ...(extra.jun || {}) }; st.cast.cast.mara = { here: true, ...(extra.mara || {}) }; return st; };
const msgs = [{ name: 'Jun', mes: '"And I\'m not your bodyguard." He didn\'t look at Mara when he passed the inn.', _i: 12 }];
const names = { mainName: 'Corvin', userName: 'Miinthe' };
const dir = (ties, person = 'Jun') => [{ person, thoughts: 'x', plans: [], ties }];

test('a tie needs someone real and a word-for-word line', () => {
    const b = board(), st = here(b);
    const r = validateDirector(dir([
        { to: 'Miinthe', feel: 'distrusts, but follows anyway', trend: 'warmer', quote: 'And I\'m not your bodyguard.' },
        { to: 'Mara', feel: 'old friends, a little tense', trend: 'cooler', quote: 'He didn\'t look at Mara when he passed the inn.' },
        { to: 'The Queen', feel: 'loyal', quote: 'And I\'m not your bodyguard.' },
        { to: 'Corvin', feel: 'owes him his post', quote: 'he vouched for me' },
    ]), b, st, msgs, names);
    const ch = r.changes.find(c => c.field === 'ties');
    assertEqual(ch.to.map(t => `${t.to}|${t.w}|${t.tr}|${t.i}`).join(), 'Miinthe|distrusts, but follows anyway|up|12,Mara|old friends, a little tense|down|12');
    assert(r.rejected.some(x => x.reason === 'nobody by that name'));
    const r2 = validateDirector(dir([{ to: 'Corvin', feel: 'owes him his post', quote: 'he vouched for me' }]), b, st, msgs, names);
    assert(r2.rejected.some(x => x.reason === 'quote not found in the messages') && !r2.changes.some(c => c.field === 'ties'));
    // at most three a turn: a fourth isn't looked at
    assertEqual(r.rejected.length, 1);
});

test('the main character and {{user}} are fair targets; the person never ties to themselves', () => {
    const b = board(), st = here(b);
    const r = validateDirector(dir([{ to: 'Jun', feel: 'proud', quote: 'And I\'m not your bodyguard.' }, { to: 'Corvin', feel: 'owes him his post', quote: 'And I\'m not your bodyguard.' }]), b, st, msgs, names);
    assertEqual(r.changes.find(c => c.field === 'ties').to.map(t => t.to).join(), 'Corvin');
});

test('a pinned tie stays as Miinthe set it; the same feeling again is no change', () => {
    const b = board(), st = here(b, { jun: { ties: [{ to: 'Miinthe', w: 'fond of', pin: true }, { to: 'Mara', w: 'old friends' }] } });
    const r = validateDirector(dir([{ to: 'Miinthe', feel: 'hates', quote: 'And I\'m not your bodyguard.' }, { to: 'Mara', feel: 'old friends', trend: 'same', quote: 'He didn\'t look at Mara when he passed the inn.' }]), b, st, msgs, names);
    assertEqual(r.changes.filter(c => c.field === 'ties').length, 0);
});

test('applied, logged and undone like any Cast change', () => {
    const b = board(), st = here(b);
    const r = validateDirector(dir([{ to: 'Miinthe', feel: 'distrusts', quote: 'And I\'m not your bodyguard.' }]), b, st, msgs, names);
    const st2 = applyCastChanges(b, st, r.changes.filter(c => c.field === 'ties'), 12);
    const c = b.trackers[0];
    assertEqual(personNow(st2, c, c.people[0]).ties[0].w, 'distrusts');
    const e = st2.log.at(-1);
    revertCast(st2, e);
    assertEqual(personNow(st2, c, c.people[0]).ties.length, 0);
    assert(describeCastChange(b, r.changes.find(x => x.field === 'ties')).includes('Jun → Miinthe: distrusts'));
});

test('the writer hears ties of people in the scene only; the director sees them and the names', () => {
    const b = board(), st = here(b, { jun: { ties: [{ to: 'Miinthe', w: 'distrusts', tr: 'up' }] }, mara: { here: false, ties: [{ to: 'Miinthe', w: 'fond of' }] } });
    const lines = castLines(b, st).join('\n');
    assert(lines.includes('JUN feels: about Miinthe: distrusts (warming).'));
    assert(!lines.includes('fond of'));
    const u = directorUser(b, st, msgs, names);
    assert(u.includes('THE MAIN CHARACTER: Corvin · THE AUTHOR\'S CHARACTER: Miinthe') && u.includes('Ties: → Miinthe: distrusts'));
});

test('never more than MAX_TIES; pinned ones are kept first', () => {
    const b = board();
    const many = Array.from({ length: MAX_TIES }, (_, k) => ({ to: k === 0 ? 'Miinthe' : 'Mara', w: 'x' + k, pin: k === 0 }));
    const st = here(b, { jun: { ties: many } });
    const r = validateDirector(dir([{ to: 'Corvin', feel: 'owes him', quote: 'And I\'m not your bodyguard.' }]), b, st, msgs, names);
    const to = r.changes.find(c => c.field === 'ties').to;
    assertEqual(to.length, MAX_TIES); assert(to.some(t => t.pin && t.to === 'Miinthe') && to.some(t => t.to === 'Corvin'));
});

test('bug hunt 2026-11-03: a tie updated this turn is not the one trimmed away', () => {
    const b = board();
    const full = [{ to: 'Mara', w: 'old friends', pin: false }, ...Array.from({ length: MAX_TIES - 1 }, (_, k) => ({ to: 'Person' + k, w: 'x', pin: false }))];
    const st = here(b, { jun: { ties: full } });
    const r = validateDirector(dir([{ to: 'Mara', feel: 'furious with her', quote: 'He didn\'t look at Mara' }, { to: 'Corvin', feel: 'owes him', quote: 'And I\'m not your bodyguard.' }]), b, st, msgs, names);
    const c = r.changes.find(x => x.field === 'ties');
    assertEqual(c.to.length, MAX_TIES);
    assert(c.to.some(t => t.to === 'Mara' && t.w === 'furious with her'), 'the update stays');
    assert(!c.to.some(t => t.to === 'Person0'), 'the oldest other one goes');
    assertEqual(c.said.length, 2);
});

test('ties survive the chat state being saved and read back', () => {
    const b = board(), st = here(b, { jun: { ties: [{ to: 'Miinthe', w: 'distrusts', tr: 'up', q: 'x', i: 3, pin: true }, { to: '', w: 'junk' }] } });
    const back = normalizeState(JSON.parse(JSON.stringify(st)), b);
    assertEqual(JSON.stringify(back.cast.cast.jun.ties), JSON.stringify([{ to: 'Miinthe', w: 'distrusts', tr: 'up', q: 'x', i: 3, pin: true }]));
});

// ── smart ties, round 1 (Miinthe 2026-11-03: "we go with your suggestions"; no new automatic calls) ──

test('smart ties: "ask me" is the default — the director suggests, nothing is written, the writer gets nothing', () => {
    const b = board('suggest'), st = here(b);
    assertEqual(tieModeOf(b.trackers[0]), 'suggest');
    const r = validateDirector(dir([{ to: 'Miinthe', feel: 'distrusts her', trend: 'cooler', quote: 'And I\'m not your bodyguard.' }]), b, st, msgs, names);
    assert(!r.changes.some(c => c.field === 'ties'), 'nothing written');
    const ch = r.changes.find(c => c.field === 'tieSug');
    assert(ch && ch.to[0].to === 'Miinthe' && ch.to[0].src === 'scene' && ch.to[0].i === 12, 'a suggestion with its line');
    const st2 = applyCastChanges(b, st, r.changes, 13);
    assertEqual(personNow(st2, b.trackers[0], b.trackers[0].people[0]).tieSug.length, 1);
    assert(!castLines(b, st2).some(l => / feels: /.test(l)), 'a suggestion is not a tie');
    assert(describeCastChange(b, ch).includes('suggested'));
    // the same suggestion next turn: nothing new
    assertEqual(validateDirector(dir([{ to: 'Miinthe', feel: 'distrusts her', quote: 'And I\'m not your bodyguard.' }]), b, st2, msgs, names).changes.filter(c => c.field === 'tieSug').length, 0);
});

test('smart ties: off ignores the director; write still writes', () => {
    const t = [{ to: 'Miinthe', feel: 'distrusts her', quote: 'And I\'m not your bodyguard.' }];
    const off = board('off');
    assert(!validateDirector(dir(t), off, here(off), msgs, names).changes.some(c => c.field === 'ties' || c.field === 'tieSug'));
    const w = board('write');
    assert(validateDirector(dir(t), w, here(w), msgs, names).changes.some(c => c.field === 'ties'));
});

test('smart ties: ✓ makes it a tie, ✕ turns it down for good', () => {
    const b = board('suggest');
    const sug = { to: 'Miinthe', w: 'distrusts her', tr: 'down', q: 'And I\'m not your bodyguard.', i: 12, src: 'scene', why: '' };
    const st = here(b, { jun: { tieSug: [sug] } });
    const yes = handChanges(b, st, 'cast', 'jun', { ties: withTie([], { ...sug, pin: false }), tieSug: [] }, 14);
    const n = personNow(yes, b.trackers[0], b.trackers[0].people[0]);
    assertEqual(n.ties.length, 1); assertEqual(n.tieSug.length, 0); assertEqual(n.ties[0].q, sug.q);
    assert(!('src' in n.ties[0]), 'a kept tie is a plain tie');
    const no = handChanges(b, st, 'cast', 'jun', { tieSug: [], tieNo: turnDown([], sug) }, 14);
    const n2 = personNow(no, b.trackers[0], b.trackers[0].people[0]);
    assertEqual(n2.tieSug.length, 0);
    const again = validateDirector(dir([{ to: 'Miinthe', feel: 'distrusts her', quote: 'And I\'m not your bodyguard.' }]), b, no, msgs, names);
    assert(!again.changes.some(c => c.field === 'tieSug'), 'turned down: not suggested again');
    // and both are one Undo each, like any change
    const log = no.log.slice(-2);
    let back = JSON.parse(JSON.stringify(no)); for (const e of log.reverse()) revertCast(back, e);
    assertEqual(personNow(back, b.trackers[0], b.trackers[0].people[0]).tieSug.length, 1);
});

test('smart ties: a tie keeps its story when it changes, capped', () => {
    let list = withTie([], { to: 'Mara', w: 'strangers', i: 3, q: 'Who are you?' });
    list = withTie(list, { to: 'Mara', w: 'friendly', i: 12, q: 'Thanks, really.' });
    list = withTie(list, { to: 'Mara', w: 'resentful', i: 40, q: 'You lied.' });
    assertEqual(list.length, 1);
    assertEqual(list[0].h.map(x => x.w).join(' → '), 'strangers → friendly');
    assertEqual(list[0].h[1].i, 12);
    for (let k = 0; k < 10; k++) list = withTie(list, { to: 'Mara', w: `feel ${k}` });
    assertEqual(list[0].h.length, TIE_HISTORY);
    // the same feeling again (only the trend changed): no new step
    const same = withTie(list, { to: 'Mara', w: list[0].w, tr: 'up' });
    assertEqual(same[0].h.length, TIE_HISTORY); assertEqual(same[0].h.at(-1).w, list[0].h.at(-1).w);
    // the director writing (mode write) keeps the story too
    const b = board('write'), st = here(b, { jun: { ties: [{ to: 'Mara', w: 'old friends', i: 2 }] } });
    const r = validateDirector(dir([{ to: 'Mara', feel: 'avoids her now', trend: 'cooler', quote: 'He didn\'t look at Mara when he passed the inn.' }]), b, st, msgs, names);
    assertEqual(r.changes.find(c => c.field === 'ties').to[0].h[0].w, 'old friends');
});

test('smart ties: ✨ Suggest ties — the answer checked: known people, nothing she has or turned down, at most 4', () => {
    const now = { ties: [{ to: 'Mara', w: 'old friends' }], tieSug: [], tieNo: turnDown([], { to: 'Corvin', w: 'owes him' }) };
    const ans = JSON.stringify({ ties: [
        { to: 'Mara', feel: 'old friends', why: 'card' },          // she has it
        { to: 'Corvin', feel: 'owes him', why: 'card' },          // turned down
        { to: 'The Queen', feel: 'loyal', why: 'lore' },           // nobody
        { to: 'miinthe', feel: 'curious about her', why: 'the chat: he keeps watching her' },
        { to: 'Miinthe', feel: 'twice', why: 'x' },                    // one per person
    ] });
    const out = seedSugs('```json\n' + ans + '\n```', { targets: ['Mara', 'Corvin', 'Miinthe'], now });
    assertEqual(out.length, 1); assertEqual(out[0].to, 'Miinthe'); assertEqual(out[0].src, 'seed'); assert(out[0].why.includes('watching'));
    assertEqual(seedSugs('not json', { targets: ['Miinthe'] }).length, 0);
    const u = seedUser({ name: 'Jun', card: 'Jun grew up with Mara.', targets: ['Mara', 'Miinthe'], ties: now.ties });
    assert(u.includes('PEOPLE: Mara, Miinthe') && u.includes('grew up with Mara') && u.includes("don't repeat"));
    let s = []; for (let k = 0; k < 6; k++) s = withSug(s, { to: `P${k}`, w: 'x' });
    assertEqual(s.length, MAX_TIE_SUGS); assertEqual(s[0].to, 'P2');
});

test('smart ties: the board keeps the tie mode; old stored ties and suggestions read back safely', () => {
    assertEqual(normalizeBoard({ v: 2, trackers: [{ id: 'c', kind: 'cast', name: 'C', ties: 'off', people: [] }] }).trackers[0].ties, 'off');
    assertEqual(tieModeOf(normalizeBoard({ v: 2, trackers: [{ id: 'c', kind: 'cast', name: 'C', ties: 'weird', people: [] }] }).trackers[0]), 'suggest');
    const b = board('suggest');
    const st = here(b, { jun: { ties: [{ to: 'Mara', w: 'ok', h: [{ w: '' }, 'x', { w: 'before', i: 'no' }] }], tieSug: [{ to: '', w: 'x' }, { to: 'Miinthe', w: 'likes her', src: 'weird' }], tieNo: [3, 'miinthe|x'] } });
    const n = personNow(st, b.trackers[0], b.trackers[0].people[0]);
    assertEqual(n.ties[0].h.length, 1); assertEqual(n.ties[0].h[0].i, null);
    assertEqual(n.tieSug.length, 1); assertEqual(n.tieSug[0].src, 'scene');
    assertEqual(n.tieNo.join(), 'miinthe|x');
});

test('smart ties: suggestions, turned-down ties and a tie\'s story survive the chat state being saved and read back', () => {
    const b = board('suggest');
    const st = here(b, { jun: { ties: [{ to: 'Mara', w: 'friendly', h: [{ w: 'strangers', i: 3, q: 'Who are you?' }] }], tieSug: [{ to: 'Miinthe', w: 'likes her', src: 'seed', why: 'card' }], tieNo: ['corvin|owes him'] } });
    const back = normalizeState(JSON.parse(JSON.stringify(st)), b);
    const n = personNow(back, b.trackers[0], b.trackers[0].people[0]);
    assertEqual(n.ties[0].h[0].w, 'strangers'); assertEqual(n.ties[0].h[0].i, 3);
    assertEqual(n.tieSug.length, 1); assertEqual(n.tieSug[0].src, 'seed'); assertEqual(n.tieSug[0].why, 'card');
    assertEqual(n.tieNo.join(), 'corvin|owes him');
});

summary('cast-ties');
