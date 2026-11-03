/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — characters and runs own their folders (the Filters hub's base).
 * Pure rules; tested in test/characters.test.mjs. Glue: src/characters.js. Design: `11 settings
 * inventory.md` (v10/v11) and `6 merge roadmap.md`.
 *
 * Miinthe: "Corvin (base) = folder one, folder two; Corvin / instance A = folder three … it also makes
 * us quick-apply boards faster." So:
 *  - a CHARACTER has base folders; each RUN (the chat's instance letter) adds its own folders;
 *  - a chat reads base ∪ its run's folders ∪ its own folders (the old per-chat folder filter — kept, so
 *    every chat set up the old way keeps working);
 *  - "a character with no folders doesn't use DeepLore": a chat with no folders anywhere is off.
 *  - DeepLore can be switched off (or on) per chat and per character; the chat's switch wins.
 *
 * Store (extension_settings.onyxquill_characters, per account):
 *   { v: 1, chars: { [avatar]: { name, folders: [], runs: { [letter]: { folders: [] } }, on?: false } } }
 * Keyed by the card's avatar file (stable across renames); the name is for showing.
 */

export const CHARS_KEY = 'onyxquill_characters';   // was deeplore_characters
export const CHAT_SWITCH_KEY = 'deeplore_switch';    // chat_metadata: 'on' | 'off' (unset: follow the character)

const arr = v => (Array.isArray(v) ? v : []);
const clean = list => [...new Set(arr(list).map(f => String(f ?? '').trim()).filter(Boolean))];
const letter = v => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim().toLowerCase();

export function asStore(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const chars = {};
    for (const [k, c] of Object.entries(s.chars && typeof s.chars === 'object' ? s.chars : {})) {
        if (!k || !c || typeof c !== 'object') continue;
        const runs = {};
        for (const [r, v] of Object.entries(c.runs && typeof c.runs === 'object' ? c.runs : {})) { const L = letter(r); if (L) runs[L] = { folders: clean(v?.folders) }; }
        chars[k] = { name: String(c.name ?? k), folders: clean(c.folders), runs, ...(c.on === false ? { on: false } : {}) };
    }
    return { v: 1, chars };
}

/** The run letter of a chat, from its context (the instance field). '' when none. */
export const runOf = context => letter(context?.instance);

/** Folders a chat reads: the character's base, its run's, and the chat's own (in that order, no repeats). */
export function chatFolders(store, key, run, own) {
    const c = asStore(store).chars[key];
    return clean([...(c ? c.folders : []), ...(c && run ? c.runs[letter(run)]?.folders || [] : []), ...arr(own)]);
}

/**
 * Is DeepLore on for this chat? { on, why }.
 * Order: the chat's own switch → the character's switch → folders (none anywhere = off).
 * A chat without a character (a group chat) follows only its own switch.
 */
export function isOn({ store, key, name, run, own, chatSwitch } = {}) {
    if (chatSwitch === 'off') return { on: false, why: 'switched off for this chat' };
    if (chatSwitch === 'on') return { on: true, why: 'switched on for this chat' };
    if (!key) return { on: true, why: 'no character' };
    const c = asStore(store).chars[key];
    const who = c?.name || name || 'this character';
    if (c?.on === false) return { on: false, why: `switched off for ${who}` };
    if (!chatFolders(store, key, run, own).length) return { on: false, why: `${who} has no folders yet` };
    return { on: true, why: c?.folders.length ? `reads ${who}'s folders` : 'reads this chat\'s folders' };
}

// ── changes (all return a new store) ────────────────────────────────────────

function withChar(store, key, name, fn) {
    const s = asStore(store);
    const c = s.chars[key] || { name: name || key, folders: [], runs: {} };
    s.chars[key] = fn({ ...c, name: name || c.name, runs: { ...c.runs } });
    return s;
}
/** Set a character's base folders (run: '' / null) or a run's folders. */
export function setFolders(store, key, name, folders, run = null) {
    return withChar(store, key, name, c => {
        const L = letter(run);
        if (!L) return { ...c, folders: clean(folders) };
        c.runs[L] = { folders: clean(folders) };
        if (!c.runs[L].folders.length) delete c.runs[L];
        return c;
    });
}
export function addFolders(store, key, name, folders, run = null) {
    const c = asStore(store).chars[key];
    const L = letter(run);
    const now = L ? c?.runs[L]?.folders || [] : c?.folders || [];
    return setFolders(store, key, name, [...now, ...arr(folders)], run);
}
export function removeFolders(store, key, name, folders, run = null) {
    const c = asStore(store).chars[key];
    const L = letter(run);
    const drop = new Set(arr(folders).map(f => String(f).trim()));
    const now = L ? c?.runs[L]?.folders || [] : c?.folders || [];
    return setFolders(store, key, name, now.filter(f => !drop.has(f)), run);
}
/** Switch DeepLore on (true: back to "follow the folders") or off for a character. */
export function setCharOn(store, key, name, on) {
    return withChar(store, key, name, c => { const { on: _o, ...rest } = c; return on ? rest : { ...rest, on: false }; });
}

/** A line for the side panel / a command: "Corvin · run c — reads 4 folders" etc. */
export function describe({ store, key, name, run, own, chatSwitch } = {}) {
    const st = isOn({ store, key, name, run, own, chatSwitch });
    const n = chatFolders(store, key, run, own).length;
    const who = asStore(store).chars[key]?.name || name || 'This chat';
    return `${who}${run ? ` · run ${run}` : ''} — Onyx Quill ${st.on ? 'on' : 'off'} (${st.why})${st.on && n ? `, ${n} folder${n > 1 ? 's' : ''}` : ''}`;
}

/**
 * LOCAL PATCH (Miinthe, 2026-10-13) — a new chat gets a run letter by itself (Miinthe: "can it automatically apply a run"):
 * without one, entries kept per run (`instance: a`, `b`, `c` …) all came in at once — three copies of one entry.
 * The letter: the next free one for the chat's character — read from the vault, like New Run does. The character is the
 * chat's Character field, else the entries' `character` value that names the card (e.g. "Toaster; The Kitchen").
 * Returns { letter, character } — `letter` is 'a' when the character has no runs yet; null when z is taken.
 */
export function autoRunLetter(entries, contextCharacter, cardName, nextInstanceLetter) {
    const list = Array.isArray(entries) ? entries : [];
    let character = String(Array.isArray(contextCharacter) ? contextCharacter[0] ?? '' : contextCharacter ?? '').trim();
    if (!character && cardName) {
        const want = String(cardName).trim().toLowerCase(), seen = new Map();
        for (const e of list) {
            const ec = e?.customFields?.character;
            for (const v of (Array.isArray(ec) ? ec : [ec])) {
                const full = String(v ?? '').trim();
                if (full && full.split(';').some(part => part.trim().toLowerCase() === want)) seen.set(full, (seen.get(full) || 0) + 1);
            }
        }
        character = [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    return { letter: character ? nextInstanceLetter(list, character, '') : 'a', character };
}
