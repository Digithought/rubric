import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Run `fn(root)` over a temp directory holding `files` (relative path → content); the directory is removed afterwards. */
export async function withTree(files, fn) {
	const root = await mkdtemp(join(tmpdir(), 'rubric-test-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			const full = join(root, path);
			await mkdir(dirname(full), { recursive: true });
			await writeFile(full, content, 'utf-8');
		}
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
