import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { dueRank, readReleaseList, releaseRank } from './releases.mjs';
import { withTree } from './test-tree.mjs';

// Contract: agent-rules/principles.md § Current release assumption — the first code is current,
// an absent list turns the model off; tess owns the file's grammar.

const OFF = { present: false, current: null, codes: [], errors: [], unreadable: false };
const NOT_FOUND = "tickets/releases.md exists but tess's reader (tess/scripts/lib/releases.mjs) was not found";

test('readReleaseList: no tickets/releases.md turns the model off without loading tess', async () => {
	await withTree({ 'features/README.md': '# Features\n' }, async (root) => {
		let loads = 0;
		const list = await readReleaseList(root, { loadReader: async () => { loads++; throw new Error('must not load'); } });

		assert.deepEqual(list, OFF);
		assert.equal(loads, 0);
	});
});

test('readReleaseList: a present list comes through the reader — codes in order, the first current, errors prefixed with the file', async () => {
	await withTree({ 'tickets/releases.md': '## BETA\n' }, async (root) => {
		const reader = {
			async readReleases(ticketsDir) {
				assert.equal(ticketsDir, join(root, 'tickets'));
				return {
					present: true,
					entries: [{ code: 'BETA', due: null, line: 1 }, { code: 'GA', due: null, line: 3 }],
					errors: ['tickets/releases.md:3: due: soon is not a date — write due: YYYY-MM-DD', 'unprefixed problem'],
				};
			},
		};
		const list = await readReleaseList(root, { loadReader: async () => reader });

		assert.deepEqual(list, {
			present: true,
			current: 'BETA',
			codes: ['BETA', 'GA'],
			errors: ['tickets/releases.md:3: due: soon is not a date — write due: YYYY-MM-DD', 'tickets/releases.md: unprefixed problem'],
			unreadable: false,
		});
	});
});

test('readReleaseList: a list with no entries is on, with no current release', async () => {
	await withTree({ 'tickets/releases.md': '# Releases\n' }, async (root) => {
		const reader = { readReleases: async () => ({ present: true, entries: [], errors: [] }) };

		assert.deepEqual(await readReleaseList(root, { loadReader: async () => reader }), { ...OFF, present: true });
	});
});

test('readReleaseList: a reader that cannot be loaded is one error, and the list is marked unreadable', async () => {
	await withTree({ 'tickets/releases.md': '## BETA\n' }, async (root) => {
		const missing = Object.assign(new Error('Cannot find module'), { code: 'ERR_MODULE_NOT_FOUND' });

		assert.deepEqual(await readReleaseList(root, { loadReader: async () => { throw missing; } }), {
			...OFF, present: true, unreadable: true, errors: [NOT_FOUND],
		});
		// The default loader really imports tess/scripts/lib/releases.mjs, which this tree lacks.
		assert.deepEqual((await readReleaseList(root)).errors, [NOT_FOUND]);
	});
});

test('readReleaseList: the default loader imports the reader from tess/ under the project root', async () => {
	await withTree({
		'tickets/releases.md': '## BETA\n',
		'tess/scripts/lib/releases.mjs': 'export async function readReleases() { return { present: true, entries: [{ code: "BETA" }, { code: "GA" }], errors: [] }; }\n',
	}, async (root) => {
		const list = await readReleaseList(root);

		assert.deepEqual([list.current, list.codes, list.errors], ['BETA', ['BETA', 'GA'], []]);
	});
});

test('releaseRank: no code and the current code rank 0, a later code its position, an unlisted code -1', () => {
	const list = { present: true, current: 'BETA', codes: ['BETA', 'GA', 'LATER'], errors: [], unreadable: false };

	assert.equal(releaseRank(list, null), 0);
	assert.equal(releaseRank(list, 'BETA'), 0);
	assert.equal(releaseRank(list, 'LATER'), 2);
	assert.equal(releaseRank(list, 'RC'), -1);
	assert.equal(releaseRank(OFF, 'GA'), -1);
});

test('dueRank: releaseRank, except an unlisted code — one just shipped, or any code with no release list — ranks as current', () => {
	const list = { present: true, current: 'BETA', codes: ['BETA', 'GA'], errors: [], unreadable: false };

	assert.deepEqual([null, 'BETA', 'GA', 'RC'].map(code => dueRank(list, code)), [0, 0, 1, 0]);
	assert.equal(dueRank(OFF, 'GA'), 0);
});
