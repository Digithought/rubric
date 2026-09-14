/**
 * `tickets/rules/rubric-anchors.md` — the tess project-rules addendum that
 * declares `features:` and `aspects:` as anchor fields, alongside tess's own
 * `architecture:` (see rubric/agent-rules/principles.md § Rubric anchors).
 *
 * Only relevant to a project using tess (github.com/gotchoices/tess) for
 * tickets: tess reads `tickets/rules/*.md` addenda to learn which extra
 * header fields count as a ticket anchor. A project with no `tickets/`
 * directory has no use for the file, so `writeAnchorsAddendum` is a no-op
 * there rather than creating an orphaned folder.
 */

import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Path to the generated file, relative to the project root. */
export const ANCHORS_ADDENDUM_PATH = 'tickets/rules/rubric-anchors.md';

/** Render the addendum: a fenced `anchor-fields:` declaration plus a short explanatory body. */
export function renderAnchorsAddendum() {
	return `---
anchor-fields: features, aspects
---
Written by \`node rubric/scripts/init.mjs\`; hand edits are overwritten on the next init.

- \`features:\` — full hyphenated feature codes from \`features/\` (for example \`SIT-BRA\`), as a comma list or indented \`- item\` lines.
- \`aspects:\` — aspect folder names from \`aspects/\`.
- The anchor rule: \`rubric/agent-rules/principles.md\` § Rubric anchors.
- A ticket that changes what a capability says also updates the feature file in the same change: \`rubric/agent-rules/principles.md\` § The single-home rule.
`;
}

/**
 * Write (or refresh) `tickets/rules/rubric-anchors.md` under `repoRoot`.
 * Returns `'created'`, `'updated'`, `'unchanged'`, or `'skipped'` (no
 * `tickets/` directory — not a tess project).
 *
 * Compares against the existing file with CRLF normalised to LF, so a CRLF
 * checkout that already matches is left untouched rather than flipped to LF.
 * `tickets/rules` existing as a file (not a directory) is not handled here —
 * `mkdir` throws naming the path (`EEXIST` on Windows, `ENOTDIR` elsewhere),
 * and the caller lets that surface.
 */
export async function writeAnchorsAddendum(repoRoot) {
	const ticketsDir = join(repoRoot, 'tickets');
	if (!statSync(ticketsDir, { throwIfNoEntry: false })?.isDirectory()) return 'skipped';

	const filePath = join(repoRoot, ANCHORS_ADDENDUM_PATH);
	const next = renderAnchorsAddendum();

	if (existsSync(filePath)) {
		const cur = await readFile(filePath, 'utf-8');
		if (cur.replace(/\r\n/g, '\n') === next) return 'unchanged';
		await writeFile(filePath, next, 'utf-8');
		return 'updated';
	}

	await mkdir(join(ticketsDir, 'rules'), { recursive: true });
	await writeFile(filePath, next, 'utf-8');
	return 'created';
}
