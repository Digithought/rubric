# Rubric agent rules — reviewing a change against the inventory

For the agent reviewing a completed change (in tess, the `review` stage). Everything here is *in addition* to the review your ticket system already asks for; none of it replaces reading the diff for correctness.

## Why the reviewer and not someone else

The inventory drifts from the code in one direction: the code moves, the spec does not. Three parties could catch it, and only one is well placed.

- The **implementer** is inside the change. They know what they built, which is exactly why they cannot see what they silently made untrue elsewhere.
- The **aspect audit** catches it eventually, but late and at full cost: an audit that discovers a feature's spec no longer matches has to reconstruct what happened from the tree, weeks after the person who knew was in the file.
- The **reviewer** has already read the whole diff with fresh eyes. Everything below is a question they can answer from a diff they are holding anyway. That is the entire argument: this is nearly free *here* and expensive everywhere else.

## What to verify

In cost order. The first three are minutes; the last is optional and bounded.

### 1. Every feature the diff touches is named — not just that the named ones exist

The ticket carries feature anchors. Checking that they resolve is the easy half and a check script may already do it. The half that matters is the converse: **a feature this change touched that the ticket does not name is invisible** — no audit re-runs for it, no staleness fires, and the next agent to read that spec believes it.

Ask of each meaningfully changed file: *which feature's behaviour does this change?* Then confirm that feature is in the anchors. An over-claimed anchor is noise and cheap; an unnamed one is a silent hole. When you find one, add it rather than filing a ticket about it.

### 2. New implementation sites carry a `FEATURE:` comment

The tags are how a feature is mechanically discoverable from its code. A check script may verify that existing tags *resolve*; nothing can verify that a new site that deserved one *got* one, because absence has no syntax. That is a reviewer's judgement.

Tag the meaningful sites — the entry point, the core transform, the contribution registration — not every function that participates.

### 3. The feature's `status` is still true

`status` lives on the leaf (see [`schema.md`](../schema.md)) and is the only place progress is recorded. A change routinely moves it and almost never announces that it did:

- shipped the last missing capability → `partial` → `implemented`
- shipped some of them → `planned` → `partial`
- **review found a capability that does not actually work → `implemented` → `partial`**, and that last direction is the one nobody performs, because nothing about fixing a bug prompts you to downgrade a claim.

Update the leaf in this pass. Do not touch ancestors: their status is derived.

### 4. Spec text the change falsified is reconciled in the same pass

The cardinal rule in [`root.md`](root.md) — a ticket that modifies a feature updates that feature's spec in the same PR — is unenforceable by machine and therefore lands here. Read the `summary` and `capabilities` of each touched feature against what the diff actually does now. A capability that is now worded wrong is worse than a missing one: it reads as specification.

If the change *adds* a user-facing capability, the bullet goes in now. If it removes one, the bullet comes out now.

### 5. Optionally, run the cheap aspect check

If an active aspect covers a feature this change touched, and running it is genuinely cheap, run it for that feature alone:

```
node rubric/scripts/run.mjs --aspect <name> --features <CODE>
```

**This is opt-in and explicitly abandonable.** Skip it — without apology or a ticket — when the aspect needs an environment you do not have, when the feature's audit would take longer than the review itself, or when your context is already heavy. A review that runs out of room before finishing §1–§4 has traded something cheap for something expensive, which is the wrong way round. Record that you skipped it and why; "did not run, context budget" is a complete answer.

## Report what you checked

Whatever section your ticket system asks findings in, state the inventory outcome explicitly, including the empty case — "anchors complete; ADM-COS moved `implemented` → `partial`; no spec text affected; aspect check skipped (needs a running app)". Silence here is indistinguishable from not having looked.

## Known gap: nothing marks a status stale

A feature's `status` is asserted once and then believed forever. When the code beneath it changes, the coverage ledger's audit records go stale on their own — freshness is *derived* by comparing a record's stored hashes and commit against the current tree — but `status` has no equivalent, so a claim of `implemented` made two years and forty commits ago reads exactly like one made today.

The shape of the fix, when someone builds it: store the commit at which status was asserted (`status-asserted: <sha>`), treat the files carrying that feature's `FEATURE:` tags as its implementation, and derive "possibly stale" as *any tagged file changed since that commit* — the same derive-never-store discipline the ledger already uses, and the reason not to introduce a `status: dirty` value, which would jam a freshness axis into a progress field.

The honest caveat, and why this is written down rather than built: it only sees features that carry tags. In SiteCAD at the time of writing that is 152 of 390 leaves, so such a check would be **silently blind on 61% of the inventory** — not wrong, which is recoverable, but quiet, which is not. Worth building alongside a push on tag coverage, not before it.

Until then, §3 is the only thing standing between a stale `status` and an audit finding it months later.
