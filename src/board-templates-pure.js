/**
 * The built-in starter templates of the board's New board dialog (Miinthe, 2026-11-02: "just a handful to get a new user
 * started and to see some examples"; draft approved: "looks good to me" — ~/deeplore-mockups/board-templates-draft.html).
 * Pure; tested in test/board-templates.test.mjs (each one goes through the real window → storage translator and the
 * board check).
 *
 * They are written in the board WINDOW's format (board/board.html works in it; fromWindowBoard turns it into the stored
 * board): a fork branch's `then.step` is a step's position from 0. `full: true` = the whole tracker is copied into the
 * new board (any kind), not only names and steps. Nothing here is anyone's own story: made-up, generic examples.
 * Each shows off different parts of the board:
 *   Slow-burn romance — steps with a fork, meters (one settles back by itself), flags
 *   Mystery            — collections with states (clues, suspects), places
 *   Fantasy quest      — an inventory with a purse that grows, a map, day · time · weather, a health meter
 *   Slice of life      — dated events, a meter, everyday places, a collection that grows
 */

const meter = ({ who = '', bands, start, min = 0, max = 100, drift = false, rest = start, every = 5 }) => ({
    steps: [], starts: [], start, min, max, unit: '',
    meter: {
        ...(who ? { who } : {}), bands: bands.map(([name, from], k) => ({ name, from, c: `b${Math.min(5, k + 1)}`, entries: [] })),
        sizes: { slight: 2, clear: 5, big: 10 }, cap: 10, drift, rest, every, ask: 'low', twoEnded: false,
    },
});
const steps = list => list.map(s => (typeof s === 'string' ? { name: s, entries: [] } : { entries: [], ...s }));
const items = list => list.map(name => ({ name, entry: null }));
const places = list => list.map((name, k) => ({ id: `p${k + 1}`, name, entries: [] }));
const FLAGS = [{ id: 'no', label: 'no', c: 'muted' }, { id: 'yes', label: 'yes', c: 'good' }];

export const STARTER_TEMPLATES = {
    'Slow-burn romance': { full: true, trackers: [
        { id: 'rel', name: 'Relationship', icon: '💞', color: '#d0145e', direction: 'both', skip: false, settle: 0, onFall: 'keep', starts: [],
            steps: steps(['Strangers', 'Acquaintances', 'Friends', 'Something more',
                { name: 'Confession', fork: [{ name: 'Says yes', entries: [] }, { name: 'Not yet', entries: [], then: { kind: 'back', step: 3 } }] },
                'Together']) },
        { id: 'trust', kind: 'counter', name: 'Trust', icon: '🤝', color: '#2f8f6b',
            ...meter({ bands: [['Wary', 0], ['Guarded', 21], ['Neutral', 41], ['Open', 61], ['Devoted', 81]], start: 50, drift: true, rest: 50 }) },
        { id: 'attraction', kind: 'counter', name: 'Attraction', icon: '💗', color: '#b0306b',
            ...meter({ bands: [['None', 0], ['Curious', 21], ['Drawn', 41], ['Smitten', 61], ['Hopeless', 81]], start: 0 }) },
        { id: 'moments', kind: 'collection', preset: 'flags', name: 'Moments', icon: '✨', color: '#c27c0e', steps: [], starts: [], states: FLAGS,
            items: [{ name: 'First kiss', entry: null, oneWay: true }, { name: 'Said “I love you”', entry: null, oneWay: true }, { name: 'A rival shows up', entry: null }] },
    ] },

    'Mystery': { full: true, trackers: [
        { id: 'case', name: 'Investigation', icon: '🔎', color: '#2a86b8', direction: 'forward', skip: false, settle: 0, onFall: 'keep', starts: [],
            steps: steps(['The crime', 'First clues', 'Suspects', 'The twist', 'The reveal']) },
        { id: 'clues', kind: 'collection', name: 'Clues', icon: '🧩', color: '#23845a', steps: [], starts: [],
            states: [{ id: 'hidden', label: 'hidden', c: 'muted' }, { id: 'uncovered', label: 'uncovered', c: 'good' }, { id: 'lost', label: 'lost', c: 'bad', strike: true }],
            items: items(['A torn letter', 'Muddy footprints', 'A stopped pocket watch']) },
        { id: 'suspects', kind: 'collection', name: 'Suspects', icon: '🕵️', color: '#c99700', steps: [], starts: [],
            states: [{ id: 'unknown', label: 'unknown', c: 'muted' }, { id: 'suspected', label: 'suspected', c: 'sig-med' }, { id: 'cleared', label: 'cleared', c: 'good' }, { id: 'guilty', label: 'guilty', c: 'bad' }],
            items: items(['The heir', 'The housekeeper', 'The stranger']) },
        { id: 'where', kind: 'place', name: 'Where', icon: '📍', color: '#c2410c', steps: [], starts: [], pinHere: true, nearby: true,
            places: places(['The scene of the crime', 'The study', 'The garden', 'The village']) },
        { id: 'pressure', kind: 'collection', preset: 'flags', name: 'Pressure', icon: '⏳', color: '#7232e0', steps: [], starts: [], states: FLAGS,
            items: [{ name: 'The culprit knows they’re being hunted', entry: null, oneWay: true }, { name: 'Someone else goes missing', entry: null, oneWay: true }] },
    ] },

    'Fantasy quest': { full: true, trackers: [
        { id: 'quest', name: 'Quest', icon: '🗡️', color: '#7232e0', direction: 'forward', skip: false, settle: 0, onFall: 'keep', starts: [],
            steps: steps(['The call', 'Setting out', 'The road',
                { name: 'The trial', fork: [{ name: 'Passed', entries: [] }, { name: 'Failed', entries: [], then: { kind: 'back', step: 2 } }] },
                'The final battle', 'Homecoming']) },
        { id: 'pack', kind: 'collection', name: 'Pack', icon: '🎒', color: '#2a86b8', steps: [], starts: [], amounts: true, grows: true, growAsk: 'ask',
            states: [{ id: 'have', label: 'have', c: 'good' }, { id: 'used', label: 'used up', c: 'l5' }, { id: 'lost', label: 'lost', c: 'bad', strike: true }],
            purse: [{ id: 'gold', unit: 'gold', before: false, start: 10 }],
            items: items(['Rope', 'Torch', 'Healing potion', 'An old map']) },
        { id: 'map', kind: 'place', name: 'Map', icon: '🗺️', color: '#c2410c', steps: [], starts: [], pinHere: true, nearby: true,
            places: places(['Home village', 'Forest road', 'Mountain pass', 'The ruin', 'The capital']) },
        { id: 'world', kind: 'state', name: 'World', icon: '🌦️', color: '#2a86b8', steps: [], starts: [], datesGrow: true, datesAsk: 'auto',
            fields: [
                { id: 'day', type: 'day', name: 'Day', start: 1 },
                { id: 'tod', type: 'cycle', name: 'Time of day', values: ['Morning', 'Afternoon', 'Evening', 'Night'], addsDay: true },
                { id: 'weather', type: 'choice', name: 'Weather', values: ['Clear', 'Rain', 'Storm', 'Snow'] },
            ], dates: [] },
        { id: 'health', kind: 'counter', name: 'Health', icon: '❤️', color: '#d0145e',
            ...meter({ bands: [['Near death', 0], ['Wounded', 26], ['Bruised', 51], ['Fine', 76]], start: 100, drift: true, rest: 100, every: 8 }) },
    ] },

    'Slice of life': { full: true, trackers: [
        { id: 'calendar', kind: 'state', name: 'Calendar', icon: '📅', color: '#2a86b8', steps: [], starts: [], datesGrow: true, datesAsk: 'auto',
            fields: [{ id: 'day', type: 'day', name: 'Day', start: 1 }],
            dates: [
                { id: 'movein', name: 'Moving in', due: 1, by: 'you' },
                { id: 'birthday', name: 'A birthday', due: 10, by: 'you' },
                { id: 'festival', name: 'The summer festival', due: 20, by: 'you' },
            ] },
        { id: 'family', name: 'Becoming family', icon: '🏡', color: '#23845a', direction: 'both', skip: false, settle: 0, onFall: 'keep', starts: [],
            steps: steps(['Newcomer', 'Housemate', 'Friend', 'Family']) },
        { id: 'mood', kind: 'counter', name: 'Mood at home', icon: '☕', color: '#c27c0e',
            ...meter({ bands: [['Tense', 0], ['Quiet', 21], ['Easy', 41], ['Warm', 61], ['Joyful', 81]], start: 50, drift: true, rest: 50 }) },
        { id: 'town', kind: 'place', name: 'Around town', icon: '📍', color: '#c2410c', steps: [], starts: [], pinHere: true, nearby: true,
            places: places(['Home', 'The café', 'Work', 'The park', 'The market']) },
        { id: 'memories', kind: 'collection', name: 'Shared memories', icon: '📸', color: '#b0306b', steps: [], starts: [], grows: true, growAsk: 'ask',
            states: [{ id: 'kept', label: 'remembered', c: 'good' }, { id: 'faded', label: 'faded', c: 'muted' }],
            items: items(['The first dinner together']) },
    ] },
};
