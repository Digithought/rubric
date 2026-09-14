import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { renderAnchorsAddendum, writeAnchorsAddendum } from './anchors-addendum.mjs';

/** A fresh temp directory, removed after the test. */
async function withTempDir(fn) {
	const dir = await mkdtemp(join(tmpdir(), 'rubric-anchors-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

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
	await withTempDir(async (repoRoot) => {
		const result = await writeAnchorsAddendum(repoRoot);

		assert.equal(result, 'skipped');
		await assert.rejects(readFile(join(repoRoot, 'tickets', 'rules', 'rubric-anchors.md'), 'utf-8'));
	});
});

test('writeAnchorsAddendum: creates the file under tickets/, then reports unchanged on a second call', async () => {
	await withTempDir(async (repoRoot) => {
		await mkdir(join(repoRoot, 'tickets'), { recursive: true });

		const first = await writeAnchorsAddendum(repoRoot);
		const written = await readFile(join(repoRoot, 'tickets', 'rules', 'rubric-anchors.md'), 'utf-8');
		const second = await writeAnchorsAddendum(repoRoot);

		assert.equal(first, 'created');
		assert.equal(written, renderAnchorsAddendum());
		assert.equal(second, 'unchanged');
	});
});

test('writeAnchorsAddendum: existing content that differs only by CRLF line endings is left untouched', async () => {
	await withTempDir(async (repoRoot) => {
		const rulesDir = join(repoRoot, 'tickets', 'rules');
		await mkdir(rulesDir, { recursive: true });
		const crlf = renderAnchorsAddendum().replace(/\n/g, '\r\n');
		const filePath = join(rulesDir, 'rubric-anchors.md');
		await writeFile(filePath, crlf, 'utf-8');

		const result = await writeAnchorsAddendum(repoRoot);
		const bytes = await readFile(filePath, 'utf-8');

		assert.equal(result, 'unchanged');
		assert.equal(bytes, crlf, 'CRLF checkout must not be rewritten to LF');
	});
});

test('writeAnchorsAddendum: different existing content is overwritten and reported as updated', async () => {
	await withTempDir(async (repoRoot) => {
		const rulesDir = join(repoRoot, 'tickets', 'rules');
		await mkdir(rulesDir, { recursive: true });
		const filePath = join(rulesDir, 'rubric-anchors.md');
		await writeFile(filePath, '---\nanchor-fields: features\n---\nStale hand-written copy.\n', 'utf-8');

		const result = await writeAnchorsAddendum(repoRoot);
		const bytes = await readFile(filePath, 'utf-8');

		assert.equal(result, 'updated');
		assert.equal(bytes, renderAnchorsAddendum());
	});
});
