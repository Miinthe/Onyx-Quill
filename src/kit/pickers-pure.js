/**
 * Overhaul step 1 (2026-10-15) — what the icon picker and the color picker offer. Moved from the board
 * (board.html, Miinthe's micro fixes of 2026-10-04/05) so the board, the Add window and the side panel share one list.
 *
 * Icons: emoji only — the design rule is "emoji = a meaning"; typing or pasting any emoji still works.
 * Colors: 14 ready-made colors, then "Custom…" for any other.
 * Pure. Tested in test/kit.test.mjs.
 */

/** [group, [{ e: emoji, w: search words }]] */
export const EMOJI = [
  ['Love & people', '💞 two hearts love|❤️ heart love|💔 broken heart|💌 love letter|💍 ring wedding|💐 bouquet|🌹 rose|💋 kiss|🫂 hug|👫 couple|💑 couple|👪 family|👑 crown royal|🤝 handshake deal|🗣️ talk speak|👀 eyes watch|😈 devil|🎭 masks drama'],
  ['Mystery & danger', '🔍 magnifier search clue|🔎 magnifier|🕵️ detective suspect|🧩 puzzle clue|🗝️ old key|🔑 key|🔒 lock secret|🔓 unlocked|📜 scroll|✉️ letter|🩸 blood|🗡️ dagger|⚔️ swords fight|🏹 bow|💀 skull death|☠️ poison|⚠️ warning|🚨 alarm|🕸️ web|🐍 snake'],
  ['Plot & progress', '📶 steps progress|📈 rising|📉 falling|🎯 goal|🏁 finish|🚩 flag|🧭 compass journey|🗺️ map|⚡ spark trigger|🔥 fire|💥 boom|🌀 twist|🎲 dice chance|⏳ hourglass time|⌛ hourglass|📅 calendar date|⏰ alarm clock|🔁 repeat|🪜 ladder'],
  ['Places', '📍 pin place|🏠 house home|🏰 castle|🏯 palace|⛪ church|🏛️ hall|🏙️ city|🏘️ village|🏚️ ruin|🌲 forest|🏔️ mountain|🌊 sea|🏝️ island|🏜️ desert|🌋 volcano|🚪 door|🛏️ bed room|🍳 kitchen|⛺ camp|🌉 bridge'],
  ['Nature & weather', '🌦️ weather|☀️ sun|🌙 moon night|⭐ star|🌧️ rain|⛈️ storm|❄️ snow|🌫️ fog|🌈 rainbow|🍂 autumn|🌸 blossom spring|🌷 tulip|🌻 sunflower|🌵 cactus|🍀 clover luck|🌿 herb|🦋 butterfly|🐉 dragon|🐺 wolf|🦊 fox|🐱 cat|🐦 bird'],
  ['Things & items', '🎒 backpack inventory|🗂️ collection folders|📦 box|💰 money bag|🪙 coin|💎 gem|🧪 potion|📖 book|📚 books|🕯️ candle|🔦 torch|🧰 toolbox|🔧 wrench|🧵 thread|🎁 gift|🍷 wine|🍞 bread food|☕ tea|🫖 teapot kettle|🍞 toast'],
  ['Magic & mood', '✨ sparkles magic|🔮 crystal ball|🪄 wand|🌟 glow|💫 dizzy|☁️ cloud|🌑 dark|😊 happy|😢 sad|😠 angry|😨 afraid|😴 sleepy|🤒 sick|💤 sleep|❤️‍🩹 healing|🧠 mind|💪 strength|🛡️ shield|⚖️ balance judge|🔢 counter number'],
].map(([g, list]) => [g, list.split('|').map(x => { const i = x.indexOf(' '); return { e: x.slice(0, i), w: x.slice(i + 1) }; })]);

/** [hex, name] — the 14 ready-made colors. */
export const SWATCHES = [['#d0145e', 'raspberry'], ['#e5484d', 'red'], ['#d9480f', 'orange'], ['#c27c0e', 'amber'], ['#8a6d00', 'olive'], ['#2f9e44', 'green'], ['#0f8a6a', 'teal'],
  ['#0b7fa8', 'sea'], ['#2c55c9', 'blue'], ['#5b4fd6', 'indigo'], ['#7232e0', 'violet'], ['#b0306b', 'plum'], ['#8b5e3c', 'brown'], ['#5b6b7f', 'slate']];

/**
 * The icon groups for a search text: words match anywhere, the emoji itself matches exactly; each emoji once.
 * → [[group, [{e, w}]]] without empty groups.
 */
export function searchEmoji(text) {
    const t = String(text ?? '').trim().toLowerCase(), seen = new Set();
    return EMOJI
        .map(([g, list]) => [g, list.filter(x => (!t || x.w.includes(t) || x.e === t) && !seen.has(x.e) && seen.add(x.e))])
        .filter(([, l]) => l.length);
}

/** A color as the picker stores it: "#rrggbb" lowercase, or '' if it isn't one. */
export function normalHex(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('');
    return '';
}
