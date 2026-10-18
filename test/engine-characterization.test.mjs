import { readFileSync } from 'node:fs';
/**
 * LOCAL PATCH suite — the engine's behaviour, pinned (`13 engine on v2 plan.md` step 0, 2026-10-05).
 *
 * The REAL engine glue (trackers.js, autotrack.js, board-live.js, reevaluate.js) runs on a pretend
 * SillyTavern (_engine-harness.mjs) through one scripted story, a turn at a time. After each step the test
 * checks what the engine SAYS — where each tracker stands, what the writer is told, the timeline — never how
 * it is stored, so the same expectations must hold before, during and after the move to one v2 store.
 * If the observation code (`observe`) has to read a new store later, change only it — never the expectations.
 *
 * Run: npm run test:engine
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { st, engine, resetChat, say, takeNotices } from './_engine-harness.mjs';

const E = await engine();
const { trackers: T, autotrack: A, live: L, reeval: R, model: M, window: W } = E;
const C = await import('../src/conditions-pure.js');
const TP = await import('../src/trackers-pure.js');

// ── the test board ────────────────────────────────────────────────────────────
const BOARD = {
    v: 2, name: 'Engine test', folders: [], trackers: [
        { id: 'rel', name: 'Relationship', direction: 'both', steps: [
            { id: 's1', name: 'Strangers' }, { id: 's2', name: 'Neighbours', detours: [{ id: 'nui', name: 'Nuisance' }] },
            { id: 's3', name: 'Friends', fork: { by: 'story', branches: [{ id: 'conf', name: 'Confesses', entries: ['Rel · Confession'] }, { id: 'chick', name: 'Chickens out' }] } },
            { id: 's4', name: 'Sweethearts' }, { id: 's5', name: 'Married', needs: [{ tracker: 'fuse', step: 'c3' }] },
        ], triggers: [{ tracker: 'fuse', step: 'c2', to: 's2' }] },
        { id: 'fuse', name: 'The Broken Fuse', direction: 'forward', starts: [{ tracker: 'rel', step: 's3' }], steps: [
            { id: 'c1', name: 'Calm' }, { id: 'c2', name: 'Sparks' }, { id: 'c3', name: 'Repair', fork: { by: 'roll', branches: [{ id: 'ok', name: 'Success', weight: 1 }, { id: 'fail', name: 'Fail', weight: 1 }] } },
        ] },
        { id: 'secret', name: 'Kettle\'s Secret', direction: 'forward', starts: [{ tracker: 'rel', step: 's4', odds: 2 }], steps: [{ id: 'h1', name: 'Hidden' }, { id: 'h2', name: 'Revealed' }] },
        { id: 'stash', kind: 'collection', name: 'Kitchen stash', amounts: true, states: [{ id: 'no', label: 'not yet' }, { id: 'have', label: 'have' }, { id: 'used', label: 'used up' }],
            items: [{ id: 'tape', name: 'Tape' }] },
        { id: 'where', kind: 'place', name: 'Where', places: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'pantry', name: 'Pantry' }] },
    ],
};

function useBoard(raw) {
    const board = M.normalizeBoard(raw, raw.name);
    // engine on v2, step 5: one board store (board-store.js) — the old store is no longer written
    delete st.extension_settings.deeplore_storyboards;
    st.extension_settings.deeplore_storyboards_v2 = { boards: { [board.name]: { board } }, characters: {}, oneStore: 1 };
    st.chat_metadata.deeplore_board = board.name;
    st.chat_metadata.deeplore_board_state = M.freshState(board);
    T.saveTrackers(M.toEngineList(board, st.chat_metadata.deeplore_board_state, []));
}

// ── what the engine says ─────────────────────────────────────────────────────
/** Every step tracker: "Name: Step (detour) [state] {fork taken}". */
function pos() {
    const list = T.getTrackers();
    return list.map(t => {
        const s = C.stateOf(t, list);
        const took = t.took && Object.keys(t.took).length ? ` {${Object.entries(t.took).map(([a, b]) => `${a}→${b}`).join(', ')}}` : '';
        return `${t.name}: ${t.steps[t.index]}${t.aside ? ` (${t.aside})` : ''}${s !== 'running' ? ` [${s}]` : ''}${t.ended ? ' [ended]' : ''}${took}`;
    });
}
const writer = () => TP.writerBlock(T.getActiveTrackers(), L.liveWriterLines());
/** The timeline, compact: "#m who tracker→value". */
function timeline() {
    const lv = L.live();
    return W.timelineEvents(lv.board, T.getTrackers(), lv.state).map(e => `#${e.m} ${e.who} ${e.t}→${e.to ?? e.place ?? e.item ?? e.field ?? e.date}`);
}
/** Engine on v2, step 1: the v2 state agrees with the engine's list about every step tracker (empty = agree). */
function disagree() {
    const lv = st.extension_settings.deeplore_storyboards_v2?.boards?.[st.chat_metadata.deeplore_board];
    if (!lv || !st.chat_metadata.deeplore_board_state?.v2steps) return [];
    const board = M.normalizeBoard(lv.board, st.chat_metadata.deeplore_board);
    return M.engineDiff(board, T.getTrackers(), M.normalizeState(st.chat_metadata.deeplore_board_state, board)).map(d => `${d.tracker}.${d.field}: v2 ${JSON.stringify(d.v2)} ≠ engine ${JSON.stringify(d.engine)}`);
}
/** Engine on v2, step 2: the readers' view from v2 says exactly what the engine's list says. */
const LORE = [{ title: 'Rel · Friends', storyStep: { tracker: 'Relationship', steps: ['Friends'] } }, { title: 'Rel · Married', storyStep: { tracker: 'Relationship', steps: ['Married'] } },
    { title: 'Fuse · Sparks', storyStep: { tracker: 'The Broken Fuse', steps: ['Sparks'] } }, { title: 'Rel · Confession' }, { title: 'Unlinked' }];
const FK = await import('../src/forks-pure.js');
function sameReading(label = '') {
    const F = TP.filterByStoryStep, active = l => new Set(l.filter(t => !t.ended).map(t => t.name));
    const oldList = T.getTrackers(), newList = T.readTrackers(), oldA = T.getActiveTrackers(), newA = T.readActiveTrackers();
    assertEqual(TP.writerBlock(newA, []), TP.writerBlock(oldA, []), `the writer's tracker lines read from v2 = from the list (${label.slice(0, 30)})`);
    const titles = (l, a) => F(LORE, l, () => false, t => a.has(t.name)).map(e => e.title);
    assertEqual(titles(newList, active(newA)), titles(oldList, active(oldA)), `the step-linked lore read from v2 = from the list (${label.slice(0, 30)})`);
    const branchT = (l, a) => FK.filterByBranch(LORE, l, () => false, t => a.has(t.name)).map(e => e.title);
    assertEqual(branchT(newList, active(newA)), branchT(oldList, active(oldA)), `the branch-linked lore read from v2 = from the list (${label.slice(0, 30)})`);
}
const stepLog = () => (st.chat_metadata.deeplore_board_state?.log || []).filter(e => e.kind === 'step');

/** One turn: Miinthe's message, the helper (scripted answer), the board's tick, the reply. */
async function turn(userText, helperAnswer, aiText = 'ok') {
    say('user', userText);
    st.helper.push(helperAnswer ?? { changes: [] });
    await A.runAutoTrack(st.chat, 'normal');
    T.boardTick();
    const d = disagree(); assertEqual(d, [], `the v2 state agrees with the engine after "${userText.slice(0, 30)}"`);
    sameReading(userText);
    return say('ai', aiText);
}
const ch = (tracker, step, quote, extra = {}) => ({ tracker, step, aside: null, branch: null, quote, reason: 'test', confidence: 'high', ...extra });
// Rolls: a forced value only during the turns that test a roll (the same function also makes ids — tiny steps keep those apart)
let seed = 0, forced = null, step = 0;
Math.random = () => (forced !== null ? Math.min(0.999999, forced + (step++) * 1e-9) : ((seed = (seed * 9301 + 49297) % 233280) / 233280));
const withRoll = async (value, fn) => { forced = value; try { return await fn(); } finally { forced = null; } };

// ── the story ───────────────────────────────────────────────────────────────
resetChat();
st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello, neighbour.', send_date: '0', extra: {} });
useBoard(BOARD);

test('the board applied: Relationship at its first step; the trackers with start lines wait', () => {
    assertEqual(pos(), ['Relationship: Strangers', 'The Broken Fuse: Calm [waiting]', 'Kettle\'s Secret: Hidden [waiting]']);
    assertEqual(writer(), '[Where the story currently stands]\nRelationship: Strangers\nPLACE: Kitchen\nKNOWN PLACES, NOT HERE: Pantry\n[End of story state]');
});

test('a helper move with its quote; the timeline records it', async () => {
    await turn('Hi! I\'m your new neighbour, I just moved in next door.', { changes: [ch('Relationship', 'Neighbours', 'I\'m your new neighbour')] });
    assertEqual(pos()[0], 'Relationship: Neighbours');
    assert(timeline().includes('#1 auto rel→1'), timeline().join(' | '));
});

test('a jump that skips steps is refused and recorded; a detour (aside) is set', async () => {
    await turn('We are married now!', { changes: [ch('Relationship', 'Married', 'We are married now')] });
    assertEqual(pos()[0], 'Relationship: Neighbours');
    assert(timeline().some(x => x.startsWith('#3 refused rel→')), timeline().join(' | '));
    await turn('Ugh, you are so loud every night.', { changes: [ch('Relationship', null, 'you are so loud', { aside: 'Nuisance' })] });
    assertEqual(pos()[0], 'Relationship: Neighbours (Nuisance)');
});

test('reaching Friends starts the Fuse (its start line holds); the writer is told both', async () => {
    await turn('I think we\'re friends now.', { changes: [ch('Relationship', 'Friends', 'we\'re friends now')] });
    // a detour belongs to its step (Miinthe, 2026-10-05): moving on from Neighbours ended "Nuisance"
    assertEqual(pos().slice(0, 2), ['Relationship: Friends', 'The Broken Fuse: Calm']);
    assert(takeNotices().some(n => /The Broken Fuse has started/.test(n.msg)));
    assertEqual(writer().split('\n').slice(1, 3), ['Relationship: Friends', 'The Broken Fuse: Calm']);
});

test('a fork by story: the helper names the branch; the branch goes on to the next step (the default)', async () => {
    // the first arrival at Sweethearts: Kettle's Secret rolls its 1-in-2 start — forced to fail here
    await withRoll(0.9, () => turn('I... I like you so much. A lot.', { changes: [ch('Relationship', 'Sweethearts', 'I like you so much', { branch: 'Confesses' })] }));
    assertEqual(pos()[0], 'Relationship: Sweethearts {Friends→Confesses}');
});

test('a move by hand (◀ ▶) to another step ends a detour too', () => {
    T.setTrackerAside('Relationship', 'Pouting');
    assertEqual(pos()[0].split(' {')[0], 'Relationship: Sweethearts (Pouting)');
    T.moveTracker('Relationship', { delta: -1 });
    assertEqual(pos()[0].split(' {')[0], 'Relationship: Friends');
    T.moveTracker('Relationship', { delta: 1 });
    assertEqual(pos()[0].split(' {')[0], 'Relationship: Sweethearts');
});

test('a trigger: the Fuse reaching Sparks throws Relationship back to Neighbours', async () => {
    await turn('Every light in the kitchen flickers.', { changes: [ch('The Broken Fuse', 'Sparks', 'Every light in the kitchen flickers')] });
    assertEqual(pos().slice(0, 2), ['Relationship: Neighbours', 'The Broken Fuse: Sparks']);
    assert(takeNotices().some(n => /Relationship/.test(n.msg) && /Neighbours/.test(n.msg)));
});

test('"only possible once": Married needs the Fuse at Repair — refused while it isn\'t', async () => {
    // going back to Neighbours forgot the fork ahead: Friends waits at it again until the story takes a way
    await turn('We are friends again after all that.', { changes: [ch('Relationship', 'Friends', 'We are friends again')] });
    await turn('From now on we are sweethearts.', { changes: [ch('Relationship', 'Sweethearts', 'on we are sweethearts', { branch: 'Confesses' })] });
    await turn('We got married at the town hall today.', { changes: [ch('Relationship', 'Married', 'married at the town hall')] });
    // (the trigger's move back to Neighbours cleared the detour)
    assertEqual(pos()[0].split(' {')[0], 'Relationship: Sweethearts');
    assert(takeNotices().some(n => /only possible once/.test(n.msg)));
});

test('odds on a start: Kettle\'s Secret rolled 1 in 2 when its line first held — a fail keeps it waiting (closed for good)', () => {
    assertEqual(pos()[2].replace(/ \{.*\}/, ''), 'Kettle\'s Secret: Hidden [waiting]');
});

test('a fork by roll: arriving at Repair rolls Success / Fail at once', async () => {
    await withRoll(0.1, () => turn('She fixes the fuse with tape.', { changes: [ch('The Broken Fuse', 'Repair', 'fixes the fuse with tape')] }));
    // the last step's fork: Success (forced) — the branch goes "on" past the last step, so the tracker ends
    assertEqual(pos()[1], 'The Broken Fuse: Repair [ended] {Repair→Success}');
});

test('collections and places move with the helper too; the writer gets them', async () => {
    await turn('She pockets the tape and walks into the pantry.', { changes: [], items: [{ collection: 'Kitchen stash', item: 'Tape', state: 'have', amount: 1, quote: 'pockets the tape', reason: 'kept', confidence: 'high' }], places: [{ tracker: 'Where', place: 'Pantry', quote: 'walks into the pantry', reason: 'moved', confidence: 'high' }] });
    const w = writer();
    assert(w.includes('ITEM: Tape') && w.includes('PLACE: Pantry'), w);
});

let snapBeforePause;
test('pause keeps the step and goes quiet; continue brings it back', () => {
    snapBeforePause = pos();
    assert(T.setTrackerRun('Relationship', 'pause').ok);
    assert(!T.getActiveTrackers().some(t => t.name === 'Relationship'));
    assert(/\[paused\]/.test(pos()[0]));
    assert(T.setTrackerRun('Relationship', 'continue').ok);
    assertEqual(pos(), snapBeforePause);
});

test('abandon resets to the start and switches off; Undo puts it back exactly', () => {
    T.setTrackerRun('Relationship', 'abandon');
    assertEqual(pos()[0], 'Relationship: Strangers [abandoned]');
    T.undoTrackerRun('Relationship');
    assertEqual(pos(), snapBeforePause);
});

test('the board switched off for this chat: nothing active, nothing told; on again: as before', () => {
    T.switchBoard(true);
    assertEqual([T.getActiveTrackers().length, L.live()], [0, null]);
    T.switchBoard(false);
    assertEqual(pos(), snapBeforePause);
});

test('Undo of the helper\'s last move puts the tracker back', async () => {
    await turn('From now on, you live with me.', { changes: [ch('Relationship', 'Married', 'you live with me')] });
    const after = pos()[0];
    A.undoAutoMove('Relationship');
    assert(pos()[0] !== after && /Sweethearts/.test(pos()[0]), `${after} → ${pos()[0]}`);
});

let snapBeforeDelete, lenBeforeDelete;
test('deleting messages rolls everything after them back — trackers, items, places', async () => {
    snapBeforeDelete = pos(); lenBeforeDelete = st.chat.length;
    await turn('We\'re finally married now, and the tape is used up.', { changes: [ch('Relationship', 'Married', 'We\'re finally married now')], items: [{ collection: 'Kitchen stash', item: 'Tape', state: 'used', amount: 0, quote: 'the tape is used up', reason: 'used', confidence: 'high' }] });
    st.chat.splice(lenBeforeDelete);
    await T.reconcileTrackers({ prune: true });
    assertEqual(pos(), snapBeforeDelete);
    assert(writer().includes('ITEM: Tape'), writer());
});

test('deleting back past a start un-starts it; past a fork, the branch is forgotten', async () => {
    const cut = st.chat.findIndex(m => /friends now/.test(m.mes));
    const saved = st.chat.slice(cut);
    st.chat.splice(cut);
    await T.reconcileTrackers({ prune: true });
    assertEqual(pos(), ['Relationship: Neighbours (Nuisance)', 'The Broken Fuse: Calm [waiting]', 'Kettle\'s Secret: Hidden [waiting]']);
    st.chat.push(...saved);   // (the messages come back as in a branch made later — nothing replays them)
});

test('Re-evaluate: the newest turn is undone, the helper asked again, a new swipe written', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    await turn('I\'m your new neighbour.', { changes: [ch('Relationship', 'Neighbours', 'your new neighbour')] });
    await turn('We\'re friends now, I think.', { changes: [ch('Relationship', 'Friends', 'We\'re friends now')] });
    assertEqual(pos().slice(0, 2), ['Relationship: Friends', 'The Broken Fuse: Calm']);
    st.helper.push({ changes: [] });   // asked again, the helper sees no move this time
    await R.reEvaluate({ confirm: false });
    assertEqual(pos().slice(0, 2), ['Relationship: Neighbours', 'The Broken Fuse: Calm [waiting]']);
    assertEqual(st.swipes, 1);
});

test('engine on v2 step 1: every helper move is in the v2 log too, with its quote; a delete takes it out again', async () => {
    const before = stepLog().length;
    await turn('Okay. We are friends now, I mean it this time.', { changes: [ch('Relationship', 'Friends', 'We are friends now')] });
    // two entries: the helper's move, and the Fuse starting because of it (the board's own doing — no quote)
    const e = stepLog().find(x => x.col === 'rel' && x.to.at === 's3'), f = stepLog().at(-1);
    assertEqual([stepLog().length, e.who, e.quote, f.col, f.who, f.to.started], [before + 2, 'auto', 'We are friends now', 'fuse', 'engine', true]);
    st.chat.splice(st.chat.length - 2);
    await T.reconcileTrackers({ prune: true });
    assertEqual([stepLog().length, disagree()], [before, []]);
});

test('engine on v2 step 1: pause, abandon, Undo, a hand move — the v2 state keeps agreeing', () => {
    T.setTrackerRun('Relationship', 'pause'); assertEqual(disagree(), []);
    T.setTrackerRun('Relationship', 'continue'); T.setTrackerRun('Relationship', 'abandon'); assertEqual(disagree(), []);
    T.undoTrackerRun('Relationship'); assertEqual(disagree(), []);
    T.moveTracker('Relationship', { delta: 1 }); assertEqual(disagree(), []);
});

test('engine on v2 step 2: after pause, abandon, Undo, the board off — the readers still see the same', () => {
    for (const act of [() => T.setTrackerRun('Relationship', 'pause'), () => T.setTrackerRun('Relationship', 'continue'), () => T.setTrackerRun('Relationship', 'abandon'), () => T.undoTrackerRun('Relationship'), () => T.switchBoard(true), () => T.switchBoard(false)]) { act(); sameReading('after an action'); }
});

test('engine on v2 step 3: opening a branch — the dialog, then trackers, items and the v2 log roll back from v2', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    await turn('I\'m your new neighbour.', { changes: [ch('Relationship', 'Neighbours', 'your new neighbour')] });
    const keep = st.chat.length, before = pos(), logBefore = stepLog().length;
    await turn('Okay. We are friends now, I mean it this time.', { changes: [ch('Relationship', 'Friends', 'We are friends now')] });
    assert(pos()[0].startsWith('Relationship: Friends'), pos()[0]);
    st.chat.splice(keep);   // the branch ends here (nothing deleted — the state came along from the parent chat)
    st.popupAnswer = 1;
    await T.reconcileTrackers({ confirm: true });
    assertEqual([pos(), stepLog().length, disagree()], [before, logBefore, []]);
});

test('New Run: the same board, every tracker back at its first step', () => {
    const old = T.getTrackers();
    T.startTrackersForNewRun(old, 'Engine test');
    assertEqual(pos(), ['Relationship: Strangers', 'The Broken Fuse: Calm [waiting]', 'Kettle\'s Secret: Hidden [waiting]']);
});

test('a detour set together with a move to another step is kept (the helper names it for the new step)', async () => {
    await turn('Hi, I am the new neighbour, and I play my drums at midnight.', { changes: [ch('Relationship', 'Neighbours', 'I am the new neighbour', { aside: 'Nuisance' })] });
    assertEqual(pos()[0], 'Relationship: Neighbours (Nuisance)');
});

// ── board 2: the turn's finer rules (pinned 2026-10-05 before the turn moves to v2, step 3b) ──────────────
const BOARD2 = { v: 2, name: 'Engine test 2', folders: [], trackers: [
    { id: 'quest', name: 'Quest', direction: 'both', steps: [{ id: 'q1', name: 'Rumour heard' },
        { id: 'q2', name: 'At the gate', fork: { by: 'story', branches: [{ id: 'win', name: 'Wins', then: { kind: 'back', step: 'q1' } }, { id: 'lose', name: 'Loses', then: { kind: 'next', tracker: 'after' } }] } },
        { id: 'q3', name: 'Home' }] },
    { id: 'bard', name: 'The Bard', onFall: 'pause', starts: [{ tracker: 'quest', at: 'q2', branch: 'win' }], steps: [{ id: 'b1', name: 'Humming' }, { id: 'b2', name: 'Singing' }] },
    { id: 'guard', name: 'The Guard', onFall: 'pause', starts: [{ tracker: 'quest', step: 'q2' }], steps: [{ id: 'g1', name: 'Watching' }, { id: 'g2', name: 'Chasing' }] },
    { id: 'after', name: 'Aftermath', starts: [{ tracker: 'quest', step: 'q3' }], steps: [{ id: 'a1', name: 'Quiet' }, { id: 'a2', name: 'Loud' }] },
] };
const settled = label => { assertEqual(disagree(), [], `v2 agrees (${label})`); sameReading(label); };

test('board 2: applied — the Quest runs, the other three wait', () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'A rumour reaches the village.', send_date: '0', extra: {} });
    useBoard(BOARD2);
    assertEqual(pos(), ['Quest: Rumour heard', 'The Bard: Humming [waiting]', 'The Guard: Watching [waiting]', 'Aftermath: Quiet [waiting]']);
});

test('board 2: the Quest reaches the gate — the Guard starts', () => {
    say('user', 'We walk to the gate.');
    T.moveTracker('Quest', { delta: 1 });
    assertEqual(pos(), ['Quest: At the gate', 'The Bard: Humming [waiting]', 'The Guard: Watching', 'Aftermath: Quiet [waiting]']);
    settled('gate');
});

test('board 2: "Wins" goes back — the Bard starts from the branch history; the Guard pauses (its start fell)', () => {
    say('user', 'We win at the gate and go back to the village.');
    const r = T.chooseBranch('Quest', 'Wins');
    assert(r.ok, JSON.stringify(r));
    assertEqual(pos(), ['Quest: Rumour heard', 'The Bard: Humming', 'The Guard: Watching [paused]', 'Aftermath: Quiet [waiting]']);
    assertEqual(writer().split('\n').slice(1, -1), ['Quest: Rumour heard', 'The Bard: Humming']);
    settled('wins');
});

test('board 2: back at the gate the fork is open again; "Loses" ends the Quest and starts the Aftermath', () => {
    say('user', 'We go back to the gate, and this time we lose.');
    T.moveTracker('Quest', { delta: 1 });
    assertEqual(pos()[2], 'The Guard: Watching');
    const r = T.chooseBranch('Quest', 'Loses');
    assert(r.ok, JSON.stringify(r));
    assertEqual(pos(), ['Quest: At the gate [ended] {At the gate→Loses}', 'The Bard: Humming', 'The Guard: Watching', 'Aftermath: Quiet']);
    settled('loses');
});

test('board 2: deleting back to before "Wins" — the branch history goes too, the Bard waits again', async () => {
    const cut = st.chat.findIndex(m => /We win at the gate/.test(m.mes));
    st.chat.splice(cut);
    await T.reconcileTrackers({ prune: true });
    assertEqual(pos(), ['Quest: At the gate', 'The Bard: Humming [waiting]', 'The Guard: Watching', 'Aftermath: Quiet [waiting]']);
    settled('deleted back');
});

test('board 2: a waiting tracker moved by hand keeps that step and starts there; abandon and Undo put it back', () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Again, from the start.', send_date: '0', extra: {} });
    useBoard(BOARD2);
    say('user', 'Later, it will be loud.');
    T.moveTracker('Aftermath', { delta: 1 });
    assertEqual(pos()[3], 'Aftermath: Loud [waiting]');
    settled('waiting moved');
    T.setTrackerRun('Aftermath', 'abandon');
    assertEqual(pos()[3], 'Aftermath: Quiet [abandoned]');
    T.undoTrackerRun('Aftermath');
    assertEqual(pos()[3], 'Aftermath: Loud [waiting]');
    say('user', 'We go to the gate and then home.');
    T.moveTracker('Quest', { toIndex: 2 });
    assertEqual([pos()[0], pos()[3]], ['Quest: Home', 'Aftermath: Loud']);
    settled('started at its step');
});

test('a trigger\'s Undo: the tracker goes back, and that trigger never fires again in this chat', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello again.', send_date: '0', extra: {} });
    useBoard(BOARD);
    say('user', 'Friends, then.');
    T.moveTracker('Relationship', { toIndex: 2 });
    say('user', 'The fuse sparks.');
    T.moveTracker('The Broken Fuse', { delta: 1 });
    assertEqual(pos().slice(0, 2), ['Relationship: Neighbours', 'The Broken Fuse: Sparks']);
    const logId = st.chat_metadata.deeplore_board_state.log.filter(e => e.kind === 'trigger').at(-1).id;
    assert(T.undoTrigger(logId), 'undone');
    assertEqual(pos().slice(0, 2), ['Relationship: Friends', 'The Broken Fuse: Sparks']);
    // arriving at Sweethearts rolls Kettle's Secret's 1-in-2 start: fixed both ways, so both engines see the same dice
    await withRoll(0.9, () => T.moveTracker('Relationship', { delta: 1 }));
    assertEqual(pos()[0], 'Relationship: Sweethearts');
    assertEqual(pos()[2], 'Kettle\'s Secret: Hidden [waiting]');
    settled('trigger undone');
});

globalThis.window ??= globalThis;
const BW = await import('../src/board-window.js');   // the window's host (its Save), without the window itself
test('the board window: a move saved there is undone when its message is deleted', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'A rumour reaches the village.', send_date: '0', extra: {} });
    useBoard(BOARD2);
    say('user', 'We walk to the gate.');
    const d = BW._host.load();
    BW._host.save(d.current, d.boards[d.current], { ...d.bag, quest: 1 });
    assertEqual(pos().slice(0, 3), ['Quest: At the gate', 'The Bard: Humming [waiting]', 'The Guard: Watching']);
    settled('window move');
    st.chat.splice(1);
    await T.reconcileTrackers({ prune: true });
    assertEqual(pos().slice(0, 3), ['Quest: Rumour heard', 'The Bard: Humming [waiting]', 'The Guard: Watching [waiting]']);
    settled('window move deleted');
});

test('pausing a place tracker can be undone (its Undo memory survives the save)', () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    assert(T.setTrackerRun('Where', 'pause').ok, 'paused');
    assertEqual(T.undoTrackerRun('Where'), { ok: true, text: 'Where: put back as it was.' });
});

// ── step 5: one board store ─────────────────────────────────────────────────
const BS = await import('../src/board-store.js');

test('one store: a board only the old store had, a character default and a rename come over once; the old store stays as it was', () => {
    const oldStore = { boards: { 'Old one': { name: 'Old one', trackers: [{ id: 'mood', name: 'Mood', steps: ['Calm', 'Cross'], direction: 'both', skip: false }] } }, characters: { 'kettle.png': 'Old one' }, renamed: { 'Older name': 'Old one' } };
    st.extension_settings.deeplore_storyboards = structuredClone(oldStore);
    st.extension_settings.deeplore_storyboards_v2 = { boards: {} };
    const s = BS.boardStore();
    assertEqual([Object.keys(s.boards), s.characters, s.renamed, s.oneStore], [['Old one'], { 'kettle.png': 'Old one' }, { 'Older name': 'Old one' }, 1]);
    assertEqual(BS.getBoard('Old one').trackers[0].steps.map(x => x.name), ['Calm', 'Cross']);
    assertEqual(BS.engineBoard('Old one').trackers[0].steps, ['Calm', 'Cross']);
    assertEqual(st.extension_settings.deeplore_storyboards, oldStore);
});

test('one store: Story-tab edits go into the board — a step added, the tracker renamed; links and forks on unchanged steps stay', () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    T.setTracker('Relationship', ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Engaged', 'Married'], { rename: 'Us' });
    const b = BS.getBoard('Engine test'), rel = b.trackers.find(t => t.id === 'rel');
    assertEqual([rel.name, rel.steps.map(x => x.name)], ['Us', ['Strangers', 'Neighbours', 'Friends', 'Sweethearts', 'Engaged', 'Married']]);
    assertEqual([rel.steps[2].id, rel.steps[2].fork.branches.map(x => x.name), rel.steps[5].id, rel.steps[5].needs.length, rel.steps[1].detours[0].name], ['s3', ['Confesses', 'Chickens out'], 's5', 1, 'Nuisance']);
    assertEqual(pos()[0], 'Us: Strangers');
    assert(!st.extension_settings.deeplore_storyboards, 'the old store is not written');
    T.removeTracker('Kettle\'s Secret');
    assertEqual(BS.getBoard('Engine test').trackers.map(t => t.name), ['Us', 'The Broken Fuse', 'Kitchen stash', 'Where']);
});

test('one store: "save as" copies the whole board (links, forks, collections), the chat moves to the copy', () => {
    const name = T.saveBoardAs('Engine test copy');
    const a = BS.getBoard('Engine test'), b = BS.getBoard(name);
    assertEqual([name, st.chat_metadata.deeplore_board, b.trackers.map(t => t.name), JSON.stringify(b.trackers[0].steps) === JSON.stringify(a.trackers[0].steps)], ['Engine test copy', 'Engine test copy', ['Us', 'The Broken Fuse', 'Kitchen stash', 'Where'], true]);
    assertEqual(pos().slice(0, 2), ['Us: Strangers', 'The Broken Fuse: Calm [waiting]']);
});

// ── step 6: stored chats — the early v2 log rebuilt from the list's history ─────────────────────────────
const strip = e => ({ i: e.i, col: e.col, who: e.who || null, quote: e.quote || null, from: e.from, to: e.to });
/** Per message and tracker, the net change (the old history keeps one entry per message: pause + continue in one message is one entry). */
const net = log => {
    const out = [];
    for (const e of log) { const last = out.at(-1); if (last && last.i === e.i && last.col === e.col) { last.to = e.to; last.who = e.who; last.quote = e.quote; } else out.push({ ...e }); }
    return out.filter(e => JSON.stringify(e.from) !== JSON.stringify(e.to));
};
async function rewoundTo(k) {
    const keepMeta = structuredClone(st.chat_metadata), keepChat = st.chat.slice();
    st.chat.splice(k + 1);
    await T.reconcileTrackers({ prune: true });
    const out = pos();
    for (const key of Object.keys(st.chat_metadata)) delete st.chat_metadata[key];
    Object.assign(st.chat_metadata, keepMeta);
    st.chat.splice(0, st.chat.length, ...keepChat);
    return out;
}
// An old chat, recorded on the old engine before step 7b removed it (test/fixtures/old-chat.json): the stored list
// with its history and no step log; `expected[k]` is what the old roll back gave when deleting back to message k.
const OLD = JSON.parse(readFileSync(new URL('./fixtures/old-chat.json', import.meta.url), 'utf8'));
function openOldChat() {
    resetChat();
    st.chat.push(...structuredClone(OLD.chat));
    Object.assign(st.chat_metadata, structuredClone(OLD.chat_metadata));
    st.extension_settings.deeplore_storyboards_v2 = { boards: { [OLD.board.name]: { board: M.normalizeBoard(OLD.board, OLD.board.name) } }, characters: {}, oneStore: 1 };
}

test('stored chats: an old chat gets its step log rebuilt from its history on first read — what the old engine did, entry by entry', async () => {
    openOldChat();
    const added = T.completeChat();
    const want = [[1, 'rel', 'auto', 's1', 's2'], [3, 'rel', 'auto', 's2', 's3'], [3, 'fuse', 'engine', null, 'c1'], [5, 'rel', 'auto', 's3', 's4'], [7, 'rel', 'trigger', 's4', 's2'], [7, 'fuse', 'hand', 'c1', 'c2'], [8, 'rel', 'hand', 's2', 's2'], [9, 'fuse', 'roll', 'c2', 'c3']];
    assertEqual(stepLog().map(e => [e.i, e.col, e.who, e.from.at, e.to.at]), want);
    assertEqual([added, st.chat_metadata.deeplore_board_state.v2since, !!st.chat_metadata.deeplore_trackers_v1_backup], [want.length, 0, true]);
    assertEqual(T.completeChat(), 0);   // once
    openOldChat();
    assertEqual(pos(), OLD.expected[9]);   // reading it converts it (getTrackers)
    assert(st.chat_metadata.deeplore_board_state.stepsRebuilt, 'converted on first read');
});

test('stored chats: a chat whose log has gaps is rebuilt whole, once — no doubles', async () => {
    const before = stepLog().map(strip);
    delete st.chat_metadata.deeplore_board_state.stepsRebuilt;
    st.chat_metadata.deeplore_board_state.log = st.chat_metadata.deeplore_board_state.log.filter(e => !(e.kind === 'step' && e.i === 7));   // a gap
    T.completeChat();
    assertEqual(stepLog().map(strip), before);
});

test('stored chats: after the rebuild, deleting back to every point gives exactly what the old roll back gave', async () => {
    for (const k of Object.keys(OLD.expected).map(Number).sort((a, b) => a - b)) assertEqual(await rewoundTo(k), OLD.expected[k], `back to message ${k}`);
});

// ── step 7: no old engine ───────────────────────────────────────────────────
test('/dle-tracker-rewind: the trackers go back to where they stood at a message — as a move by hand now; items and later messages stay', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    await turn('I am your new neighbour.', { changes: [ch('Relationship', 'Neighbours', 'your new neighbour')] });
    const at = st.chat.length - 1, then = pos();
    await turn('We are friends now, and I have the tape.', { changes: [ch('Relationship', 'Friends', 'We are friends now')], items: [{ collection: 'Kitchen stash', item: 'Tape', state: 'have', amount: 1, quote: 'I have the tape', reason: 'got it', confidence: 'high' }] });
    const len = st.chat.length;
    const r = T.rewindTrackersTo(at);
    assertEqual([pos(), st.chat.length, r.moved.length > 0], [then, len, true]);
    assert(writer().includes('Tape'), 'the item stays');
    assertEqual(stepLog().at(-1).who, 'hand');
});

test('detaching a chat from its board: it keeps its trackers as a board of its own, at the same places', () => {
    const before = pos();
    T.detachBoard();
    assert(st.chat_metadata.deeplore_board && st.chat_metadata.deeplore_board !== 'Engine test', `its own board (${st.chat_metadata.deeplore_board})`);
    assertEqual(pos(), before);
    assertEqual(T.moveTracker('Relationship', { delta: 1 }).value, 'Friends');   // it was rewound to Neighbours
});

test('reactivate: on again from the start — one with start lines waits for them again; deleting the abandon\'s message takes it back', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'A rumour reaches the village.', send_date: '0', extra: {} });
    useBoard(BOARD2);
    say('user', 'We walk to the gate.');
    T.moveTracker('Quest', { delta: 1 });
    assertEqual(pos()[2], 'The Guard: Watching');
    const keep = st.chat.length;
    say('user', 'The guard is not part of this story.');
    T.setTrackerRun('The Guard', 'abandon');
    assertEqual(pos()[2], 'The Guard: Watching [abandoned]');
    T.setTrackerRun('The Guard', 'reactivate');
    assertEqual(pos()[2], 'The Guard: Watching', 'its start (Quest at the gate) holds — it starts again at once');
    T.setTrackerRun('The Guard', 'abandon');
    st.chat.splice(keep);
    await T.reconcileTrackers({ prune: true });
    assertEqual(pos()[2], 'The Guard: Watching', 'the abandon went with its message');
    settled('abandon deleted');
});

test('a branch that does not exist, or no fork there: an error, nothing changes', () => {
    const before = pos();
    assert(T.chooseBranch('The Guard', 'Wins').error, 'the Guard has no fork');
    assert(T.chooseBranch('Quest', 'Flies away').error, 'no such branch');
    assertEqual(pos(), before);
});

// ── step 7c: blocks and "only one at a time" work in chats (Miinthe, 2026-10-05: "make them work") ──────────
const BOARD3 = { v: 2, name: 'Engine test 3', folders: [], exclusive: [{ a: 'rel', b: 'cat' }], trackers: [
    { id: 'rel', name: 'Relationship', direction: 'both', steps: [{ id: 's1', name: 'Strangers' }, { id: 's2', name: 'Neighbours' }, { id: 's3', name: 'Married', blocks: [{ tracker: 'fuse', running: true }] }] },
    { id: 'fuse', name: 'The Broken Fuse', direction: 'both', blocks: [{ tracker: 'rel', step: 's1' }], steps: [{ id: 'c1', name: 'Calm' }, { id: 'c2', name: 'Sparks' }] },
    { id: 'cat', name: 'The Cat', direction: 'both', steps: [{ id: 'k1', name: 'Asleep' }, { id: 'k2', name: 'Awake' }] },
] };
const LORE3 = [{ title: 'Fuse · Calm', storyStep: { tracker: 'The Broken Fuse', steps: ['Calm'] } }, { title: 'Cat · Asleep', storyStep: { tracker: 'The Cat', steps: ['Asleep'] } }];
const loreNow = () => { const a = new Set(T.readActiveTrackers().map(t => t.name)); return TP.filterByStoryStep(LORE3, T.readTrackers(), () => false, t => a.has(t.name)).map(e => e.title); };

test('a block pauses a tracker while it holds: not told, not watched, its lore hidden, the Story tab says why', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD3);
    assertEqual(pos(), ['Relationship: Strangers', 'The Broken Fuse: Calm [paused]', 'The Cat: Asleep [paused]']);
    assertEqual(T.getTrackers()[1].pausedWhy, 'while Relationship is at Strangers');
    assertEqual(writer().split('\n').slice(1, -1).filter(l => !/^(PLACE|KNOWN)/.test(l)), ['Relationship: Strangers']);
    assertEqual(loreNow(), []);
    // the helper may not move a paused tracker
    await turn('The fuse sparks wildly.', { changes: [ch('The Broken Fuse', 'Sparks', 'The fuse sparks wildly')] });
    assertEqual(pos()[1], 'The Broken Fuse: Calm [paused]');
    // Relationship moves on: the block no longer holds
    await turn('Hi, I live next door now.', { changes: [ch('Relationship', 'Neighbours', 'I live next door now')] });
    assertEqual(pos()[1], 'The Broken Fuse: Calm');
    assertEqual(loreNow(), ['Fuse · Calm']);
});

test('a block on a step locks it: the helper is refused with why; by hand allowed, with a warning', async () => {
    takeNotices();
    await turn('We got married today!', { changes: [ch('Relationship', 'Married', 'We got married today')] });
    assertEqual(pos()[0], 'Relationship: Neighbours');
    assert(takeNotices().some(n => /Married is only possible while The Broken Fuse is running/.test(n.msg) || /only possible while The Broken Fuse is running/.test(n.msg)), 'refused, with the block');
    T.moveTracker('Relationship', { delta: 1 });
    assertEqual(pos()[0], 'Relationship: Married');
    assert(takeNotices().some(n => /Moved anyway, by hand/.test(n.msg)), 'warned');
});

test('only one at a time: the Cat waits while Relationship holds the floor; abandoned, the Cat runs', () => {
    assertEqual([pos()[2], T.getTrackers()[2].pausedWhy], ['The Cat: Asleep [paused]', 'Relationship holds the floor']);
    T.setTrackerRun('Relationship', 'abandon');
    assertEqual(pos()[2], 'The Cat: Asleep');
    assert(loreNow().includes('Cat · Asleep'), 'its lore shows');
});

// ── Mero's 📬: the helper asks when unsure — the reply waits (Miinthe, decided 2026-10-03; mock-ups v3–v13) ────────
const RQ = await import('../src/requests.js');
const waitingCards = () => RQ.requestsHere().waiting.filter(r => r.kind === 'move');
/** Miinthe's message; the helper answers; while its run waits, Miinthe answers the card(s) with `choice`. */
async function askedTurn(userText, answer, choice, n = null) {
    say('user', userText);
    st.helper.push(answer);
    const run = A.runAutoTrack(st.chat, 'normal');
    await new Promise(r => setTimeout(r, 0));
    const cards = waitingCards();
    for (const c of cards) await RQ.answerRequest(c.id, choice, n);
    await run;
    T.boardTick();
    say('ai', 'ok');
    return cards;
}
const unsure = (tracker, step, quote, extra = {}) => ch(tracker, step, quote, { confidence: 'low', reason: 'maybe', recheck: 5, recheckWhy: 'see if it sticks', ...extra });

test('📬 an unsure move waits for Miinthe — the card says what, the quote, why, and the helper\'s re-check suggestion; Accept applies it', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    let seen = null;
    say('user', 'I guess I live next door now, sort of.');
    st.helper.push({ changes: [unsure('Relationship', 'Neighbours', 'I live next door now')] });
    // what the signals see at the moment the card is announced (the 📬 dot, wiggle and ticker redraw then)
    const atNotice = [];
    const off = RQ.onRequestsChanged(() => atNotice.push(RQ.replyWaits()));
    const run = A.runAutoTrack(st.chat, 'normal');
    await new Promise(r => setTimeout(r, 0));
    seen = waitingCards();
    assertEqual(seen.map(c => [c.title, c.q, c.why, c.conf, c.recheck, c.recheckWhy, c.now]), [['Relationship → Neighbours?', 'I live next door now', 'maybe', 'low', 5, 'see if it sticks', true]]);
    assert(RQ.replyWaits(), 'the reply waits');
    assertEqual(atNotice[0], true, 'announced as holding the reply, not before');
    off();
    assertEqual(pos()[0], 'Relationship: Strangers', 'nothing applied yet');
    await RQ.answerRequest(seen[0].id, 'accept');
    await run;
    assertEqual([pos()[0], RQ.replyWaits()], ['Relationship: Neighbours', false]);
    assertEqual(RQ.requestsHere().answered[0].done, 'Accepted');
    assertEqual(stepLog().at(-1).quote, 'I live next door now');
});

test('📬 Deny: not applied, and the same line never asks again', async () => {
    await askedTurn('We are friends now, maybe?', { changes: [unsure('Relationship', 'Friends', 'We are friends now')] }, 'deny');
    assertEqual(pos()[0], 'Relationship: Neighbours');
    say('user', 'Anyway.');
    st.helper.push({ changes: [unsure('Relationship', 'Friends', 'We are friends now')] });
    await A.runAutoTrack(st.chat, 'normal');
    assertEqual([waitingCards().length, pos()[0]], [0, 'Relationship: Neighbours']);
    say('ai', 'ok');
});

test('📬 Re-check in 3: not applied now; the same line may ask again 3 messages later', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    await askedTurn('Neighbours, I suppose.', { changes: [unsure('Relationship', 'Neighbours', 'Neighbours, I suppose')] }, 'wait', 3);
    assertEqual([pos()[0], RQ.requestsHere().answered[0].done], ['Relationship: Strangers', 'Re-check in 3']);
    say('user', 'Hm.');
    st.helper.push({ changes: [unsure('Relationship', 'Neighbours', 'Neighbours, I suppose')] });
    await A.runAutoTrack(st.chat, 'normal');
    assertEqual(waitingCards().length, 0, 'too early');
    say('ai', 'ok'); say('user', 'And?');
    const cards = await askedTurn('Well.', { changes: [unsure('Relationship', 'Neighbours', 'Neighbours, I suppose')] }, 'accept');
    assertEqual([cards.length, pos()[0]], [1, 'Relationship: Neighbours']);
    const told = st.calls.filter(c => c.caller === 'storyTracker').at(-1).user;
    assert(/LOOK AGAIN/.test(told) && told.includes('Miinthe: Neighbours, I suppose.'), 'the helper got the original line back, with the note');
    assertEqual(T.getTrackers()[0].undone || [], [], 'the re-check is used up');
});

test('📬 when to ask: a step set to "always" asks even when sure; a tracker set to "never" doesn\'t; the board\'s "rarely" switches it off', async () => {
    const b = structuredClone(BOARD);
    b.trackers[0].steps[2].ask = 'all';          // Friends: always ask
    b.trackers[1].askAt = 'never';                 // the Fuse: never ask
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(b);
    await turn('Hi, I am the new neighbour.', { changes: [ch('Relationship', 'Neighbours', 'I am the new neighbour')] });
    const cards = await askedTurn('Friends now, for sure.', { changes: [ch('Relationship', 'Friends', 'Friends now, for sure')] }, 'accept');
    assertEqual([cards.length, cards[0]?.conf, pos()[0]], [1, 'high', 'Relationship: Friends']);
    await turn('The lights spark a little.', { changes: [unsure('The Broken Fuse', 'Sparks', 'The lights spark a little')] });
    assertEqual(pos()[1].split(' {')[0], 'The Broken Fuse: Sparks', 'never asks: applied as it came');
    const r = structuredClone(BOARD); r.ask = { level: 'rarely', found: true, unsure: true, suggest: false };
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(r);
    await turn('I live next door now, I think.', { changes: [unsure('Relationship', 'Neighbours', 'I live next door now')] });
    assertEqual(pos()[0], 'Relationship: Neighbours', '"rarely": decided on its own');
});

test('📬 a stopped reply drops the question — nothing applied, nothing remembered', async () => {
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(BOARD);
    say('user', 'I live next door now, I think.');
    st.helper.push({ changes: [unsure('Relationship', 'Neighbours', 'I live next door now')] });
    const stop = new AbortController();
    const run = A.runAutoTrack(st.chat, 'normal', stop.signal);
    await new Promise(r => setTimeout(r, 0));
    assertEqual(waitingCards().length, 1);
    stop.abort();
    await run;
    assertEqual([pos()[0], RQ.replyWaits(), waitingCards().length, RQ.requestsHere().answered[0].done], ['Relationship: Strangers', false, 0, 'Dropped — the reply it held was stopped']);
    assertEqual(T.getTrackers()[0].undone || [], [], 'nothing remembered — it may ask again');
});

test('📬 a found item shows as a card (it doesn\'t hold the reply); "Not worth keeping" answers it there; gone with its message ("still true?")', async () => {
    const b = structuredClone(BOARD);
    b.trackers[3] = { ...b.trackers[3], grows: true, growAsk: 'ask' };
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(b);
    say('user', 'She finds a brass key with a green ribbon and pockets it.');
    const pend = (id, m) => ({ id, name: 'Brass key', state: 'have', m, q: 'finds a brass key with a green ribbon', why: 'plainly pocketed', conf: 'high', about: '', summary: '', body: '' });
    st.chat_metadata.deeplore_board_state.collections.stash.pending = [pend('p1', 1)];
    let w = RQ.requestsHere().waiting.filter(r => r.kind === 'find');
    assertEqual([w.length, w[0].title, w[0].now ?? false, RQ.replyWaits()], [1, 'Keep Brass key?', false, false]);
    assert(await RQ.answerRequest(w[0].id, 'refuse'), 'answered');
    assertEqual([RQ.requestsHere().waiting.filter(r => r.kind === 'find').length, RQ.requestsHere().answered[0].done], [0, 'Not kept']);
    // still true? a find whose message is deleted leaves the board — and its card with it
    st.chat_metadata.deeplore_board_state.collections.stash.pending = [pend('p2', 1)];
    assertEqual(RQ.requestsHere().waiting.filter(r => r.kind === 'find').length, 1);
    st.chat.splice(1);
    await T.reconcileTrackers({ prune: true });
    assertEqual(RQ.requestsHere().waiting.filter(r => r.kind === 'find').length, 0);
});

// ── Immersion = no echoes; requests still ask; warnings stay (Miinthe, 2026-10-05) ───────────────────────────────
test('Immersion: a sure move is not echoed; a refused move still warns; an unsure one still asks', async () => {
    const b = structuredClone(BOARD); b.mode = 'immersion';
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(b);
    takeNotices();
    await turn('Hi, I am the new neighbour.', { changes: [ch('Relationship', 'Neighbours', 'I am the new neighbour')] });
    assertEqual([pos()[0], takeNotices().length], ['Relationship: Neighbours', 0], 'moved, nothing echoed');
    await turn('We are friends now.', { changes: [ch('Relationship', 'Friends', 'We are friends now')] });
    assertEqual(takeNotices().map(n => n.msg).filter(m => /has started/.test(m)), [], 'a start is an echo too');
    await turn('Married today, at the town hall.', { changes: [ch('Relationship', 'Married', 'Married today, at the town hall')] });
    assert(takeNotices().some(n => n.kind === 'warning' && /waits at the fork/.test(n.msg)), 'the warning shows');
    const cards = await askedTurn('Maybe we are sweethearts?', { changes: [unsure('Relationship', 'Sweethearts', 'we are sweethearts', { branch: 'Confesses' })] }, 'accept');
    assertEqual([cards.length, pos()[0].split(' {')[0]], [1, 'Relationship: Sweethearts'], 'it asked, in Immersion too');
});

test('📬 a date found under "ask me first" is a card, not a toast — Add it puts it on the calendar; gone with its message', async () => {
    const b = structuredClone(BOARD);
    b.trackers.push({ id: 'world', kind: 'state', name: 'World', fields: [{ id: 'day', type: 'day', name: 'Day' }], datesGrow: true, datesAsk: 'ask' });
    resetChat();
    st.chat.push({ name: 'test bot 1', is_user: false, is_system: false, mes: 'Hello.', send_date: '0', extra: {} });
    useBoard(b);
    takeNotices();
    const date = q => ({ tracker: 'World', name: 'Harbor party', in_days: 2, quote: q, reason: 'an arrangement with a day', confidence: 'high' });
    await turn('In two days there is a party at the harbor.', { changes: [], dates: [date('In two days there is a party')] });
    let w = RQ.requestsHere().waiting.filter(r => r.kind === 'date');
    assertEqual([w.length, w[0]?.title, RQ.replyWaits()], [1, 'Add “Harbor party” to the calendar (Day 3)?', false]);
    assert(takeNotices().every(n => !/Add it/.test(n.msg)), 'no "Add it" toast any more');
    assert(await RQ.answerRequest(w[0].id, 'add'), 'answered');
    assertEqual(st.chat_metadata.deeplore_board_state.states.world.dates.map(d => [d.name, d.due]), [['Harbor party', 3]]);
    assertEqual(RQ.requestsHere().answered[0].done, 'Added');
    // still true? a new date card whose message is deleted goes away
    await turn('And in five days a wedding at the chapel.', { changes: [], dates: [{ ...date('in five days a wedding'), name: 'Wedding', in_days: 5 }] });
    assertEqual(RQ.requestsHere().waiting.filter(r => r.kind === 'date').length, 1);
    st.chat.splice(st.chat.length - 2);
    assertEqual(RQ.requestsHere().waiting.filter(r => r.kind === 'date').length, 0);
});

summary('engine (characterization)');
