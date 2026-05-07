# Audit prompt — unit-tests

You are auditing whether each feature in the batch has unit-test coverage of its `capabilities:` list.

## What "covered" looks like

- One or more test files exercise the feature's logic.
- The capabilities listed in the feature's front-matter are each represented by at least one test case (a `describe`/`it`/`test` whose name or assertions clearly correspond).
- Tests reference the feature via `FEATURE: <CODE>` comment or in a `describe` name like `describe('FEATURE: <CODE>', …)`.

## Investigation steps

1. Read the feature file. Enumerate `capabilities:`.
2. Search for tests carrying `FEATURE: <CODE>`. If absent, search for tests against the implementing code (find the implementation first if needed).
3. For each capability, decide whether at least one test plausibly exercises it. Be reasonable — a capability like "preserve children's world positions during free-transform" warrants a direct test; a capability like "the cache invalidates only when relevant data columns change" warrants both a positive and negative test.
4. Note the test file paths and the capabilities each one covers.

## Verdict rules

- **covered** — every capability has at least one corresponding test, and tests reference the feature code.
- **partial** — some capabilities are tested but not others. File a ticket listing the uncovered capabilities.
- **gap** — no tests are identifiable. File a ticket.
- **gap (cross-ref missing)** — tests exist but do not carry the feature code. File a smaller ticket.
- **n/a** — feature is `planned` (no tests expected) or describes a non-testable concern (e.g., a high-level marketing feature with no logic).

## Gap ticket contents

- The feature code and name.
- The capability list, with each marked covered/uncovered.
- File paths to the relevant tests, where they exist.
- A pointer to the implementing code if it is not test-adjacent.
