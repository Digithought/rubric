/**
 * Minimal YAML front-matter parser.
 *
 * Handles the subset rubric front-matter actually uses:
 *   - top-level scalar fields (string / number / boolean)
 *   - block scalars with `|` (multi-line strings preserved verbatim)
 *   - inline arrays `[a, b, c]` and block-list arrays (`- x` lines)
 *   - block-mapping nested objects (one level deep, e.g. applies-to.include)
 *   - bare ISO timestamps and codes left as strings
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
		return lines
			.map(l => l.replace(/^\s*-\s?/, ''))
			.filter(s => s !== '')
			.map(parseScalar);
	}
	// Block mapping: re-indent and recurse.
	const minIndent = Math.min(...lines.map(l => l.match(/^\s*/)[0].length));
	const dedented = lines.map(l => l.slice(minIndent)).join('\n');
	return parseYaml(dedented);
}

function parseScalar(raw) {
	const s = raw.trim();
	if (s === '') return '';
	if (s === 'null' || s === '~') return null;
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (/^-?\d+$/.test(s)) return parseInt(s, 10);
	if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	if (s.startsWith('[') && s.endsWith(']')) {
		const inner = s.slice(1, -1).trim();
		if (inner === '') return [];
		// Naive split — fine for the codes we use (no nested brackets, no commas in strings).
		return inner.split(',').map(x => parseScalar(x));
	}
	return s;
}
