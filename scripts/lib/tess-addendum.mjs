/**
 * Shared writer for the tess project-rules addenda rubric owns
 * (`tickets/rules/rubric-*.md`).
 *
 * Only relevant to a project using tess (github.com/gotchoices/tess) for
 * tickets: tess appends every `tickets/rules/*.md` file to its agent prompts.
 * A project with no `tickets/` directory has no use for the files, so the
 * writer is a no-op there rather than creating an orphaned folder.
 */

import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Write (or refresh) one addendum at `relPath` (relative to `repoRoot`) with
 * content `text`. Returns `'created'`, `'updated'`, `'unchanged'`, or
 * `'skipped'` (no `tickets/` directory — not a tess project).
 *
 * Compares against the existing file with CRLF normalised to LF, so a CRLF
 * checkout that already matches is left untouched rather than flipped to LF.
 * `tickets/rules` existing as a file (not a directory) is not handled here —
 * `mkdir` throws naming the path (`EEXIST` on Windows, `ENOTDIR` elsewhere),
 * and the caller lets that surface.
 */
export async function writeTessAddendum(repoRoot, relPath, text) {
	const ticketsDir = join(repoRoot, 'tickets');
	if (!statSync(ticketsDir, { throwIfNoEntry: false })?.isDirectory()) return 'skipped';

	const filePath = join(repoRoot, relPath);

	if (existsSync(filePath)) {
		const cur = await readFile(filePath, 'utf-8');
		if (cur.replace(/\r\n/g, '\n') === text) return 'unchanged';
		await writeFile(filePath, text, 'utf-8');
		return 'updated';
	}

	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, text, 'utf-8');
	return 'created';
}
