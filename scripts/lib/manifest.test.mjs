import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { MANIFEST_FILE, createManifest, readManifest, writeManifest } from './manifest.mjs';
import { withTree } from './test-tree.mjs';

// Contract: schema.md § Run-manifest schema — a manifest records the target a run was planned under, the current
// release and whether a release list exists, and its rendered heading shows them.

const TASKS = [{ id: 'code/batch1', aspect: 'code', features: ['SCN-PCK'], log: 'code-batch1.md' }];
const manifest = (runId, target, release, releaseList) => createManifest({
	runId, trigger: 'weekly', target, release, releaseList, startedAt: '2026-09-14T00:00:00Z', tasks: TASKS,
});

test('createManifest: target, release and release-list round-trip through writeManifest and readManifest', async () => {
	await withTree({}, async (runsDir) => {
		await writeManifest(runsDir, manifest('r1', 'GA', 'BETA', 'present'));
		await writeManifest(runsDir, manifest('r2', 'current', null, 'absent'));

		const fields = async (runId) => {
			const read = await readManifest(runsDir, runId);
			return [read.target, read.release, read['release-list']];
		};
		assert.deepEqual(await fields('r1'), ['GA', 'BETA', 'present']);
		assert.deepEqual(await fields('r2'), ['current', null, 'absent']);
	});
});

test('writeManifest: the heading shows the target, and for a current run the release or that there is no release list', async () => {
	await withTree({}, async (runsDir) => {
		const heading = async (m) => {
			await writeManifest(runsDir, m);
			return (await readFile(join(runsDir, m.run, MANIFEST_FILE), 'utf-8')).split('\n').find(line => line.startsWith('# Run '));
		};

		assert.equal(await heading(manifest('r1', 'GA', 'BETA', 'present')), '# Run r1 — weekly · target GA');
		assert.equal(await heading(manifest('r2', 'current', 'BETA', 'present')), '# Run r2 — weekly · target current (release BETA)');
		assert.equal(await heading(manifest('r3', 'current', null, 'absent')), '# Run r3 — weekly · target current (no tickets/releases.md — everything is current)');
	});
});
