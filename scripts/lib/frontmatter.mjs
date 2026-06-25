/**
 * Minimal YAML front-matter parser + serializer.
 *
 * Handles the subset rubric front-matter actually uses:
 *   - top-level scalar fields (string / number / boolean)
 *   - block scalars with `|` (multi-line strings preserved verbatim)
 *   - inline arrays `[a, b, c]` and block-list arrays (`- x` lines)
 *   - inline flow-maps `{ covered: 2, gap: 0 }`
 *   - block-mapping nested objects (e.g. applies-to.include)
 *   - block-list of mappings (arrays of objects, e.g. the run manifest's
 *     `tasks:` and `blockers:`)
 *   - bare ISO timestamps and codes left as strings
 *
 * `stringifyYaml` / `stringifyFrontmatter` are the symmetric inverse: they
 * round-trip the same subset so the runner can rewrite a manifest it parsed.
 *
 * It is **not** a general YAML parser. If a feature or aspect file uses
 * something exotic, extend this parser deliberately rather than reaching for
 * a heavy dependency — the schema is intentionally narrow.
 */

import { readFile } from 'node:fs/promises';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Read a markdown file and return { data, body }. data is `{}` if no front-matter. */
export async function readFileFrontmatter(path) {
	const raw = await readFile(path, 'utf-8');
	return parseFrontmatter(raw);
}

/** Parse a markdown string into { data, body }. */
export function parseFrontmatter(raw) {
	const m = raw.match(FRONT_MATTER_RE);
	if (!m) return { data: {}, body: raw };
	const data = parseYaml(m[1]);
	return { data, body: m[2] ?? '' };
}

/** Parse the YAML subset rubric uses. Returns a plain object. */
export function parseYaml(text) {
	const lines = text.split(/\r?\n/);
	const result = {};
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
		const indent = line.match(/^\s*/)[0].length;
		if (indent !== 0) { i++; continue; } // shouldn't see deeper at root level
		const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!m) { i++; continue; }
		const key = m[1];
		const rest = m[2];
		if (rest === '|') {
			// Block scalar — collect indented lines verbatim.
			const collected = [];
			i++;
			let blockIndent = null;
			while (i < lines.length) {
				const l = lines[i];
				if (l.trim() === '') { collected.push(''); i++; continue; }
				const ind = l.match(/^\s*/)[0].length;
				if (blockIndent == null) blockIndent = ind;
				if (ind < blockIndent || ind === 0) break;
				collected.push(l.slice(blockIndent));
				i++;
			}
			result[key] = collected.join('\n').replace(/\s+$/, '');
			continue;
		}
		if (rest === '') {
			// Either a block-list or a block-mapping follows (indented lines).
			i++;
			const childLines = [];
			while (i < lines.length) {
				const l = lines[i];
				if (l.trim() === '' || l.trim().startsWith('#')) { i++; continue; }
				const ind = l.match(/^\s*/)[0].length;
				if (ind === 0) break;
				childLines.push(l);
				i++;
			}
			result[key] = parseChild(childLines);
			continue;
		}
		result[key] = parseScalar(rest);
		i++;
	}
	return result;
}

function parseChild(lines) {
	if (lines.length === 0) return null;
	// Detect block-list vs block-mapping by the first non-empty line.
	const first = lines[0];
	const trimmed = first.trim();
	if (trimmed.startsWith('- ') || trimmed === '-') {
		return parseBlockList(lines);
	}
	// Block mapping: re-indent and recurse.
	const minIndent = Math.min(...lines.map(l => l.match(/^\s*/)[0].length));
	const dedented = lines.map(l => l.slice(minIndent)).join('\n');
	return parseYaml(dedented);
}

/**
 * Parse a block list whose items may be scalars (`- SCN-HIER`) or mappings
 * (`- id: x` followed by deeper-indented `key: value` lines). Items are split
 * on the dash markers at the list's own indent.
 */
function parseBlockList(lines) {
	const dashIndent = lines[0].match(/^\s*/)[0].length;
	const items = [];
	let cur = null;
	for (const l of lines) {
		const ind = l.match(/^\s*/)[0].length;
		const isDash = ind === dashIndent && /^-(\s|$)/.test(l.trim());
		if (isDash) {
			if (cur) items.push(cur);
			// Replace the "- " marker with spaces so the first key aligns with
			// the item's continuation lines, turning it into a uniform mapping.
			cur = [l.replace(/^(\s*)-(\s)/, '$1 $2').replace(/^(\s*)-$/, '$1 ')];
		} else if (cur) {
			cur.push(l);
		}
	}
	if (cur) items.push(cur);
	return items.map(itemLines => {
		const nonEmpty = itemLines.filter(s => s.trim());
		if (nonEmpty.length === 0) return null;
		const minIndent = Math.min(...nonEmpty.map(s => s.match(/^\s*/)[0].length));
		const dedented = itemLines.map(s => s.slice(minIndent)).join('\n');
		const head = dedented.trim().split('\n')[0];
		// A mapping item starts with `key:` (or `key: value`); otherwise scalar.
		if (!/^[A-Za-z0-9_-]+:(\s|$)/.test(head)) return parseScalar(dedented.trim());
		return parseYaml(dedented);
	});
}

function parseScalar(raw) {
	const s = raw.trim();
	if (s === '') return '';
	if (s === 'null' || s === '~') return null;
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (/^-?\d+$/.test(s)) return parseInt(s, 10);
	if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
	if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
	}
	if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
		return s.slice(1, -1);
	}
	if (s.startsWith('[') && s.endsWith(']')) {
		const inner = s.slice(1, -1).trim();
		if (inner === '') return [];
		return splitTopLevel(inner).map(x => parseScalar(x));
	}
	if (s.startsWith('{') && s.endsWith('}')) {
		const inner = s.slice(1, -1).trim();
		if (inner === '') return {};
		const obj = {};
		for (const pair of splitTopLevel(inner)) {
			const idx = pair.indexOf(':');
			if (idx === -1) continue;
			obj[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1));
		}
		return obj;
	}
	return s;
}

/** Split on top-level commas, respecting [] and {} nesting. */
function splitTopLevel(inner) {
	const parts = [];
	let depth = 0, start = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') depth--;
		else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
	}
	parts.push(inner.slice(start));
	return parts.map(p => p.trim()).filter(p => p !== '');
}

// ── Serializer (inverse of the parser, for the same subset) ──────────────────

/** Serialize `data` as front-matter and prepend it to `body`. */
export function stringifyFrontmatter(data, body = '') {
	return `---\n${stringifyYaml(data)}---\n${body}`;
}

/** Serialize a plain object to the YAML subset the parser accepts. */
export function stringifyYaml(obj, indent = 0) {
	const pad = '  '.repeat(indent);
	let out = '';
	for (const [key, val] of Object.entries(obj)) {
		if (val === undefined) continue;
		out += emitMapEntry(pad, key, val, indent);
	}
	return out;
}

function emitMapEntry(pad, key, val, indent) {
	if (Array.isArray(val)) {
		if (val.length === 0) return `${pad}${key}: []\n`;
		if (val.every(isScalar)) return `${pad}${key}: [${val.map(formatScalar).join(', ')}]\n`;
		let out = `${pad}${key}:\n`;
		for (const item of val) out += emitListItem(pad + '  ', item, indent + 1);
		return out;
	}
	if (isFlowObject(val)) return `${pad}${key}: ${formatFlowObject(val)}\n`;
	if (val !== null && typeof val === 'object') return `${pad}${key}:\n${stringifyYaml(val, indent + 1)}`;
	if (isBlockScalar(val)) return emitBlockScalar(pad, key, val);
	return `${pad}${key}: ${formatScalar(val)}\n`;
}

function emitListItem(pad, item, indent) {
	if (isScalar(item)) return `${pad}- ${formatScalar(item)}\n`;
	const entries = Object.entries(item).filter(([, v]) => v !== undefined);
	if (entries.length === 0) return `${pad}- {}\n`;
	let out = '';
	entries.forEach(([k, v], idx) => {
		const body = emitMapEntry(pad + '  ', k, v, indent + 1);
		// The first entry carries the "- " dash; later entries align under it.
		out += idx === 0 ? body.replace(pad + '  ', pad + '- ') : body;
	});
	return out;
}

function isScalar(v) {
	return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** A shallow object (all-scalar values) → rendered inline as `{ k: v, ... }`. */
function isFlowObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
		&& Object.values(v).every(isScalar) && !Object.values(v).some(isBlockScalar);
}

function formatFlowObject(obj) {
	const inner = Object.entries(obj)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}: ${formatScalar(v)}`)
		.join(', ');
	return `{ ${inner} }`;
}

/** Multi-line strings serialize as block scalars (`key: |`). */
function isBlockScalar(v) {
	return typeof v === 'string' && v.includes('\n');
}

function emitBlockScalar(pad, key, val) {
	const childPad = pad + '  ';
	const lines = val.split('\n').map(l => (l === '' ? '' : childPad + l));
	return `${pad}${key}: |\n${lines.join('\n')}\n`;
}

function formatScalar(v) {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'number') return String(v);
	const s = String(v);
	// Quote strings that would otherwise parse as a different type or break
	// flow/scalar boundaries (leading markers, brackets, colons, commas, #).
	if (s === '' || /^(null|true|false|~)$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)
		|| /[:#,\[\]{}]/.test(s) || /^[\s>|*&!%@`'"-]/.test(s) || /\s$/.test(s)) {
		return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return s;
}
