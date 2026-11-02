/**
 * LOCAL PATCH suite — the floating icon drawer (Miinthe, 2026-11-02: "the floating icons on mobile are pissing me off").
 * Failures to avoid: SillyTavern's or DeepLore's own parts swallowed; a toast or a big window taken for an icon; the
 * drawer on when it's set off (or on a PC set to phone only); an icon's number lost; a switched-off icon docked anyway.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { drawerActive, looksFloating, iconKey, iconName, badgeOf, tabBadge, docked, MODES } from '../src/bar/icon-drawer-pure.js';

const ck = (o = {}) => ({ position: 'absolute', onBody: true, display: 'block', visibility: 'visible', opacity: '0.25', w: 32, h: 32, cursor: 'pointer', role: '', tag: 'DIV', ours: false, ...o });

test('off by default; phone only means phone only', () => {
    assertEqual(MODES.join(), 'off,phone,always');
    assert(!drawerActive('off', true) && !drawerActive(undefined, true));
    assert(drawerActive('phone', true) && !drawerActive('phone', false));
    assert(drawerActive('always', false));
});

test('CarrotKernel’s 🥕 counts: pinned to the page, or dragged (fixed)', () => {
    assert(looksFloating(ck()));
    assert(looksFloating(ck({ position: 'fixed', onBody: false })));
});

test('never: our own parts, big windows, tiny dots, hidden things, plain boxes, things inside the page', () => {
    assert(!looksFloating(ck({ ours: true })));
    assert(!looksFloating(ck({ w: 400, h: 300 })));
    assert(!looksFloating(ck({ w: 8, h: 8 })));
    assert(!looksFloating(ck({ display: 'none' })) && !looksFloating(ck({ opacity: '0' })) && !looksFloating(ck({ visibility: 'hidden' })));
    assert(!looksFloating(ck({ cursor: 'auto' })));
    assert(looksFloating(ck({ cursor: 'auto', tag: 'BUTTON' })));
    assert(!looksFloating(ck({ position: 'absolute', onBody: false })));
    assert(!looksFloating(ck({ position: 'static' })));
});

test('a stable key and a readable name', () => {
    assertEqual(iconKey({ cls: 'ck-trigger dle-docked' }), '.ck-trigger');
    assertEqual(iconKey({ id: 'fab', cls: 'x' }), '#fab');
    assertEqual(iconKey({ title: 'Hi\nthere' }), 't:Hi');
    assertEqual(iconName({ title: '🥕 CarrotKernel WorldBook Tracker\n---\nright click for options' }), 'CarrotKernel WorldBook Tracker');
    assertEqual(iconName({ cls: 'my-cool_button' }), 'My cool button');
    assertEqual(iconName({ id: 'echoBubble' }), 'Echo Bubble');
    assertEqual(iconName({}), 'Floating icon');
});

test('its number comes along; 0 is no number', () => {
    assertEqual(badgeOf([['class', 'ck-trigger'], ['data-ck-badge-count', '8']]), '8');
    assertEqual(badgeOf([['data-ck-badge-count', '0']]), '');
    assertEqual(badgeOf([], ['', '3']), '3');
    assertEqual(tabBadge(['8', '', '3']), '11');
    assertEqual(tabBadge(['80', '30']), '99+');
    assertEqual(tabBadge(['', '']), '');
});

test('a switched-off icon stays out', () => {
    assertEqual(docked(['.ck-trigger', '#fab'], ['#fab']).join(), '.ck-trigger');
});

summary('icon-drawer');
