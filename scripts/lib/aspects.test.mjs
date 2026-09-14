import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	annotationSchema, aspectLabel, aspectsNamed, coverageColumns, discoverActiveAspects, hasVerdicts,
	readPrompt, readTicketTemplate, resolveAnnotation,
} from './aspects.mjs';
import { withTree } from './test-tree.mjs';

// Contract: schema.md § Aspect front-matter (annotation:) and § Feature front-matter (aspects:) —
// defaults overlaid by the feature's own block, keys in schema order. And schema.md § Surfaces, parent and
// annotation (parent:) — a child's prompt is its parent's then its own delta, its template its own else its
// parent's; a parent with children has no verdicts, so coverage views show its children in its place.

const performance = {
	name: 'performance',
	data: {
		annotation: {
			budget: { type: 'string', default: 'opens within 5 s' },
			workload: { type: 'string' },
			depth: { type: 'enum', values: ['overview', 'reference'], default: 'overview' },
			strict: { type: 'boolean', default: null },
		},
	},
};
const feature = (aspects) => ({ code: 'SCN', data: aspects === undefined ? {} : { aspects } });

test('resolveAnnotation: a feature without a block gets every default that is not null', () => {
	assert.equal(JSON.stringify(resolveAnnotation(performance, feature())), '{"budget":"opens within 5 s","depth":"overview"}');
});

test('resolveAnnotation: the feature\'s block overrides defaults and fills keys without one, keeping schema order', () => {
	const own = feature({ performance: { depth: 'reference', workload: 'open-large' } });

	assert.equal(JSON.stringify(resolveAnnotation(performance, own)), '{"budget":"opens within 5 s","workload":"open-large","depth":"reference"}');
});

test('resolveAnnotation: another aspect\'s block, an empty block and an empty mapping all leave the defaults', () => {
	for (const aspects of [{ help: { depth: 'reference' } }, { performance: null }, { performance: {} }]) {
		assert.deepEqual(resolveAnnotation(performance, feature(aspects)), { budget: 'opens within 5 s', depth: 'overview' });
	}
});

test('resolveAnnotation: an aspect with no annotation: has no schema and resolves to {}', () => {
	const help = { name: 'help', data: {} };

	assert.equal(annotationSchema(help), null);
	assert.deepEqual(resolveAnnotation(help, feature({ help: { depth: 'reference' } })), {});
});

// ── Hierarchy ────────────────────────────────────────────────────────────────

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');

/** `ux` has two active children and a retired one; `solo` is named only by a retired aspect; the rest cannot resolve a parent. */
const FAMILY = {
	'aspects/ux/aspect.md': fm('name: ux', 'status: active', 'level: leaf'),
	'aspects/ux/prompt.md': 'Judge the interface.\n',
	'aspects/ux/ticket-template.md': '# UX gap\n',
	'aspects/tooltips/aspect.md': fm('name: tooltips', 'status: active', 'parent: ux'),
	'aspects/tooltips/prompt.md': 'Also check tooltips.\n',
	'aspects/menus/aspect.md': fm('name: menus', 'status: draft', 'parent: ux'),
	'aspects/menus/prompt.md': 'Also check menus.\n',
	'aspects/menus/ticket-template.md': '# Menu gap\n',
	'aspects/hints/aspect.md': fm('name: hints', 'status: retired', 'parent: ux'),
	'aspects/help/aspect.md': fm('name: help', 'status: active', 'level: leaf'),
	'defaults/help/prompt.md': 'Default help prompt.\n',
	'aspects/solo/aspect.md': fm('name: solo', 'status: active'),
	'aspects/solo-old/aspect.md': fm('name: solo-old', 'status: retired', 'parent: solo'),
	'aspects/orphan/aspect.md': fm('name: orphan', 'parent: gone'),
	'aspects/selfish/aspect.md': fm('name: selfish', 'parent: selfish'),
	'aspects/grandchild/aspect.md': fm('name: grandchild', 'parent: tooltips'),
};

/** Run `fn(byName, aspects)` over the discovered FAMILY, inside its tree so prompts and templates can be read. */
function inFamily(fn) {
	return withTree(FAMILY, async (root) => {
		const aspects = await discoverActiveAspects(join(root, 'aspects'), join(root, 'defaults'));
		return fn(Object.fromEntries(aspects.map(a => [a.name, a])), aspects);
	});
}

test('discoverActiveAspects: a child links to its parent\'s record, and a parent lists its active children by name — a retired child does not count', async () => {
	await inFamily((by) => {
		assert.equal(by.tooltips.parent, by.ux);
		assert.equal(by.menus.parent, by.ux);
		assert.deepEqual(by.ux.children, ['menus', 'tooltips']);
		assert.deepEqual([by.help.parent, by.help.children], [null, []]);
		assert.deepEqual([by.solo.parent, by.solo.children], [null, []], 'named only by a retired aspect, so an ordinary aspect');
	});
});

test('discoverActiveAspects: a parent: naming the aspect itself, an inactive aspect or an aspect with a parent of its own stays unresolved', async () => {
	await inFamily((by) => {
		assert.deepEqual([by.orphan.parent, by.selfish.parent, by.grandchild.parent], [null, null, null]);
		assert.deepEqual([by.selfish.children, by.tooltips.children], [[], []]);
	});
});

test('readPrompt: a child\'s prompt is its parent\'s, a blank line, then its own; any other aspect\'s is its own', async () => {
	await inFamily(async (by) => {
		assert.equal(await readPrompt(by.tooltips), 'Judge the interface.\n\nAlso check tooltips.\n');
		assert.equal(await readPrompt(by.ux), 'Judge the interface.\n');
		assert.equal(await readPrompt(by.help), 'Default help prompt.\n');
	});
});

test('readTicketTemplate: a child uses its own template, else its parent\'s', async () => {
	await inFamily(async (by) => {
		assert.equal(await readTicketTemplate(by.menus), '# Menu gap\n');
		assert.equal(await readTicketTemplate(by.tooltips), '# UX gap\n');
		assert.equal(await readTicketTemplate(by.help), null);
	});
});

test('readPrompt: a child whose parent has no prompt fails, naming the parent', async () => {
	const files = {
		'aspects/ux/aspect.md': fm('name: ux'),
		'aspects/tooltips/aspect.md': fm('name: tooltips', 'parent: ux'),
		'aspects/tooltips/prompt.md': 'Also check tooltips.\n',
	};
	await withTree(files, async (root) => {
		const tooltips = (await discoverActiveAspects(join(root, 'aspects'), join(root, 'defaults'))).find(a => a.name === 'tooltips');

		await assert.rejects(readPrompt(tooltips), /its parent "ux" has no prompt/);
	});
});

test('aspectsNamed and hasVerdicts: naming a parent with children selects its children, which carry its verdicts; any other name selects that aspect', async () => {
	await inFamily((by, aspects) => {
		const names = (name) => aspectsNamed(aspects, name).map(a => a.name);

		assert.deepEqual([names('ux'), names('tooltips'), names('solo'), names('gone')], [['menus', 'tooltips'], ['tooltips'], ['solo'], []]);
		assert.deepEqual([hasVerdicts(by.ux), hasVerdicts(by.tooltips), hasVerdicts(by.solo)], [false, true, true]);
	});
});

test('coverageColumns: aspects with verdicts — top-level by name, each parent\'s children by name in its place — labelled parent/child', () => {
	const record = (name, parent = null) => ({ name, parent, children: [] });
	const ux = record('ux');
	const aspects = [record('ux-copy'), record('tooltips', ux), ux, record('code'), record('menus', ux), record('uptime')];
	ux.children = ['menus', 'tooltips'];

	assert.deepEqual(coverageColumns(aspects).map(aspectLabel), ['code', 'uptime', 'ux/menus', 'ux/tooltips', 'ux-copy']);
});
