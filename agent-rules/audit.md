# Rubric agent rules — audit

Run a single aspect against a batch of features. You are invoked with: an aspect name, and a list of feature codes.

## Inputs

1. **The aspect.** Read `aspects/<name>/aspect.md` for config. Read `aspects/<name>/prompt.md` for instructions; if absent, fall back to `rubric/defaults/aspects/<extends>/prompt.md` (where `extends` defaults to `<name>`). Read the ticket template the same way.
2. **The features.** For each code in the batch, read its file from `features/`. Pay attention to `summary`, `description`, `capabilities`, and `related`.
3. **The project.** You may search the codebase, read ticket queues, examine help content, etc. — whatever the aspect's prompt directs.

## Procedure

For each feature in the batch:

1. **Decide applicability.** Does this aspect plausibly apply to this feature? Use judgement based on the feature's purpose. If clearly not applicable, record verdict `n/a` with a short reason. Move on.
2. **Investigate.** Follow the aspect's prompt. Gather evidence. Be specific — note files, function names, page slugs, ticket IDs.
3. **Decide coverage.**
   - **covered** — adequate evidence found.
   - **gap** — aspect applies but evidence is missing or insufficient.
   - **partial** — some evidence exists but is incomplete; treat as a gap with a more specific scope.
4. **For gaps, file a ticket.** Use the aspect's `ticket-template.md` (or default). The ticket goes into `aspects/<name>/aspect.md`'s `ticket-system` and `ticket-stage`. Before filing, search for an open ticket already covering this (feature, aspect) pair to avoid duplicates. The ticket must reference both the feature code(s) and the aspect.
5. **Record the verdict** in the run log.

## Run log

Write a single file `.runs/<ISO-datetime>-<aspect>.md` per audit invocation. Format per [`schema.md`](../schema.md). Include:

- The aspect, batch, runner identifier, and start/finish times.
- One verdict line per feature: `covered` / `gap (ticket: <slug>)` / `partial (ticket: <slug>)` / `n/a (<reason>)`.
- Free-form notes for anything that didn't fit neatly — surprising findings, follow-ups, ambiguity.

## Avoid

- **Do not edit code or content** to fix gaps. Audits surface gaps; remediation is a separate, ticketed activity.
- **Do not expand the batch.** Stay within the features given. If you discover an adjacent gap, note it; do not chase it.
- **Do not file a ticket for `n/a` verdicts.** Just record the reason in the run log.
- **Do not duplicate tickets.** A grep through the open ticket queue for the feature code + aspect name is usually sufficient.
- **Do not invent feature codes.** If a code is not in `features/`, raise it in the run log notes; do not silently add features as part of an audit.

## Budget

Audits should be fast. If a single feature is taking outsized investigation, mark it `partial` with a sketch of what you found and what is still unclear, and let a follow-up ticket carry the deeper dig.

## Headless-mode constraints

The rubric runner invokes you in headless (`claude -p`) mode and tees your output to a log. Two things follow:

- **Never use `run_in_background: true` / `Monitor` / wait-for-notification patterns.** The first `result` message ends the turn — there is no follow-up wake-up when a backgrounded shell or sub-agent finishes, and the runner will tree-kill the process. If you must run a command, run it in the foreground and stream its output (`yarn foo 2>&1 | tee /tmp/foo.log`); never silently redirect (`> /tmp/foo.log 2>&1`), because the runner kills agents that go 10 minutes without output. Audits rarely need shell commands at all — prefer reads and searches.
- **Don't launch commands that routinely exceed ~10 minutes wall-clock.** They are not agent-runnable here. Note the deferral in the run log and move on.
