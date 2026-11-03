/**
 * ✓ Fix spelling (Miinthe, 2026-11-03: "spell check or something similar" — for her own message box, as a button: the text
 * comes back corrected, she sees what changed, Keep or Undo). Pure; tested in test/spell.test.mjs. Glue: spell.js.
 *
 * Only spelling, typos, capitals, punctuation and small grammar — never her words, her style or her story. Anything the
 * story or SillyTavern reads stays exactly as it was: *actions*, "speech", {{macros}}, [OOC: …], line breaks. An answer
 * that changed too much, or lost one of those, is refused and her text stays.
 */
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const SPELL_SYSTEM = [
    'You correct the spelling of a roleplay message the user wrote. Fix ONLY: misspelled words, typos, wrong capitals (start of sentences, names, "I"), missing or doubled punctuation, and small grammar slips (a missing word, a wrong verb form).',
    'Never change the meaning, the words she chose, her style, tone or slang, the tense, the person (I / she / he), or the order of anything. Never add or remove sentences, never improve or rephrase, never translate.',
    'Keep everything else exactly: *asterisks* around actions, "quotes" around speech, line breaks and empty lines, {{macros}}, [OOC: …] brackets, names as she spelled them on purpose, emoji.',
    'If nothing needs fixing, return the text unchanged. Return ONLY the corrected message — no comments, no quotes around it, no "Here is".',
].join('\n');

export const spellUser = (text, hints = '') => `${hints ? str(hints) + '\n\n' : ''}The message:\n<<<\n${str(text)}\n>>>`;

/** The model's answer → the corrected text: fences, wrapping quotes and a leading "Here is…:" line taken off. */
export function cleanAnswer(raw, original = '') {
    let t = str(raw).replace(/^\s*```[a-z]*\n?|\n?```\s*$/gi, '').replace(/^\s*<<<\n?|\n?>>>\s*$/g, '');
    const lines = t.split('\n');
    if (lines.length > 1 && /^(here|sure|corrected|fixed)\b.*:\s*$/i.test(lines[0].trim()) && !/:\s*$/.test(str(original).split('\n')[0].trim())) t = lines.slice(1).join('\n');
    t = t.replace(/^\s*\n/, '').replace(/\s+$/, '');
    const o = str(original).trim();
    // wrapped in quotes the original didn't have
    if (/^"[\s\S]*"$/.test(t.trim()) && !/^"[\s\S]*"$/.test(o)) t = t.trim().slice(1, -1);
    return t;
}

const count = (s, re) => (str(s).match(re) || []).length;
/** Things the story or SillyTavern reads — they must survive a correction untouched. */
const KEEP = [
    [/\*/g, 'asterisks'], [/["“”]/g, 'quotes'], [/\{\{[^}]*\}\}/g, 'macros'], [/\[OOC:/gi, 'OOC brackets'], [/\n/g, 'line breaks'],
];
// the marks in order, each with how many words come before it — a correction may not move one (bug hunt 2026-11-03:
// "*she smiles* "hi"" → "*she smiles "hi"*" passed, and so did {{char}} and {{user}} swapping places)
const MARKS = /\*|["“”]|\{\{[^}]*\}\}|\[OOC:/gi;
function marksOf(s) {
    const out = []; let m; MARKS.lastIndex = 0;
    while ((m = MARKS.exec(s))) out.push({ k: m[0].toLowerCase(), at: wordsOf(s.slice(0, m.index)).length });
    return out;
}
// a no / not / never added or dropped turns the meaning around — "small slip" or not (bug hunt 2026-11-03)
const NEG = /\b(?:not|never|no|nor|none|nothing|nobody|nowhere|neither|cannot|(?:do|does|did|is|are|was|were|has|have|had|ca|wo|could|should|would|must|need|ai|might|sha)n['’]?t)\b/gi;
/** Longest message checked word by word (words × words); a longer one is refused rather than waved through. */
const MAX_CELLS = 4000000;

/** Words, for comparing (letters, digits and apostrophes; punctuation stays with the word it touches). */
export const wordsOf = s => str(s).split(/\s+/).filter(Boolean);

/**
 * What changed, word by word: [{ from, to }] — runs of changed words, in order. A small LCS (messages are short).
 */
export function wordChanges(a, b) {
    const A = wordsOf(a), B = wordsOf(b);
    if (A.length * B.length > MAX_CELLS) return null;   // too long to compare — the caller refuses
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0, from = [], to = [];
    const flush = () => { if (from.length || to.length) out.push({ from: from.join(' '), to: to.join(' ') }); from = []; to = []; };
    while (i < n || j < m) {
        if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; }
        else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) to.push(B[j++]);
        else from.push(A[i++]);
    }
    flush();
    return out;
}

/**
 * Is the correction safe to offer? { ok, why } — refused when something the story reads was lost, or when it changed
 * far more than spelling would (a rewrite, a translation, a reply instead of a correction).
 */
export function checkFix(original, fixed) {
    // the ends trimmed first: the answer comes back without her trailing line break, which is not a change
    const o = str(original).trim(), f = str(fixed).trim();
    if (!f) return { ok: false, why: 'the answer came back empty' };
    for (const [re, what] of KEEP) if (count(o, re) !== count(f, re)) return { ok: false, why: `it changed the ${what}` };
    const ow = wordsOf(o).length, fw = wordsOf(f).length;
    if (Math.abs(fw - ow) > Math.max(3, ow * 0.15)) return { ok: false, why: 'it added or dropped too many words' };
    const mo = marksOf(o), mf = marksOf(f), slack = Math.abs(fw - ow);
    if (mo.some((x, i) => x.k !== mf[i].k || Math.abs(x.at - mf[i].at) > slack)) return { ok: false, why: 'it moved the *actions*, "speech" or {{macros}}' };
    if (count(o, NEG) !== count(f, NEG)) return { ok: false, why: 'it added or dropped a “not”' };
    const changes = wordChanges(o, f);
    if (!changes) return { ok: false, why: 'the message is too long to check safely' };
    // a spelling fix changes a word a little ("smirkes" → "smirks"); a rewrite brings other words — count only those
    const rewritten = changes.reduce((n, c) => n + (looksLikeFix(c.from, c.to) ? 0 : Math.max(wordsOf(c.from).length, wordsOf(c.to).length, 1)), 0);
    if (rewritten > Math.max(3, ow * 0.2)) return { ok: false, why: 'it rewrote too much' };
    return { ok: true };
}

const bare = s => str(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** Edit distance (small strings). */
function dist(a, b) {
    if (a === b) return 0;
    const m = b.length, row = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0]; row[0] = i;
        for (let j = 1; j <= m; j++) { const t = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return row[m];
}
/** A changed run that is still the same words, spelled better (capitals, punctuation, a few letters; "your" → "you're"). */
export function looksLikeFix(from, to) {
    const a = bare(from), b = bare(to);
    if (!a || !b) return wordsOf(from).length + wordsOf(to).length <= 1;   // one word added or dropped ("a", "the") is a small slip
    return dist(a, b) <= Math.max(2, Math.ceil(Math.max(a.length, b.length) * 0.35));
}

/** For the notice: "smirkes → smirks · walkd → walks · +2 more". */
export function changesLine(list, max = 5) {
    const shown = list.slice(0, max).map(c => `${c.from || '∅'} → ${c.to || '∅'}`);
    return shown.join(' · ') + (list.length > max ? ` · +${list.length - max} more` : '');
}

// ── her words (Miinthe, 2026-11-03: "if the word is like Ashvale and I spell it Ashvalle … it also corrects it if its in
// the list") — her own list (right-click ✓ / hold on the phone, or "Keep mine" in the notice) plus the words DeepLore
// already knows (lore entry names and keywords, character and persona names). A word on the list is never changed; a
// word close to one is pointed at it, so the AI fixes it to her spelling. Only the words her message comes near are sent.

/** One clean list: trimmed, one word or short name each, no doubles (case-insensitive), the first spelling wins. */
export function cleanWords(list) {
    const seen = new Set(), out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const w = str(raw).replace(/\s+/g, ' ').trim();
        if (!w || w.length > 40 || !/\p{L}/u.test(w)) continue;
        const k = w.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); out.push(w);
    }
    return out;
}

/** A token of her message → the word in it (edge punctuation off, inner ' and - kept): `"Ashvalle,"` → `Ashvalle`. */
const core = t => str(t).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const low = s => str(s).toLowerCase();
/** How far a word may be from one of hers and still be "meant as it": 1 letter for short words, about one in four for long ones. */
const near = len => (len < 5 ? 0 : len < 8 ? 1 : Math.min(3, Math.floor(len / 4)));

/**
 * Which of her words this message comes near. { keep: [her words found as written], fix: [{ typed, word }] }.
 * Only one-word entries of hers are matched word by word; a longer name ("Thornfield Inn") counts when its words are there.
 */
export function wordHints(text, words) {
    const list = cleanWords(words);
    const singles = list.filter(w => !/\s/.test(w));
    const exact = new Map(singles.map(w => [low(w), w]));
    const toks = wordsOf(text).map(core).filter(Boolean);
    const keep = new Set(), fix = [], seenFix = new Set();
    for (const t of toks) {
        const lt = low(t);
        if (exact.has(lt)) { keep.add(exact.get(lt)); continue; }
        const max = near(lt.length);
        if (!max || !/\p{L}/u.test(lt)) continue;
        let best = null, bd = max + 1;
        for (const w of singles) {
            const lw = low(w);
            if (Math.abs(lw.length - lt.length) > max || lw[0] !== lt[0] || near(lw.length) === 0) continue;
            const d = dist(lt, lw);
            if (d < bd) { bd = d; best = w; }
        }
        if (best && !seenFix.has(lt)) { seenFix.add(lt); fix.push({ typed: t, word: best }); }
    }
    const lowText = low(text);
    for (const w of list) if (/\s/.test(w) && lowText.includes(low(w))) keep.add(w);
    return { keep: [...keep], fix };
}

/** The lines added to the request when her message comes near her words ('' when it doesn't). */
export function hintsBlock({ keep = [], fix = [] } = {}) {
    const out = [];
    if (keep.length) out.push(`Words of her story, spelled right — never change them: ${keep.join(', ')}.`);
    if (fix.length) out.push(`Words of her story she probably misspelled — if she meant them, spell them exactly like this: ${fix.map(f => `"${f.typed}" → "${f.word}"`).join(', ')}.`);
    return out.join('\n');
}

/**
 * The safety net: a word of hers that she typed exactly right and the AI changed anyway gets her spelling back.
 * Capitals and punctuation the AI fixed around it stay. → { text, kept: [words put back] }.
 */
export function keepHerWords(original, fixed, words) {
    const mine = new Set(cleanWords(words).filter(w => !/\s/.test(w)).map(low));
    const A = wordsOf(original), Bw = wordsOf(fixed);
    if (!mine.size || A.length * Bw.length > MAX_CELLS) return { text: fixed, kept: [] };
    const n = A.length, m = Bw.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === Bw[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    // walk the alignment; inside a changed run, pair the words one to one when both sides have the same count
    const swaps = new Map(), kept = [];   // index in fixed → token to use
    let i = 0, j = 0, from = [], to = [];
    const flush = () => {
        if (from.length && from.length === to.length) {
            from.forEach((a, k) => {
                const ca = core(a), cb = core(Bw[to[k]]);
                if (mine.has(low(ca)) && low(ca) !== low(cb)) { swaps.set(to[k], Bw[to[k]].replace(cb, ca)); kept.push(ca); }
            });
        }
        from = []; to = [];
    };
    while (i < n || j < m) {
        if (i < n && j < m && A[i] === Bw[j]) { flush(); i++; j++; }
        else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) to.push(j++);
        else from.push(A[i++]);
    }
    flush();
    if (!swaps.size) return { text: fixed, kept: [] };
    // put the words back in place, keeping the fixed text's spacing and line breaks
    let k = -1;
    const text = str(fixed).replace(/\S+/g, tok => { k++; return swaps.has(k) ? swaps.get(k) : tok; });
    return { text, kept };
}

/** For "Keep mine" in the notice: the words of a change worth adding to her list ("spearling*" → ["spearling"]). */
export function wordsToKeep(change) {
    return wordsOf(change?.from).map(core).filter(w => /\p{L}/u.test(w) && w.length >= 3);
}
