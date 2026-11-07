/**
 * LOCAL PATCH 2026-08-09 (Miinthe) — session-folder routing, extracted so it can be tested.
 *
 * No imports. The caller passes the folder list in; everything that decides anything
 * lives here.
 *
 * A session belongs to a CHARACTER **and** an instance letter. "Wren instance A" and
 * "Corvin instance A" are different runs that happen to share a letter, and filing one
 * into the other's folder is the failure this function exists to prevent.
 *
 * The original version (2026-08-02) ended with "if only one folder starts with this
 * letter, use it" — written when Corvin was the only character, so the only A-folder was
 * always the right A-folder. Adding a second character made that fallback actively wrong:
 * a brand-new session folder holds no entries yet, and DeepLore's folder list is derived
 * from folders that CONTAIN entries, so the new character's own folder is invisible and
 * the only visible A-folder belongs to someone else.
 *
 * The rule now: file into a letter-folder only when it actually names this character.
 * The bare-letter fallback survives only for folders that name NO character at all
 * (a leaf with no `;`), which is the "01 Sessions/a" layout the fallback was for.
 * Anything else stays flat in the base folder — a note in the obvious wrong place is
 * recoverable; a note quietly filed under another character's run is not.
 */

/**
 * @param {string} baseFolder - configured sessions folder, e.g. '01 Sessions'
 * @param {string|string[]} charNames - candidate names for this character, best first
 *   (the chat's declared context character, then the SillyTavern card name)
 * @param {string|string[]} instance - the run's instance letter
 * @param {Array<{path: string}>} folders - DeepLore's known folders (state.folderList)
 * @returns {string} the folder to write the session note into
 */
export function resolveSessionFolder(baseFolder, charNames, instance, folders) {
    if (!instance) return baseFolder;
    const letter = String(Array.isArray(instance) ? instance[0] : instance).trim().toLowerCase();
    if (!letter) return baseFolder;

    const prefix = baseFolder + '/';
    const subs = (folders || [])
        .map(f => (typeof f === 'string' ? f : f && f.path))
        .filter(pth => typeof pth === 'string' && pth.startsWith(prefix) && !pth.slice(prefix.length).includes('/'));
    if (!subs.length) return baseFolder;

    const leafOf = pth => pth.slice(prefix.length);

    const startsWithLetter = subs.filter(pth => {
        const leaf = leafOf(pth).trim().toLowerCase();
        return leaf === letter || leaf.startsWith(letter + ';') || leaf.startsWith(letter + ' ')
            || leaf.startsWith(letter + '-') || leaf.startsWith(letter + '_');
    });
    if (!startsWithLetter.length) return baseFolder;

    // Card names are commonly "Corvin, modern, Regency" and context names
    // "Wren; Gallery Light", while the folder reads "A; Wren; Gallery Light" — so match on
    // the whole string AND on its first comma/semicolon segment.
    const needles = [];
    for (const raw of (Array.isArray(charNames) ? charNames : [charNames])) {
        const full = String(raw || '').toLowerCase().trim();
        if (!full) continue;
        for (const cand of [full, full.split(',')[0].trim(), full.split(';')[0].trim()]) {
            if (cand && cand.length > 1 && !needles.includes(cand)) needles.push(cand);
        }
    }

    // 2026-11-07: one character can have several stories ("Corvin; A Fox as a Pet…" and
    // "Corvin; The Dragon's Fated Mate"). The short name "corvin" matches both stories'
    // folders, so the Dragon's run-A notes landed in the Fox story's run-A folder. When the
    // chat names its story (the part after the first `;`), a folder naming a DIFFERENT story
    // is never this chat's folder — whichever name matched.
    const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const storyOfName = (raw) => {
        const parts = String(raw || '').split(';').map(norm).filter(Boolean);
        return parts.length > 1 ? parts.slice(1).join('; ') : '';
    };
    const chatStory = (Array.isArray(charNames) ? charNames : [charNames]).map(storyOfName).find(Boolean) || '';
    const storyOfFolder = (pth) => {
        const parts = leafOf(pth).split(';').map(norm).filter(Boolean);
        return parts.length > 2 ? parts.slice(2).join('; ') : '';
    };
    const otherStory = pth => {
        if (!chatStory) return false;
        const fs = storyOfFolder(pth);
        return !!fs && fs !== chatStory;
    };

    const withChar = startsWithLetter.filter(pth => {
        if (otherStory(pth)) return false;
        const leaf = leafOf(pth).toLowerCase();
        return needles.some(n => leaf.includes(n));
    });
    if (withChar.length === 1) return withChar[0];
    // More than one of THIS character's folders claims the letter — ambiguous, stay flat
    // rather than pick one.
    if (withChar.length > 1) return baseFolder;

    // Nothing for this letter names this character. The only safe fallback is a folder that
    // names no character either; a folder naming someone else must never be used.
    const unscoped = startsWithLetter.filter(pth => !leafOf(pth).includes(';'));
    if (unscoped.length === 1) return unscoped[0];

    return baseFolder;
}
