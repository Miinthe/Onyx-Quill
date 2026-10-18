/**
 * Overhaul — the side panel's Filters tab: the parts with no SillyTavern in them (tested by test/filters-view.test.mjs).
 * What a chat reads (its character's folders, its run's, its own) and its field values, shaped for the view.
 */
import { splitGatingFields } from '../drawer/gating-visibility-pure.js';

/** Today's "Set" button runs these for the four built-in fields; any other field uses /dle-set-field <name>. */
export const FIELD_COMMANDS = { era: '/dle-set-era', location: '/dle-set-location', scene_type: '/dle-set-scene', character_present: '/dle-set-characters' };
export const setCommandFor = name => FIELD_COMMANDS[name] || `/dle-set-field ${name}`;

export const hasValue = v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
/** A field's value(s) in this chat, always as a list of strings. */
export function valuesOf(fd, ctx) {
    const v = ctx?.[fd?.contextKey];
    if (!hasValue(v)) return [];
    return (Array.isArray(v) ? v : [v]).map(x => String(x)).filter(Boolean);
}

/** Entries a field's value leaves out — the same rule as today's "excluding N" (entry has a value, none match). */
export function leftOutByField(fd, ctx, entries) {
    const active = valuesOf(fd, ctx).map(s => s.toLowerCase());
    if (!active.length) return 0;
    const set = new Set(active);
    let n = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
        const val = e?.customFields?.[fd.name];
        if (!hasValue(val)) continue;
        const list = (Array.isArray(val) ? val : [val]).map(x => String(x).toLowerCase());
        if (!list.some(x => set.has(x))) n++;
    }
    return n;
}

/**
 * The Fields fold: enabled fields, unused ones tucked away unless `showAll` (her patch, 2026-10-03).
 * Returns { rows: [{ name, label, multi, values, choices, leftOut, cmd }], hidden, set }.
 * `choices`: a field with a fixed list of values and one value at a time gets a dropdown right in the row.
 */
export function fieldRows(defs, entries, ctx, showAll = false) {
    const enabled = (Array.isArray(defs) ? defs : []).filter(fd => fd?.gating?.enabled);
    const { visible, hidden } = splitGatingFields(enabled, entries, ctx, !!showAll);
    const rows = visible.map(fd => ({
        name: fd.name, label: fd.label || fd.name, multi: !!fd.multi, values: valuesOf(fd, ctx),
        choices: !fd.multi && Array.isArray(fd.values) && fd.values.length ? fd.values.map(String) : null,
        leftOut: leftOutByField(fd, ctx, entries), cmd: setCommandFor(fd.name),
    }));
    return { rows, hidden: hidden.length, set: enabled.filter(fd => valuesOf(fd, ctx).length).length };
}

/** The fold's one-line summary: "Character: Kettle · Instance: A", or "nothing set". */
export function fieldsSummary(rows) {
    const set = (rows || []).filter(r => r.values.length);
    return set.length ? set.map(r => `${r.label}: ${r.values.join(', ')}`).join(' · ') : 'nothing set';
}

/** A field's value after removing one (a list loses that item; a single value is cleared). */
export function withoutValue(fd, current, value) {
    if (fd?.multi) return (Array.isArray(current) ? current : []).filter(c => c !== value);
    return null;
}

/** This chat's own folders after removing one (none left = null, as today). */
export function withoutFolder(list, folder) {
    const next = (Array.isArray(list) ? list : []).filter(f => f !== folder);
    return next.length ? next : null;
}

export const folderLeaf = path => String(path || '').replace(/\/+$/, '').split('/').pop() || String(path || '');

/** Entries outside the folders a chat reads (entries at the vault's top level always count as in). */
export function leftOutByFolders(entries, folders) {
    const fs = Array.isArray(folders) ? folders.filter(Boolean) : [];
    if (!fs.length) return 0;
    let n = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
        const p = e?.folderPath;
        if (p && !fs.some(f => p === f || p.startsWith(f + '/'))) n++;
    }
    return n;
}

/**
 * The card on top, from characters.js chatStatus(): who, which run, the three folder lines, the chat switch.
 * Group chats (no character) show only the chat's own folders, as today.
 */
export function cardModel(st) {
    const s = st || {};
    const ch = s.character || null;
    const runL = s.run ? String(s.run).toUpperCase() : '';
    const base = s.setup?.folders || [];
    const runFolders = s.setup && s.run ? s.setup.runs?.[s.run]?.folders || [] : [];
    const own = Array.isArray(s.own) ? s.own : [];
    const rows = ch
        ? [{ key: 'base', label: 'Base folders', folders: base },
            ...(s.run ? [{ key: 'run', label: `Run ${runL} adds`, folders: runFolders }] : []),
            { key: 'own', label: 'This chat adds', folders: own }]
        : [{ key: 'own', label: 'This chat’s folders', folders: own }];
    return {
        group: !ch,
        title: ch ? ch.name : 'Group chat',
        run: runL,
        on: !!s.on,
        why: ch ? s.why || '' : 'Group chat: this chat’s own folders apply.',
        rows,
        chatSwitch: s.chatSwitch === 'on' || s.chatSwitch === 'off' ? s.chatSwitch : 'follow',
        switchOptions: ch ? [['follow', `like ${ch.name}`], ['on', 'always on'], ['off', 'off']] : null,
        charOn: s.setup?.on !== false,
        folders: Array.isArray(s.folders) ? s.folders : [],
    };
}
