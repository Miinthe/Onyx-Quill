/**
 * LOCAL PATCH (Miinthe, 2026-11-03) — ✓ Fix spelling on the DeepLore bar, for her story message box: one small call with
 * Mero's AI (like ✎ Rewrite), the corrected text goes into the box, a notice says what changed with Undo. A correction
 * that changed too much or lost something the story reads (*actions*, {{macros}}, [OOC], line breaks) is refused and
 * her text stays. Rules: spell-pure.js (tested).
 */
import { getContext } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { resolveConnectionConfig, getSettings } from '../settings.js';
import { callAI } from './ai/ai.js';
import * as K from './kit/kit.js';
import { getWriterVisibleEntries } from './state.js';
import { SPELL_SYSTEM, spellUser, cleanAnswer, checkFix, wordChanges, changesLine, cleanWords, wordHints, hintsBlock, keepHerWords, wordsToKeep } from './spell-pure.js';

let busy = false;
export const spellBusy = () => busy;
const box = () => document.getElementById('send_textarea');
const setBox = (el, text) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };

// ── her words (Miinthe, 2026-11-03) ──
/** Her own list (Settings key spellWords). */
export const myWords = () => cleanWords(getSettings().spellWords);
function saveMyWords(list) { getSettings().spellWords = cleanWords(list); saveSettingsDebounced(); }
/** Words DeepLore already knows: lore entry names and keywords, character names, her persona's name. */
function knownWords() {
    const out = [];
    try { for (const e of getWriterVisibleEntries()) { if (e?.title) out.push(e.title); for (const k of e?.keys || []) out.push(k); } } catch { /* index not built yet */ }
    try { const c = getContext(); if (c?.name1) out.push(c.name1); if (c?.name2) out.push(c.name2); for (const ch of c?.characters || []) if (ch?.name) out.push(ch.name); } catch { /* noop */ }
    // keywords can be phrases or patterns — only plain words and short names help here
    return cleanWords(out.map(w => String(w)).filter(w => !/[\\/^$*+?()[\]{}|]/.test(w) && w.split(/\s+/).length <= 3));
}
const allWords = () => cleanWords([...myWords(), ...knownWords()]);

/** Fix the spelling in the message box. `onBusy(on)`: the bar's button shows it is working. */
export async function fixSpelling(onBusy = () => {}) {
    const el = box();
    const text = el?.value ?? '';
    if (!text.trim()) { K.notify({ title: 'Fix spelling', text: 'Type something first.' }); return; }
    if (busy) return;
    const conn = resolveConnectionConfig('mero');
    if (!conn.profileId) { K.notify({ title: 'Fix spelling', text: 'It uses Mero’s AI, and none is picked yet: Settings › AI & connections › Mero.', tone: 'wait' }); return; }
    busy = true; onBusy(true);
    try {
        const words = allWords();
        const r = await callAI(SPELL_SYSTEM, spellUser(text, hintsBlock(wordHints(text, words))), {
            ...conn, caller: 'mero', skipThrottle: true, disableThinkingOnClaude: true, noReasoning: true, temperature: 0,
            maxTokens: Math.min(4000, Math.max(300, Math.ceil(text.length / 2))),
        });
        // the safety net: a word of hers she typed right and the AI "fixed" anyway gets her spelling back
        const { text: fixed, kept } = keepHerWords(text, cleanAnswer(r?.text, text), words);
        if (kept.length) console.debug('[Onyx Quill] Fix spelling kept her words:', kept);
        if (el.value !== text) { K.notify({ title: 'Fix spelling', text: 'You typed on meanwhile, so nothing was changed. Press it again.', tone: 'wait' }); return; }
        const ok = checkFix(text, fixed);
        if (!ok.ok) { K.notify({ title: 'Fix spelling', text: `Your text stays as it was: the correction ${ok.why}.`, tone: 'wait' }); return; }
        const changes = wordChanges(text, fixed) || [];
        if (fixed.trim() === text.trim()) { K.notify({ title: 'Fix spelling', text: 'No typos found.', tone: 'good' }); return; }
        setBox(el, fixed);
        K.notify({
            title: changes.length ? `Fixed ${changes.length} thing${changes.length === 1 ? '' : 's'}` : 'Fixed',
            text: changes.length ? changesLine(changes) : 'spacing and punctuation',
            tone: 'good', timeout: 20000,
            // "Keep mine" (Miinthe, 2026-11-03): her spelling back for one change, and the word goes on her list
            actions: changes.some(c => wordsToKeep(c).length) ? [{ label: 'Keep mine…', onClick: btn => keepMine(btn, text, fixed, changes) }] : [],
            // only while the box still holds the fix — she may have typed on, or sent it and started the next one
            undo: () => {
                const b = box();
                if (!b || b.value !== fixed) { K.notify({ title: 'Fix spelling', text: 'Not undone: the message box changed since — your new words stay.', tone: 'wait' }); return; }
                setBox(b, text); K.notify({ text: 'Back to what you typed.' });
            },
        });
    } catch (err) {
        K.notify({ title: 'Fix spelling', text: `It didn’t work: ${err?.message || err}`, tone: 'bad' });
    } finally { busy = false; onBusy(false); }
}

/** "Keep mine…": pick a change → her word goes back into the box (while it still holds the fix) and onto her list. */
function keepMine(btn, text, fixed, changes) {
    const items = changes.filter(c => wordsToKeep(c).length).slice(0, 8).map(c => ({
        label: wordsToKeep(c).join(' '), sub: `not “${String(c.to || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || '∅'}”`, icon: 'check',
        onClick: () => {
            const add = wordsToKeep(c);
            saveMyWords([...myWords(), ...add]);
            const b = box();
            if (b && b.value === fixed) {
                const back = keepHerWords(text, fixed, add).text;
                if (back !== fixed) { setBox(b, back); fixed = back; }
            }
            K.notify({ title: 'Your words', text: `Added: ${add.join(', ')}`, tone: 'good' });
        },
    }));
    K.openMenu(btn, [{ heading: 'Keep my spelling of…' }, ...items]);
}

/** The list window (right-click ✓, or hold it on the phone): her words, add and remove. */
export function openMyWords() {
    const body = document.createElement('div');
    body.className = 'dle-spellwords';
    const help = document.createElement('p'); help.className = 'dk-hint';
    help.textContent = 'Never changed. A near miss gets fixed to them: Ashvalle → Ashvale. Lore and character names count too.';
    const row = document.createElement('div'); row.className = 'dle-spellwords-add';
    const input = document.createElement('input'); input.className = 'dk-field'; input.placeholder = 'Add a word…'; input.setAttribute('aria-label', 'Add a word'); input.spellcheck = false;
    const chips = document.createElement('div'); chips.className = 'dk-chips dle-spellwords-list';
    const draw = () => {
        const list = myWords();
        chips.replaceChildren(...(list.length ? list.map(w => K.chip({ label: w, onRemove: () => { saveMyWords(myWords().filter(x => x !== w)); draw(); } }))
            : [Object.assign(document.createElement('span'), { className: 'dk-hint', textContent: 'No words of your own yet.' })]));
    };
    const add = () => {
        const v = input.value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
        if (!v.length) return;
        saveMyWords([...myWords(), ...v]); input.value = ''; draw(); input.focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    row.append(input, K.button({ label: 'Add', onClick: add }));
    body.append(help, row, chips);
    draw();
    K.openWindow({ title: 'Your words', body, size: 'small' });
    input.focus();
}
