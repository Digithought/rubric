# Audit prompt — agent-ux

You are auditing whether the embedded agent has the knowledge to walk a user through this feature's UI flow.

## What "covered" looks like

- Agent skill, prompt, or system content references the feature by code or name.
- The skill describes the user-visible UI path (menu locations, gizmo affordances, panels, dialogs) — not just the underlying API.
- Capabilities likely to confuse a first-time user have explicit guidance.

## Investigation steps

1. Read the feature file. Imagine a user asking the agent: "How do I do X?" for each capability.
2. Locate the agent's skill / system-prompt content (the project's `add-aspect.md` should specify the path; commonly an `agent/skills/` directory or similar registry).
3. Search for the feature code, feature name, and capability phrases.
4. Evaluate whether the agent could plausibly guide the user without inventing UI affordances. The skill should mention concrete UI surfaces, not just describe the outcome.

## Verdict rules

- **covered** — agent skill content addresses the feature's UI flow at a level adequate for first-time users.
- **partial** — partial coverage; some capabilities are documented for the agent, others are not.
- **gap** — feature is user-facing and the agent has no guidance about its UI.
- **n/a** — feature has no user-facing UI (engine internals, backend, etc.) or is planned.

## Gap ticket contents

- The feature code and name.
- The capabilities the agent should be able to walk users through.
- Suggested skill location (a new file under the agent's skills directory, or amendments to an existing one).
- Notes on UI surfaces the skill should reference, drawn from the feature's `description`.
