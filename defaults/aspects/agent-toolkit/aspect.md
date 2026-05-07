---
name: agent-toolkit
status: active
level: any
batch: 8
cadence:
  - on-change
  - weekly
ticket-system: tess
ticket-stage: plan
---

# Aspect — agent-toolkit

Verifies that the project's agent and scripting layer (Operations) have programmatic access to this feature. Distinct from `agent-ux`, which audits the agent's *manual instruction* of users; `agent-toolkit` audits the *function surface* the agent and Operations can call.
