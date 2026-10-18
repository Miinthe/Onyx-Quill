/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — the "born in this run" stamp for new entries.
 *
 * Pure; no SillyTavern. Play-born lore is tagged with its run at birth (her rule 14):
 * `character` and `instance` from the chat's gating context, plus `date` — when it was
 * written. The date is what lets a later branch tell which entries existed before the
 * branch point (session notes already carry one from Scribe; Auto Lorebook and Emma's
 * entries did not).
 *
 * @param {object|null} ctx - chat_metadata.deeplore_context
 * @param {string[]} keys - context keys to copy, e.g. ['character', 'instance']
 * @param {Date} [now]
 * @returns {string} YAML lines, each ending in "\n" (empty fields omitted)
 */
export function runStampYaml(ctx, keys, now = new Date()) {
    let out = '';
    for (const k of keys) {
        const raw = ctx?.[k];
        const vals = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).filter(v => v !== '' && v != null);
        if (vals.length === 1) out += `${k}: ${vals[0]}\n`;
        else if (vals.length > 1) out += `${k}:\n` + vals.map(v => `  - ${v}`).join('\n') + '\n';
    }
    return out + `date: ${now.toISOString()}\n`;
}

/**
 * Insert YAML lines just before the closing `---` of a note's frontmatter.
 * Returns the content unchanged if it has no frontmatter block.
 */
export function insertIntoFrontmatter(content, yamlLines) {
    const m = /^---\n[\s\S]*?\n---/.exec(String(content));
    if (!m || !yamlLines) return content;
    const end = m[0].length - 3;   // position of the closing ---
    return content.slice(0, end) + yamlLines + content.slice(end);
}
