/**
 * Overhaul round 2a suite — the DeepLore bar's rules (src/bar/bar-pure.js).
 * Failures to avoid: the side-panel button not leading to Mero's requests while she waits; a locked panel's button
 * closing the panel; a phone getting the envelope (no lock there); starred Quick Replies doubling or vanishing
 * when a set is switched off; the draft lost or silently overwriting what's in the message box.
 * Run: npm run test:bar
 */
import { assertEqual, test, summary } from './helpers.mjs';
import { layerUnder } from '../src/drawer/drawer-stack.js';
import { panelButton, toggleHot, isHot, hotButtons, normalHot, qrTitle, draftStep } from '../src/bar/bar-pure.js';

test('unlocked: opens and closes the panel; with something from Mero, a dot and straight to her requests', () => {
    assertEqual(panelButton({}).action, 'open');
    assertEqual(panelButton({ open: true }).action, 'close');
    const m = panelButton({ waiting: 2 });
    assertEqual([m.action, m.dot, m.icon], ['requests', 'mero', 'panel']);
    assertEqual(panelButton({ hold: true }).dot, 'hold');
    assertEqual(panelButton({ open: true, waiting: 1 }).action, 'close');
    assertEqual(panelButton({ left: true }).icon, 'panelL');
});

test('locked (PC): the button is the envelope, to her requests and back; never closes the panel', () => {
    const a = panelButton({ locked: true, open: true });
    assertEqual([a.icon, a.action, a.dot], ['mail', 'requests', '']);
    const b = panelButton({ locked: true, open: true, onRequests: true, waiting: 1 });
    assertEqual([b.icon, b.action, b.pressed, b.dot], ['mail', 'back', true, 'mero']);
    assertEqual(panelButton({ locked: true, open: true, hold: true }).dot, 'hold');
});

test('locked but closed (after a reload): the ordinary button, so it can be opened', () => {
    const c = panelButton({ locked: true, open: false, waiting: 1 });
    assertEqual([c.icon, c.action], ['panel', 'requests']);
    assertEqual(panelButton({ locked: true, open: false }).action, 'open');
});

test('a phone has no lock: a stored lock still gives the ordinary button', () => {
    assertEqual(panelButton({ locked: true, phone: true, open: true }).action, 'close');
    assertEqual(panelButton({ locked: true, phone: true }).icon, 'panel');
});

test('stars: toggle on and off, no doubles, junk dropped, order kept', () => {
    let l = toggleHot([], { set: 'Story', label: '▶️' });
    l = toggleHot(l, { set: 'Talk', label: '💬' });
    assertEqual(l, [{ set: 'Story', label: '▶️' }, { set: 'Talk', label: '💬' }]);
    assertEqual(isHot(l, { set: 'Talk', label: '💬' }), true);
    assertEqual(toggleHot(l, { set: 'Story', label: '▶️' }), [{ set: 'Talk', label: '💬' }]);
    assertEqual(normalHot([{ set: 'a', label: 'x' }, { set: 'a', label: 'x' }, null, { set: '', label: 'y' }, 'z']), [{ set: 'a', label: 'x' }]);
    assertEqual(normalHot(undefined), []);
});

test('the bar draws only stars whose set and button still exist; the star itself is kept', () => {
    const sets = [{ name: 'Story', qrs: [{ label: '▶️', title: 'Continue', message: '/continue' }] }];
    const stars = [{ set: 'Gone', label: '🫥' }, { set: 'Story', label: '▶️' }];
    assertEqual(hotButtons(stars, sets).map(q => q.label), ['▶️']);
    assertEqual(hotButtons(stars, []).length, 0);
    assertEqual(qrTitle({ label: '▶️', title: 'Continue' }), 'Continue');
    assertEqual(qrTitle({ label: '▶️', message: '/continue   now' }), '/continue now');
});

test('draft: keep, put back, and ask before replacing typed text', () => {
    assertEqual(draftStep({ box: 'Hello there' }), { box: '', draft: 'Hello there', ask: false, say: 'Kept as a draft. Press the same button to put it back, here or on another device.' });
    assertEqual(draftStep({ box: '', draft: 'Hello there' }).box, 'Hello there');
    assertEqual(draftStep({ box: 'new text', draft: 'old draft' }).ask, true);
    assertEqual([draftStep({ box: 'new text', draft: 'old draft' }).box, draftStep({ box: 'new text', draft: 'old draft' }).draft], ['old draft', 'new text']);   // a swap: nothing typed is lost
    assertEqual(draftStep({ box: '   ' }).draft, '');
});

test('a locked DeepLore sits one layer under SillyTavern\'s open panels, whatever the theme sets (Moonlit Echoes: 1000)', () => {
    assertEqual(layerUnder(['1000']), 999);
    assertEqual(layerUnder(['3000', '1000', 'auto']), 999);
    assertEqual(layerUnder([]), null);
    assertEqual(layerUnder(['auto']), null);
});

summary();
