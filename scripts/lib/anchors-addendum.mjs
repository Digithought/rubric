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

import { writeTessAddendum } from './tess-addendum.mjs';

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

/** Write (or refresh) the addendum under `repoRoot`; see `writeTessAddendum` for the return values. */
export function writeAnchorsAddendum(repoRoot) {
	return writeTessAddendum(repoRoot, ANCHORS_ADDENDUM_PATH, renderAnchorsAddendum());
}
