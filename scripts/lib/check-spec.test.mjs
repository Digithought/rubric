import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { withTree } from './test-tree.mjs';

// Contract: schema.md § Checking the spec — the exit status a CI step running check-spec.mjs reads.

const CHECK_SPEC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-spec.mjs');
const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const checkSpec = (...args) => spawnSync(process.execPath, [CHECK_SPEC, ...args], { encoding: 'utf-8' });
const lines = (text) => text.trim().split(/\r?\n/);

const SCN = 'features/SCN - Scene.md';
const CLEAN = {
	[SCN]: fm('status: planned', 'capabilities:', '  - Browse the scene'),
	'aspects/help/aspect.md': fm('name: help', 'status: active', 'level: leaf'),
};

test('check-spec: a clean spec exits 0 and says what it checked', async () => {
	await withTree(CLEAN, (root) => {
		const run = checkSpec('--root', root);

		assert.deepEqual([run.status, lines(run.stdout), run.stderr], [0, ['rubric spec: 1 features, 1 aspects — clean'], '']);
	});
});

test('check-spec: any spec error exits 1, printing each as path:line: message, then a count', async () => {
	await withTree({ ...CLEAN, [SCN]: fm('status: planned', 'surfaces: [web]') }, (root) => {
		const run = checkSpec('--root', root);

		assert.equal(run.status, 1);
		assert.deepEqual(lines(run.stderr), [
			`${SCN}:3: surfaces: is used but features/README.md declares no surface vocabulary (a surfaces: list in its front-matter)`,
			'',
			'rubric spec: 1 error(s) — field rules are in rubric/schema.md',
		]);
	});
});

test('check-spec: a root with no features exits 1; a bad argument exits 2', async () => {
	await withTree({}, (root) => {
		const run = checkSpec('--root', root);

		assert.deepEqual([run.status, lines(run.stderr)], [1, [`No features found under ${join(root, 'features')}. Did you run rubric init?`]]);
	});
	assert.equal(checkSpec('--root').status, 2);
	assert.equal(checkSpec('--strict').status, 2);
});
