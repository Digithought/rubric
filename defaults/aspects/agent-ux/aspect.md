---
name: agent-ux
status: active
level: any
batch: 6
cadence:
  - weekly
ticket-system: tess
ticket-stage: plan
---

# Aspect — agent-ux

Verifies that the project's embedded agent (LLM assistant) can guide a user through this feature's UI workflow. Distinct from `agent-toolkit`, which audits agent-callable functions; `agent-ux` audits the agent's *teaching* of the manual interaction path.
