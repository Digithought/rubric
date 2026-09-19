import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { TESS_WORKED_STAGES, TESTING_ADDENDUM_PATH, renderTestingAddendum, writeTestingAddendum } from './testing-addendum.mjs';
import { withTree } from './test-tree.mjs';

// Contract: agent-rules/principles.md § Testing policy reaches ticket agents through
// tickets/rules/rubric-testing.md, which init owns (agent-rules/init.md step 6).

test('renderTestingAddendum: declares nothing (line 1 is not a fence), states the bar, and ends with a newline', () => {
	const text = renderTestingAddendum();

	assert.notEqual(text.split('\n')[0].trim().slice(0, 3), '---');
	assert.match(text, /\*\*A test must pay for itself\.\*\*/);
	assert.ok(text.endsWith('\n'));
});

test('renderTestingAddendum: every stage the tess runner works has exactly one closed block, so no prompt gets the body with raw markers', () => {
	const text = renderTestingAddendum();

	for (const stage of TESS_WORKED_STAGES) {
		assert.equal(text.split(`<!-- stage:${stage} -->`).length - 1, 1, `one block for ${stage}`);
	}
	assert.equal(text.split('<!-- /stage -->').length - 1, TESS_WORKED_STAGES.length);
	assert.deepEqual(TESS_WORKED_STAGES, ['fix', 'plan', 'implement', 'review']);
});

test('writeTestingAddendum: skipped without tickets/, created with it, then unchanged', async () => {
	await withTree({}, async (repoRoot) => {
		assert.equal(await writeTestingAddendum(repoRoot), 'skipped');
	});
	await withTree({ 'tickets/.keep': '' }, async (repoRoot) => {
		const first = await writeTestingAddendum(repoRoot);
		const written = await readFile(join(repoRoot, TESTING_ADDENDUM_PATH), 'utf-8');

		assert.equal(first, 'created');
		assert.equal(written, renderTestingAddendum());
		assert.equal(await writeTestingAddendum(repoRoot), 'unchanged');
	});
});

test('writeTestingAddendum: a hand-edited file is overwritten, a CRLF copy is left alone', async () => {
	await withTree({ [TESTING_ADDENDUM_PATH]: 'edited by hand\n' }, async (repoRoot) => {
		assert.equal(await writeTestingAddendum(repoRoot), 'updated');
		assert.equal(await readFile(join(repoRoot, TESTING_ADDENDUM_PATH), 'utf-8'), renderTestingAddendum());
	});
	const crlf = renderTestingAddendum().replace(/\n/g, '\r\n');
	await withTree({ [TESTING_ADDENDUM_PATH]: crlf }, async (repoRoot) => {
		assert.equal(await writeTestingAddendum(repoRoot), 'unchanged');
		assert.equal(await readFile(join(repoRoot, TESTING_ADDENDUM_PATH), 'utf-8'), crlf);
	});
});
