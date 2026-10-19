/**
 * My notes (Miinthe, 2026-10-18; mock-up v3 https://claude.ai/artifact/WDdJMENvdrKPW4QufaoRLJ) — the rules, no SillyTavern.
 *
 * Her own notes, never sent to the AI: OOC prompts, plot notes, info. Each note shows in ONE place:
 *   chat  — this chat only            k = the chat's id
 *   story — every chat on its board   k = the board's name (followed through renames)
 *   char  — every chat with them      k = the character's avatar
 *   all   — everywhere (the library)  k = ''
 * The window lists "here" first (chat, story, character), the library folded under it. Search looks at every note.
 * Kept as text with SillyTavern's own markdown (**bold**, *italic*, # heading, - list), so a note put in the reply box
 * comes out formatted in the chat as well; the editor shows it formatted (noteToHtml ⇄ notebookToText).
 */

export const SCOPES = ['chat', 'story', 'char', 'all'];
export const SCOPE_WORDS = { chat: 'This chat', story: 'This story', char: 'This character', all: 'Everywhere' };

const str = v => (typeof v === 'string' ? v : '');

/** One note, tidied (anything odd in the file is dropped or fixed, never thrown). */
export function normNote(n) {
    if (!n || typeof n !== 'object') return null;
    const s = SCOPES.includes(n.s) ? n.s : 'all';
    const k = s === 'all' ? '' : str(n.k);
    if (s !== 'all' && !k) return null;
    return {
        id: str(n.id) || newId(),
        t: str(n.t), b: str(n.b), s, k,
        kn: s === 'all' ? '' : str(n.kn) || k,   // the place's name, for "lives in …"
        pin: n.pin === true,
        at: Number.isFinite(n.at) ? n.at : 0,
    };
}

/** The whole file. */
export function normNotes(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const notes = (Array.isArray(r.notes) ? r.notes : []).map(normNote).filter(n => n && !seen.has(n.id) && seen.add(n.id));
    return { v: 1, notes, imported: r.imported === true };
}

let seq = 0;
export function newId(now = Date.now()) { return `n${now.toString(36)}${(seq++).toString(36)}`; }

/** Where the window is: { chat, chatName, story, char, charName } (any may be ''). */
export function placeKey(where, s) {
    if (s === 'chat') return where?.chat || '';
    if (s === 'story') return where?.story || '';
    if (s === 'char') return where?.char || '';
    return '';
}
export function placeName(where, s) {
    if (s === 'chat') return where?.chatName || where?.chat || '';
    if (s === 'story') return where?.story || '';
    if (s === 'char') return where?.charName || where?.char || '';
    return '';
}

/** Does the note show here? `resolve` follows a renamed board to its current name. */
export function isHere(n, where, resolve = x => x) {
    if (n.s === 'all') return true;
    const k = placeKey(where, n.s);
    if (!k) return false;
    return n.s === 'story' ? (resolve(n.k) || n.k) === k : n.k === k;
}

/** Pinned first, then the newest (or A to Z). */
export function sortNotes(list, sort = 'new') {
    return [...list].sort((a, b) => (b.pin - a.pin) || (sort === 'az'
        ? (a.t || '').localeCompare(b.t || '', undefined, { sensitivity: 'base' })
        : b.at - a.at));
}

/** The four groups the window shows. */
export function groupsHere(notes, where, { resolve, sort } = {}) {
    const g = { chat: [], story: [], char: [], all: [] };
    for (const n of notes) if (isHere(n, where, resolve)) g[n.s].push(n);
    for (const s of SCOPES) g[s] = sortNotes(g[s], sort);
    return g;
}

/** Search every note, the ones that show here first. */
export function searchNotes(notes, q, where, { resolve } = {}) {
    const t = str(q).trim().toLowerCase();
    if (!t) return [];
    return sortNotes(notes.filter(n => `${n.t}\n${n.b}`.toLowerCase().includes(t)))
        .sort((a, b) => isHere(b, where, resolve) - isHere(a, where, resolve));
}

/** "Everywhere" / "Story: Harbor market" … */
export function whereText(n) {
    if (n.s === 'all') return 'Everywhere';
    const w = { chat: 'Chat', story: 'Story', char: 'Character' }[n.s];
    return `${w}: ${n.kn || n.k}`;
}

/** Move a note to one of the places of `where`. Returns the changed fields, or null when that place doesn't exist here. */
export function moveTo(s, where) {
    if (s === 'all') return { s, k: '', kn: '' };
    const k = placeKey(where, s);
    return k ? { s, k, kn: placeName(where, s) } : null;
}

/** The text for the card: one line, the markdown marks taken out. */
export function preview(b, max = 160) {
    const t = str(b).split('\n').map(l => l.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+\.\s+)/, '').trim()).filter(Boolean).join(' · ')
        .replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Put a note in the reply box: in an empty box it is the text; otherwise it goes at the end, on its own line. */
export function intoBox(box, text) {
    const b = str(box);
    return b.trim() ? `${b.replace(/\s+$/, '')}\n${text}` : str(text);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const unent = s => s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENT[e.toLowerCase()] ?? m;
});

/**
 * A Notebook extension page (Quill HTML) → text with the markdown marks. Bold, italic, headings, lists and line
 * breaks are kept; colors, fonts and sizes are not (Miinthe was told, 2026-10-18).
 */
// "<b>word </b>" → "**word** " (markdown bold can't end in a space)
const wrap = (x, m) => { const p = /^(\s*)([\s\S]*?)(\s*)$/.exec(x); return p[2].trim() ? `${p[1]}${m}${p[2]}${m}${p[3]}` : x; };
export function notebookToText(html) {
    let h = str(html);
    if (!/<[a-z]/i.test(h)) return unent(h).trim();
    h = h.replace(/\r/g, '')
        // Quill 2 marks bullets inside <ol> with data-list; a plain <ol> is numbered
        .replace(/<li[^>]*data-list="bullet"[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
        .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (m, x) => x.replace(/<li(?![^>]*data-list="bullet")[^>]*>([\s\S]*?)<\/li>/gi, '\n1. $1'))
        .replace(/&nbsp;|\u00a0/g, ' ')
        .replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (m, t, a, x) => wrap(x, '**'))
        .replace(/<(em|i)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (m, t, a, x) => wrap(x, '*'))
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, l, x) => `\n${'#'.repeat(+l)} ${x}`)
        .replace(/<li[^>]*data-list="ordered"[^>]*>([\s\S]*?)<\/li>/gi, '\n1. $1')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<(p|div)(\s[^>]*)?>(?=(\s|<(ul|ol)[^>]*>)*\n(-|1\.|#+) )/gi, '')   // a list or heading wrapped in a line's <div>: no extra empty line
        .replace(/<(p|div|blockquote|pre)(\s[^>]*)?>/gi, '\n')   // a browser's editor puts each new line in its own <div>
        .replace(/<\/(p|div|ol|ul|blockquote|pre)>/gi, '')
        .replace(/<[^>]+>/g, '');
    return unent(h).split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The editor shows a note formatted (Miinthe 2026-10-18: "bold and list ect doesn't get rendered" — the marks showed as
 * typed). Notes stay stored as text with marks; this turns them into the editor's HTML, notebookToText turns the
 * edited HTML back.
 */
export function noteToHtml(md) {
    const e = x => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const inline = x => e(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
    const out = [];
    let list = null;
    const end = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } };
    for (const line of str(md).split('\n')) {
        const ul = /^\s*[-*•]\s+(.*)$/.exec(line), ol = /^\s*\d+\.\s+(.*)$/.exec(line), h = /^\s*(?:(#{1,6}))\s+(.*)$/.exec(line);
        const tag = ul ? 'ul' : ol ? 'ol' : null;
        if (tag) { if (list?.tag !== tag) { end(); list = { tag, items: [] }; } list.items.push(inline((ul || ol)[1])); continue; }
        end();
        out.push(h ? `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>` : `<div>${line.trim() ? inline(line) : '<br>'}</div>`);
    }
    end();
    return out.join('');
}

/** The Notebook's pages ({ title, content }[]) → the import list, each preset to Everywhere and ticked. */
export function notebookPages(pages) {
    return (Array.isArray(pages) ? pages : []).map((p, i) => (p && typeof p === 'object' ? {
        t: str(p.title).trim() || `Notebook page ${i + 1}`,
        b: notebookToText(p.content),
        on: true, s: 'all',
    } : null)).filter(Boolean);
}
