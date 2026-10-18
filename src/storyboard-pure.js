/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — storyboards, the foundation. Pure rules only
 * (tested in test/storyboard.test.mjs). Design: `6 merge roadmap.md` §4 G.
 *
 * A STORYBOARD is a named "book" of trackers — names, steps, direction, may-skip —
 * stored on the SillyTavern side (extension settings, per account), never in the
 * vault. Chats and characters APPLY a board. Each chat keeps only its PLACE on it:
 * where each tracker stands, its detour, its history (journal), its last automatic
 * move and undo memory — in `chat_metadata.deeplore_trackers` as before.
 *
 * The place entries keep a copy of the definition too (steps etc.), so a chat
 * still works exactly as before if its board is missing — and a chat without a
 * board is just today's per-chat trackers.
 *
 * Trackers are matched between board and place by a stable `id` (name as a
 * fallback), so renaming a tracker on the board does not lose any chat's place.
 */

export const BOARD_KEY = 'deeplore_board';            // chat_metadata: the board this chat uses
export const STORE_KEY = 'deeplore_storyboards';      // extension_settings: { boards, characters }

/** The definition fields a board owns; everything else on a tracker is the chat's place. */
const DEF_FIELDS = ['id', 'name', 'steps', 'direction', 'skip'];

export function emptyStore() {
    return { boards: {}, characters: {} };
}

/** Normalise the stored value (tolerates missing or damaged data). */
export function asStore(v) {
    const s = v && typeof v === 'object' ? v : {};
    return {
        boards: s.boards && typeof s.boards === 'object' ? s.boards : {},
        characters: s.characters && typeof s.characters === 'object' ? s.characters : {},
        // old name → new name, so chats still holding the old name follow a rename (cloud bug hunt, 2026-10-04)
        ...(s.renamed && typeof s.renamed === 'object' ? { renamed: s.renamed } : {}),
    };
}

/** Record a rename (old → new), keeping earlier renames pointing at the newest name. */
export function noteRename(store, from, to) {
    const r = { ...(store.renamed || {}) };
    for (const k of Object.keys(r)) if (r[k] === from) r[k] = to;
    r[from] = to;
    delete r[to];          // the new name is a real board again
    store.renamed = r;
    return store;
}

/** Was the board a chat still names deleted on purpose? Follows renames, so an old name of a deleted board counts too (Miinthe, 2026-10-17). */
export function wasDeleted(store, name) {
    const gone = new Set(Array.isArray(store?.deleted) ? store.deleted : []);
    const seen = new Set();
    for (let n = name; n && !seen.has(n); n = store?.renamed?.[n]) { if (gone.has(n)) return true; seen.add(n); }
    return false;
}

/** The board a chat's stored name means now: itself, or where a rename took it (null if neither exists). */
export function resolveBoardName(store, name) {
    if (!name) return null;
    if (store?.boards?.[name]) return name;
    const seen = new Set();
    let n = name;
    while (store?.renamed?.[n] && !seen.has(n)) { seen.add(n); n = store.renamed[n]; if (store.boards?.[n]) return n; }
    return null;
}

const slug = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24) || 'tracker';

/** A new id for a tracker, unique among `taken`. */
export function newTrackerId(name, taken = []) {
    const used = new Set(taken);
    const base = slug(name);
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Give every tracker an id (keeps existing ones). */
export function withIds(list) {
    const taken = list.map(t => t.id).filter(Boolean);
    return list.map(t => {
        if (t.id) return t;
        const id = newTrackerId(t.name, taken);
        taken.push(id);
        return { ...t, id };
    });
}

/** Only the definition part of a tracker. */
export function defOf(t) {
    const d = {
        id: t.id, name: t.name, steps: [...t.steps],
        direction: t.direction === 'forward' ? 'forward' : 'both',
        skip: t.skip === true,
    };
    // Conditions (conditions-pure.js) — only when set, so older boards stay identical.
    if (Array.isArray(t.starts) && t.starts.length) d.starts = t.starts.map(c => ({ ...c }));
    if (Array.isArray(t.needs) && t.needs.length) d.needs = t.needs.map(c => ({ ...c }));
    if (t.onFall === 'pause') d.onFall = 'pause';
    // LOCAL PATCH (Miinthe, 2026-10-05): forks after steps (forks-pure.js) belong to the board too.
    if (t.forks && typeof t.forks === 'object' && Object.keys(t.forks).length) d.forks = JSON.parse(JSON.stringify(t.forks));
    return d;
}

export function makeBoard(name, list) {
    return { name, trackers: withIds(list).map(defOf) };
}

/** A board name not yet used in the store: "Name", "Name (2)", … */
export function freeBoardName(store, wanted) {
    const base = String(wanted || 'Storyboard').trim() || 'Storyboard';
    if (!store.boards[base]) return base;
    for (let n = 2; ; n++) if (!store.boards[`${base} (${n})`]) return `${base} (${n})`;
}

// The board is the only source of conditions: clear the place's old copies first.
const withoutConditions = () => ({ starts: undefined, needs: undefined, onFall: undefined, forks: undefined });   // the board's, if any, come from defOf

const sameDef = (a, b) => JSON.stringify(defOf(a)) === JSON.stringify(defOf(b));

/**
 * The chat's trackers as one list: the board's definitions, each with this chat's
 * place. A tracker new to the chat starts at step 1. A place whose step was renamed
 * or reordered on the board follows the step BY NAME; if its step is gone, it is
 * reported in `lost` (so the caller can say so — nothing moves silently) and starts
 * at step 1.
 *
 * @returns {{ list: Array, lost: Array<{ name, step }> }}
 */
export function mergeBoard(board, place, fresh) {
    const places = Array.isArray(place) ? place : [];
    const lost = [];
    const list = (board?.trackers || []).map(def => {
        const p = places.find(x => x.id && x.id === def.id) || places.find(x => !x.id && x.name?.toLowerCase() === def.name.toLowerCase())
            || places.find(x => x.name?.toLowerCase() === def.name.toLowerCase());
        if (!p) return { ...fresh(def.name, def.steps), ...withoutConditions(), ...defOf(def) };
        let index = Math.min(Math.max(Number(p.index) || 0, 0), Math.max((p.steps?.length || 1) - 1, 0));
        const was = Array.isArray(p.steps) ? p.steps[index] : undefined;
        if (was !== undefined && def.steps[index] !== was) {
            const k = def.steps.findIndex(s => s.toLowerCase() === String(was).toLowerCase());
            if (k >= 0) index = k;
            else { lost.push({ name: def.name, step: was }); index = 0; }
        }
        index = Math.min(index, def.steps.length - 1);
        return { ...p, ...withoutConditions(), ...defOf(def), index };
    });
    return { list, lost };
}

/** Did the definitions change compared with the board? (save → board too) */
export function defsDiffer(board, list) {
    const a = board?.trackers || [];
    if (a.length !== list.length) return true;
    return list.some((t, i) => !a[i] || !sameDef(a[i], t));
}

/** "Relationship, The Broken Fuse" — for messages. */
export function boardSummary(board) {
    const t = board?.trackers || [];
    return t.length ? t.map(x => x.name).join(', ') : 'no trackers yet';
}

export { DEF_FIELDS };
