/**
 * Regenerate keeps what you and the world did (Miinthe, 2026-10-19 — "I tried to move the relationship from strangers to
 * neighbors and regen, but it went back to strangers and deleted all my messages with the cast. Major bug").
 *
 * SillyTavern's Regenerate first announces the generation (GENERATION_STARTED 'regenerate'), then DELETES the last reply
 * and writes a new one. Everything DeepLore logs is tagged with the newest message, so that delete used to undo it all —
 * a move made by hand after reading the reply, the world's messages and what people learned from them. A regenerate's
 * delete now keeps those (made by hand, or by the world); what the story helper read from the old reply still goes,
 * since that reply is gone. A real delete (going back in the story) still undoes everything after it.
 */
export const REGEN_WINDOW_MS = 5000;
/** A logged change that a regenerate keeps: made by hand ('hand' / 'you') or by the world layer ('world'). */
export const keptOnRegen = e => !!e && ['hand', 'you', 'world'].includes(e.who);
/** Is this delete a regenerate's? (it comes right after the regenerate was announced) */
export const isRegenDelete = (regenAt, now = Date.now()) => regenAt > 0 && now - regenAt < REGEN_WINDOW_MS;
