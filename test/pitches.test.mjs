/**
 * LOCAL PATCH suite — Mero ☆'s 💡 pitches (2026-10-14, `10 co-writer design.md` §9, mock-up v4).
 * Failures to avoid: a new batch eating kept or running pitches; ← Back losing a pitch for good (Bring back) or
 * counting as 👎; numbers repeating; a model answer in a code fence or with extra keys giving nothing; two "ask"
 * pitches; a "who" that isn't on the Cast; a hidden pitch without a moment, or Mero's moment beating Miinthe's; a
 * "landed" with a quote that isn't in the reply; the fallback firing early; taste notes growing forever; Mero's
 * [[PITCH]] cards leaking into the talk text.
 * Run: npm run test:pitches
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import {
    asPitches, normMenu, addBatch, dropPicking, bringBack, setPitch, trimPitches, pitchPrompt, parsePitches, parseHidden, checkFrom,
    fallbackDue, boardEntryTitles, quietLore, castForPitches, tasteText, tasteOverflow, takePitchCards, directionText, MAX_KEPT_LIST, MAX_TASTE,
    parsePlans, startPlan, planLines, repliesSince, beatDue, tickBeat, rewindPlan, timerDue, lingerPatch, rewritePrompt, parseRewrite, applyReview, normPitch,
} from '../src/pitches-pure.js';
import { normNote, buildMeroPrompt, normTalk } from '../src/mero-pure.js';

const P = (text, extra = {}) => ({ kind: 'twist', strength: 'turn', src: 'loose', from: 'x', text, ...extra });

test('menu: remembered, clamped', () => {
    const m = normMenu({ shape: 'multi', vis: 'hide', n: 9, str: 'bomb', tone: 'nsfw', fb: 1 });
    assertEqual(m.shape, 'multi'); assertEqual(m.vis, 'hide'); assertEqual(m.n, 5); assertEqual(m.str, 'bomb'); assertEqual(m.tone, 'nsfw'); assertEqual(m.fb, 2);
    assertEqual(normMenu(null).n, 3);
});

test('a new batch replaces the pick view only; numbers go on', () => {
    let s = addBatch(null, [P('one'), P('two'), P('three')]);
    assertEqual(s.list.map(p => p.no).join(','), '1,2,3');
    s = setPitch(s, s.list.find(p => p.no === 2).id, { st: 'kept' });
    s = setPitch(s, s.list.find(p => p.no === 3).id, { st: 'dir' });
    s = addBatch(s, [P('four'), P('five')]);
    assertEqual(s.list.filter(p => p.st === 'fresh').map(p => p.no).join(','), '4,5');
    assert(s.list.some(p => p.no === 2 && p.st === 'kept'), 'kept stays');
    assert(s.list.some(p => p.no === 3 && p.st === 'dir'), 'running stays');
    assert(!s.list.some(p => p.no === 1), 'the unused one of the old batch is gone');
    const more = addBatch(s, [P('six')], { replace: false });
    assertEqual(more.list.filter(p => p.st === 'fresh').length, 3, '"more like these" adds to the batch');
});

test('← Back drops the batch; ↩ Bring back returns it once', () => {
    let s = addBatch(null, [P('a'), P('b')]);
    s = setPitch(s, s.list[0].id, { st: 'kept' });
    s = dropPicking(s);
    assertEqual(s.list.length, 1); assertEqual(s.dropped.length, 1);
    s = bringBack(asPitches(JSON.parse(JSON.stringify(s))));   // survives a save
    assertEqual(s.list.filter(p => p.st === 'fresh').length, 1); assertEqual(s.dropped.length, 0);
    s = addBatch(dropPicking(s), [P('c')]);
    assertEqual(s.dropped.length, 0, 'a new batch ends the bring-back');
});

test('the store stays a sane size; running and kept ones are never trimmed', () => {
    let s = asPitches(null);
    for (let k = 0; k < MAX_KEPT_LIST + 20; k++) { s = addBatch(s, [P(`p${k}`)], { replace: false }); s = setPitch(s, s.list[0].id, { st: 'landed' }); }
    s = addBatch(s, [P('kept one')], { replace: false }); s = setPitch(s, s.list[0].id, { st: 'kept' });
    s = trimPitches(s);
    assert(s.list.length <= MAX_KEPT_LIST, `trimmed (${s.list.length})`);
    assert(s.list.some(p => p.text === 'kept one'), 'kept survives');
    assertEqual(Math.max(...s.list.map(p => p.no)), s.next - 1, 'the counter never goes back');
});

test('parsePitches: fences, extra text, one ask at most, Cast names, no duplicates', () => {
    const ans = 'Sure!\n```json\n{"pitches": [{"kind": "acts", "strength": "Turn", "who": "kettle", "source": "cast", "from": "Kettle\'s plan", "text": "Kettle hides the fuse."},'
        + '{"kind": "ask", "strength": "nudge", "text": "What does Spoon want?"}, {"kind": "question", "text": "Second question?"},'
        + '{"kind": "twist", "who": "Nobody", "text": "Kettle hides the fuse."}, {"kind": "callback", "strength": "bombshell", "source": "lore", "text": "The cellar door opens."}]}\n```';
    const out = parsePitches(ans, 5, ['Kettle', 'Spoon']);
    assertEqual(out.length, 3);
    assertEqual(out[0].who, 'Kettle'); assertEqual(out[0].kind, 'acts'); assertEqual(out[0].strength, 'turn'); assertEqual(out[0].src, 'cast');
    assertEqual(out.filter(p => p.kind === 'ask').length, 1);
    assertEqual(out[2].strength, 'bomb'); assertEqual(out[2].src, 'lore');
    assertEqual(parsePitches('{"pitches":[{"kind":"ask","text":"Q?"}]}', 1).length, 0, 'never an ask on its own');
    assertEqual(parsePitches('no json here', 3).length, 0);
    assertEqual(parsePitches('{"pitches":[{"text":"a"},{"text":"b"},{"text":"c"}]}', 2).length, 2, 'at most n');
});

test('parseHidden: needs a moment; Miinthe\'s own moment wins; no questions', () => {
    const a = '{"pitch": {"kind": "twist", "strength": "turn", "text": "Spoon buried the teaspoons."}, "moment": "when someone goes to the garden"}';
    assertEqual(parseHidden(a).moment, 'when someone goes to the garden');
    assertEqual(parseHidden(a, [], 'when the lights go out').moment, 'when the lights go out');
    assertEqual(parseHidden('{"pitch": {"kind": "ask", "text": "Q?"}, "moment": "x"}'), null);
    assertEqual(parseHidden('{"pitch": {"text": "x"}}').moment, '', 'no moment → the glue refuses it');
});

test('did it land / has the moment come: the quote must be in the text', () => {
    const reply = 'Kettle pries the crumb tray loose and freezes: there is tape inside.';
    assertEqual(checkFrom('{"landed": true, "quote": "pries the crumb tray loose and freezes"}', [reply], 'landed'), 'pries the crumb tray loose and freezes');
    assertEqual(checkFrom('{"landed": true, "quote": "opens the cellar door wide"}', [reply], 'landed'), null, 'invented quote');
    assertEqual(checkFrom('{"landed": false}', [reply], 'landed'), null);
    assertEqual(checkFrom('{"came": true, "quote": "I step out into the garden"}', ['Hi.', 'I step out into the garden to find Spoon.'], 'came'), 'I step out into the garden');
});

test('the fallback fires after N messages, not before; off when 0', () => {
    const p = { st: 'hidden', armed: 10, fb: 5 };
    assert(!fallbackDue(p, 14)); assert(fallbackDue(p, 15));
    assert(!fallbackDue({ ...p, fb: 0 }, 99)); assert(!fallbackDue({ ...p, st: 'fired' }, 99));
});

test('the prompt: hidden asks for a moment; DON\'T notes and taste go in; a single pitch never asks', () => {
    const ctx = { user: 'Miinthe', character: 'Toaster', donts: ['Kettle never apologises first.'], taste: ['Not my thing: new characters'], cast: castForPitches([{ name: 'Kettle', here: true, wants: 'peace', plans: ['fix the toaster'], thoughts: 'buried the teaspoons', hidden: true }]), replies: [{ i: 3, name: 'Kettle', text: 'Hm.' }] };
    const h = pitchPrompt({ vis: 'hide', moment: 'when the lights go out' }, ctx);
    assert(/MOMENT/.test(h.system) && /the author named the moment/.test(h.system), 'hidden: the moment');
    assert(/when the lights go out/.test(h.user));
    const v = pitchPrompt({ n: 4, str: 'nudge', tone: 'sfw' }, ctx, { comment: 'something with the cellar' });
    assert(/exactly 4/.test(v.system) && /Strength wanted: nudge/.test(v.user) && /something with the cellar/.test(v.user));
    assert(/Kettle never apologises first/.test(v.user) && /new characters/.test(v.user));
    assert(!/buried the teaspoons/.test(v.user), 'a hidden person\'s thoughts stay out');
    assert(/Never from genre templates/.test(v.system));
});

test('lore that hasn\'t come up lately; the board\'s entries', () => {
    const chat = Array.from({ length: 40 }, (_, i) => ({ mes: i === 5 ? 'The cellar is locked.' : i === 35 ? 'The fuse box hums.' : 'Toast.' }));
    const out = quietLore([{ title: 'Cellar', keys: ['cellar'] }, { title: 'Fuse Box', keys: ['fuse'] }, { title: 'Garden' }], chat);
    assertEqual(out.map(e => e.title).join(','), 'Cellar,Garden', 'fuse came up lately');
    assertEqual(out[0].last, 5); assertEqual(out[1].last, -1);
    const b = { trackers: [{ steps: [{ entries: ['A', 'B'] }], people: [{ entries: ['Kettle'] }], keep: { entries: ['Judge · K'] } }] };
    assertEqual(boardEntryTitles(b).sort().join(','), 'A,B,Judge · K,Kettle');
});

test('taste: notes keep their mark; the oldest 👍 go first past the limit', () => {
    assertEqual(normNote({ text: 'x', taste: 'up' }).taste, 'up');
    assertEqual(normNote({ text: 'x', taste: 'maybe' }).taste, undefined);
    const notes = Array.from({ length: MAX_TASTE + 2 }, (_, k) => ({ id: `n${k}`, taste: k < 3 ? 'down' : 'up', made: { at: `2026-10-14T00:00:${String(k).padStart(2, '0')}Z` } }));
    assertEqual(tasteOverflow(notes).join(','), 'n3,n4');
    assert(/^Not my thing \(too much\)/.test(tasteText({ text: 'x' }, false, 'too much')));
});

test('old [[PITCH]] cards still come out of a talk text; no talk is told to write them any more (the 💡 Pitch button does)', () => {
    const r = takePitchCards('Love it!\n[[PITCH kind=acts strength=turn who=kettle]] Kettle takes the tray to the cellar. [[/PITCH]]\n[[PITCH kind=ask]] Q? [[/PITCH]]', ['Kettle']);
    assertEqual(r.text, 'Love it!');
    assertEqual(r.pitches.length, 1); assertEqual(r.pitches[0].who, 'Kettle'); assertEqual(r.pitches[0].src, 'talk');
    for (const tag of ['yap', 'plan', 'fb']) assert(!/\[\[PITCH/.test(buildMeroPrompt({ talk: { tag, msgs: [] } }).system), tag);
    assertEqual(normTalk({ msgs: [{ who: 'mero', t: 'x', pitchNos: [4, 'y', 5] }] }).msgs[0].pitchNos.join(','), '4,5');
});

test('the writer\'s direction says "this reply"', () => {
    assert(/this reply/.test(directionText({ text: 'Kettle hides the fuse.' })));
});


// ── 🪜 plans ──
const planAns = '{"plans": [{"kind": "acts", "strength": "turn", "who": "Kettle", "source": "cast", "from": "Kettle\'s plan", "goal": "The party slowly goes wrong.", "beats": ["Kettle notices the toaster is distracted", "Kettle starts doubting the toaster", "A guest mentions the fuse box", "The lights go out"]}, {"kind": "twist", "goal": "One beat only", "beats": ["just one"]}]}';
const mkPlan = () => normPitch({ id: 'x', no: 1, ...parsePlans(planAns, 3, ['Kettle'])[0] });
const isAi = k => k % 2 === 1;   // odd messages are AI replies

test('plans: parsed with 2+ beats; the goal is the text', () => {
    const out = parsePlans(planAns, 3, ['Kettle']);
    assertEqual(out.length, 1, 'a one-beat plan is no plan');
    assertEqual(out[0].plan.beats.length, 4); assertEqual(out[0].text, 'The party slowly goes wrong.'); assertEqual(out[0].who, 'Kettle');
    assertEqual(parsePlans('{"plan": {"goal": "g", "beats": ["a", "b"]}}', 1).length, 1, 'a hidden answer');
    assertEqual(normMenu({ shape: 'multi' }).shape, 'multi');
    const pr = pitchPrompt({ shape: 'multi', n: 2 }, {});
    assert(/MULTISTEP/.test(pr.system) && /"plans"/.test(pr.system) && /exactly 2/.test(pr.system));
    assert(/"plan"/.test(pitchPrompt({ shape: 'multi', vis: 'hide' }, {}).system));
});

test('plans: the writer sees what the plan says, and is held back before the floor', () => {
    let p = normPitch({ ...mkPlan(), ...startPlan(mkPlan(), { i: 10, sees: 'beat' }) });
    assertEqual(p.st, 'running'); assertEqual(p.plan.at, 0); assertEqual(p.plan.since, 10);
    let l = planLines(p, 0);
    assertEqual(l.length, 1); assert(/Kettle notices/.test(l[0]) && /must NOT happen yet/.test(l[0]), l[0]);
    assert(!/lights go out/.test(l.join(' ')), 'current beat only');
    l = planLines(p, 1); assert(/gently, over several replies/.test(l[0]), 'past the floor');
    p = normPitch({ ...p, plan: { ...p.plan, sees: 'summary' } });
    assert(/^PLAN: The party slowly goes wrong\. Now: Kettle notices/.test(planLines(p, 5)[0]));
    p = normPitch({ ...p, plan: { ...p.plan, sees: 'all' } });
    assertEqual(planLines(p, 5).length, 6);
    assertEqual(planLines({ ...p, st: 'kept' }, 5).length, 0);
});

test('plans: a beat ticks only after its floor, then the next starts; the last one ends it', () => {
    let p = normPitch({ ...mkPlan(), ...startPlan(mkPlan(), { i: 10 }) });
    assertEqual(repliesSince(10, 13, isAi), 2);
    assert(!beatDue(p, 11, isAi), 'one reply < floor 2');
    assert(beatDue(p, 13, isAi));
    p = normPitch({ ...p, ...tickBeat(p, 13, 'you keep looking at the door') });
    assertEqual(p.plan.at, 1); assertEqual(p.plan.since, 13); assertEqual(p.plan.beats[0].done.i, 13);
    for (const i of [17, 21, 25]) p = normPitch({ ...p, ...tickBeat(p, i, 'q') });
    assertEqual(p.st, 'done');
    assert(!beatDue(p, 99, isAi));
});

test('plans: a delete or a swipe takes ticks back, in order', () => {
    let p = normPitch({ ...mkPlan(), ...startPlan(mkPlan(), { i: 10 }) });
    p = normPitch({ ...p, ...tickBeat(p, 13, 'a') }); p = normPitch({ ...p, ...tickBeat(p, 17, 'b') });
    const back = normPitch({ ...p, ...rewindPlan(p, 17) });
    assertEqual(back.plan.at, 1); assertEqual(back.plan.since, 13); assert(!back.plan.beats[1].done);
    const all = normPitch({ ...p, ...rewindPlan(p, 12) });
    assertEqual(all.plan.at, 0); assertEqual(all.plan.since, 10);
    assertEqual(rewindPlan(p, 30), null, 'nothing after 30');
    let d = p; for (const i of [21, 25]) d = normPitch({ ...d, ...tickBeat(d, i, 'q') });
    assertEqual(normPitch({ ...d, ...rewindPlan(d, 25) }).st, 'running', 'a done plan runs again');
});

test('plans: the timer asks once per stretch; off at 0; Linger raises the floor', () => {
    let p = normPitch({ ...mkPlan(), ...startPlan(mkPlan(), { i: 10, timer: 10 }) });
    assert(!timerDue(p, 27, isAi)); assert(timerDue(p, 29, isAi), '10 replies');
    p = normPitch({ ...p, plan: { ...p.plan, asked: 29 } });
    assert(!timerDue(p, 45, isAi), 'asked already');
    assert(!timerDue(normPitch({ ...p, plan: { ...p.plan, timer: 0, asked: undefined } }), 99, isAi));
    const lg = normPitch({ ...p, ...lingerPatch(p, 29, isAi) });
    assertEqual(lg.plan.beats[0].floor, 13);
});

test('plans: rewrites are reviewed; redirect keeps the goal, extend adds after, evolve changes both', () => {
    let p = normPitch({ ...mkPlan(), ...startPlan(mkPlan(), { i: 10 }) });
    p = normPitch({ ...p, ...tickBeat(p, 13, 'a') });
    const pr = rewritePrompt(p, 'redirect', { replies: [{ i: 20, name: 'K', text: 'garden' }] });
    assert(/same goal/.test(pr.system) && /NOW: Kettle starts doubting/.test(pr.user) && /#13/.test(pr.user));
    const rv = parseRewrite('{"goal": "new goal", "beats": ["x", "y"]}', 'redirect');
    let r = normPitch({ ...p, plan: { ...p.plan, review: rv } });
    r = normPitch({ ...r, ...applyReview(r, 30) });
    assertEqual(r.plan.goal, 'The party slowly goes wrong.'); assertEqual(r.plan.beats.map(b => b.text).join('|'), 'Kettle notices the toaster is distracted|x|y');
    assertEqual(r.plan.at, 1); assertEqual(r.plan.since, 30); assert(!r.plan.review);
    let e = normPitch({ ...p, plan: { ...p.plan, review: parseRewrite('{"goal": "bigger", "beats": ["z"]}', 'extend') } });
    e = normPitch({ ...e, ...applyReview(e, 30) });
    assertEqual(e.plan.beats.length, 5); assertEqual(e.plan.at, 1); assertEqual(e.plan.since, 13, 'extend keeps the clock');
    let v = normPitch({ ...p, plan: { ...p.plan, review: parseRewrite('{"goal": "a new goal", "beats": ["n1", "n2"]}', 'evolve') } });
    v = normPitch({ ...v, ...applyReview(v, 30) });
    assertEqual(v.plan.goal, 'a new goal');
    assertEqual(parseRewrite('{"beats": []}', 'evolve'), null);
});

test('pitches name the author from Mero\'s settings — never by the persona (Miinthe 2026-10-26)', () => {
    const plain = pitchPrompt({}, { user: 'Lucan', persona: 'x' }, { comment: 'more angst' });
    assert(!plain.system.includes('Lucan') && !plain.system.includes('Miinthe') && plain.system.includes('Never call the author by a name'));
    assert(plain.user.includes("the author's wish: more angst"));
    const set = pitchPrompt({}, { names: { you: 'Miinthe', me: 'Mero' } }, {});
    assert(set.system.startsWith("You are Mero ☆, Miinthe's co-writer") && set.system.includes('Call the author "Miinthe".'));
});

summary('Pitches');
