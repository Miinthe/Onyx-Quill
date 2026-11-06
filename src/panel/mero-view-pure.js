/**
 * Overhaul — Mero ☆'s tab (side panel + bar v13): the rules with no page behind them, so they can be tested.
 * Used by src/panel/mero-view.js and src/mero-window.js (SillyTavern's page) and mero/mero.html (Mero's own page).
 */

/**
 * How tall Mero's box is in the side panel: everything the panel's scroller has left below where the box starts,
 * so her talk reaches the bottom of the screen (Miinthe's bug: "only half down"). Measured inside the scroller, so it
 * does not matter how far the scroller was scrolled on the tab before.
 * { scrollerHeight: the scroller's inner height, top: where the box starts inside the scroller's content,
 *   padBottom: the scroller's own bottom padding, min } → px
 */
export function fitHeight({ scrollerHeight = 0, top = 0, padBottom = 0, min = 300 } = {}) {
    const h = Math.floor(Number(scrollerHeight) - Math.max(0, Number(top) || 0) - Math.max(0, Number(padBottom) || 0));
    return Number.isFinite(h) ? Math.max(min, h) : min;
}

/** The small dot on the side panel's Mero tab while she has something for you (amber while the reply waits). */
export function tabDot({ waiting = 0, hold = false } = {}) {
    const n = Math.max(0, Number(waiting) || 0);
    if (!n && !hold) return { show: false, hold: false, title: '' };
    return {
        show: true, hold: !!hold,
        title: hold ? 'The reply waits for your answer (Mero’s requests)' : `Mero has ${n} ${n === 1 ? 'thing' : 'things'} for you`,
    };
}

/** Where Mero's rail sits: on the panel's outer edge (left when the side panel is on the left), right in her window. */
export function railSide(drawerSide, popped = false) {
    return !popped && drawerSide === 'left' ? 'left' : 'right';
}

/** The line under a talk's title: "Talks about Kettle · co-writer: DeepSeek · ● open". */
export function talkLine({ character = '', connection = '', state = '' } = {}) {
    const st = state === 'open' ? '● open' : state === 'resolved' ? '✓ resolved, writing reopens it' : state === 'archived' ? 'archived' : '';
    return [character ? `Talks about ${character}` : '', `co-writer: ${connection || 'not set'}`, st].filter(Boolean).join(' · ');
}

/**
 * The talk's ⋯ menu (mock-up: Check the lore, Wrap up, then Resolve, Archive, Delete). Returns plain items;
 * the page adds what each one does by `id`.
 */
export function talkMenu({ state = 'open', job = 'part', looking = false, busy = false, hasTalk = true } = {}) {
    const items = [
        { id: 'look', label: looking ? 'Mero is looking…' : 'Check the lore', icon: 'search', sub: job === 'off' ? 'Mero is off duty' : undefined, disabled: looking || job === 'off' },
        { id: 'wrap', label: 'Wrap up', icon: 'check', sub: 'agreements into notes', disabled: !hasTalk || busy },
    ];
    if (!hasTalk) return items;
    return [...items, 'sep',
        { id: 'resolve', label: state === 'open' ? 'Resolve for now' : 'Reopen', icon: state === 'open' ? 'keep' : 'undo' },
        { id: 'archive', label: state === 'archived' ? 'Unarchive' : 'Archive', icon: 'notes' },
        { id: 'delete', label: 'Delete', icon: 'trash', sub: 'asks first', danger: true },
    ];
}

/** Chattiness: the three sub-settings show under Custom, or while she opened them herself. */
export function showCustom(chatty, openedByHand = false) { return chatty === 'custom' || !!openedByHand; }

/** The folded Pitch menu's one line: "⚡ one-shot · 👁 3 · 🔀 turn · SFW · focus: Kettle". */
export function pitchLine(m = {}) {
    const PS = { nudge: '🌱 nudge', turn: '🔀 turn', bomb: '💥 bombshell' };
    const multi = m.shape === 'multi', hid = m.vis === 'hide';
    return [multi ? '🪜 multistep' : '⚡ one-shot', hid ? '🙈 hidden' : `👁 ${m.n || 3}`, PS[m.str] || '', String(m.tone || 'sfw').toUpperCase(), m.focus ? `focus: ${m.focus}` : null].filter(Boolean).join(' · ');
}
