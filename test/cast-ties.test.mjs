/**
 * LOCAL PATCH suite — Cast ties (Miinthe, 2026-11-02: "some lowkey cast relationship board that includes towards user and
 * main lead"). Failures to avoid: a tie made up without a line that shows it; a tie to nobody; a pinned tie changed by
 * the AI; ties of someone away told to the writer; the list growing without end.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { normalizeBoard, normalizeState, freshState } from '../src/board-model-pure.js';
import { personNow, validateDirector, applyCastChanges, revertCast, castLines, directorUser, describeCastChange, MAX_TIES } from '../src/cast-pure.js';

const board = () => normalizeBoard({ v: 2, name: 'T', trackers: [{ id: 'cast', kind: 'cast', name: 'Cast', people: [{ id: 'jun', name: 'Jun' }, { id: 'mara', name: 'Mara' }] }] });
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

summary('cast-ties');
