# Rubric agent rules — init

Set rubric up in a project. This rule applies whether the project is new or already has a feature inventory.

## What `rubric init` does

1. **Verify peer folders.** From the project root, ensure these directories exist; create any that are missing:
   - `features/` — feature inventory.
   - `aspects/` — active aspects (likely empty at first).
   - `.runs/` — run logs.
2. **Scaffold `features/README.md`** if absent. Use the template below. If a feature inventory already exists elsewhere (e.g., in `docs/features/`), do **not** overwrite — surface this to the user and let them migrate.
3. **Scaffold `aspects/README.md`** with a short pointer to `rubric/README.md` and a list of available defaults found under `rubric/defaults/aspects/`. This lets a reader see what could be activated without spelunking.
4. **Add `.runs/` to the project's `.gitignore`.** Idempotent — only add the line if it is not already there. Also `.gitkeep` the folder if you want it tracked as empty.
5. **Reference rubric in the project's root agent-onboarding docs** — `AGENTS.md` and `CLAUDE.md`. Append a short `## Specification (rubric)` section pointing agents at [`rubric/agent-rules/root.md`](root.md) (the entry point for rubric operations) and listing the peer folders. Create the file if it does not exist; skip if a section with that heading is already present.
6. **Do not activate any aspects.** Aspects are project-specific; the user (or a follow-up `add-aspect` run) opts each one in.

The whole operation is **idempotent**. Re-running `init` detects existing state and only fills in what is missing. Never delete or rewrite existing content unless explicitly asked.

## `features/README.md` starter template

```markdown
# Feature Inventory

Hierarchical, timeless functional specification. One file per feature. Codes live in filenames.

## Coding scheme

- 3–5 uppercase letters per layer, mnemonic where possible.
- Hyphenated for nesting: `LIB-INS-MFT`.
- Unique within siblings, not globally.
- Stable. Codes are retired but never reassigned.

## Front-matter

See `rubric/schema.md`.

## Conventions

- **Timeless.** No "currently", "now", "in progress". Describe the desired system.
- **No source-code references.** Spec language stays paths-and-files-free.
- **No architecture leakage.** Frameworks, modules, plumbing belong in architecture docs.
- **UI-agnostic where possible.** "Select an entity" beats "click an entity."
- **DRY.** A capability lives in exactly one feature; cross-references via `related:`.

## Root feature index

| Code | Name | Status | Summary |
|------|------|--------|---------|
| (add rows here) |
```

## After init

Confirm to the user:

- Which folders were created vs. already present.
- Whether `.gitignore` was updated.
- Whether `AGENTS.md` (or equivalent) was updated.
- Pointers to next steps: `add-feature.md`, `add-aspect.md`.
