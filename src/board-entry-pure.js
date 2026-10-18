/**
 * LOCAL PATCH (Miinthe, 2026-10-04) — creating an entry right from the board (storyboard stage 3).
 * Pure: the file a new entry becomes. Tested in test/board-entry.test.mjs. The host
 * (board-window.js) checks the file does not exist yet, writes it, and re-reads the vault.
 *
 * Same shape as Auto Lorebook's new entries (src/ai/auto-suggest.js): type, priority, the lorebook
 * tag, keys, summary, the run stamp (character / instance from the chat, and the date), then
 * "# Title" and the text as Miinthe wrote it. An entry made at a place that is "only here" or "the place
 * itself" gets `location:` with the place and the places it sits in (spot first) — what DeepLore's
 * location filter matches (places-pure.js).
 */

export const ENTRY_TYPES = ['character', 'location', 'lore', 'organization', 'story'];

/** A title that is safe as a file name (same rules as Auto Lorebook). */
export function safeTitle(title) {
    let t = String(title ?? '').replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+|\.+$/g, '').trimEnd();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(t)) t = '_' + t;
    return t || 'Untitled';
}

const yamlStr = v => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const yamlItem = v => (/^[\w .,'()&·-]+$/u.test(String(v)) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(String(v)) ? String(v) : yamlStr(v));
const list = (key, vals) => (vals.length ? `${key}:\n${vals.map(v => `  - ${yamlItem(v)}`).join('\n')}\n` : `${key}: []\n`);

/** Keys typed with commas → a clean list. */
export const splitKeys = text => [...new Set(String(text ?? '').split(',').map(k => k.trim()).filter(Boolean))];

/**
 * The file for a new entry: { filename, content }.
 * @param {object} f { title, folder, type, keys (array or comma text), summary, body, location (array|null),
 *                    madeBy, from, tags (extra tags) — a draft Mero wrote (board entries window, overhaul 2026-10-16):
 *                    `made_by: Mero`, `from:` where she wrote it, and the `made-by-mero` tag; the date is in the stamp }
 * @param {object} o { stamp — the run stamp lines (runStampYaml), lorebookTag }
 */
export function buildEntryFile(f, { stamp = '', lorebookTag = 'lorebook' } = {}) {
    const title = String(f?.title ?? '').trim();
    const folder = String(f?.folder ?? '').trim().replace(/^\/+|\/+$/g, '');
    const name = safeTitle(title);
    const filename = folder ? `${folder}/${name}.md` : `${name}.md`;
    const type = ENTRY_TYPES.includes(f?.type) ? f.type : 'lore';
    const keys = Array.isArray(f?.keys) ? splitKeys(f.keys.join(',')) : splitKeys(f?.keys);
    const loc = Array.isArray(f?.location) ? f.location.filter(Boolean) : [];
    const tags = [lorebookTag, ...(Array.isArray(f?.tags) ? f.tags.map(t => String(t).trim()).filter(Boolean) : [])].filter((t, i, a) => a.indexOf(t) === i);
    // the text exactly as written — only a line of three dashes would end the frontmatter early
    const body = String(f?.body ?? '').replace(/^---$/gm, '- - -').trimEnd();
    const content = '---\n'
        + `type: ${type}\n`
        + (loc.length ? list('location', loc) : '')
        + 'priority: 50\n'
        + list('tags', tags)
        + list('keys', keys)
        + `summary: ${yamlStr(String(f?.summary ?? '').trim())}\n`
        + (f?.madeBy ? `made_by: ${yamlItem(f.madeBy)}\n` : '')
        + (f?.from ? `from: ${yamlStr(f.from)}\n` : '')
        + stamp
        + '---\n'
        + `# ${title}\n`
        + (body ? `\n${body}\n` : '');
    return { filename, content };
}
