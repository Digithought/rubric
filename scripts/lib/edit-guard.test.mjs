import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { contentOutsideBlock, editedOutsideBlock, snapshotBatch } from './edit-guard.mjs';
import { withTree } from './test-tree.mjs';

// Contract: agent-rules/principles.md § Aspect annotations, surfaces and hierarchy — only an aspect's audit writes
// its settings block — as agent-rules/runner.md § Post-batch guard checks it after each batch.

const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const HEAD = ['status: implemented', 'capabilities:', '  - Open a large scene'];
const BODY = '# Scene\n\nOpens scenes.\n';
const HELP_BLOCK = ['  help:', '    depth: reference'];
const BEFORE = fm(...HEAD, 'aspects:', ...HELP_BLOCK) + BODY;

const sameOutside = (after, before = BEFORE) => contentOutsideBlock(after, 'performance') === contentOutsideBlock(before, 'performance');

test('contentOutsideBlock: writing, changing or removing the audited aspect\'s own block is no edit outside it', () => {
	const bare = fm(...HEAD) + BODY;

	assert.equal(sameOutside(fm(...HEAD, 'aspects:', ...HELP_BLOCK, '  performance:', '    budget: "2 s"') + BODY), true, 'added after another block');
	assert.equal(sameOutside(fm(...HEAD, 'aspects:', '  performance:', '    budget: "2 s"', ...HELP_BLOCK) + BODY), true, 'added before another block');
	assert.equal(sameOutside(fm('status: implemented', 'aspects:', '  performance:', '    budget: "2 s"', 'capabilities:', '  - Open a large scene') + BODY, bare), true, 'a new aspects: key holding only this block');
	assert.equal(sameOutside(BEFORE, fm(...HEAD, 'aspects:', ...HELP_BLOCK, '  performance:', '    budget: "2 s"') + BODY), true, 'removed');
	assert.equal(sameOutside(BEFORE.replace(/\n/g, '\r\n')), true, 'line endings alone');
});

test('contentOutsideBlock: any other change is an edit outside the block — another aspect\'s block, a front-matter field, the body', () => {
	assert.equal(sameOutside(BEFORE.replace('depth: reference', 'depth: overview')), false);
	assert.equal(sameOutside(BEFORE.replace('status: implemented', 'status: partial')), false);
	assert.equal(sameOutside(BEFORE.replace('Opens scenes.', 'Opens scenes fast.')), false);
	assert.equal(sameOutside(fm(...HEAD, 'related: [TER]', 'aspects:', ...HELP_BLOCK) + BODY), false);
});

test('editedOutsideBlock: names each batch feature whose file changed outside the block since the snapshot, a deleted file included', async () => {
	const files = { 'features/SCN - Scene.md': BEFORE, 'features/TER - Terrain.md': BEFORE, 'features/CAM - Camera.md': BEFORE };
	await withTree(files, async (root) => {
		const features = Object.keys(files).map(path => ({ code: path.split('/')[1].split(' ')[0], path: join(root, path) }));
		const snapshot = snapshotBatch(features, 'performance');
		await writeFile(features[0].path, fm(...HEAD, 'aspects:', ...HELP_BLOCK, '  performance:', '    budget: "2 s"') + BODY, 'utf-8');
		await writeFile(features[1].path, BEFORE.replace('status: implemented', 'status: partial'), 'utf-8');
		await rm(features[2].path);

		assert.deepEqual(editedOutsideBlock(snapshot, features, 'performance'), ['TER', 'CAM']);
	});
});
