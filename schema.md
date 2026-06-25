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

Each audit run writes a structured log to its run directory, `.runs/<runId>/<aspect>-batchN.md`:

```yaml
---
aspect: help
started: 2026-05-07T14:22:01Z
finished: 2026-05-07T14:25:18Z
batch:
  - SCN-ENT-CMP
  - SCN-HIER
  - INT-SEL
runner: <runId>
blockers: []                   # shared conditions observed; see below
---

## Verdicts

- SCN-ENT-CMP — covered (links to in-app help section "Components")
- SCN-HIER — gap; ticket filed: tickets/plan/help-scn-hier.md
- INT-SEL — n/a; feature is internal to the editor scaffolding
- TER-LYR — blocked (env/db-down)

## Notes

Free-form agent reasoning, evidence sketches, follow-ups.
```

`blocked (<id>)` is a fifth verdict: the feature couldn't be audited because of a shared blocker.

### Blockers in the run log

A **blocker** is a shared condition an agent observes that would impede *other* audits, not just its own (a dependency down, a missing tool, a stale shared artifact). Agents report blockers — **even when they finished their verdicts** — in the run-log front-matter so the runner can lift them into the manifest, warn later batches, and short-circuit a doomed run. A blocker is an observation, not a failure side-effect.

```yaml
blockers:
  - id: env/db-down            # short stable slug: <area>/<thing>
    scope: global              # global | aspect:<name> | feature:<CODE>
    severity: blocking         # blocking (couldn't validate) | degraded (validated, lower confidence)
    summary: Quereus in-memory init throws on startup
    detect: node -e "..." → throws       # how to tell it's still broken
    resolution-hint: bring up the DB     # what would clear it
```

Run logs are append-only and gitignored by default. The durable artifact of an audit is the gap **ticket**, not the run log.

## Run-manifest schema

A **run** is one orchestration pass (one logical plan), identified by a `runId` and homed in `.runs/<runId>/`. Its `manifest.md` is the run's checklist and blocker blackboard — the single piece of state the **runner owns and is the sole writer of**. Audit agents never touch it; they report upward through their own run logs, and the runner lifts verdicts and blockers into the manifest after each batch.

The manifest exists to:

1. **Stop cross-cutting blockers from wasting cycles** — open blockers are injected into later prompts and, when `global`/`blocking`, short-circuit the rest of the run.
2. **Enable resumption** — `done` tasks are skipped on a re-run; the rest re-dispatch (`run.mjs --resume <runId|last>`).
3. **Make progress visible** — the front-matter is the machine-readable truth; the rendered body below it is a human/UI snapshot.

```yaml
---
run: 2026-06-24T10-30-00Z-12345
trigger: weekly                # cadence, or aspect:<name> for --aspect runs
started: 2026-06-24T10:30:00Z
finished: null
status: in-progress            # planned | in-progress | completed | aborted
tasks:
  - id: code/batch1            # <aspect>/batch<N>
    aspect: code
    features: [SCN-ENT-CMP, SCN-HIER]
    status: done               # pending | running | done | failed | blocked | skipped
    attempts: 1
    log: code-batch1.md        # run-log filename within this run dir
    verdicts: { covered: 2, gap: 0, partial: 0, na: 0 }
  - id: code/batch2
    aspect: code
    features: [INT-SEL, INT-GIZ]
    status: blocked
    blocked-by: env/db-down
    attempts: 1
blockers:
  - id: env/db-down
    raised-by: code/batch2
    scope: global
    severity: blocking
    summary: Quereus in-memory init throws on startup
    detect: node -e "..." → throws
    resolution-hint: bring up the DB
    raised: 2026-06-24T10:35:00Z
    resolved: null             # set to an ISO datetime (by a human or a resume) to clear it
---

# Run 2026-06-24T10-30-00Z-12345 — weekly
...rendered checklist (regenerated by the runner on every transition)...
```

### Blocker lifecycle

- **Opened** by an agent (the primary path — a self-reported observation) or, as a backstop, synthesized by the runner when multiple batches fail without naming a cause.
- **Resolved** by a human editing `resolved:` in the manifest, or implicitly on `--resume`: blockers carried into a resumed run are treated as *unverified* — they still warn later prompts but don't halt until an agent re-confirms one this pass. Resolving a blocker makes its dependent `blocked` tasks eligible again.

Manifests live under `.runs/` and are gitignored by default, like run logs.
