# Rubric schemas

Front-matter conventions for feature and aspect files.

## Feature front-matter

Every feature file (`features/<CODE> - <Name>.md` or nested branch file) carries:

```yaml
---
status: implemented            # CHILDLESS NODES ONLY — implemented | partial | planned | retired
summary: |                     # 1–2 sentence headline, user-facing
  ...
description: |                 # 1–3 paragraph functional spec (optional for very small leaves)
  ...
capabilities:                  # discrete user-facing capabilities; bullets agents reason over
  - First capability           # plain text: due with the feature
  - text: Export to KML        # object form, only to defer one capability to a later release
    target: GA
related: [CRD, TER-LYR, INT]   # cross-references to other feature codes (full hyphenated form)
surfaces: [web, api]           # optional; the surfaces the feature exists on — descendants that omit it inherit it
target: GA                     # optional; a later release the feature is deferred to — descendants inherit it
aspects:                       # optional; one settings block per aspect that declares an annotation:
  performance:
    budget: "opens within 2 s on the reference machine"
    workload: open-large
---
```

### `status` is stored only where nothing can derive it

**A file stores `status` if and only if it has no descendants.** A childless root counts as a leaf and keeps its `status`. A file with descendants derives its status instead, and must not store one:

| Descendant leaves (ignoring `retired`) | Derived status |
|---|---|
| none left — every descendant is `retired` | `retired` |
| all `implemented` | `implemented` |
| all `planned` | `planned` |
| anything else | `partial` |

A stored copy on a branch is a second home for the same fact, and nothing updates it when a leaf changes. Measured on SiteCAD before this rule: 22 of 51 branches (43%) claimed a status their own leaves contradicted — all 22 overclaimed, none understated, because the leaf edit that would falsify it happens far from the branch file.

Retiring a branch means retiring its leaves; once every descendant is `retired`, the branch derives `retired` too.

### `surfaces` and `target` inherit down the tree

A node's effective value is its own declaration, else its nearest ancestor's. A subtree that exists on one surface, or is deferred as a whole, says so once at its top node rather than on every leaf.

- **`surfaces:`** — a non-empty list of names from the [surface vocabulary](#surface-vocabulary); omit the field rather than writing `[]`. A descendant may declare surfaces outside its ancestor's. An aspect that declares `surfaces:` audits a feature only when their surfaces intersect, so a feature with no effective surfaces is not audited by it.
- **`target:`** — a later code from `tickets/releases.md`; anything without one is due in the current release ([principles](agent-rules/principles.md#current-release-assumption)). Naming the current code means the same as no tag. Using `target:` requires the release list to exist, and a descendant cannot target a release before its ancestor's. Once tess ships that release, its code no longer exists in the list, and `node rubric/scripts/coverage.mjs ship <CODE>` strips every `target:` tag naming it, at the feature and the capability level alike.

### Capabilities

Each item is plain text, due with its feature, or the object form `{ text, target }`, which defers that one capability. In the object form `text` is one non-empty line and `target` is required — a capability with no target uses the plain form — and the capability cannot target a release before its feature's effective target. A plain capability that starts with `Word: ` parses as a mapping; quote the line.

### `aspects:` — settings an aspect owns

One block per aspect, keyed by the aspect's folder name, holding the settings its [`annotation:`](#surfaces-parent-and-annotation) declares. The audit uses the annotation's defaults overlaid by the block; an empty block means the defaults. Only an active aspect that declares `annotation:` takes a block, every key must be one it declares, and every value must have the declared type.

A block does not inherit: it belongs to the node the aspect audits, and a copy on an ancestor would be dead data. So a block on a feature the aspect does not apply to is an error, retired features excepted.

### Surface vocabulary

`features/README.md` declares the surface names in its front-matter:

```yaml
---
surfaces: [web, mobile, api, viewer]
---
```

Names match `^[a-z][a-z0-9-]*$` and are listed once. Any `surfaces:` on a feature or aspect requires this list.

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
staleness:                     # optional; governs when a prior audit is re-run (see below)
  drift-threshold: 1           # relevant commits since audit before the record is drift-stale
  max-age: null                # optional wall-clock safety net; null = off (default)
  on-spec-change: stale        # feature-hash mismatch → stale | ignore
  on-criteria-change: stale    # aspect-hash mismatch  → stale | ignore
surfaces: [web]                # optional; audit only features on these surfaces — absent = regardless of surfaces
parent: ux                     # optional; the folder name of another aspect
annotation:                    # optional; schema and defaults for features' aspects.<name> block
  budget:
    type: string               # string | number | boolean | enum | list
    default: "..."
  depth:
    type: enum
    values: [overview, reference]
    default: overview
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
- A child aspect's audit composes its prompt and template with its parent's — see [`parent:`](#surfaces-parent-and-annotation).

### Staleness

`staleness:` controls when an existing coverage record (see **Coverage-ledger schema**) is considered stale and re-audited by `run.mjs --stale-only`. All keys optional; omitting the block uses the defaults shown above.

- `drift-threshold` (default `1`) — number of commits touching a record's `evidence` paths, since the commit it was audited at, before it goes **drift-stale**. `1` = any relevant change re-audits; raise to tolerate churn.
- `max-age` (default `null`, off) — a wall-clock backstop. When set (e.g. `180d`, `12w`, `90`), a record older than this is **age-stale** *even if git shows no drift*. Left off, an inactive repo never ages a record out — drift is the primary signal.
- `on-spec-change` (default `stale`) — when the feature's fingerprint for this aspect (`feature-hash`) no longer matches, mark **spec-stale**. Set `ignore` for aspects indifferent to spec edits.
- `on-criteria-change` (default `stale`) — when the resolved aspect config's hash no longer matches, mark **criteria-stale**. Set `ignore` to keep verdicts across prompt tweaks.

Staleness is **derived at read time** by comparing a record's stored hashes and `audited-commit` against the current files and git history — never persisted. See the ledger schema for the state precedence.

### Surfaces, parent and annotation

- **`surfaces:`** — names from the [surface vocabulary](#surface-vocabulary), as on features. `level`, `applies-to` and `surfaces` compose: all three must admit a feature.
- **`parent:`** — the folder name of another active aspect that has no `parent:` of its own (one level only). A child is an ordinary folder, `aspects/<child>/`, so its name stays one path segment everywhere an aspect is named. What the hierarchy means: [principles](agent-rules/principles.md#aspect-annotations-surfaces-and-hierarchy). A child takes from its parent:
  - **applicability** — a feature must be admitted by the parent's `level`, `applies-to` and `surfaces` as well as by the child's own, so whatever the child omits it inherits. A child that declares `level:` declares its parent's.
  - **prompt** — its audit's prompt is the parent's, a blank line, then the child's own, which it must have (`prompt.md`, or the default for its `extends`).
  - **ticket template** — its own, else the parent's.

  `batch`, `cadence`, `ticket-system`, `ticket-stage`, `staleness` and `annotation` are not inherited: they govern running and filing the child's own audit. A parent with active children has no verdicts of its own: the runner never plans it (`run.mjs --aspect <parent>` runs its children), coverage views show its children in its place, labelled `parent/child`, and it declares no `annotation:`. A parent whose children are all retired is an ordinary aspect.
- **`annotation:`** — the settings this aspect owns in features' [`aspects.<name>`](#aspects--settings-an-aspect-owns) blocks. Setting names match `^[a-z][a-z0-9-]*$`. `type` is `string`, `number`, `boolean`, `enum` (with a non-empty `values:` list) or `list` (of scalars); `default`, when given and not null, has that type. A setting with no default is absent from a feature's resolved settings until the feature sets it.

## Checking the spec

`node rubric/scripts/check-spec.mjs [--root <dir>]` checks every field rule above, and the release list through tess's reader, printing `<path>:<line>: <message>` for each problem. `run.mjs` and `coverage.mjs` run the same check at startup and exit without planning or recording anything — a dry run included — while it fails. The exception is `coverage.mjs ship`, whose job is removing the tags that fail it: it checks after stripping instead, and exits 1 on anything left. When an unknown `target:` code is the one named by the most recent `tess: ship release <CODE>` commit, the message says to run `coverage.mjs ship`.

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

## Evidence

- SCN-ENT-CMP: packages/site-cad/src/lib/modules/component/**, packages/engine/src/binding/evaluator.ts
- SCN-HIER: packages/site-cad/src/lib/modules/scenario/hierarchy.ts
- INT-SEL: (none)

## Notes

Free-form agent reasoning, evidence sketches, follow-ups.
```

`blocked (<id>)` is a fifth verdict: the feature couldn't be audited because of a shared blocker.

### Evidence section

The `## Evidence` section records, per feature, the **paths the audit actually inspected** to reach its verdict — one bullet `<CODE>: <comma-separated paths>` (globs allowed, repo-relative, forward slash). It is the input to drift-based staleness: the runner stores these paths in the coverage ledger, and a later run recomputes freshness by asking git whether any commit since the audit touched them. Use `(none)` when there is nothing to inspect (e.g. an `n/a` verdict) — such a record can never go drift-stale. Report only paths you genuinely consulted; over-broad globs cause needless re-audits, too-narrow ones let drift slip through.

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
target: current                # current | all | a later release code — the work the run covers (--target)
release: BETA                  # the current release when planned; null with no release list or an empty one
release-list: present          # present | absent — absent: no tickets/releases.md, so everything counted as current
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

# Run 2026-06-24T10-30-00Z-12345 — weekly · target current (release BETA)
...rendered checklist (regenerated by the runner on every transition)...
```

`target`, `release` and `release-list` record the release scope the run was planned under ([release scoping](agent-rules/runner.md#release-scoping)); a resumed run keeps its target. A manifest without `target` was written before release scoping and resumes as `all`, the scope it was planned under.

### Blocker lifecycle

- **Opened** by an agent (the primary path — a self-reported observation) or, as a backstop, synthesized by the runner when multiple batches fail without naming a cause.
- **Resolved** by a human editing `resolved:` in the manifest, or implicitly on `--resume`: blockers carried into a resumed run are treated as *unverified* — they still warn later prompts but don't halt until an agent re-confirms one this pass. Resolving a blocker makes its dependent `blocked` tasks eligible again.

Manifests live under `.runs/` and are gitignored by default, like run logs.

## Coverage-ledger schema

Run logs and manifests are ephemeral (`.runs/`, gitignored). The **coverage ledger** is their durable counterpart: one file per aspect, `aspects/<name>/coverage.md`, **committed to git**. It records the latest audit verdict for each `(feature, aspect)` pair plus the fingerprints needed to tell whether that verdict is still trustworthy. The runner is its sole writer, lifting verdicts + evidence from each batch's run log the same way it lifts them into the manifest.

Like the manifest, it is YAML front-matter (machine truth) followed by a regenerated human/UI table.

```yaml
---
aspect: code
generated: 2026-07-27T10:00:00Z     # when the ledger was last rewritten
records:
  SCN-ENT-CMP:
    verdict: covered                # covered | gap | partial | n/a | blocked
    audited: 2026-06-24T10:35:00Z   # ISO datetime of the audit
    audited-commit: 3fa9c21         # git HEAD short-sha at audit time
    feature-hash: a1b2c3d4e5f6      # the feature's fingerprint for this aspect (see Hashes), 12 hex
    aspect-hash: 9f8e7d6c5b4a       # sha256 of aspect.md + resolved prompt.md + ticket-template.md
    evidence:                       # paths the audit inspected (from the run log's Evidence section)
      - packages/site-cad/src/lib/modules/component/**
      - packages/engine/src/binding/evaluator.ts
    run: 2026-06-24T10-30-00Z-12345 # provenance: the runId that produced this record
    ticket: null                    # relative path to the gap ticket, when verdict is gap/partial
    pinned: false                   # human reaffirmation; suppresses age/drift staleness until a hash changes
---

# Coverage — code   (table regenerated on every write)
| Feature | Verdict | Freshness | Drift | Audited | Ticket |
| ... |
```

### Hashes

- **feature-hash** — the feature's fingerprint for this aspect: sha256, first 12 hex, of the feature `.md` as it bears on this aspect's audit, with line endings normalized to `\n` so CRLF churn doesn't trigger false spec-staleness. The file is hashed as written — body and front-matter, so a `status:`, `summary:` or capability edit is a spec change — except for these front-matter fields:
  - `aspects:`, `surfaces:` and `target:` are left out, each key with every line it owns.
  - A capability not due with its feature — its `target:` ranks later in `tickets/releases.md` than the feature's [effective target](#surfaces-and-target-inherit-down-the-tree) — is left out, and one that is due is hashed in its plain `- <text>` form. So the release it waits for shipping makes it a spec change, and stripping its tag afterwards changes nothing. A code the list does not hold ranks as current (most likely a release just shipped); with no release list, every capability is due.

  Appended to that text, each only when non-empty: `rubric-annotation: <JSON>`, this aspect's resolved settings for the feature (the annotation's defaults overlaid by the feature's `aspects.<name>` block, in declaration order); then `rubric-surfaces: <JSON>`, the sorted overlap of the feature's effective surfaces with the aspect's `surfaces:`, when the aspect declares any. Editing one aspect's block therefore stales only that aspect's records, and a feature gaining a surface stales only the aspects that audit it. A file with no `aspects:`, `surfaces:` or `target:` key and no capability written as `text:`, audited by an aspect with no `annotation:` or `surfaces:`, fingerprints as the sha256 of the whole file.
- **aspect-hash** — sha256 of the resolved aspect config: `aspect.md` concatenated with the effective `prompt.md` and `ticket-template.md` (project override or rubric default, whichever the audit would use), first 12 hex. For a child, its parent's `aspect.md` comes first and the prompt and template are the ones its audit uses ([`parent:`](#surfaces-parent-and-annotation)), so editing the parent criteria-stales every child's records. Changing the audit's instructions invalidates prior verdicts.

Neither the tested artifact (code, docs, help pages) nor its size is hashed — impractical and noisy. Drift over `evidence` paths, via git, is what tracks artifact change.

### Freshness — derived, never stored

Computed at read time by `coverage.mjs`, `run.mjs --stale-only`, and the UI, comparing a record against current files + git. Precedence, highest first:

| State | Condition |
| --- | --- |
| **missing** | no record for this (feature, aspect) pair |
| **criteria-stale** | `aspect-hash` ≠ current, and `on-criteria-change: stale` |
| **spec-stale** | `feature-hash` ≠ current, and `on-spec-change: stale` |
| **drift-stale** | commits touching `evidence` in `audited-commit..HEAD` ≥ `drift-threshold` |
| **age-stale** | `max-age` set and exceeded (used as the drift fallback when drift is *unverifiable*) |
| **fresh** | none of the above |

`pinned: true` suppresses **drift-stale** and **age-stale** (a human vouched for it) but not the hash-based states — a real spec or criteria change still surfaces. The drift commit-count doubles as a **priority signal**: `--stale-only` re-audits the most-churned records first.

**Unverifiable drift** — when `audited-commit` is absent from history (rebase, squash, shallow clone), drift can't be computed. The record falls back to `age-stale` if `max-age` is set, otherwise is surfaced as stale with an `unverifiable` flag rather than silently trusted.

### Lifecycle

- **Written** by the runner after each batch: for every non-blocked verdict it computes the two hashes, captures `audited-commit` (current HEAD) and `evidence` (from the run log), and upserts the record. A `blocked` verdict leaves any prior record untouched (the audit didn't actually run).
- **Bootstrap** — with no ledger yet, every pair is `missing`; the first full sweep seeds the file. No migration needed.
- **Manual overrides** (via `coverage.mjs`): `pin` reaffirms a record without re-auditing; `accept` rehashes a record to the current feature/aspect (clearing spec/criteria-staleness) while keeping the verdict — for cosmetic spec edits that don't warrant a re-audit.

The ledger is committed, so audit history travels with the code and shows up in PR diffs — an audited feature whose evidence a PR touches visibly flips to drift-stale in review.
