import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { withTree } from './test-tree.mjs';

// Contract: agent-rules/principles.md § Current release assumption — shipping strips every target: tag
// naming the shipped code; and schema.md § Checking the spec — `coverage.mjs ship` checks after
// stripping, not before. These drive the command itself: its guards, exit statuses and output.

const COVERAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'coverage.mjs');
const fm = (...lines) => ['---', ...lines, '---', ''].join('\n');
const lines = (text) => text.trim().split(/\r?\n/);
/** `coverage.mjs ship <args>` against the project at `root` — outside any git repository, so no ship commit is found. */
const ship = (root, ...args) => spawnSync(process.execPath, [COVERAGE, 'ship', ...args, '--root', root], { encoding: 'utf-8' });

const SCN = 'features/SCN - Scene.md';
const TAGGED = fm('status: planned', 'target: BETA', 'capabilities:', '  - Pick an entity', '  - text: Export to KML', '    target: BETA');
const STRIPPED = fm('status: planned', 'capabilities:', '  - Pick an entity', '  - Export to KML');

/** tess's release-list reader, stubbed to list `codes`: rubric loads it from the project root. */
const reader = (...codes) => `export async function readReleases() { return { present: true, entries: ${JSON.stringify(codes.map(code => ({ code })))}, errors: [] }; }\n`;
const releaseList = (...codes) => ({ 'tickets/releases.md': codes.map(c => `## ${c}\n`).join('\n'), 'tess/scripts/lib/releases.mjs': reader(...codes) });
/** BETA has shipped through tess: only GA is left, and SCN still carries BETA's tags. */
const AFTER_TESS_SHIP = { [SCN]: TAGGED, ...releaseList('GA') };

const scn = (root) => readFile(join(root, SCN), 'utf-8');

test('coverage.mjs ship --dry-run prints what it would strip and changes nothing', async () => {
	await withTree(AFTER_TESS_SHIP, async (root) => {
		const run = ship(root, 'BETA', '--dry-run');

		assert.deepEqual([run.status, lines(run.stdout), run.stderr], [0, [
			'Strip target: BETA from 1 feature file:',
			`  ${SCN}: feature target, 1 capability target`,
			'',
			'Dry run — nothing changed.',
		], '']);
		assert.equal(await scn(root), TAGGED);
	});
});

test('coverage.mjs ship strips the shipped code\'s tags and reports the counts; running it again strips nothing and still exits 0', async () => {
	await withTree(AFTER_TESS_SHIP, async (root) => {
		const first = ship(root, 'BETA');
		assert.deepEqual([first.status, lines(first.stdout).at(-1), first.stderr], [0, 'stripped BETA: 1 feature target, 1 capability target in 1 file', '']);
		assert.equal(await scn(root), STRIPPED);

		const again = ship(root, 'BETA');
		assert.deepEqual([again.status, lines(again.stdout)], [0, ['No feature file carries target: BETA.', 'stripped BETA: 0 feature targets, 0 capability targets in 0 files']]);
		assert.equal(await scn(root), STRIPPED);
	});
});

test('coverage.mjs ship keeps the strip but exits 1 when the spec is still invalid afterwards, printing what is left', async () => {
	const TER = 'features/TER - Terrain.md';
	await withTree({ ...AFTER_TESS_SHIP, [TER]: fm('status: implemented', 'target: OLD') }, async (root) => {
		const run = ship(root, 'BETA');

		assert.equal(run.status, 1);
		assert.deepEqual(lines(run.stderr), [
			`${TER}:3: target: OLD is not a code in tickets/releases.md`,
			'',
			'rubric spec: 1 error(s) after stripping BETA — field rules are in rubric/schema.md',
		]);
		assert.equal(await scn(root), STRIPPED);
	});
});

test('coverage.mjs ship refuses, touching nothing, while the code is still listed (exit 1), without a release list (exit 1), or with no code to strip (exit 2)', async () => {
	const refusals = [
		[{ [SCN]: TAGGED, ...releaseList('BETA', 'GA') }, ['BETA'], 1, 'BETA is still in tickets/releases.md — run node tess/scripts/release.mjs ship first'],
		[{ [SCN]: TAGGED }, ['BETA'], 1, 'tickets/releases.md does not exist — nothing was shipped through tess'],
		[AFTER_TESS_SHIP, [], 2, 'name the shipped release: coverage.mjs ship <CODE>'],
	];
	for (const [tree, args, status, message] of refusals) {
		await withTree(tree, async (root) => {
			const run = ship(root, ...args);

			assert.deepEqual([run.status, lines(run.stderr), run.stdout], [status, [message], '']);
			assert.equal(await scn(root), TAGGED);
		});
	}
});

test('coverage.mjs ship rejects an unknown option or a second code with exit 2', async () => {
	await withTree(AFTER_TESS_SHIP, async (root) => {
		assert.equal(ship(root, 'BETA', '--force').status, 2);
		assert.equal(ship(root, 'BETA', 'GA').status, 2);
		assert.equal(await scn(root), TAGGED);
	});
});
