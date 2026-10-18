/**
 * LOCAL PATCH (Miinthe, 2026-10-03) — word-for-word quote checking.
 *
 * Ported from Merged World Tracker 1.7.10 (knowledge/growth.js: normalizeForMatch,
 * quoteMatchesMessage, findQuoteMatch) — MIT License, Copyright (c) 2026 brasen56.
 * Pure; tested in test/autotrack.test.mjs (MWT itself shipped it untested).
 *
 * Used by automatic story trackers: a tracker only moves when the helper quotes a
 * line that REALLY appears in the recent messages. A faithfully copied quote matches
 * across trivial reformatting (case, punctuation, *emphasis*, wrapping quotes); a
 * quote split by a dialogue tag ("…," he said, "…") still matches by word pairs; a
 * paraphrase — what a model drifts to — does not.
 */

/** Lowercase, drop punctuation and markdown, collapse whitespace. */
export function normalizeForMatch(s) {
    return String(s || '')
        .toLowerCase()
        // Apostrophes join, never split: "I'm" and "Im" must normalise alike
        // (MWT turned "I'm" into "i m", so a quote differing only by an apostrophe
        // failed both the exact and the word-pair check).
        .replace(/['’‘`]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Strip blocks the model never wrote as story: think tags, HTML, details blocks. */
export function stripNonNarrative(text) {
    return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/<details[\s\S]*?<\/details>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
}

/** Fraction of the quote's word pairs that must appear for a non-contiguous match. */
export const BIGRAM_MATCH_THRESHOLD = 0.7;

function bigrams(tokens) {
    const out = [];
    for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
    return out;
}

function matchesText(needle, needleBigrams, text) {
    const haystack = normalizeForMatch(stripNonNarrative(text));
    if (!haystack) return false;
    if (haystack.includes(needle)) return true;            // exact contiguous span
    if (!needleBigrams.length) return false;
    const haySet = new Set(bigrams(haystack.split(' ')));
    let hit = 0;
    for (const bg of needleBigrams) if (haySet.has(bg)) hit++;
    return hit / needleBigrams.length >= BIGRAM_MATCH_THRESHOLD;
}

/**
 * Find which of `messages` contains `quote`.
 *
 * @param {string} quote
 * @param {Array<{mes: string}>} messages - the messages the helper was shown
 * @returns {number} index into `messages`, or -1 if the quote cannot be verified
 *   (including quotes too short to be a meaningful receipt: < 8 characters or < 3 words)
 */
export function findQuoteMatch(quote, messages) {
    const needle = normalizeForMatch(quote);
    if (needle.length < 8) return -1;
    const tokens = needle.split(' ');
    if (tokens.length < 3) return -1;
    const needleBigrams = bigrams(tokens);
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {             // newest first
        if (list[i]?.mes && matchesText(needle, needleBigrams, list[i].mes)) return i;
    }
    return -1;
}
