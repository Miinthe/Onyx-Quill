/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — a branch from a past point becomes its own run.
 *
 * Pure decision logic; no SillyTavern, no jQuery (tested in test/local-patches.test.mjs).
 * The wiring lives in src/branch-run.js.
 *
 * When Miinthe branches from an earlier message, the new chat should start as its own run
 * (next instance letter) and carry the run's history up to the branch point: the
 * session notes Scribe wrote, and the lore Auto Lorebook filed for that run.
 * Everything is COPIED, never moved or edited — the parent run stays intact, and dead
 * runs are kept on purpose (she collects them). Each copy records where it came from.
 *
 * Why copies, not re-tagging: the folder filter runs after matching, so a note left in
 * `C; …` is filtered out by folder whatever its `instance` says.
 */

/** A frontmatter `date:` value as epoch ms, or null. */
export function frontmatterDate(content) {
    const fm = /^---\n([\s\S]*?)\n---/.exec(String(content ?? ''));
    if (!fm) return null;
    const m = /^date:\s*["']?([^"'\n]+)["']?\s*$/m.exec(fm[1]);
    if (!m) return null;
    const t = Date.parse(m[1].trim());
    return Number.isFinite(t) ? t : null;
}

/** A frontmatter `summary:` value (the model-facing line), or ''. */
export function frontmatterSummary(content) {
    const fm = /^---\n([\s\S]*?)\n---/.exec(String(content ?? ''));
    if (!fm) return '';
    const m = /^summary:\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(fm[1]) || /^summary:\s*(.+)$/m.exec(fm[1]);
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : '';
}

const lower = v => String(v ?? '').trim().toLowerCase();
const asList = v => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map(lower).filter(Boolean);

/**
 * Which indexed entries belong to the run being branched from.
 *
 * @param {Array} entries - vault index entries ({filename, folderPath, tags, customFields})
 * @param {{character: string, instance: string, sessionTag: string}} run
 * @returns {{ sessions: object[], lore: object[] }}
 */
export function runEntries(entries, { character, instance, sessionTag = 'lorebook-session' }) {
    const letter = lower(instance);
    const char = lower(character);
    const sessions = [];
    const lore = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const cf = e?.customFields || {};
        if (!asList(cf.instance).includes(letter)) continue;
        const chars = asList(cf.character);
        // An entry stamped for another character is never ours. One with no character
        // only counts when its folder names this character (older entries predate the stamp).
        if (chars.length ? !chars.includes(char) : !lower(e.folderPath).includes(char.split(/[;,]/)[0].trim())) continue;
        const isSession = (e.tags || []).map(lower).includes(sessionTag);
        (isSession ? sessions : lore).push(e);
    }
    return { sessions, lore };
}

/**
 * Sort candidates around the branch point.
 *
 * A session note's date is when Scribe wrote it — the END of the stretch it covers — so
 * the first note dated after the branch point usually covers it ("straddles"): shown,
 * unticked, Miinthe decides. Lore entries carry no range: dated ones before the point are
 * ticked, after it left out; undated ones (written before dates were stamped) are listed
 * for Miinthe to pick.
 *
 * @param {Array<{path, date}>} sessions - date: epoch ms or null
 * @param {Array<{path, date}>} lore
 * @param {number} branchTime - epoch ms of the branch's last message
 */
export function planCarry(sessions, lore, branchTime) {
    const byDate = (a, b) => (a.date ?? 0) - (b.date ?? 0);
    const s = [...sessions].sort(byDate);
    const before = s.filter(n => n.date != null && n.date <= branchTime);
    const after = s.filter(n => n.date != null && n.date > branchTime);
    const straddle = after.length ? after[0] : null;
    const undatedSessions = s.filter(n => n.date == null);
    return {
        sessionsBefore: before,
        sessionStraddle: straddle,
        sessionsUndated: undatedSessions,
        loreBefore: lore.filter(e => e.date != null && e.date <= branchTime).sort(byDate),
        loreUndated: lore.filter(e => e.date == null),
        loreAfterCount: lore.filter(e => e.date != null && e.date > branchTime).length,
    };
}

/**
 * Where a copy goes: the same folder with the run letter swapped (via the same rule New
 * Run uses), same filename. When the folder does not encode the letter (e.g. `00 Inbox`),
 * the copy stays in that folder with " (run D)" added to the filename instead.
 *
 * @param {string} path - vault-relative path of the original
 * @param {(folder: string) => string} swapFolder - folder → new run's folder
 */
export function copyTarget(path, newLetter, swapFolder) {
    const cut = path.lastIndexOf('/');
    const folder = cut >= 0 ? path.slice(0, cut) : '';
    const file = cut >= 0 ? path.slice(cut + 1) : path;
    const newFolder = folder ? swapFolder(folder) : folder;
    if (newFolder !== folder) return `${newFolder}/${file}`;
    const stem = file.replace(/\.md$/i, '');
    const name = `${stem} (run ${String(newLetter).toUpperCase()}).md`;
    return folder ? `${folder}/${name}` : name;
}

/**
 * The copy's content: identical to the original except `instance` becomes the new
 * letter and two provenance lines are added — so a branch's history can be traced (and,
 * if Miinthe ever wants, cleaned up) completely. The body is never touched.
 */
export function carriedContent(content, { newLetter, carriedFrom, atMessage }) {
    const text = String(content ?? '');
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!m) return null;
    const lines = m[1].split('\n');
    const out = [];
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^instance:/.test(line)) {
            out.push(`instance: ${String(newLetter).toLowerCase()}`);
            replaced = true;
            // drop a following YAML list belonging to instance:
            while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) i++;
            continue;
        }
        if (/^(carried_from|carried_at_message):/.test(line)) continue;   // a copy of a copy keeps only the latest hop
        out.push(line);
    }
    if (!replaced) out.push(`instance: ${String(newLetter).toLowerCase()}`);
    out.push(`carried_from: "${String(carriedFrom).replace(/"/g, '\\"')}"`);
    out.push(`carried_at_message: ${atMessage}`);
    return `---\n${out.join('\n')}\n---` + text.slice(m[0].length);
}
