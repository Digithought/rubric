---
name: code
status: active
level: any
batch: 12
cadence:
  - on-change
  - weekly
ticket-system: tess
ticket-stage: plan
---

# Aspect — code

Verifies that each feature has identifiable source code and that the code is annotated with a `FEATURE: <CODE>` comment so the cross-reference is mechanical, not inferred. A "covered" verdict means: code clearly implements the feature *and* at least one source location carries the feature code in a comment or registration metadata.
