# Rubric agent rules — root

You are operating inside a project that uses **rubric**, a feature-inventory + cross-cutting-aspects system. Read this file first; it points at the rule you actually need.

## What rubric is

- `features/` (peer of `rubric/`) holds the **feature inventory** — a hierarchical, timeless functional spec of the project. One `.md` per feature; codes live in filenames; front-matter follows [`schema.md`](../schema.md).
- `aspects/` (peer) holds the **active aspects** for this project. Each aspect is a folder containing `aspect.md` (config) and optionally `prompt.md`, `ticket-template.md` (overrides of the rubric defaults).
- `rubric/defaults/aspects/<name>/` provides default prompts and templates for common aspects. A project opts in by creating `aspects/<name>/`; it overrides by adding files of the same name on the project side.
- `.runs/` (peer, gitignored) holds run logs.

## Pick the rule that matches your task

| You are doing | Read |
|---|---|
| Setting rubric up in a new (or existing) project | [`init.md`](init.md) |
| Adding or updating a feature in the inventory | [`add-feature.md`](add-feature.md) |
| Activating a new aspect for the project | [`add-aspect.md`](add-aspect.md) |
| Running an audit of one aspect over a batch of features | [`audit.md`](audit.md) |
| Orchestrating audits across aspects (scheduling, batching) | [`runner.md`](runner.md) |

## Cross-references — the inventory as a spine

The inventory is the coordinate system other artifacts reference. Two integrations matter:

**Source code** carries `FEATURE: <CODE>` comments at meaningful sites so each implementation is mechanically discoverable from its feature:

```ts
// FEATURE: SCN-ENT-CMP
function instantiateComponent(...) { ... }
```

A single source location may reference multiple features:

```ts
// FEATURE: INT-SEL, INT-GIZ
function onPointerDown(...) { ... }
```

**Tickets** reference features in their front-matter (exact field is project-specific to the ticket system):

```yaml
features: [SCN-ENT-CMP, INT-INS]
```

- A ticket that **ships** a feature flips its `status` from `planned` or `partial` toward `implemented`.
- A ticket that **modifies** a feature is responsible for updating the feature's spec in the same PR.
- A ticket that **introduces** a new feature adds an entry to `features/` in the same PR.

## Cardinal rules

- **The inventory is the spine.** Every audit, every gap ticket, every cross-reference uses the feature codes from `features/`. Do not invent codes; do not reuse retired codes.
- **Rubric does not contain user-facing content.** Marketing copy, help articles, test code, agent skills — those live where they normally live in the project. Rubric only catalogs *what should exist* and verifies *whether it does*.
- **Use judgement on applicability.** There is no static "this aspect applies to that feature" matrix. The audit agent decides per (aspect, feature) pair whether the aspect applies, and records the verdict.
- **Gaps become tickets, not edits.** An audit agent does not silently fix gaps. It files a ticket (in tickets/ for tess) following the aspect's `ticket-template` if there is one.
- **Run logs are evidence, not deliverables.** The durable artifact is the ticket; logs in `.runs/` are for traceability and may be pruned.
- **Stay narrow.** Each agent invocation handles one aspect against one batch. Do not pile on adjacent work.
