# Audit prompt — help

You are auditing whether each feature in the batch has in-app help content addressing its capabilities.

## What "covered" looks like

- A help article, tutorial step, or contextual help entry describes the feature in user-facing language.
- Each `capability:` is at least mentioned or implied; major capabilities have their own section, paragraph, or step.
- The help content is reachable from the UI surfaces that expose the feature (or, at minimum, from the help index).

## Investigation steps

1. Read the feature file. Enumerate `capabilities:` and consider how a user would first encounter this feature.
2. Locate the project's help content (the project's `add-aspect.md` notes should specify where; common locations include a `help/` directory, a CMS, or an in-app docs registry). Search for the feature code, the feature name, and key capability phrases.
3. Decide whether the help is *adequate* — a single sentence buried in a tutorial is not sufficient for a feature with rich capabilities; a brief mention is fine for a small leaf feature.
4. If the feature is internal-only (engine plumbing, sync internals, contribution-point machinery), prefer `n/a` with a brief rationale.

## Verdict rules

- **covered** — adequate help content exists and is reachable.
- **partial** — help exists but does not address all capabilities or is hard to reach. File a ticket scoped to what is missing.
- **gap** — feature is user-facing and has no help. File a ticket.
- **n/a** — feature is internal-only or planned.

## Gap ticket contents

- The feature code and name.
- A short user-facing description (lift from the feature's `summary`).
- The capabilities the help should cover.
- Where in the help system the article should live (best guess; the help author may relocate).
