import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withTree } from './test-tree.mjs';
import { loadSpec, validateSpec } from './validate.mjs';

// Contract: the field rules in schema.md § Feature front-matter and § Aspect front-matter.
// Each case names the rule it verifies; errors are asserted whole, `path:line:` prefix included.

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');

const LIST = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };
const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };

const README = 'features/README.md';
const SCN = 'features/SCN - Scene.md';
const HIER = 'features/SCN - Scene/HIER - Hierarchy.md';
const TER = 'features/TER - Terrain.md';
const PERFORMANCE = 'aspects/performance/aspect.md';
const HELP = 'aspects/help/aspect.md';
const TOOLTIPS = 'aspects/tooltips/aspect.md';

/** performance's keys before `annotation:`, which is therefore line 6. */
const PERFORMANCE_HEAD = ['name: performance', 'status: active', 'level: any', 'surfaces: [web]'];
const PERFORMANCE_ANNOTATION = ['annotation:', '  budget:', '    type: string', '    default: "5 s"', '  depth:', '    type: enum', '    values: [overview, reference]', '    default: overview'];
const ALL_TYPES = fm(...PERFORMANCE_HEAD, 'annotation:', '  budget:', '    type: string', '  runs:', '    type: number', '  strict:', '    type: boolean', '  depth:', '    type: enum', '    values: [overview, reference]', '  workloads:', '    type: list');
/** A leaf under SCN whose `aspects:` key is line 5. */
const hier = (...aspectLines) => fm('status: planned', 'capabilities:', '  - Reorder entities', 'aspects:', ...aspectLines);

/** A clean spec; each case overrides the files it breaks. */
const BASE = {
	[README]: `${fm('surfaces: [web, mobile, api]')}# Features\n`,
	[SCN]: fm('surfaces: [web]', 'target: GA', 'capabilities:', '  - Browse the scene', '  - text: Export to KML', '    target: LATER'),
	[HIER]: hier('  performance:', '    budget: "2 s"', '    depth: reference'),
	[TER]: fm('status: implemented'),
	[PERFORMANCE]: fm(...PERFORMANCE_HEAD, ...PERFORMANCE_ANNOTATION),
	[HELP]: fm('name: help', 'status: active', 'level: leaf'),
	[TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: leaf', 'parent: help'),
};

function errorsFor(overrides = {}, releases = LIST) {
	return withTree({ ...BASE, ...overrides }, async (root) => validateSpec({ repoRoot: root, ...(await loadSpec(root)), releases }));
}

const CASES = [
	['a clean spec using every field has no errors', {}, []],
	['a file with no front-matter has nothing to check', { [TER]: '# Terrain\n' }, []],

	// features/README.md — the surface vocabulary
	['vocabulary: names are lowercase-hyphenated and listed once',
		{ [README]: fm('surfaces: [web, Web2, web, mobile, api]') },
		[`${README}:2: surfaces: Web2 is not a surface name — use lowercase letters, digits and hyphens, starting with a letter`,
			`${README}:2: surfaces: web is listed twice`]],
	['vocabulary: is a list',
		{ [README]: fm('surfaces: web, mobile') },
		[`${README}:2: surfaces: must be a list of surface names, e.g. surfaces: [web, api]`]],

	// surfaces: on features and aspects
	['surfaces: using them needs a vocabulary in features/README.md',
		{ [README]: '# Features\n' },
		[`${PERFORMANCE}:5: surfaces: is used but features/README.md declares no surface vocabulary (a surfaces: list in its front-matter)`,
			`${SCN}:2: surfaces: is used but features/README.md declares no surface vocabulary (a surfaces: list in its front-matter)`]],
	['surfaces: every name is in the vocabulary',
		{ [SCN]: BASE[SCN].replace('surfaces: [web]', 'surfaces: [web, desktop]') },
		[`${SCN}:2: surfaces: desktop is not in the surface vocabulary in features/README.md (web, mobile, api)`]],
	['surfaces: an empty list is written by omitting the field',
		{ [TER]: fm('status: implemented', 'surfaces: []') },
		[`${TER}:3: surfaces: is empty — omit the field instead`]],

	// target: on features and capabilities
	['target: needs tickets/releases.md to exist',
		{},
		[`${SCN}:3: has target: GA but tickets/releases.md does not exist`, `${SCN}:6: has target: LATER but tickets/releases.md does not exist`],
		OFF],
	['target: names a code in tickets/releases.md',
		{ [SCN]: BASE[SCN].replace('target: GA', 'target: GA1') },
		[`${SCN}:3: target: GA1 is not a code in tickets/releases.md`]],
	['target: a descendant cannot be due before its ancestor',
		{ [HIER]: fm('status: planned', 'target: BETA') },
		[`${HIER}:3: targets BETA but ancestor SCN targets GA — a descendant cannot be due before its ancestor`]],
	['target: a descendant may be due after its ancestor, and naming the current release is the same as no tag',
		{ [HIER]: fm('status: planned', 'target: LATER'), [TER]: fm('status: implemented', 'target: BETA', 'capabilities:', '  - text: Shade terrain', '    target: BETA') },
		[]],
	['target: a capability cannot be due before its feature, whose target may be inherited',
		{ [SCN]: BASE[SCN].replace('    target: LATER', '    target: BETA'), [HIER]: fm('status: planned', 'capabilities:', '  - text: Reorder entities', '    target: BETA') },
		[`${SCN}:6: capability targets BETA but its feature targets GA — a capability cannot be due before its feature`,
			`${HIER}:4: capability targets BETA but its feature targets GA (inherited from SCN) — a capability cannot be due before its feature`]],
	['target: an empty value is written by omitting the field',
		{ [TER]: fm('status: implemented', 'target:') },
		[`${TER}:3: target: is empty — omit the field for a feature due in the current release`]],

	// capabilities:
	['capabilities: an item is plain text, or a text: and target: mapping whose text is one non-empty line',
		{ [TER]: fm('status: implemented', 'capabilities:',
			'  - text: Export', '    target: LATER', '    owner: ops',
			'  - target: LATER',
			'  - text: ""', '    target: LATER',
			'  - text: |', '      line one', '      line two', '    target: LATER',
			'  - text: Export to KML',
			'  - Note: exports are zipped',
			'  - 42',
			'  - "Note: quoted stays plain"') },
		[`${TER}:4: capability has owner — only text: and target: are allowed`,
			`${TER}:7: capability has target: but no text:`,
			`${TER}:8: capability text: must be one non-empty line`,
			`${TER}:10: capability text: must be one non-empty line`,
			`${TER}:14: capability has no target: — use the plain string form for a capability with no target`,
			`${TER}:15: capability parses as a mapping (Note: …) — quote the line to keep it plain text, or write text: and target:`,
			`${TER}:16: capability 42 must be plain text, or a text: and target: mapping`]],

	// aspects: — per-feature settings blocks
	['aspects: is a mapping from aspect name to settings',
		{ [HIER]: fm('status: planned', 'capabilities:', '  - Reorder entities', 'aspects: [performance]') },
		[`${HIER}:5: aspects: must be a mapping from aspect name to its settings`]],
	['aspects: each key is an active aspect — not a missing or retired one, while a draft one counts',
		{
			[HIER]: hier('  speed:', '    budget: x', '  legacy:', '    budget: x', '  tooltips:', '    hint: Drag to reorder'),
			'aspects/legacy/aspect.md': fm('name: legacy', 'status: retired', 'annotation:', '  budget:', '    type: string'),
			[TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: leaf', 'parent: help', 'annotation:', '  hint:', '    type: string'),
		},
		[`${HIER}:5: aspects.speed: speed is not an active aspect`, `${HIER}:5: aspects.legacy: legacy is not an active aspect`]],
	['aspects: only an aspect declaring annotation: takes a block',
		{ [HIER]: hier('  help:', '    depth: reference') },
		[`${HIER}:5: aspects.help: aspects/help/aspect.md declares no annotation:, so there are no settings to give`]],
	['aspects: a block is a mapping of settings',
		{ [HIER]: hier('  performance: fast') },
		[`${HIER}:5: aspects.performance: must be a mapping of settings (leave it empty for the defaults)`]],
	['aspects: an empty block means the defaults', { [HIER]: hier('  performance:') }, []],
	['aspects: a setting is one the annotation declares',
		{ [HIER]: hier('  performance:', '    speed: 3') },
		[`${HIER}:5: aspects.performance.speed is not a setting aspects/performance/aspect.md declares`]],
	['aspects: a value has its setting\'s type',
		{ [PERFORMANCE]: ALL_TYPES, [HIER]: hier('  performance:', '    budget: 2', '    runs: many', '    strict: yes', '    depth: deep', '    workloads: open-large') },
		[`${HIER}:5: aspects.performance.budget: expected text, got 2 — quote it`,
			`${HIER}:5: aspects.performance.runs: expected a number, got many`,
			`${HIER}:5: aspects.performance.strict: expected true or false, got yes`,
			`${HIER}:5: aspects.performance.depth: deep is not one of overview, reference`,
			`${HIER}:5: aspects.performance.workloads: expected a list of scalars, got open-large`]],
	['aspects: values of every type that fit their settings',
		{ [PERFORMANCE]: ALL_TYPES, [HIER]: hier('  performance:', '    budget: "2 s"', '    runs: 3', '    strict: true', '    depth: reference', '    workloads: [open-large, save]') },
		[]],
	['aspects: a block sits only on a feature the aspect applies to',
		{ [TER]: fm('status: implemented', 'aspects:', '  performance:', '    budget: "1 s"') },
		[`${TER}:3: aspects.performance: performance does not apply to this feature (its level, applies-to or surfaces exclude it)`]],
	['aspects: a retired feature is exempt from the applicability rule',
		{ [TER]: fm('status: retired', 'aspects:', '  performance:', '    budget: "1 s"') },
		[]],

	// annotation: on aspects
	['annotation: is a mapping',
		{ [PERFORMANCE]: fm(...PERFORMANCE_HEAD, 'annotation: fast') },
		[`${PERFORMANCE}:6: annotation: must be a mapping from setting name to { type, default }`]],
	['annotation: setting names are lowercase-hyphenated, and each setting is a mapping',
		{ [PERFORMANCE]: fm(...PERFORMANCE_HEAD, ...PERFORMANCE_ANNOTATION, '  Max_Size:', '    type: number', '  owner: string') },
		[`${PERFORMANCE}:6: annotation: Max_Size is not a setting name — use lowercase letters, digits and hyphens, starting with a letter`,
			`${PERFORMANCE}:6: annotation.owner: must be a mapping with type: (and optionally values:, default:)`]],
	['annotation: type is string, number, boolean, enum or list',
		{ [PERFORMANCE]: fm(...PERFORMANCE_HEAD, 'annotation:', '  budget:', '    type: string', '  depth:', '    type: choice') },
		[`${PERFORMANCE}:6: annotation.depth: type choice is not one of string, number, boolean, enum, list`]],
	['annotation: an enum has a non-empty values: list',
		{ [PERFORMANCE]: fm(...PERFORMANCE_HEAD, 'annotation:', '  budget:', '    type: string', '  depth:', '    type: enum', '    default: overview') },
		[`${PERFORMANCE}:6: annotation.depth: an enum needs a non-empty values: list`]],
	['annotation: a default matches its type',
		{ [PERFORMANCE]: fm(...PERFORMANCE_HEAD, ...PERFORMANCE_ANNOTATION, '  retries:', '    type: number', '    default: many') },
		[`${PERFORMANCE}:6: annotation.retries: default does not match type number — expected a number, got many`]],

	// parent: on aspects
	['parent: names an active aspect — not a missing or retired one',
		{
			[TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: leaf', 'parent: ux'),
			'aspects/hints/aspect.md': fm('name: hints', 'status: active', 'level: leaf', 'parent: legacy'),
			'aspects/legacy/aspect.md': fm('name: legacy', 'status: retired', 'level: leaf'),
		},
		['aspects/hints/aspect.md:5: parent: legacy is not an active aspect', `${TOOLTIPS}:5: parent: ux is not an active aspect`]],
	['parent: an aspect is not its own parent',
		{ [TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: leaf', 'parent: tooltips') },
		[`${TOOLTIPS}:5: parent: names this aspect itself`]],
	['parent: aspects nest one level only',
		{ [HELP]: fm('name: help', 'status: active', 'level: leaf', 'parent: code'), 'aspects/code/aspect.md': fm('name: code', 'status: active', 'level: leaf') },
		[`${TOOLTIPS}:5: parent: help has a parent of its own (code) — aspects nest one level only`]],
	['parent: a child audits the same level as its parent',
		{ [TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: branch', 'parent: help') },
		[`${TOOLTIPS}:4: level: branch differs from parent help's level: leaf — a child audits the same level as its parent`]],
	['parent: a parent with children declares no annotation:',
		{ [HELP]: fm('name: help', 'status: active', 'level: leaf', 'annotation:', '  depth:', '    type: enum', '    values: [overview, reference]') },
		[`${HELP}:5: annotation: help has child aspects (tooltips) and no verdicts of its own, so nothing would read these settings`]],
];

for (const [name, overrides, expected, releases] of CASES) {
	test(name, async () => {
		assert.deepEqual(await errorsFor(overrides, releases), expected);
	});
}

test('release list: when tess\'s reader is missing, that is the one error — target: tags are not judged against an unknown list', async () => {
	await withTree({ ...BASE, 'tickets/releases.md': '## BETA\n\n## GA\n\n## LATER\n' }, async (root) => {
		assert.deepEqual(validateSpec({ repoRoot: root, ...(await loadSpec(root)) }), [
			"tickets/releases.md exists but tess's reader (tess/scripts/lib/releases.mjs) was not found",
		]);
	});
});

test('errors sort by path, then line; release-list errors keep the line tess reports', async () => {
	const releases = { ...LIST, errors: ['tickets/releases.md:4: release code GA is listed twice (first on line 2)'] };
	const errors = await errorsFor({
		[README]: fm('surfaces: [web, mobile, api, web]'),
		[SCN]: BASE[SCN].replace('surfaces: [web]', 'surfaces: [web, desktop]').replace('target: GA', 'target: GA1'),
		[TOOLTIPS]: fm('name: tooltips', 'status: draft', 'level: leaf', 'parent: ux'),
	}, releases);

	assert.deepEqual(errors.map(e => e.split(': ')[0]), [
		`${TOOLTIPS}:5`, `${README}:2`, `${SCN}:2`, `${SCN}:3`, 'tickets/releases.md:4',
	]);
	assert.equal(errors.at(-1), releases.errors[0]);
});

test('a CRLF spec reports the same errors, on the same lines, as its LF copy', async () => {
	const broken = { [TER]: fm('status: implemented', 'surfaces: []', 'capabilities:', '  - target: LATER') };
	const crlf = Object.fromEntries(Object.entries({ ...BASE, ...broken }).map(([path, text]) => [path, text.replace(/\n/g, '\r\n')]));
	const lfErrors = await errorsFor(broken);

	assert.deepEqual(lfErrors, [`${TER}:3: surfaces: is empty — omit the field instead`, `${TER}:5: capability has target: but no text:`]);
	assert.deepEqual(await errorsFor(crlf), lfErrors);
});
