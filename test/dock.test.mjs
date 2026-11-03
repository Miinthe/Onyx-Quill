/**
 * LOCAL PATCH suite — panel tabs (Miinthe, 2026-11-03). Failures to avoid: a panel on the wrong side (World's old default:
 * opposite the side panel); tabs in a jumping order; the wrong tab showing after an open or a close; a drop on the
 * wrong side.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { sidesFrom, tabsBySide, shownTab, nextOpened, dropSide, otherSide } from '../src/dock/dock-pure.js';

test('sides: the side panel and My notes default right; World opposite the side panel until moved', () => {
    assertEqual(JSON.stringify(sidesFrom({})), JSON.stringify({ dl: 'right', notes: 'right', world: 'left' }));
    assertEqual(sidesFrom({ drawerSide: 'left' }).world, 'right');
    assertEqual(sidesFrom({ drawerSide: 'left', worldSide: 'left' }).world, 'left');
    assertEqual(sidesFrom({ notesSide: 'left' }).notes, 'left');
    assertEqual(sidesFrom({ drawerSide: 'weird' }).dl, 'right');
    assertEqual(otherSide('left'), 'right');
});

test('tabs: the open panels of a side, in the order they were opened', () => {
    const t = tabsBySide({ dl: true, notes: true, world: true }, { dl: 'right', notes: 'right', world: 'left' }, ['notes', 'world', 'dl']);
    assertEqual(t.right.join(), 'notes,dl'); assertEqual(t.left.join(), 'world');
    assertEqual(tabsBySide({ dl: true, notes: false }, { dl: 'left', notes: 'left' }, []).left.join(), 'dl');
    assertEqual(tabsBySide({ dl: true, notes: true, world: true }, { dl: 'left', notes: 'left', world: 'left' }, ['world']).left.join(), 'world,dl,notes');
});

test('which tab shows: one just opened; else the one before; else the newest', () => {
    assertEqual(shownTab(['dl', 'notes'], 'dl', ['notes']), 'notes');
    assertEqual(shownTab(['dl', 'notes'], 'dl', []), 'dl');
    assertEqual(shownTab(['notes'], 'dl', []), 'notes');          // the shown one closed
    assertEqual(shownTab([], 'dl', []), null);
});

test('the open order: closed ones leave, new ones join at the end', () => {
    assertEqual(nextOpened(['dl', 'notes'], { dl: false, notes: true, world: true }).join(), 'notes,world');
    assertEqual(nextOpened([], { dl: true, world: true }).join(), 'dl,world');
});

test('a drop lands on the half of the window under the pointer', () => {
    assertEqual(dropSide(100, 1920), 'left'); assertEqual(dropSide(1500, 1920), 'right');
    assert(dropSide(960, 1920) === 'right');
});

summary('dock');
