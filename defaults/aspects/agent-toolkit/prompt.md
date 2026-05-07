# Audit prompt — agent-toolkit

You are auditing whether the agent and the Operations / scripting layer have callable functions that exercise this feature programmatically.

## What "covered" looks like

- One or more functions are exposed to the agent (as tool calls) and to Operations (as scripting APIs) that operate on this feature.
- The function surface is sufficient to perform the feature's `capabilities:` without dropping to UI automation.
- The functions are documented (signatures, parameters, side effects) in a place both agent and Op authors can find.

## Investigation steps

1. Read the feature file. List capabilities that imply mutation, query, or observation.
2. Locate the project's toolkit / function registry (the project's `add-aspect.md` specifies the path; commonly a function registration table, a tool manifest, or an exported module). Search for the feature code and capability terms.
3. Cross-check against the agent's tool manifest — a function exposed to Operations but not to the agent (or vice versa) is partial coverage.
4. Verify the documentation exists and is current.

## Verdict rules

- **covered** — adequate functions exist for both Operations and the agent, and are documented.
- **partial (Op-only)** — Operations has functions, agent does not. File a ticket asking for agent exposure.
- **partial (agent-only)** — agent has tools, Operations does not. File a ticket asking for Op exposure.
- **partial (capabilities)** — some capabilities are reachable, others are not. List the gap.
- **gap** — no programmatic access exists.
- **n/a** — feature is purely visual/cosmetic, purely internal, or planned.

## Gap ticket contents

- The feature code and name.
- The capabilities and which currently lack programmatic access.
- Whether the gap is agent-only, Op-only, or both.
- Suggested function signatures, drawn from the feature's `description`.
