/**
 * DeepLore — Custom Field Definitions
 * Parsing, validation, defaults, YAML for user-defined frontmatter fields.
 * Pure — no ST imports, Node-testable.
 */

/** Reserved frontmatter names — cannot be used as custom fields. */
export const RESERVED_FIELD_NAMES = new Set([
    'keys', 'priority', 'tags', 'requires', 'excludes', 'position', 'depth',
    'role', 'scandepth', 'excluderecursion', 'refine_keys', 'cascade_links',
    'cooldown', 'warmup', 'probability', 'summary', 'graph', 'enabled',
    'constant', 'seed', 'bootstrap', 'type', 'fileclass', 'status', 'aliases',
    // Wave 3 WI parity — selective_logic is the native refine-gate mode field.
    // Reserved so users can't shadow it via field-definitions.yaml (which would
    // route their custom value into customFields and silently overwrite the
    // native field after extractCustomFields runs).
    'selective_logic',
]);

const VALID_TYPES = new Set(['string', 'number', 'boolean']);

export const VALID_OPERATORS = new Set([
    'match_any', 'match_all', 'not_any', 'exists', 'not_exists', 'gt', 'lt', 'eq',
]);

import { runFieldCopies } from './run-fields-pure.js';

const VALID_TOLERANCES = new Set(['strict', 'moderate', 'lenient']);

// Built-in default field definitions. The run fields (character, instance) come first: runs depend on them.
/** @type {FieldDefinition[]} */
export const DEFAULT_FIELD_DEFINITIONS = [
    ...runFieldCopies(),
    {
        name: 'era',
        label: 'Era',
        type: 'string',
        multi: true,
        gating: { enabled: true, operator: 'match_any', tolerance: 'moderate' },
        values: [],
        contextKey: 'era',
    },
    {
        name: 'location',
        label: 'Location',
        type: 'string',
        multi: true,
        gating: { enabled: true, operator: 'match_any', tolerance: 'moderate' },
        values: [],
        contextKey: 'location',
    },
    {
        name: 'scene_type',
        label: 'Scene Type',
        type: 'string',
        multi: true,
        gating: { enabled: true, operator: 'match_any', tolerance: 'moderate' },
        values: [],
        contextKey: 'scene_type',
    },
    {
        name: 'character_present',
        label: 'Characters Present',
        type: 'string',
        multi: true,
        gating: { enabled: true, operator: 'match_any', tolerance: 'moderate' },
        values: [],
        contextKey: 'character_present',
    },
];

/**
 * @typedef {object} FieldDefinition
 * @property {string} name - Frontmatter field name (snake_case, must not collide with reserved names)
 * @property {string} label - Human-readable label for UI display
 * @property {'string'|'number'|'boolean'} type - Data type
 * @property {boolean} multi - Whether this field holds an array of values
 * @property {{ enabled: boolean, operator: string, tolerance: string }} gating - Gating configuration
 * @property {string[]} values - Optional allowed values (empty = freeform)
 * @property {string} contextKey - Key in chat_metadata.deeplore_context
 */

/**
 * Validate a field name against reserved names.
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateFieldName(name) {
    if (!name || typeof name !== 'string') {
        return { valid: false, reason: 'Field name is required' };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return { valid: false, reason: 'Field name is required' };
    }
    if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
        return { valid: false, reason: 'Field name must be lowercase alphanumeric with underscores, starting with a letter' };
    }
    if (RESERVED_FIELD_NAMES.has(trimmed.toLowerCase())) {
        return { valid: false, reason: `"${trimmed}" is a reserved field name` };
    }
    return { valid: true };
}

/**
 * Validate a single field definition. Returns a normalized copy or null.
 * @param {object} raw - From YAML or UI
 * @returns {{ field: FieldDefinition|null, errors: string[] }}
 */
export function validateFieldDefinition(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
        return { field: null, errors: ['Field definition must be an object'] };
    }

    const nameResult = validateFieldName(raw.name);
    if (!nameResult.valid) {
        errors.push(nameResult.reason);
    }

    const label = (typeof raw.label === 'string' && raw.label.trim()) ? raw.label.trim() : (raw.name || '');

    const type = VALID_TYPES.has(raw.type) ? raw.type : 'string';
    if (raw.type && !VALID_TYPES.has(raw.type)) {
        errors.push(`Unknown type "${raw.type}", defaulting to "string"`);
    }

    const multi = raw.multi === true;

    const rawGating = raw.gating || {};
    if (rawGating.enabled !== undefined && typeof rawGating.enabled !== 'boolean') {
        errors.push(`gating.enabled must be true or false (got ${JSON.stringify(rawGating.enabled)}); defaulting to enabled. To disable gating use "enabled: false".`);
    }
    const gating = {
        enabled: rawGating.enabled !== false,
        operator: VALID_OPERATORS.has(rawGating.operator) ? rawGating.operator : 'match_any',
        tolerance: VALID_TOLERANCES.has(rawGating.tolerance) ? rawGating.tolerance : 'moderate',
    };

    const values = Array.isArray(raw.values) ? raw.values.map(v => String(v).trim()).filter(Boolean) : [];

    const contextKey = (typeof raw.contextKey === 'string' && raw.contextKey.trim()) ? raw.contextKey.trim() : (raw.name || '');

    if (errors.length > 0 && !nameResult.valid) {
        return { field: null, errors };
    }

    return {
        field: { name: raw.name.trim(), label, type, multi, gating, values, contextKey },
        errors,
    };
}

/**
 * Small YAML reader for field-definitions.yaml (no external lib). LOCAL PATCH (Miinthe, 2026-11-05): it used to read only
 * the exact layout serializeFieldDefinitions() writes ("  - name:" at two spaces, keys at four), so a file in normal
 * YAML style (`- name:` at column 0, four-space indents, `values: [a, b]`, `gating: { … }`, a bare list without
 * `fields:`) silently parsed to zero fields. Now it follows the indentation the file uses: block mappings, block
 * sequences (also "indentless" ones under a key), flow lists / maps, quotes and `#` comments. The rule builder's own
 * layout reads exactly as before.
 * @param {string} yamlText
 * @returns {{ definitions: FieldDefinition[], errors: string[] }}
 */
export function parseFieldDefinitionYaml(yamlText) {
    if (!yamlText || typeof yamlText !== 'string') {
        return { definitions: [], errors: [] };
    }
    if (yamlText.trim().length === 0) {
        return { definitions: [], errors: [] };
    }

    const errors = [];
    const definitions = [];

    // Obsidian indents with tabs by default: one leading tab = one indent level (2 spaces).
    const lines = [];
    for (const rawLine of yamlText.split(/\r?\n/)) {
        const line = rawLine.replace(/^[\t ]+/, ws => ws.replace(/\t/g, '  ')).trimEnd();
        const text = line.trim();
        if (text === '' || text.startsWith('#') || text === '---' || text === '...') continue;
        lines.push({ indent: line.length - line.trimStart().length, text });
    }

    let root;
    const pos = { i: 0, errs: [] };
    try {
        root = _yamlBlock(lines, pos);
    } catch (err) {
        errors.push(`Could not read field-definitions.yaml: ${err?.message || err}`);
        return { definitions, errors };
    }
    errors.push(...pos.errs);

    let items = null;
    if (Array.isArray(root)) items = root;
    else if (root && typeof root === 'object' && 'fields' in root) {
        if (Array.isArray(root.fields)) items = root.fields;
        else if (root.fields == null || root.fields === '') items = [];
    }
    if (!items) {
        if (lines.length) errors.push('No field definitions parsed from non-empty content — expected a "fields:" list of "- name: …" items (check the indentation).');
        return { definitions, errors };
    }

    for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const raw = { ...item };
        delete raw[_RAW];
        if (raw.gating == null || typeof raw.gating !== 'object' || Array.isArray(raw.gating)) raw.gating = {};
        if (Array.isArray(raw.values)) {
            // A value written "a: b" reads as a little mapping in YAML — keep the text as written.
            raw.values = raw.values.map(v => (v && typeof v === 'object' && v[_RAW]) ? v[_RAW] : v).filter(v => v != null && typeof v !== 'object');
        }
        for (const k of ['name', 'label', 'contextKey']) if (typeof raw[k] === 'number') raw[k] = String(raw[k]);
        const { field, errors: fieldErrors } = validateFieldDefinition(raw);
        if (field) definitions.push(field);
        errors.push(...fieldErrors);
    }

    if (definitions.length === 0 && errors.length === 0 && items.length > 0) {
        errors.push('No field definitions parsed from non-empty content — each item needs a "name:" (check the indentation).');
    }

    return { definitions, errors };
}

/** Marks a one-line `- a: b` sequence item with its text, so a value like "Inn: The Mug" can be read back as text. */
const _RAW = Symbol('yamlRaw');

/** Read the block (mapping or sequence) that starts at lines[pos.i], at that line's indentation. */
function _yamlBlock(lines, pos) {
    const ln = lines[pos.i];
    if (!ln) return null;
    if (ln.text === '-' || ln.text.startsWith('- ')) return _yamlSeq(lines, pos, ln.indent);
    return _yamlMap(lines, pos, ln.indent);
}

function _yamlSeq(lines, pos, indent) {
    const out = [];
    while (pos.i < lines.length) {
        const ln = lines[pos.i];
        if (ln.indent !== indent || !(ln.text === '-' || ln.text.startsWith('- '))) break;
        const rest = ln.text === '-' ? '' : ln.text.slice(2).trimStart();
        if (rest === '') {
            pos.i++;
            const next = lines[pos.i];
            out.push(next && next.indent > indent ? _yamlBlock(lines, pos) : null);
            continue;
        }
        if (_yamlKey(rest)) {
            // "- key: value" starts a mapping whose keys line up with "key".
            const childIndent = indent + (ln.text.length - rest.length);
            lines[pos.i] = { indent: childIndent, text: rest };
            const startI = pos.i;
            const map = _yamlMap(lines, pos, childIndent);
            if (pos.i === startI + 1 && map && typeof map === 'object') map[_RAW] = _yamlUnquote(rest);
            out.push(map);
            continue;
        }
        pos.i++;
        out.push(_yamlFlowOrText(rest));
    }
    return out;
}

function _yamlMap(lines, pos, indent) {
    const out = {};
    while (pos.i < lines.length) {
        const ln = lines[pos.i];
        if (ln.indent < indent) break;
        if (ln.indent > indent) { (pos.errs ||= []).push(`Skipped a line with unexpected indentation: "${ln.text}"`); pos.i++; continue; }
        const kv = _yamlKey(ln.text);
        if (!kv) {
            if (ln.text === '-' || ln.text.startsWith('- ')) break;   // a sequence at this level ends the mapping
            (pos.errs ||= []).push(`Skipped a line that is not "key: value": "${ln.text}"`); pos.i++; continue;
        }
        pos.i++;
        const [key, rest] = kv;
        if (rest !== '') { out[key] = _yamlScalar(rest, key); continue; }
        const next = lines[pos.i];
        if (next && next.indent > indent) out[key] = _yamlBlock(lines, pos);
        else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) out[key] = _yamlSeq(lines, pos, indent);
        else out[key] = null;
    }
    return out;
}

/** "key: rest" → [key, rest] (rest '' when the value is on the next lines), or null. */
function _yamlKey(text) {
    const m = text.match(/^("([^"]*)"|'([^']*)'|[^\s"'#\-[\]{},:][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) return null;
    const key = m[2] ?? m[3] ?? m[1];
    return [key.trim(), (m[4] || '').trim()];
}

/** A map value: free text for `label` (a "#" may be part of it), typed scalars elsewhere; flow lists / maps. */
function _yamlScalar(rest, key) {
    if (rest.startsWith('[') || rest.startsWith('{')) return _yamlFlow(_yamlStripComment(rest));
    if (key === 'label') return _yamlUnquote(rest);
    return parseYamlValue(_yamlStripComment(rest));
}

/** A sequence item: kept as text (values are text), flow lists / maps read as such. */
function _yamlFlowOrText(rest) {
    if (rest.startsWith('[') || rest.startsWith('{')) return _yamlFlow(_yamlStripComment(rest));
    return _yamlUnquote(rest);
}

function _yamlStripComment(s) {
    if (s.startsWith('"') || s.startsWith("'")) {
        const q = s[0];
        const end = s.indexOf(q, 1);
        return end > 0 ? s.slice(0, end + 1) : s;
    }
    return s.replace(/\s+#.*$/, '').trim();
}

function _yamlUnquote(s) {
    const t = s.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
    return t;
}

/** `[a, "b c"]` → ['a', 'b c'] (text); `{ enabled: true, operator: eq }` → { enabled: true, operator: 'eq' }. */
function _yamlFlow(s) {
    const t = s.trim();
    const isList = t.startsWith('[');
    const close = isList ? ']' : '}';
    if (!t.endsWith(close)) throw new Error(`unclosed ${isList ? 'list' : 'map'} "${t}"`);
    const parts = [];
    let cur = '', q = null;
    for (const ch of t.slice(1, -1)) {
        if (q) { cur += ch; if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === ',') { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    const items = parts.map(p => p.trim()).filter(p => p !== '');
    if (isList) return items.map(_yamlUnquote);
    const out = {};
    for (const p of items) {
        const i = p.indexOf(':');
        if (i < 0) continue;
        const k = _yamlUnquote(p.slice(0, i));
        out[k] = k === 'label' ? _yamlUnquote(p.slice(i + 1)) : parseYamlValue(p.slice(i + 1).trim());
    }
    return out;
}

/**
 * Parse a simple YAML scalar value.
 * @param {string} val
 * @returns {string|number|boolean}
 */
function parseYamlValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
    }
    if (val === '[]') return [];
    return val;
}

/**
 * Serialize FieldDefinitions to YAML.
 * @param {FieldDefinition[]} definitions
 * @returns {string}
 */
export function serializeFieldDefinitions(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
        return 'fields: []\n';
    }

    const lines = ['fields:'];
    for (const def of definitions) {
        lines.push(`  - name: ${def.name}`);
        lines.push(`    label: ${def.label}`);
        lines.push(`    type: ${def.type}`);
        lines.push(`    multi: ${def.multi}`);
        lines.push('    gating:');
        lines.push(`      enabled: ${def.gating.enabled}`);
        lines.push(`      operator: ${def.gating.operator}`);
        lines.push(`      tolerance: ${def.gating.tolerance}`);
        if (def.values && def.values.length > 0) {
            lines.push('    values:');
            for (const v of def.values) {
                lines.push(`      - ${v}`);
            }
        } else {
            lines.push('    values: []');
        }
        lines.push(`    contextKey: ${def.contextKey}`);
    }

    return lines.join('\n') + '\n';
}

/**
 * Evaluate a gating operator against entry and active context values.
 * @param {string} operator - One of VALID_OPERATORS
 * @param {*} entryValue - Value from entry.customFields[fieldName]
 * @param {*} activeValue - Value from chat_metadata.deeplore_context[contextKey]
 * @returns {boolean}
 */
export function evaluateOperator(operator, entryValue, activeValue) {
    const entryArr = Array.isArray(entryValue) ? entryValue : [entryValue];
    const activeArr = Array.isArray(activeValue) ? activeValue : [activeValue];

    switch (operator) {
        case 'match_any':
            return entryArr.some(v => activeArr.some(a => String(v).toLowerCase() === String(a).toLowerCase()));
        case 'match_all':
            // BUG-AUDIT-6: all ENTRY values must exist in active context.
            // entry.character_present: [Alice, Bob] only passes when BOTH are present.
            return entryArr.every(v => activeArr.some(a => String(v).toLowerCase() === String(a).toLowerCase()));
        case 'not_any':
            return !entryArr.some(v => activeArr.some(a => String(v).toLowerCase() === String(a).toLowerCase()));
        case 'exists':
            return entryValue != null && (!Array.isArray(entryValue) || entryValue.length > 0);
        case 'not_exists':
            return entryValue == null || (Array.isArray(entryValue) && entryValue.length === 0);
        case 'eq':
            // Reduce over active values ("any element matches") — String([a,b]) would compare
            // against "a,b" and match nothing for a multi-valued context.
            return activeArr.some(a => String(entryValue).toLowerCase() === String(a).toLowerCase());
        case 'gt': {
            const a = Number(entryValue);
            if (Number.isNaN(a)) return false; // BUG-L2: NaN guard
            // "any active element satisfies" — Number([3,5]) is NaN and would fail-closed.
            return activeArr.some(x => { const b = Number(x); return !Number.isNaN(b) && a > b; });
        }
        case 'lt': {
            const a = Number(entryValue);
            if (Number.isNaN(a)) return false; // BUG-L2: NaN guard
            return activeArr.some(x => { const b = Number(x); return !Number.isNaN(b) && a < b; });
        }
        default:
            return true;
    }
}

/**
 * Extract custom field values from parsed frontmatter, guided by field definitions.
 * @param {object} frontmatter - Parsed frontmatter object
 * @param {FieldDefinition[]} fieldDefinitions - Active field definitions
 * @returns {Object<string, *>} customFields object
 */
export function extractCustomFields(frontmatter, fieldDefinitions) {
    const customFields = {};
    if (!frontmatter || !fieldDefinitions) return customFields;

    const toStringArray = (v) => {
        if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
        if (typeof v === 'string' && v.trim()) return [v.trim()];
        if (typeof v === 'number' || typeof v === 'boolean') return [String(v)];
        return [];
    };

    for (const field of fieldDefinitions) {
        const raw = frontmatter[field.name];
        if (raw === undefined) continue;

        if (field.type === 'string') {
            customFields[field.name] = field.multi ? toStringArray(raw) : (typeof raw === 'string' ? raw.trim() : String(raw));
        } else if (field.type === 'number') {
            const num = typeof raw === 'number' ? raw : Number(raw);
            customFields[field.name] = Number.isNaN(num) ? null : num;
        } else if (field.type === 'boolean') {
            customFields[field.name] = raw === true || raw === 'true';
        }
    }

    return customFields;
}

/**
 * Check for duplicate field names in a definitions array.
 * @param {FieldDefinition[]} definitions
 * @returns {string[]} Array of duplicate names (empty if none)
 */
export function findDuplicateFieldNames(definitions) {
    const seen = new Set();
    const dupes = [];
    for (const def of definitions) {
        const lower = def.name.toLowerCase();
        if (seen.has(lower)) dupes.push(def.name);
        else seen.add(lower);
    }
    return dupes;
}
