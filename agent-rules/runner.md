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
4. **Dispatch audit agents.** For each batch, launch one agent per [`audit.md`](audit.md). Pass:
   - the aspect name,
   - the batch's feature codes,
   - a runner-supplied `runner-id` (e.g., the timestamp + cadence) so log files correlate.
5. **Run aspects in parallel where practical.** Different aspects can audit concurrently; batches within the same aspect can also. Watch ticket-system rate limits.
6. **Collect run logs.** Each audit writes its own `.runs/<ISO-datetime>-<aspect>.md`. The runner does not need to merge them, but may write a top-level summary `.runs/<ISO-datetime>-<runner-id>.md` listing dispatched batches and outcomes.

## On-change scoping

For aspects with `cadence: [on-change]`, narrow the feature set to those potentially affected by the change. Heuristics:

- If the changed file carries a `FEATURE:` comment or front-matter `features:` field, audit those features.
- If the changed file is a feature file itself, audit the feature it represents.
- If the change is to an aspect's `prompt.md` or `aspect.md`, run the aspect over its full feature set (the audit logic itself changed).

When in doubt, skip narrowing and audit the full applicable set — false positives are cheap (verdicts unchanged); false negatives leave gaps invisible.

## Context discipline

- Do not load all feature files into the runner. Only the audit agents need feature contents; the runner walks filenames and dispatches.
- Do not include audit results in the runner's context. Run logs land in `.runs/`; the runner writes a brief summary if it writes anything at all.
- If the active aspect set is large, the runner may delegate dispatch itself to per-aspect sub-runners.

## Failure handling

- An audit agent failure (timeout, error) is logged; the runner moves on. Do not retry blindly — re-runs duplicate ticket-creation effort. A human or follow-up cadence pass picks up where it left off.
- If a ticket-system call fails, the audit's verdicts are still preserved in the run log. The audit agent should record the unfiled gap with enough detail that a manual re-file is straightforward.
