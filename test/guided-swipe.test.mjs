/**
 * LOCAL PATCH suite — guided swipe (Miinthe, 2026-11-02: "you press it and then you can type corrections"). Failures to
 * avoid: the direction leaking into the next reply after she answered; it reaching a normal reply; a swipe's tag lost
 * or put on the wrong message; Compare showing nothing for a message without swipes.
 */
import { assert, assertEqual, test, summary } from './helpers.mjs';
import { asGuide, guideActive, guideLines, setGuide, tagSwipe, clearGuide, swipesOf } from '../src/guided-swipe-pure.js';

test('the writer gets it only for swipes of that reply', () => {
    const g = setGuide(asGuide(null), '  colder, fewer words ', 7);
    assertEqual(g.text, 'colder, fewer words');
    assertEqual(guideLines(g, 'swipe', 7).length, 1);
    assert(guideLines(g, 'swipe', 7)[0].text.includes('colder, fewer words'));
    assertEqual(guideLines(g, 'regenerate', 7).length, 1);
    assertEqual(guideLines(g, 'normal', 7).length, 0);
    assertEqual(guideLines(g, 'swipe', 9).length, 0);   // a newer message: not that reply any more
});

test('it stays across swipes; once she answers it is gone, the tags stay', () => {
    let g = setGuide(asGuide(null), 'colder', 7);
    g = tagSwipe(g, 7, 1); g = tagSwipe(g, 7, 2);
    assertEqual(Object.keys(g.tags).join(), '1,2');
    g = clearGuide(g);
    assert(!guideActive(g, 7) && guideLines(g, 'swipe', 7).length === 0);
    assertEqual(g.tags[2], 'colder');
    assertEqual(tagSwipe(g, 7, 3), g);   // no direction: nothing tagged
});

test('a new direction on the same reply keeps the old tags; on another reply starts fresh', () => {
    let g = tagSwipe(setGuide(asGuide(null), 'colder', 7), 7, 1);
    assertEqual(setGuide(g, 'warmer', 7).tags[1], 'colder');
    assertEqual(Object.keys(setGuide(g, 'warmer', 9).tags).length, 0);
});

test('compare: every swipe, which one shows, its direction', () => {
    const g = tagSwipe(setGuide(asGuide(null), 'colder', 3), 3, 1);
    const l = swipesOf({ swipes: ['a', 'b', 'c'], swipe_id: 1, mes: 'b' }, g, 3);
    assertEqual(l.map(x => `${x.k}${x.showing ? '*' : ''}${x.tag ? '🧭' : ''}`).join(), '0,1*🧭,2');
    assertEqual(swipesOf({ mes: 'only' }, g, 5).length, 1);
    assertEqual(swipesOf({ swipes: ['a', 'b'] }, g, 5)[1].tag, '');   // another message: no tags
});

test('stored junk is tidied', () => {
    const g = asGuide({ text: 5, i: 'x', tags: { a: 'no', 2: '  yes ', 3: '' } });
    assertEqual(g.text, ''); assertEqual(g.i, -1); assertEqual(JSON.stringify(g.tags), '{"2":"yes"}');
});

summary('guided-swipe');
