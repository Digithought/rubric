# Rubric agent rules — the specification model

How a project that uses rubric is specified. Every rule file in this folder,
every feature file, every aspect and every ticket assumes the model below.
Read this once; the task-specific rules in [`root.md`](root.md) build on it.

## The three axes

Everything written about a system lands on one of three orthogonal axes.

| Axis | Question | Home | Tooling |
|---|---|---|---|
| **Features** | *What* does the system do for the user? | `features/` | the inventory |
| **Aspects** | *Which manifestations* must every applicable feature carry — code, tests, help, performance, agent reach, …? | `aspects/` | audits |
| **Architecture** | *How* is any feature built — modularity, data access, reactivity, scaling, packaging, testing policy? | the project's architecture documents | the project |

Features × aspects is the coverage matrix rubric audits. Architecture is
orthogonal: it applies to every cell and names no feature. An architecture
document that mentions a feature leaks *what* into *how*; a feature file that
names a framework, table or protocol leaks *how* into *what*.
[`add-feature.md`](add-feature.md) holds the line from the feature side; the
project's architecture root holds it from the other.

Architecture is organised **by concern**, not by feature, so an agent working
on one concern reads only that concern's documents. There is no such thing as
a "feature architecture" document: a change reads the feature file plus the
concern documents it touches.

## The single-home rule

Each kind of truth has exactly one home. The test for any paragraph, comment
or test case: *delete it — what breaks?* If nothing breaks, it duplicated a
truth that lives elsewhere; remove it.

| Kind of truth | Only home | Form |
|---|---|---|
| User-observable capability, acceptance, budget | `features/` | `capabilities:`, aspect annotations |
| Principle, invariant, seam, mechanism, contract | architecture documents | one document per concern |
| Why a specific line is the way it is | source comment | a tagged note at the site; the feature tag |
| Executable acceptance of a named capability or invariant | test | a contract test naming its spec line |
| A change to be made | ticket | a delta against feature + architecture; dies at landing |

Consequences:

- **Tickets never restate spec.** They cite feature codes and architecture
  sections and describe the delta. Design a ticket discovers that the spec
  lacks moves into `features/` or the architecture in the same change.
- **Architecture never restates capabilities.** It says how capabilities of a
  kind are realised, in general.
- **Comments say what code cannot.** A comment states a why, a constraint, or
  a non-obvious consequence. A comment that narrates a run of imperative
  statements is a missing subroutine: extract it and let the name carry the
  intent.
- **Tests name their spec line.** A test that cannot say which capability or
  which invariant it verifies is a candidate for deletion.

## Rubric anchors

Every ticket names at least one anchor on the spine: `features:` (codes),
`aspects:` (aspect names), or `architecture:` (concern-document section
slugs). A ticket with no anchor has no reason to exist that the spec can see.

Convergence between spec and code happens at ticket time, not document time.
Planning resolves a ticket against its feature file and the architecture
concerns it touches. When both answer, the ticket proceeds with no human
involvement. A ticket blocks only when:

- the feature spec is silent or contradictory — the blocked ticket carries
  **proposed capability text** for a human to accept or edit; or
- the architecture is silent or conflicting — the blocked ticket carries a
  **proposed principle or mechanism**.

A blocked ticket is a spec diff proposal, never an open question.

## Current release assumption

Release information is an exception, not an annotation. The ticket system
keeps an ordered list of release codes (`tickets/releases.md` under tess); the
first entry is the **current** release. Anything not explicitly deferred — a
feature, a capability, a ticket — is due in the current release.

- A feature or capability defers with `target: <CODE>` naming a later entry.
- A ticket defers by living in the ticket system's deferral folder for that
  code; tickets at the top level are current.
- Shipping deletes the current entry. The next entry becomes current, and
  every `target:` tag and deferral folder that named it is stripped
  mechanically. Past releases exist only in version history.
- Release codes follow the feature-code shape: short uppercase mnemonics,
  never reassigned.

The burn-down for the current release is therefore derivable: every untagged
capability not yet implemented and covered, every top-level backlog ticket,
every stale or missing coverage cell for an untagged feature.

## Aspect annotations, surfaces and hierarchy

**Annotations.** An aspect may own an optional block in a feature's
front-matter under the single `aspects:` map. The aspect's configuration
declares the block's schema and defaults; a feature that omits the block gets
the defaults. Only that aspect's audit reads and writes its block.

```yaml
aspects:
  performance:
    budget: "opens within 2 s on the reference machine"
    workload: open-large
  help:
    depth: reference
```

Performance is the canonical case: it is not a feature and not a separate
root in the inventory. It is a quality of the feature that owns the workload,
with a budget the performance aspect audits and a benchmark that carries the
feature's tag.

**Surfaces.** A feature declares the surfaces it exists on (`surfaces:`, from
a vocabulary the project declares in `features/README.md`). An aspect declares
the surfaces it audits. An aspect applies to a feature when the two intersect;
an aspect with no `surfaces:` applies regardless. Auditing a quality per
surface is therefore two aspects with different `surfaces:` and different
instructions; the ledger and tickets follow.

**Hierarchy.** Aspects nest shallowly: a parent supplies applicability and a
base prompt, a child supplies a delta. Split an aspect when its gap for a
feature would be its own ticket, fixed independently of a sibling's gap; keep
aspects together when their gaps always land in one ticket.

## The enforcement ladder

Every rule the system must obey is enforced at the lowest rung that can
express it. Cost rises down the ladder; so does what it can catch.

1. **Type or schema** — compile time, free. Branded identifiers, units as
   types, exhaustive switches, non-null by default, parse-don't-validate at
   boundaries.
2. **Lint or check script** — repository time, deterministic.
3. **Unit or property test** — repository time; carries maintenance cost.
4. **Development-mode assertion** — run time in development only, zero
   production cost.
5. **Agent aspect audit** — judgment time, token cost, non-deterministic; the
   only rung that can judge nuance.
6. **Runtime constraint** — production cost on every operation. Reserved for
   corruption-class invariants: writes that replicate and cannot be undone.

A new check goes on the ladder before it goes anywhere else. An architecture
principle lists its enforcer; a principle with no enforcer is visible debt. A
one-off judgment check that no rung below 5 can express is written as an
aspect prompt, not contorted into a unit test.

## Testing policy

Value of a test = P(regression) × cost of regression × P(test catches it) −
maintenance. These rules make that arithmetic mechanical.

- **Contract, not code.** A test is an example or property of a named spec
  line — a capability or an architecture invariant — and says which.
- **One transformation deep, no mocked collaborators.** Test at the lowest
  layer with a stable contract. Pure modules get property and table tests.
  Composition and glue get no unit tests; smoke and end-to-end runs cover
  them.
- **Mocks only for the world.** Clock, network, randomness, external
  services. A test that mocks the module under test verifies the mock.
- **Risk tiers decide obligation.** Score each source file on churn, fan-in,
  branch density and blast radius. Top tier: contract tests required. Bottom
  tier: tests forbidden unless a bug drove them. The unit-tests aspect audits
  only the top tier and capabilities annotated to require a test.
- **Every bug fix adds one reproduction** at the lowest layer that reproduces
  it.
- **Deletion list.** Tests that assert a call happened, mock their subject,
  duplicate a type check, or snapshot markup are removed on sight.
