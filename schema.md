# Rubric schemas

Front-matter conventions for feature and aspect files.

## Feature front-matter

Every feature file (`features/<CODE> - <Name>.md` or nested branch file) carries:

```yaml
---
status: implemented            # implemented | partial | planned | retired
summary: |                     # 1–2 sentence headline, user-facing
  ...
description: |                 # 1–3 paragraph functional spec (optional for very small leaves)
  ...
capabilities:                  # discrete user-facing capabilities; bullets agents reason over
  - First capability
  - Second capability
related: [CRD, TER-LYR, INT]   # cross-references to other feature codes (full hyphenated form)
---
```

### Coding scheme

- 3–5 uppercase letters per layer, mnemonic where possible.
- Hyphenated for nesting: `LIB-INS-MFT` (library install, manifest validation).
- Unique within siblings, not globally; the same segment may appear under different parents.
- Stable: once published, codes are retired but never reassigned.

### File naming

A feature's code and name live in the **filename**, not in front-matter. Branch filenames use the **leaf code only**; the full hyphenated code is implied by the directory path:

```
features/
├── README.md                                        ← project root index, group tables, project-specific notes
├── <CODE> - <Name>.md                               ← one file per root feature
└── <ROOT-CODE> - <Root Name>/                       ← directory of branch docs (when populated)
    ├── <BRANCH-CODE> - <Branch Name>.md             ← branch docs use the leaf code only
    └── <BRANCH-CODE> - <Branch Name>/               ← deeper levels nest the same way
        └── <SUB-BRANCH-CODE> - <Sub-Branch Name>.md
```

So `SCN - Scene/HIER - Hierarchy.md` represents the feature whose full code is `SCN-HIER`.

## Aspect front-matter

Each project-active aspect file (`aspects/<name>/aspect.md`) carries:

```yaml
---
name: help                     # mirrors folder; included for clarity
status: active                 # active | draft | retired
level: leaf                    # root | branch | leaf | any — which features the audit walks
batch: 8                       # max features per agent invocation
cadence:                       # one or more
  - on-demand
  - on-change
  - weekly
extends: help                  # optional; default is folder name. Names a rubric/defaults/aspects/<name>/
prompt: prompt.md              # optional override of default prompt
ticket-template: ticket-template.md   # optional override
ticket-system: tess            # which ticket system to file gaps into
ticket-stage: plan             # stage / queue within the ticket system
applies-to:                    # optional restriction; default = all features matching `level`
  include: [SCN, INT-SEL]
  exclude: [WEB, ADM]
---
```

### Cadence values

- `on-demand` — explicit invocation only.
- `on-change` — triggered by file change (pre-merge hook, post-commit, etc.).
- `daily` / `weekly` / `monthly` — scheduled.

An aspect can list multiple cadences; the runner unions them.

### Level

- `root` — only top-level features.
- `branch` — non-leaf, non-root features.
- `leaf` — leaves of the inventory tree.
- `any` — every feature. Use sparingly; expensive.

### Override semantics

- A project activates an aspect by creating its folder and at least an `aspect.md`.
- If `prompt.md` is absent, the runner uses `rubric/defaults/aspects/<extends>/prompt.md`.
- If `ticket-template.md` is absent, same fallback.
- If a default doesn't exist for `<extends>`, the project must supply both.

## Run-log schema

Each audit run writes a structured log to `.runs/<ISO-datetime>-<aspect>.md`:

```yaml
---
aspect: help
started: 2026-05-07T14:22:01Z
finished: 2026-05-07T14:25:18Z
batch:
  - SCN-ENT-CMP
  - SCN-HIER
  - INT-SEL
runner: dispatch-id-or-cadence
---

## Verdicts

- SCN-ENT-CMP — covered (links to in-app help section "Components")
- SCN-HIER — gap; ticket filed: tickets/plan/help-scn-hier.md
- INT-SEL — n/a; feature is internal to the editor scaffolding

## Notes

Free-form agent reasoning, evidence sketches, follow-ups.
```

Run logs are append-only and gitignored by default. The durable artifact of an audit is the gap **ticket**, not the run log.
