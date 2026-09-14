/**
 * Spec validation: the fields rubric reads from feature files, aspect files
 * and `features/README.md`, checked so a mistake in them fails a check instead
 * of silently changing what gets audited. What each field means is in
 * `schema.md`; this module only says when a value is wrong.
 */

import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotationSchema, discoverActiveAspects } from './aspects.mjs';
import { aspectApplies, readSurfaceVocabulary, walkFeatures } from './features.mjs';
import { isMapping } from './frontmatter.mjs';
import { RELEASES_FILE, readReleaseList, releaseRank } from './releases.mjs';

const DEFAULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'defaults', 'aspects');
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const NAME_RULE = 'use lowercase letters, digits and hyphens, starting with a letter';
const ANNOTATION_TYPES = ['string', 'number', 'boolean', 'enum', 'list'];

/** Discover everything `validateSpec` reads for the project at `repoRoot`. */
export async function loadSpec(repoRoot) {
	const featuresDir = join(repoRoot, 'features');
	const [features, aspects, vocabulary, releases] = await Promise.all([
		walkFeatures(featuresDir),
		discoverActiveAspects(join(repoRoot, 'aspects'), DEFAULTS_DIR),
		readSurfaceVocabulary(featuresDir),
		readReleaseList(repoRoot),
	]);
	return { features, aspects, vocabulary, releases };
}

/**
 * For entry points that plan audits or record verdicts: print the spec's
 * errors and exit 1 when there are any. An invalid spec is not safe to plan
 * from, so this applies to dry runs too. `shipped` — `lastShippedRelease`'s
 * result — sharpens the message when an unknown target code is the release
 * that was just shipped.
 */
export function exitIfSpecInvalid(repoRoot, spec, shipped = null) {
	const errors = validateSpec({ repoRoot, ...spec, shipped });
	if (errors.length === 0) return;
	for (const error of errors) console.error(error);
	console.error(`\nrubric spec: ${errors.length} error(s) — field rules are in rubric/schema.md`);
	process.exit(1);
}

/**
 * Every problem in the spec, as `<repo-relative path>:<line>: <message>`,
 * sorted by path then line. The line is the capability item's when the
 * problem is inside one, else the top-level key's; release-list errors keep
 * the line tess's reader gives. `shipped`, when given, is the code
 * `lastShippedRelease` found — an unknown target code matching it gets a hint
 * to run `coverage.mjs ship`.
 */
export function validateSpec({ repoRoot, features, aspects, vocabulary, releases, shipped = null }) {
	const found = [];
	const report = (path, line = 1, message) => {
		const rel = relative(repoRoot, path).split(sep).join('/');
		found.push({ path: rel, line, text: `${rel}:${line}: ${message}` });
	};

	const vocab = checkVocabulary(vocabulary, report);
	for (const record of [...features, ...aspects]) checkSurfaces(record, vocab, report);
	checkTargets(features, releases, shipped, report);
	for (const feature of features) checkCapabilities(feature, report);
	checkAspectBlocks(features, aspects, report);
	for (const aspect of aspects) checkAnnotation(aspect, report);
	checkParents(aspects, report);
	for (const text of releases.errors) {
		const line = text.startsWith(`${RELEASES_FILE}:`) ? Number(text.slice(RELEASES_FILE.length).match(/^:(\d+):/)?.[1] ?? 0) : 0;
		found.push({ path: RELEASES_FILE, line, text });
	}

	return found
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
		.map(e => e.text);
}

/** A value as it reads in a message: strings bare, anything else as JSON. */
const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

const isScalar = (value) => ['string', 'number', 'boolean'].includes(typeof value);

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * The vocabulary in `features/README.md`. Returns null when none is declared,
 * else `{ names }` — a Set of the declared names, or null when the value is not
 * a list at all (membership is then not checked, so one error doesn't repeat
 * at every use).
 */
function checkVocabulary(vocabulary, report) {
	if (!vocabulary) return null;
	const { path, line, value } = vocabulary;
	if (value == null || (Array.isArray(value) && value.length === 0)) {
		report(path, line, 'surfaces: is empty — list the surface names, or omit the field');
		return { names: new Set() };
	}
	if (!Array.isArray(value)) {
		report(path, line, 'surfaces: must be a list of surface names, e.g. surfaces: [web, api]');
		return { names: null };
	}
	const names = new Set();
	for (const name of value) {
		if (typeof name !== 'string' || !NAME_RE.test(name)) report(path, line, `surfaces: ${show(name)} is not a surface name — ${NAME_RULE}`);
		else if (names.has(name)) report(path, line, `surfaces: ${name} is listed twice`);
		if (typeof name === 'string') names.add(name);
	}
	return { names };
}

/** `surfaces:` on a feature or an aspect. */
function checkSurfaces(record, vocab, report) {
	if (!Object.hasOwn(record.data, 'surfaces')) return;
	const { path } = record;
	const line = record.keyLines.surfaces;
	const value = record.data.surfaces;
	if (value == null || (Array.isArray(value) && value.length === 0)) {
		report(path, line, 'surfaces: is empty — omit the field instead');
	} else if (!Array.isArray(value)) {
		report(path, line, 'surfaces: must be a list, e.g. surfaces: [web]');
	} else if (!vocab) {
		report(path, line, 'surfaces: is used but features/README.md declares no surface vocabulary (a surfaces: list in its front-matter)');
	} else if (vocab.names) {
		for (const name of value) {
			if (!vocab.names.has(name)) {
				report(path, line, `surfaces: ${show(name)} is not in the surface vocabulary in features/README.md (${[...vocab.names].join(', ')})`);
			}
		}
	}
}

// ── Targets ──────────────────────────────────────────────────────────────────

/**
 * `target:` on features and on capability items. Skipped entirely when the
 * release list exists but tess's reader could not load it: that is one error
 * already, and judging every tag against an unknown list would repeat it.
 */
function checkTargets(features, releases, shipped, report) {
	if (releases.unreadable) return;
	const byCode = new Map(features.map(f => [f.code, f]));
	const isListed = (path, line, code) => {
		if (!releases.present) report(path, line, `has target: ${show(code)} but ${RELEASES_FILE} does not exist`);
		else if (releaseRank(releases, code) === -1) {
			const hint = code === shipped ? ` — ${code} was just shipped; run node rubric/scripts/coverage.mjs ship` : '';
			report(path, line, `target: ${show(code)} is not a code in ${RELEASES_FILE}${hint}`);
		}
		else return true;
		return false;
	};

	for (const feature of features) {
		const { path } = feature;
		if (Object.hasOwn(feature.data, 'target')) {
			const own = feature.data.target;
			const line = feature.keyLines.target;
			if (own == null) {
				report(path, line, 'target: is empty — omit the field for a feature due in the current release');
			} else if (isListed(path, line, own)) {
				const ancestor = declaringAncestor(feature, byCode);
				if (ancestor && isDueBefore(releases, own, ancestor.data.target)) {
					report(path, line, `targets ${own} but ancestor ${ancestor.code} targets ${ancestor.data.target} — a descendant cannot be due before its ancestor`);
				}
			}
		}
		for (const cap of feature.capabilities) {
			if (cap.target == null || !isListed(path, cap.line, cap.target)) continue;
			if (isDueBefore(releases, cap.target, feature.target)) {
				const from = feature.data.target != null ? '' : ` (inherited from ${declaringAncestor(feature, byCode).code})`;
				report(path, cap.line, `capability targets ${cap.target} but its feature targets ${feature.target}${from} — a capability cannot be due before its feature`);
			}
		}
	}
}

/** The nearest ancestor declaring its own `target:` — where the feature's inherited target comes from. */
function declaringAncestor(feature, byCode) {
	const segments = feature.code.split('-');
	for (let n = segments.length - 1; n > 0; n--) {
		const node = byCode.get(segments.slice(0, n).join('-'));
		if (node?.data.target != null) return node;
	}
	return null;
}

/** Whether `code` ranks before `bound`. False when either is unlisted: that is reported where it is written. */
function isDueBefore(releases, code, bound) {
	const rank = releaseRank(releases, code);
	const boundRank = releaseRank(releases, bound);
	return rank >= 0 && boundRank >= 0 && rank < boundRank;
}

// ── Capabilities ─────────────────────────────────────────────────────────────

function checkCapabilities(feature, report) {
	const value = feature.data.capabilities;
	if (value == null) return;
	if (!Array.isArray(value)) {
		report(feature.path, feature.keyLines.capabilities, 'capabilities: must be a list');
		return;
	}
	value.forEach((item, i) => {
		for (const problem of capabilityProblems(item)) report(feature.path, feature.capabilities[i].line, problem);
	});
}

function capabilityProblems(item) {
	if (typeof item === 'string') return [];
	if (!isMapping(item)) return [`capability ${show(item)} must be plain text, or a text: and target: mapping`];
	const keys = Object.keys(item);
	if (!Object.hasOwn(item, 'text')) {
		return [Object.hasOwn(item, 'target')
			? 'capability has target: but no text:'
			: `capability parses as a mapping (${keys[0]}: …) — quote the line to keep it plain text, or write text: and target:`];
	}
	const problems = [];
	const extra = keys.filter(k => k !== 'text' && k !== 'target');
	if (extra.length) problems.push(`capability has ${extra.join(', ')} — only text: and target: are allowed`);
	if (typeof item.text !== 'string' || item.text.trim() === '' || item.text.includes('\n')) {
		problems.push('capability text: must be one non-empty line');
	}
	if (item.target == null) problems.push('capability has no target: — use the plain string form for a capability with no target');
	return problems;
}

// ── Aspect settings (annotations) ────────────────────────────────────────────

/** A feature's `aspects:` map: each block against its aspect's `annotation:` schema. */
function checkAspectBlocks(features, aspects, report) {
	const byName = new Map(aspects.map(a => [a.name, a]));
	for (const feature of features) {
		if (!Object.hasOwn(feature.data, 'aspects')) continue;
		const { path } = feature;
		const line = feature.keyLines.aspects;
		const blocks = feature.data.aspects;
		if (!isMapping(blocks)) {
			report(path, line, 'aspects: must be a mapping from aspect name to its settings');
			continue;
		}
		for (const [name, block] of Object.entries(blocks)) {
			const aspect = byName.get(name);
			if (!aspect) {
				report(path, line, `aspects.${name}: ${name} is not an active aspect`);
				continue;
			}
			if (!Object.hasOwn(aspect.data, 'annotation')) {
				report(path, line, `aspects.${name}: aspects/${name}/aspect.md declares no annotation:, so there are no settings to give`);
				continue;
			}
			if (feature.data.status !== 'retired' && !aspectApplies(aspect, feature)) {
				const excluding = aspect.parent ? `its level, applies-to or surfaces, or its parent ${aspect.parent.name}'s,` : 'its level, applies-to or surfaces';
				report(path, line, `aspects.${name}: ${name} does not apply to this feature (${excluding} exclude it)`);
			}
			const schema = annotationSchema(aspect);
			if (!schema) continue;  // the malformed annotation: is reported on the aspect
			if (block == null) continue;  // an empty block means the defaults
			if (!isMapping(block)) {
				report(path, line, `aspects.${name}: must be a mapping of settings (leave it empty for the defaults)`);
				continue;
			}
			for (const [key, value] of Object.entries(block)) {
				if (!Object.hasOwn(schema, key)) {
					report(path, line, `aspects.${name}.${key} is not a setting aspects/${name}/aspect.md declares`);
					continue;
				}
				const problem = typeProblem(schema[key], value);
				if (problem) report(path, line, `aspects.${name}.${key}: ${problem}`);
			}
		}
	}
}

/** Why `value` does not fit an annotation entry's type, or null. Null too for a malformed entry, which is reported on the aspect. */
function typeProblem(entry, value) {
	switch (entry.type) {
		case 'string': return typeof value === 'string' ? null : `expected text, got ${show(value)}${value == null ? '' : ' — quote it'}`;
		case 'number': return typeof value === 'number' ? null : `expected a number, got ${show(value)}`;
		case 'boolean': return typeof value === 'boolean' ? null : `expected true or false, got ${show(value)}`;
		case 'enum':
			if (!Array.isArray(entry.values) || entry.values.length === 0) return null;
			return entry.values.includes(value) ? null : `${show(value)} is not one of ${entry.values.map(show).join(', ')}`;
		case 'list': return Array.isArray(value) && value.every(isScalar) ? null : `expected a list of scalars, got ${show(value)}`;
		default: return null;
	}
}

/** An aspect's `annotation:` schema. */
function checkAnnotation(aspect, report) {
	if (!Object.hasOwn(aspect.data, 'annotation')) return;
	const { path } = aspect;
	const line = aspect.keyLines.annotation;
	const declared = aspect.data.annotation;
	if (!isMapping(declared)) {
		report(path, line, 'annotation: must be a mapping from setting name to { type, default }');
		return;
	}
	for (const [key, entry] of Object.entries(declared)) {
		if (!NAME_RE.test(key)) report(path, line, `annotation: ${key} is not a setting name — ${NAME_RULE}`);
		if (!isMapping(entry)) {
			report(path, line, `annotation.${key}: must be a mapping with type: (and optionally values:, default:)`);
		} else if (!ANNOTATION_TYPES.includes(entry.type)) {
			report(path, line, `annotation.${key}: type ${show(entry.type)} is not one of ${ANNOTATION_TYPES.join(', ')}`);
		} else if (entry.type === 'enum' && !(Array.isArray(entry.values) && entry.values.length > 0)) {
			report(path, line, `annotation.${key}: an enum needs a non-empty values: list`);
		} else if (entry.default != null) {
			const problem = typeProblem(entry, entry.default);
			if (problem) report(path, line, `annotation.${key}: default does not match type ${entry.type} — ${problem}`);
		}
	}
}

// ── Aspect parents ───────────────────────────────────────────────────────────

/**
 * `parent:` names another active aspect, one level deep, at the same level, and
 * the child has a prompt of its own — the delta its audit appends to the
 * parent's. A parent with children has no verdicts of its own, so its
 * `annotation:` would never be read.
 */
function checkParents(aspects, report) {
	const byName = new Map(aspects.map(a => [a.name, a]));
	const childrenOf = new Map();
	for (const aspect of aspects) {
		if (!Object.hasOwn(aspect.data, 'parent')) continue;
		const { path } = aspect;
		const line = aspect.keyLines.parent;
		const name = aspect.data.parent;
		if (name === aspect.name) {
			report(path, line, 'parent: names this aspect itself');
			continue;
		}
		const parent = byName.get(name);
		if (!parent) {
			report(path, line, `parent: ${show(name)} is not an active aspect`);
			continue;
		}
		childrenOf.set(name, [...(childrenOf.get(name) ?? []), aspect.name]);
		if (!aspect.promptPath) {
			report(path, line, `child aspect ${aspect.name} needs its own prompt.md (the delta appended to ${name}'s prompt)`);
		}
		if (parent.data.parent != null) {
			report(path, line, `parent: ${name} has a parent of its own (${show(parent.data.parent)}) — aspects nest one level only`);
		}
		const parentLevel = parent.data.level || 'any';
		if (aspect.data.level != null && aspect.data.level !== parentLevel) {
			report(path, aspect.keyLines.level, `level: ${show(aspect.data.level)} differs from parent ${name}'s level: ${parentLevel} — a child audits the same level as its parent`);
		}
	}
	for (const [name, children] of childrenOf) {
		const parent = byName.get(name);
		if (Object.hasOwn(parent.data, 'annotation')) {
			report(parent.path, parent.keyLines.annotation, `annotation: ${name} has child aspects (${children.join(', ')}) and no verdicts of its own, so nothing would read these settings`);
		}
	}
}
