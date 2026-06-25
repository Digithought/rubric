# Rubric agent rules — runner

The runner orchestrates audits across aspects without overflowing any single agent's context. It does not perform audits itself; it dispatches audit agents.

## Inputs

- **Trigger.** One of: a cadence tick (`on-change`, `daily`, `weekly`), an explicit `on-demand` invocation (with optional aspect/feature scope), or an external event (e.g., a pre-merge hook firing).
- **Project state.** `aspects/` (active aspect set), `features/` (feature tree), open tickets (for de-duplication context).

## Procedure

1. **Resolve aspect set.** From `aspects/`, list each subdirectory containing an `aspect.md`. Filter to those whose `cadence:` includes the current trigger. If the trigger is on-demand with a specific aspect, narrow to that.
2. **Per aspect, resolve feature set.**
   - Walk `features/` and select features matching `level:` (root / branch / leaf / any).
   - Apply `applies-to.include` / `applies-to.exclude` if present.
   - For `on-change`, optionally narrow to features whose source artifacts changed since the last run (see "on-change scoping" below).
3. **Per aspect, batch the features.** Split into groups of size `batch:`. The order does not matter unless the aspect's prompt says otherwise.
4. **Open a run.** Allocate a `runId` and create `.runs/<runId>/manifest.md` (schema in [`schema.md`](../schema.md)) listing every batch as a task with status `pending`. This manifest is the run's checklist and blocker blackboard; **the runner is its sole writer.**
5. **Dispatch audit agents, driving the manifest state machine.** For each task, in order:
   - Set it `running` (regenerate the manifest), then launch one agent per [`audit.md`](audit.md). Pass the aspect name, the batch's feature codes, the `runId`, the target run-log path, and **any open blockers relevant to this task** (global, this aspect, or a feature in the batch) so the agent bails instead of re-investigating a known wall.
   - When the agent finishes, lift its run-log `## Verdicts` and `blockers:` into the manifest, and set the task `done` or `failed`.
6. **React to blockers.** Before dispatching each task, check the manifest:
   - A `global` + `blocking` blocker **short-circuits the run** — mark all remaining dispatchable tasks `blocked` and stop. Don't burn an agent per batch to rediscover the same outage.
   - An `aspect:<name>` + `blocking` blocker skips that aspect's remaining tasks the same way.
   - A `degraded` blocker only warns later prompts; it doesn't halt.
7. **Collect artifacts.** Each audit writes its own `.runs/<runId>/<aspect>-batchN.md`. The manifest is the run-level summary; the runner regenerates it on every task transition.

The reference runner (`rubric/scripts/run.mjs`) dispatches **sequentially**, which is what lets a blocker raised by one batch reach the next batch's prompt. If you parallelize (see below), blockers still land in the manifest for resume and the next wave, but can't reach already-running siblings.

## On-change scoping

For aspects with `cadence: [on-change]`, narrow the feature set to those potentially affected by the change. Heuristics:

- If the changed file carries a `FEATURE:` comment or front-matter `features:` field, audit those features.
- If the changed file is a feature file itself, audit the feature it represents.
- If the change is to an aspect's `prompt.md` or `aspect.md`, run the aspect over its full feature set (the audit logic itself changed).

When in doubt, skip narrowing and audit the full applicable set — false positives are cheap (verdicts unchanged); false negatives leave gaps invisible.

## Context discipline

- Do not load all feature files into the runner. Only the audit agents need feature contents; the runner walks filenames and dispatches.
- Do not include audit results in the runner's context. Verdicts land in run logs; the runner only lifts the structured summary (verdict counts, blockers) into the manifest.
- If the active aspect set is large, the runner may delegate dispatch itself to per-aspect sub-runners.

## Failure handling and resumption

- A task that errors or times out is marked `failed` in the manifest; the runner moves on. Do not retry blindly mid-run — re-runs duplicate ticket-creation effort.
- **Resume instead of restarting.** `run.mjs --resume <runId|last>` replays a run: `done` tasks are skipped, and `pending` / `failed` / interrupted (`running`) tasks re-dispatch. A `blocked` task becomes eligible again once its blocker is resolved. This is what picks up where a halted or crashed run left off.
- **Blockers carried into a resumed run are unverified.** They still warn later prompts but don't short-circuit until an agent re-confirms one this pass — so resuming after you've fixed the underlying problem actually makes progress rather than halting on a stale blocker. To clear a blocker by hand, set its `resolved:` to a datetime in the manifest before resuming.
- **Backstop blocker.** If multiple batches fail without any agent naming a cause, the runner synthesizes a `degraded` `runner/repeated-failures` blocker so the pattern is visible without halting the run.
- If a ticket-system call fails, the audit's verdicts are still preserved in the run log. The audit agent should record the unfiled gap with enough detail that a manual re-file is straightforward.
