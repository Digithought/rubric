# Audit prompt — marketing

You are auditing whether each root feature in the batch has public-facing marketing coverage.

## What "covered" looks like

- A page, section, or repeated mention on the marketing site describes the feature in benefit-oriented language.
- The page reflects the feature's current `status:` — `implemented` features get current-tense prose; `partial` may be qualified; `planned` may be on a roadmap page rather than the main feature surface.
- SEO basics are present: distinct title, meta description, indexable URL.

## Investigation steps

1. Read the feature file's `summary` and `description`.
2. Locate the project's marketing site source. Search for the feature name and key capability phrases.
3. Skim the feature's positioning. Marketing language is benefit-oriented ("survey faster", "model your site without guesswork") rather than feature-listy.

## Verdict rules

- **covered** — the feature has a recognizable place on the marketing surface, with copy and SEO appropriate to its status.
- **partial** — feature is mentioned but undersold or buried. File a ticket scoped to the upgrade.
- **gap** — feature has no public-facing marketing presence. File a ticket.
- **n/a** — feature is internal (admin, ops, engine) or planned and not yet on a roadmap page.
