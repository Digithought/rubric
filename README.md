# rubric

A specification backbone for software projects. Rubric pairs a single, hierarchical **feature inventory** with a configurable set of **aspects** — cross-cutting concerns (code, tests, help, marketing, agent skills, …) that every feature might address. AI agents audit each aspect against the inventory, find gaps, and file tickets.

## Why

Building software produces a collection of artifacts: source code, unit tests, UX tests, help pages, marketing copy, agent skills, telemetry, accessibility coverage, and so on. Without a centralized list of what the system *does* for the user, it is easy to ship a feature and silently miss its help page, its agent skill, or its marketing entry. Rubric is the spine that makes those gaps visible.

It is **not** a place to keep marketing copy, help articles, or test code. Each aspect lives in its own native place. Rubric only catalogs *what should exist* and dispatches agents to verify *whether it does*.

## Installation

### 1. Add rubric to your project

```bash
# Git submodule:
git submodule add https://github.com/digithought/rubric.git rubric
node rubric/scripts/init.mjs

# Git subtree (works with git worktrees; submodules do not):
git subtree add --prefix=rubric https://github.com/digithought/rubric.git main --squash
node rubric/scripts/init.mjs

# Symlink (rubric cloned elsewhere):
node /path/to/rubric/scripts/init.mjs
```

`init.mjs` is idempotent — safe to re-run at any time. It creates the peer folders rubric expects (`features/`, `aspects/`, `.runs/`) and updates `.gitignore`.

### 2. Add features

Drop a markdown file into `features/` following the coding scheme in `features/README.md`:

```
features/AUTH - Authentication.md
features/AUTH-LOG - Login.md
```

See [`rubric/agent-rules/add-feature.md`](agent-rules/add-feature.md) for the full front-matter schema and conventions.

### 3. Activate aspects

Create a folder under `aspects/<name>/` with at minimum an `aspect.md`. Rubric ships defaults for common aspects — copy and customize, or start from scratch:

```
aspects/code/aspect.md
aspects/unit-tests/aspect.md
aspects/help/aspect.md
```

See [`rubric/agent-rules/add-aspect.md`](agent-rules/add-aspect.md) for configuration options.

### 4. Run audits

```bash
node rubric/scripts/run.mjs --help
node rubric/scripts/run.mjs --aspect code --dry-run
node rubric/scripts/run.mjs --cadence weekly
```

## Layout

Rubric ships as a directory you drop into a project (eventually a submodule). On `init`, it expects three peer folders to live alongside it at the project root:

```
<project>/
├── rubric/                  # this directory — rules, defaults, schema
│   ├── README.md
│   ├── agent-rules/         # instructions agents follow when running rubric
│   ├── defaults/aspects/    # default aspect templates (prompts, configs)
│   └── schema.md            # front-matter schemas for features and aspects
├── features/                # the inventory — one .md per feature, hierarchical
│   ├── README.md            # index, conventions, coding scheme
│   └── <CODE> - <Name>.md
├── aspects/                 # per-project active aspects (folder = active)
│   └── <name>/
│       ├── aspect.md        # config (level, batch, cadence)
│       ├── prompt.md        # optional override of rubric default
│       └── ticket-template.md  # optional override
└── .runs/                   # rubric run logs (gitignored by default)
```

## Aspects

An aspect is a cross-cutting concern that should be addressed for every (applicable) feature. Examples a project might activate:

- **code** — source implementing the feature, marked with `FEATURE:` comments.
- **unit-tests**, **ux-tests** — verification at different layers.
- **help** — in-app help and documentation.
- **marketing** — public-facing copy and SEO.
- **changelog**, **accessibility**, **telemetry**, **shortcuts**, **pricing-tier** — others as the project demands.

A project activates an aspect by creating `aspects/<name>/` with at least an `aspect.md`. If `prompt.md` is absent, rubric falls back to `rubric/defaults/aspects/<name>/prompt.md`. If no default exists, the project must supply its own prompt. **Aspects are project-specific** — defaults are starting points, not a canon.

## Audits

An audit runs one aspect against a batch of features. It is performed by an AI agent reading the aspect's prompt and the relevant feature .md files, then investigating the project to determine, per feature: **covered**, **gap**, or **n/a**. Gaps are converted to tickets in the project's ticket system (e.g., tess). Verdicts and reasoning land in `.runs/` for traceability.

The audit agent uses **judgement** to decide whether an aspect applies to a given feature — there is no static applicability matrix.

## Cadence

Each aspect declares one or more cadences:

- `on-demand` — only when explicitly invoked.
- `on-change` — triggered by changes to relevant files (e.g., a pre-merge hook).
- `daily` / `weekly` — scheduled passes.

Plus a **batch size** and a **level** (root / branch / leaf / any) that determine which features the audit walks and how many it considers per agent invocation. These keep agent contexts narrow.

## Working with rubric

Two surfaces:

**CLI** (Node, no dependencies). The runner walks aspects × features, plans batches, dispatches an audit agent per batch, and lets each agent file gap tickets and write its own run log.

```
node rubric/scripts/init.mjs                       # idempotent scaffold
node rubric/scripts/run.mjs --help                 # full options
node rubric/scripts/run.mjs --aspect code --dry-run
node rubric/scripts/run.mjs --cadence weekly       # all aspects with that cadence
```

**UI** (Svelte 5 + Vite, in `rubric/ui/`). Browse features, inspect aspect configs and resolved prompts, view run logs, and read the coverage matrix at a glance.

```
cd rubric/ui && yarn install && yarn dev
```

**Agent rules** (instructions agents read when performing rubric operations) live in `rubric/agent-rules/`:

- [`root.md`](agent-rules/root.md) — what rubric is and how its parts fit together.
- [`init.md`](agent-rules/init.md) — set rubric up in a project.
- [`add-feature.md`](agent-rules/add-feature.md) — add or update a feature in the inventory.
- [`add-aspect.md`](agent-rules/add-aspect.md) — activate a new aspect for the project.
- [`audit.md`](agent-rules/audit.md) — run a single aspect audit on a batch of features.
- [`runner.md`](agent-rules/runner.md) — orchestrate audits across aspects without overflowing context.

Front-matter schemas for features and aspects are in [`schema.md`](schema.md).

## Relationship to ticket systems

Rubric does not implement ticket flow. It produces gap tickets in whatever ticket system the project uses (e.g. [tess](https://github.com/gotchoices/tess)). The aspect's `ticket-template.md` (or its default) describes the ticket the audit should file.
