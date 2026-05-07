---
name: unit-tests
status: active
level: leaf
batch: 8
cadence:
  - on-change
  - weekly
ticket-system: tess
ticket-stage: plan
---

# Aspect — unit-tests

Verifies that each leaf feature has unit-test coverage of its discrete capabilities. Operates on leaves rather than roots because root features are aggregates and rarely have a single test file.
