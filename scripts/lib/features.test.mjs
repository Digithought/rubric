import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { filterFeatures, readSurfaceVocabulary, walkFeatures } from './features.mjs';
import { withTree } from './test-tree.mjs';

// Contract: schema.md § Feature front-matter (surfaces, target, capabilities) and
// agent-rules/principles.md § Aspect annotations, surfaces and hierarchy (applicability).

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const PICKING = fm('status: planned', 'surfaces: [mobile]', 'capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: LATER');

const TREE = {
	'features/README.md': `${fm('surfaces: [web, mobile, api]')}# Features\n`,
	'features/SCN - Scene.md': fm('surfaces: [web, api]', 'target: GA'),
	'features/SCN - Scene/HIER - Hierarchy.md': fm('summary: Hierarchy'),
	'features/SCN - Scene/HIER - Hierarchy/PCK - Picking.md': PICKING,
	'features/TER - Terrain.md': fm('status: implemented'),
};

const walk = (files) => withTree(files, root => walkFeatures(join(root, 'features')));
const byCode = (features) => Object.fromEntries(features.map(f => [f.code, f]));

test('surfaces: and target: inherit from the nearest declaring ancestor, root → branch → leaf; a descendant may declare surfaces outside its ancestor\'s', async () => {
	const f = byCode(await walk(TREE));

	assert.deepEqual([f.SCN.level, f['SCN-HIER'].level, f['SCN-HIER-PCK'].level], ['root', 'branch', 'leaf']);
	assert.deepEqual([f.SCN.surfaces, f.SCN.target], [['web', 'api'], 'GA']);
	assert.deepEqual([f['SCN-HIER'].surfaces, f['SCN-HIER'].target], [['web', 'api'], 'GA']);
	assert.deepEqual([f['SCN-HIER-PCK'].surfaces, f['SCN-HIER-PCK'].target], [['mobile'], 'GA']);
	assert.deepEqual([f.TER.surfaces, f.TER.target], [null, null]);
});

test('capabilities: both forms normalise to { text, target, line } — target is the item\'s own tag, line its 1-based file line', async () => {
	const f = byCode(await walk(TREE));

	assert.deepEqual(f['SCN-HIER-PCK'].capabilities, [
		{ text: 'Pick an entity', target: null, line: 5 },
		{ text: 'Export to KML', target: 'LATER', line: 6 },
	]);
	assert.deepEqual(f.TER.capabilities, []);
});

test('a CRLF feature file reports the same key and capability lines as its LF copy', async () => {
	const f = byCode(await walk({ 'features/LF - Lf.md': PICKING, 'features/CR - Cr.md': PICKING.replace(/\n/g, '\r\n') }));

	assert.deepEqual(f.CR.keyLines, { status: 2, surfaces: 3, capabilities: 4 });
	assert.deepEqual(f.CR.keyLines, f.LF.keyLines);
	assert.deepEqual(f.CR.capabilities, f.LF.capabilities);
});

test('filterFeatures: an aspect with surfaces: audits only features whose effective surfaces intersect them; one without applies regardless', async () => {
	const features = await walk(TREE);
	const codes = (data) => filterFeatures(features, { name: 'x', data }).map(f => f.code).sort();

	assert.deepEqual(codes({ surfaces: ['api'] }), ['SCN', 'SCN-HIER']);
	assert.deepEqual(codes({ surfaces: ['mobile', 'viewer'] }), ['SCN-HIER-PCK']);
	assert.deepEqual(codes({ surfaces: ['viewer'] }), [], 'disjoint surfaces, and TER declares none');
	assert.deepEqual(codes({}), ['SCN', 'SCN-HIER', 'SCN-HIER-PCK', 'TER']);
});

test('filterFeatures: level, applies-to and surfaces compose — all must admit the feature', async () => {
	const features = await walk(TREE);
	const codes = (data) => filterFeatures(features, { name: 'x', data }).map(f => f.code).sort();

	assert.deepEqual(codes({ surfaces: ['web'], 'applies-to': { exclude: ['SCN-HIER'] } }), ['SCN']);
	assert.deepEqual(codes({ surfaces: ['web', 'mobile'], level: 'leaf' }), ['SCN-HIER-PCK']);
});

test('readSurfaceVocabulary: the surfaces: list in features/README.md front-matter with its line, else null', async () => {
	await withTree(TREE, async (root) => {
		assert.deepEqual(await readSurfaceVocabulary(join(root, 'features')), {
			path: join(root, 'features', 'README.md'), line: 2, value: ['web', 'mobile', 'api'],
		});
	});
	await withTree({ 'features/README.md': '# Features\n' }, async (root) => {
		assert.equal(await readSurfaceVocabulary(join(root, 'features')), null);
	});
	await withTree({}, async (root) => {
		assert.equal(await readSurfaceVocabulary(join(root, 'features')), null);
	});
});
