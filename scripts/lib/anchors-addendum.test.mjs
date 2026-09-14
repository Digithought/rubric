import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { ANCHORS_ADDENDUM_PATH, renderAnchorsAddendum, writeAnchorsAddendum } from './anchors-addendum.mjs';
import { withTree } from './test-tree.mjs';

// Contract: agent-rules/principles.md § Rubric anchors — a tess project declares features: and aspects:
// as anchor fields through tickets/rules/rubric-anchors.md, which init owns (agent-rules/init.md step 6).

test('renderAnchorsAddendum: line 1 is a fence, the header declares features/aspects and closes, the body is non-empty, and it ends with a newline', () => {
	const text = renderAnchorsAddendum();
	const lines = text.split('\n');

	assert.equal(lines[0], '---');
	const closeIndex = lines.indexOf('---', 1);
	assert.ok(closeIndex > 0, 'header must close with a second fence');
	assert.ok(lines.slice(1, closeIndex).includes('anchor-fields: features, aspects'));
	assert.ok(lines.slice(closeIndex + 1).join('\n').trim().length > 0, 'body must be non-empty');
	assert.ok(text.endsWith('\n'));
});

test('writeAnchorsAddendum: no tickets/ directory is skipped and creates nothing', async () => {
	await withTree({}, async (repoRoot) => {
		const result = await writeAnchorsAddendum(repoRoot);

		assert.equal(result, 'skipped');
		await assert.rejects(readFile(join(repoRoot, 'tickets'), 'utf-8'));
	});
});

test('writeAnchorsAddendum: tickets as a plain file is not a tess board, so it is skipped and left as it was', async () => {
	await withTree({ tickets: 'not a directory\n' }, async (repoRoot) => {
		const result = await writeAnchorsAddendum(repoRoot);

		assert.equal(result, 'skipped');
		assert.equal(await readFile(join(repoRoot, 'tickets'), 'utf-8'), 'not a directory\n');
	});
});

test('writeAnchorsAddendum: creates the file under tickets/, then reports unchanged on a second call', async () => {
	await withTree({ 'tickets/.keep': '' }, async (repoRoot) => {
		const first = await writeAnchorsAddendum(repoRoot);
		const written = await readFile(join(repoRoot, ANCHORS_ADDENDUM_PATH), 'utf-8');
		const second = await writeAnchorsAddendum(repoRoot);

		assert.equal(first, 'created');
		assert.equal(written, renderAnchorsAddendum());
		assert.equal(second, 'unchanged');
	});
});

test('writeAnchorsAddendum: existing content that differs only by CRLF line endings is left untouched', async () => {
	const crlf = renderAnchorsAddendum().replace(/\n/g, '\r\n');
	await withTree({ [ANCHORS_ADDENDUM_PATH]: crlf }, async (repoRoot) => {
		const result = await writeAnchorsAddendum(repoRoot);
		const bytes = await readFile(join(repoRoot, ANCHORS_ADDENDUM_PATH), 'utf-8');

		assert.equal(result, 'unchanged');
		assert.equal(bytes, crlf, 'CRLF checkout must not be rewritten to LF');
	});
});

test('writeAnchorsAddendum: different existing content is overwritten and reported as updated', async () => {
	await withTree({ [ANCHORS_ADDENDUM_PATH]: '---\nanchor-fields: features\n---\nStale hand-written copy.\n' }, async (repoRoot) => {
		const result = await writeAnchorsAddendum(repoRoot);
		const bytes = await readFile(join(repoRoot, ANCHORS_ADDENDUM_PATH), 'utf-8');

		assert.equal(result, 'updated');
		assert.equal(bytes, renderAnchorsAddendum());
	});
});

test('writeAnchorsAddendum: tickets/rules as a plain file fails naming the path rather than writing anywhere else', async () => {
	await withTree({ 'tickets/rules': 'not a directory\n' }, async (repoRoot) => {
		// The error code is platform-dependent (EEXIST on Windows, ENOTDIR elsewhere); only the path is asserted.
		await assert.rejects(writeAnchorsAddendum(repoRoot), (err) => String(err.message).includes('rules'));
		assert.equal(await readFile(join(repoRoot, 'tickets', 'rules'), 'utf-8'), 'not a directory\n');
	});
});
