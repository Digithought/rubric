# Audit prompt — code

You are auditing whether each feature in the batch is implemented in source code and reachable from a stable cross-reference.

## What "covered" looks like

- One or more source files contain logic that plausibly implements the feature's `capabilities`.
- At least one source location carries a `FEATURE: <CODE>` comment (or equivalent registration metadata) referencing this feature's code.
- The implementation is reachable from the application's entry points (not orphaned scratch code).

## Investigation steps

1. Read the feature file. Note the `summary`, `description`, and `capabilities`.
2. Search the codebase for the feature code as a literal (`FEATURE: SCN-ENT-CMP`). If found in a comment or registration table, follow it to the implementing code.
3. If no `FEATURE:` cross-reference exists, search for terms that match `capabilities` to find probable implementation. Confirm the match is real (function names, file purpose, integration with the surrounding system) — do not be fooled by lexical coincidence.  `code-search` MCP may be useful if available.
4. Check the feature's `status:` against what you found. A `status: implemented` feature with no code is a clear gap. A `status: planned` feature with no code is *not* a gap (planned means future).

## Verdict rules

- **covered** — code exists *and* a `FEATURE:` cross-reference is present. Note the file paths.
- **gap** — `status: implemented` or `partial` but no source you can identify. File a ticket.
- **gap (cross-ref missing)** — code clearly implements the feature, but no `FEATURE:` comment marks it.  You can fix this directly rather than filing a ticket.
- **partial** — code exists for some `capabilities:` but not others. File a ticket scoped to the missing capabilities.
- **n/a** — feature is `planned` (no implementation expected) or `retired`.

