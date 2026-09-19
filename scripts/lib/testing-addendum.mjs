/**
 * `tickets/rules/rubric-testing.md` — the tess project-rules addendum that
 * carries the testing policy (rubric/agent-rules/principles.md § Testing
 * policy) into every ticket prompt, so the agent writing or reviewing code is
 * told when a test pays for itself at the moment it would otherwise add one.
 *
 * It declares no header fields, so line 1 is not a fence and the whole file is
 * body. Every stage the tess runner works has a block: tess keeps a body whole,
 * markers included, when it has blocks but none for the ticket's stage.
 */

import { writeTessAddendum } from './tess-addendum.mjs';

/** Path to the generated file, relative to the project root. */
export const TESTING_ADDENDUM_PATH = 'tickets/rules/rubric-testing.md';

/** The tess stages an addendum must give a block to. */
export const TESS_WORKED_STAGES = ['fix', 'plan', 'implement', 'review'];

const STAGE_TEXT = {
	fix: 'The reproduction is the one test this ticket owes. Put it at the lowest layer that reproduces the bug and name the bug in a `// regression:` comment.',
	plan: 'An `## Edge cases & interactions` entry is something the implementer must handle and the reviewer must check. Say how each is verified: by inspection, by a type, by an assertion at a seam, or by a test. Name a test only for entries that meet the bar above.',
	implement: 'In the handoff, list each test you added beside the spec line or bug it verifies. A change with nothing that meets the bar ships with no new test; say so in one line instead of adding filler.',
	review: 'Review the tests as code to be cut, not a floor to build on. Delete added tests that restate the implementation, assert a call on a mocked project module, or duplicate a cheaper enforcer. Add a test only for a defect you actually found or a named contract left unverified. Report tests added and tests removed.',
};

/** Render the addendum: the shared bar, then one block per worked stage. */
export function renderTestingAddendum() {
	const blocks = TESS_WORKED_STAGES.map(stage => `<!-- stage:${stage} -->\n${STAGE_TEXT[stage]}\n<!-- /stage -->`).join('\n');
	return `Written by \`node rubric/scripts/init.mjs\`; hand edits are overwritten on the next init. Full policy: \`rubric/agent-rules/principles.md\` § Testing policy. Where this disagrees with a general instruction to "cover" a change or "add tests", this wins.

**A test must pay for itself.** Write one only when it is (a) the reproduction of the bug being fixed; (b) an example or property of a named capability or architecture invariant, on logic with real branching, and it says which spec line it verifies; or (c) required by the project's risk tiers. Do not write tests for wiring, registration, glue, getters, constants, or anything a type, lint rule or check script already enforces. Do not mock a module this repository owns: a test that needs such a mock is at the wrong layer, so move it down to the pure function or up to a smoke path. One test per behaviour, never a second case that differs only in its literals. Every test is run time and maintenance that each later ticket pays, so fewer and sharper is the goal.

${blocks}
`;
}

/** Write (or refresh) the addendum under `repoRoot`; see `writeTessAddendum` for the return values. */
export function writeTestingAddendum(repoRoot) {
	return writeTessAddendum(repoRoot, TESTING_ADDENDUM_PATH, renderTestingAddendum());
}
