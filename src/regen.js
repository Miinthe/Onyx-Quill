/** Notices SillyTavern's Regenerate, so the delete it does right after keeps hand and world changes (regen-pure.js). */
import { eventSource, event_types } from '../../../../../script.js';
import { isRegenDelete, keptOnRegen } from './regen-pure.js';

let regenAt = 0;
/** Wire once (index.js init, before the MESSAGE_DELETED handlers run). */
export function initRegenWatch() {
    try { eventSource.on(event_types.GENERATION_STARTED, (type, _o, dryRun) => { if (type === 'regenerate' && !dryRun) regenAt = Date.now(); }); } catch { /* noop */ }
}
/**
 * For a delete happening now: what to keep (null = a real delete, undo everything after it). Not used up — every
 * listener of that one delete (DeepLore's rewind, the world's) must see the same answer; the window is a few seconds.
 */
export function keepForDelete() { return isRegenDelete(regenAt) ? keptOnRegen : null; }
export const regenDeleteNow = () => isRegenDelete(regenAt);
