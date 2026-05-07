import type { Plugin } from 'vite';
import { readdir, readFile, access, stat } from 'node:fs/promises';
import { join, basename, relative, sep } from 'node:path';
import { constants } from 'node:fs';
import type { ServerResponse } from 'node:http';

interface ApiOptions {
	projectRoot: string;
	featuresDir: string;
	aspectsDir: string;
	runsDir: string;
	rubricDir: string;
}

// ---------- HTTP helpers ----------

function json(res: ServerResponse, data: unknown, status = 200) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

async function pathExists(path: string): Promise<boolean> {
	try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function isDir(path: string): Promise<boolean> {
	try { return (await stat(path)).isDirectory(); } catch { return false; }
}

// ---------- YAML front-matter ----------

// Extract `---\n...\n---\n<body>` from a markdown file.
// Returns parsed front-matter as a structured object plus the remaining body.
export interface Frontmatter {
	[key: string]: string | string[] | Frontmatter | undefined;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
	// Normalize: strip BOM, convert CRLF to LF.
	const trimmed = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	if (!trimmed.startsWith('---')) return { meta: {}, body: trimmed };
	const endIdx = trimmed.indexOf('\n---', 3);
	if (endIdx === -1) return { meta: {}, body: trimmed };
	const header = trimmed.slice(3, endIdx).replace(/^\n/, '');
	let body = trimmed.slice(endIdx + 4);
	if (body.startsWith('\n')) body = body.slice(1);
	return { meta: parseYamlBlock(header), body };
}

// Minimal YAML parser supporting:
// - key: value (scalar)
// - key: |  followed by indented multi-line block scalar
// - key: followed by `  - item` list lines
// - inline flow lists: key: [a, b, c]
// - nested mappings via 2-space indentation (one level deep is enough for our schemas)
function parseYamlBlock(text: string): Frontmatter {
	const lines = text.split('\n');
	const result: Frontmatter = {};
	let i = 0;

	function readBlockScalar(baseIndent: number): string {
		const collected: string[] = [];
		while (i < lines.length) {
			const line = lines[i];
			if (line.trim() === '') { collected.push(''); i++; continue; }
			const indent = line.search(/\S|$/);
			if (indent <= baseIndent) break;
			collected.push(line.slice(baseIndent + 2));
			i++;
		}
		// Trim trailing blank lines, collapse leading/trailing whitespace
		while (collected.length && collected[collected.length - 1] === '') collected.pop();
		return collected.join('\n').trim();
	}

	function readList(baseIndent: number): string[] {
		const items: string[] = [];
		while (i < lines.length) {
			const line = lines[i];
			if (line.trim() === '') { i++; continue; }
			const indent = line.search(/\S|$/);
			if (indent <= baseIndent) break;
			const m = line.slice(indent).match(/^-\s*(.*)$/);
			if (!m) break;
			items.push(stripQuotes(m[1].trim()));
			i++;
		}
		return items;
	}

	function readNestedMap(baseIndent: number): Frontmatter {
		const sub: Frontmatter = {};
		while (i < lines.length) {
			const line = lines[i];
			if (line.trim() === '') { i++; continue; }
			const indent = line.search(/\S|$/);
			if (indent <= baseIndent) break;
			const m = line.slice(indent).match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
			if (!m) break;
			const key = m[1];
			const rawVal = m[2];
			i++;
			if (rawVal === '') {
				// Could be list or nested map; peek next line's indent
				if (i < lines.length) {
					const next = lines[i];
					const nextIndent = next.search(/\S|$/);
					if (nextIndent > indent && next.slice(nextIndent).startsWith('- ')) {
						sub[key] = readList(indent);
						continue;
					}
					if (nextIndent > indent) {
						sub[key] = readNestedMap(indent);
						continue;
					}
				}
				sub[key] = '';
			} else {
				sub[key] = parseScalar(rawVal);
			}
		}
		return sub;
	}

	function stripQuotes(s: string): string {
		if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
			return s.slice(1, -1);
		}
		return s;
	}

	function parseScalar(raw: string): string | string[] {
		const v = raw.trim();
		// inline flow list: [a, b, c]
		if (v.startsWith('[') && v.endsWith(']')) {
			const inner = v.slice(1, -1).trim();
			if (inner === '') return [];
			return inner.split(',').map(s => stripQuotes(s.trim())).filter(s => s.length > 0);
		}
		return stripQuotes(v);
	}

	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
		const indent = line.search(/\S|$/);
		if (indent !== 0) { i++; continue; } // skip stray
		const m = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
		if (!m) { i++; continue; }
		const key = m[1];
		const rawVal = m[2];
		i++;
		if (rawVal === '|' || rawVal === '|-' || rawVal === '>') {
			result[key] = readBlockScalar(0);
			continue;
		}
		if (rawVal === '') {
			// list or nested map
			if (i < lines.length) {
				const next = lines[i];
				const nextIndent = next.search(/\S|$/);
				if (nextIndent > 0 && next.slice(nextIndent).startsWith('- ')) {
					result[key] = readList(0);
					continue;
				}
				if (nextIndent > 0) {
					result[key] = readNestedMap(0);
					continue;
				}
			}
			result[key] = '';
		} else {
			result[key] = parseScalar(rawVal);
		}
	}

	return result;
}

// ---------- Feature inventory ----------

// A feature filename has the form `<CODE> - <Name>.md`. A directory has the same
// shape minus the .md extension and may contain children. The full hyphenated
// code is implied by the path (directory codes joined with `-`).
export interface FeatureNode {
	code: string;            // full code, e.g. "SCN-TRN"
	leafCode: string;        // just the segment, e.g. "TRN"
	name: string;            // human-readable name from filename
	path: string;            // identifier used in URLs (relative to features/, slash-separated)
	hasFile: boolean;        // whether a .md file exists for this node (vs dir-only)
	children: FeatureNode[];
}

function parseFeatureFilename(name: string): { code: string; name: string } | null {
	// strip trailing .md
	const stem = name.endsWith('.md') ? name.slice(0, -3) : name;
	const m = stem.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
	if (!m) return null;
	return { code: m[1].toUpperCase(), name: m[2].trim() };
}

async function buildFeatureTree(featuresDir: string): Promise<FeatureNode[]> {
	if (!await isDir(featuresDir)) return [];
	return walkFeatureDir(featuresDir, featuresDir, '');
}

async function walkFeatureDir(dir: string, root: string, parentCode: string): Promise<FeatureNode[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	// Group: collect dirs and md files, keyed by leaf code so we can merge a dir+md pair.
	const byCode = new Map<string, { dirEntry?: string; fileEntry?: string; name: string }>();

	for (const e of entries) {
		if (e.name.startsWith('.')) continue;
		if (e.name === 'README.md') continue;
		if (e.isDirectory()) {
			const parsed = parseFeatureFilename(e.name);
			if (!parsed) continue;
			const slot = byCode.get(parsed.code) ?? { name: parsed.name };
			slot.dirEntry = e.name;
			slot.name = parsed.name;
			byCode.set(parsed.code, slot);
		} else if (e.isFile() && e.name.endsWith('.md')) {
			const parsed = parseFeatureFilename(e.name);
			if (!parsed) continue;
			const slot = byCode.get(parsed.code) ?? { name: parsed.name };
			slot.fileEntry = e.name;
			slot.name = parsed.name;
			byCode.set(parsed.code, slot);
		}
	}

	const nodes: FeatureNode[] = [];
	for (const [leafCode, slot] of byCode) {
		const code = parentCode ? `${parentCode}-${leafCode}` : leafCode;
		const subdir = slot.dirEntry ? join(dir, slot.dirEntry) : null;
		// path is filesystem-relative slash-separated, used as URL key.
		// Use the .md filename if present, else the dir name (to identify which file represents this node).
		const repName = slot.fileEntry ?? slot.dirEntry!;
		const relPath = relative(root, join(dir, repName)).split(sep).join('/');
		const children = subdir ? await walkFeatureDir(subdir, root, code) : [];
		nodes.push({
			code,
			leafCode,
			name: slot.name,
			path: relPath,
			hasFile: Boolean(slot.fileEntry),
			children,
		});
	}

	nodes.sort((a, b) => a.code.localeCompare(b.code));
	return nodes;
}

// Resolve a feature path identifier (the `path` field on FeatureNode) to a real
// .md file under featuresDir. Validates that the resolved path stays within
// featuresDir to prevent traversal.
function resolveFeatureFile(featuresDir: string, featurePath: string): string | null {
	// featurePath comes in as slash-separated
	const safe = featurePath.replace(/\\/g, '/').replace(/^\/+/, '');
	if (safe.includes('..')) return null;
	const abs = join(featuresDir, safe);
	if (!abs.startsWith(featuresDir)) return null;
	return abs;
}

function flattenFeatures(tree: FeatureNode[], out: FeatureNode[] = []): FeatureNode[] {
	for (const n of tree) {
		out.push(n);
		flattenFeatures(n.children, out);
	}
	return out;
}

// ---------- Aspects ----------

export interface AspectSummary {
	name: string;            // folder name = aspect name
	status?: string;
	level?: string;
	batch?: number;
	cadence?: string[];
	extends?: string;        // resolved (defaults to name)
	hasProjectPrompt: boolean;
	hasDefaultPrompt: boolean;
	ticketSystem?: string;
	ticketStage?: string;
	lastRun?: string | null; // run filename (newest mentioning this aspect), or null
}

async function listAspects(opts: ApiOptions): Promise<AspectSummary[]> {
	if (!await isDir(opts.aspectsDir)) return [];
	const entries = await readdir(opts.aspectsDir, { withFileTypes: true });
	const aspects: AspectSummary[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		if (e.name.startsWith('.')) continue;
		const aspectMdPath = join(opts.aspectsDir, e.name, 'aspect.md');
		if (!await pathExists(aspectMdPath)) continue;
		const raw = await readFile(aspectMdPath, 'utf-8');
		const { meta } = parseFrontmatter(raw);
		const extendsName = (typeof meta.extends === 'string' && meta.extends) ? meta.extends : e.name;
		const projectPrompt = join(opts.aspectsDir, e.name, 'prompt.md');
		const defaultPrompt = join(opts.rubricDir, 'defaults', 'aspects', extendsName, 'prompt.md');
		const cadence = Array.isArray(meta.cadence)
			? meta.cadence
			: typeof meta.cadence === 'string' && meta.cadence
				? [meta.cadence]
				: [];
		const batchVal = typeof meta.batch === 'string' ? parseInt(meta.batch, 10) : undefined;
		aspects.push({
			name: e.name,
			status: typeof meta.status === 'string' ? meta.status : undefined,
			level: typeof meta.level === 'string' ? meta.level : undefined,
			batch: Number.isFinite(batchVal) ? batchVal : undefined,
			cadence,
			extends: extendsName,
			hasProjectPrompt: await pathExists(projectPrompt),
			hasDefaultPrompt: await pathExists(defaultPrompt),
			ticketSystem: typeof meta['ticket-system'] === 'string' ? meta['ticket-system'] as string : undefined,
			ticketStage: typeof meta['ticket-stage'] === 'string' ? meta['ticket-stage'] as string : undefined,
		});
	}
	aspects.sort((a, b) => a.name.localeCompare(b.name));
	return aspects;
}

async function getAspectDetail(opts: ApiOptions, name: string) {
	const aspectMdPath = join(opts.aspectsDir, name, 'aspect.md');
	if (!await pathExists(aspectMdPath)) return null;
	const raw = await readFile(aspectMdPath, 'utf-8');
	const { meta, body } = parseFrontmatter(raw);
	const extendsName = (typeof meta.extends === 'string' && meta.extends) ? meta.extends : name;
	const projectPrompt = join(opts.aspectsDir, name, 'prompt.md');
	const defaultPrompt = join(opts.rubricDir, 'defaults', 'aspects', extendsName, 'prompt.md');
	let promptSource: 'project' | 'default' | 'missing' = 'missing';
	let promptContent = '';
	if (await pathExists(projectPrompt)) {
		promptSource = 'project';
		promptContent = await readFile(projectPrompt, 'utf-8');
	} else if (await pathExists(defaultPrompt)) {
		promptSource = 'default';
		promptContent = await readFile(defaultPrompt, 'utf-8');
	}
	const projectTicketTpl = join(opts.aspectsDir, name, 'ticket-template.md');
	const defaultTicketTpl = join(opts.rubricDir, 'defaults', 'aspects', extendsName, 'ticket-template.md');
	let ticketTplSource: 'project' | 'default' | 'missing' = 'missing';
	let ticketTplContent = '';
	if (await pathExists(projectTicketTpl)) {
		ticketTplSource = 'project';
		ticketTplContent = await readFile(projectTicketTpl, 'utf-8');
	} else if (await pathExists(defaultTicketTpl)) {
		ticketTplSource = 'default';
		ticketTplContent = await readFile(defaultTicketTpl, 'utf-8');
	}
	return {
		name,
		extends: extendsName,
		meta,
		body,
		raw,
		prompt: { source: promptSource, content: promptContent },
		ticketTemplate: { source: ticketTplSource, content: ticketTplContent },
	};
}

async function listDefaultAspects(opts: ApiOptions): Promise<string[]> {
	const dir = join(opts.rubricDir, 'defaults', 'aspects');
	if (!await isDir(dir)) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	const names: string[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		if (await pathExists(join(dir, e.name, 'aspect.md'))) names.push(e.name);
	}
	names.sort();
	return names;
}

// ---------- Runs ----------

export interface RunSummary {
	filename: string;
	aspect: string;
	started?: string;
	finished?: string;
	batch: string[];
	runner?: string;
	tally: { covered: number; gap: number; partial: number; na: number; other: number };
}

// Parse a run log body to extract per-feature verdicts.
// Schema is loose: looking for lines under "## Verdicts" of form
// `- <CODE> — <verdict>; ...` (em dash or hyphen). We accept any of:
//   `- CODE — covered`, `- CODE - gap`, `- CODE: covered`.
const VERDICT_RE = /^[-*]\s*([A-Z][A-Z0-9\-]*)\s*[—\-:]\s*([a-zA-Z\/]+)/;

function parseRunVerdicts(body: string): { codes: string[]; tally: RunSummary['tally']; verdicts: Array<{ code: string; verdict: string; line: string }> } {
	const tally = { covered: 0, gap: 0, partial: 0, na: 0, other: 0 };
	const codes: string[] = [];
	const verdicts: Array<{ code: string; verdict: string; line: string }> = [];

	// Look for the Verdicts section.
	const lines = body.split('\n');
	let inVerdicts = false;
	for (const line of lines) {
		const heading = line.match(/^##\s+(.+)$/);
		if (heading) {
			inVerdicts = /verdicts?/i.test(heading[1]);
			continue;
		}
		if (!inVerdicts) continue;
		const m = line.match(VERDICT_RE);
		if (!m) continue;
		const code = m[1];
		const verdictRaw = m[2].toLowerCase();
		codes.push(code);
		verdicts.push({ code, verdict: verdictRaw, line: line.trim() });
		if (verdictRaw === 'covered') tally.covered++;
		else if (verdictRaw === 'gap') tally.gap++;
		else if (verdictRaw === 'partial') tally.partial++;
		else if (verdictRaw === 'n' || verdictRaw === 'na' || verdictRaw === 'n/a') tally.na++;
		else tally.other++;
	}
	return { codes, tally, verdicts };
}

async function listRuns(opts: ApiOptions): Promise<RunSummary[]> {
	if (!await isDir(opts.runsDir)) return [];
	const entries = await readdir(opts.runsDir, { withFileTypes: true });
	const out: RunSummary[] = [];
	for (const e of entries) {
		if (!e.isFile() || !e.name.endsWith('.md')) continue;
		const raw = await readFile(join(opts.runsDir, e.name), 'utf-8');
		const { meta, body } = parseFrontmatter(raw);
		const { tally } = parseRunVerdicts(body);
		const batch = Array.isArray(meta.batch)
			? meta.batch as string[]
			: typeof meta.batch === 'string' && meta.batch
				? [meta.batch]
				: [];
		out.push({
			filename: e.name,
			aspect: typeof meta.aspect === 'string' ? meta.aspect : 'unknown',
			started: typeof meta.started === 'string' ? meta.started : undefined,
			finished: typeof meta.finished === 'string' ? meta.finished : undefined,
			batch,
			runner: typeof meta.runner === 'string' ? meta.runner : undefined,
			tally,
		});
	}
	// newest first by filename (ISO timestamp prefix sorts naturally)
	out.sort((a, b) => b.filename.localeCompare(a.filename));
	return out;
}

async function getRunDetail(opts: ApiOptions, filename: string) {
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
	const path = join(opts.runsDir, filename);
	if (!await pathExists(path)) return null;
	const raw = await readFile(path, 'utf-8');
	const { meta, body } = parseFrontmatter(raw);
	const parsed = parseRunVerdicts(body);
	const batch = Array.isArray(meta.batch)
		? meta.batch as string[]
		: typeof meta.batch === 'string' && meta.batch
			? [meta.batch]
			: [];
	return {
		filename,
		aspect: typeof meta.aspect === 'string' ? meta.aspect : 'unknown',
		started: typeof meta.started === 'string' ? meta.started : undefined,
		finished: typeof meta.finished === 'string' ? meta.finished : undefined,
		batch,
		runner: typeof meta.runner === 'string' ? meta.runner : undefined,
		tally: parsed.tally,
		verdicts: parsed.verdicts,
		body,
		raw,
	};
}

// Coverage matrix: latest verdict per (feature code, aspect) pair from runs.
async function buildCoverage(opts: ApiOptions): Promise<Record<string, Record<string, string>>> {
	const runs = await listRuns(opts);
	// Iterate oldest-first so newer runs overwrite older.
	const coverage: Record<string, Record<string, string>> = {};
	for (const summary of runs.slice().reverse()) {
		const detail = await getRunDetail(opts, summary.filename);
		if (!detail) continue;
		for (const v of detail.verdicts) {
			coverage[v.code] ??= {};
			coverage[v.code][detail.aspect] = v.verdict;
		}
	}
	return coverage;
}

// ---------- Plugin ----------

export function rubricApi(opts: ApiOptions): Plugin {
	return {
		name: 'rubric-api',
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (!req.url?.startsWith('/api/')) return next();

				const url = new URL(req.url, `http://${req.headers.host}`);
				const path = url.pathname;

				try {
					if (path === '/api/features') {
						const tree = await buildFeatureTree(opts.featuresDir);
						return json(res, tree);
					}

					let m = path.match(/^\/api\/features\/(.+)$/);
					if (m) {
						const featurePath = decodeURIComponent(m[1]);
						const abs = resolveFeatureFile(opts.featuresDir, featurePath);
						if (!abs || !await pathExists(abs)) {
							return json(res, { error: 'Feature not found' }, 404);
						}
						const raw = await readFile(abs, 'utf-8');
						const { meta, body } = parseFrontmatter(raw);
						// derive code/name from the leaf filename plus parent dirs
						const rel = featurePath.replace(/\\/g, '/');
						const segments = rel.split('/');
						const codes: string[] = [];
						let leafName = '';
						for (const seg of segments) {
							const parsed = parseFeatureFilename(seg);
							if (parsed) { codes.push(parsed.code); leafName = parsed.name; }
						}
						return json(res, {
							path: rel,
							code: codes.join('-'),
							name: leafName,
							meta,
							body,
							raw,
						});
					}

					if (path === '/api/aspects') {
						return json(res, await listAspects(opts));
					}

					m = path.match(/^\/api\/aspects\/([^/]+)$/);
					if (m) {
						const detail = await getAspectDetail(opts, decodeURIComponent(m[1]));
						if (!detail) return json(res, { error: 'Aspect not found' }, 404);
						return json(res, detail);
					}

					if (path === '/api/defaults/aspects') {
						return json(res, await listDefaultAspects(opts));
					}

					if (path === '/api/runs') {
						return json(res, await listRuns(opts));
					}

					m = path.match(/^\/api\/runs\/([^/]+)$/);
					if (m) {
						const detail = await getRunDetail(opts, decodeURIComponent(m[1]));
						if (!detail) return json(res, { error: 'Run not found' }, 404);
						return json(res, detail);
					}

					if (path === '/api/coverage') {
						const tree = await buildFeatureTree(opts.featuresDir);
						const features = flattenFeatures(tree).map(n => ({
							code: n.code,
							name: n.name,
							path: n.path,
							hasFile: n.hasFile,
						}));
						const aspects = await listAspects(opts);
						const matrix = await buildCoverage(opts);
						return json(res, { features, aspects, matrix });
					}

					json(res, { error: 'Not found' }, 404);
				} catch (err: any) {
					console.error('[rubric-api]', err);
					json(res, { error: err.message }, 500);
				}
			});
		},
	};
}
