# Rubric agent rules — add or update a feature

Use this when introducing a new feature to the inventory or modifying an existing one.

## What a feature is

The inventory captures **what** the system does for the user, independent of **how** it is built. The line:

| In | Out |
|----|-----|
| What the user can do, see, configure, or be affected by | How the system is built |
| Backlog and planned features that are documented or scaffolded | Implementation tactics, frameworks, plumbing |
| User-perceptible system behavior (offline operation, undo, time travel) | Sync protocols, schema mechanics, internal contracts |
| UI capabilities, kept UX-abstract where possible (pointing vs clicking) | Specific component layouts, framework choices |

Rule of thumb: if removing the underlying tech wouldn't change what the user does or sees, it is architecture — and lives in the project's architecture docs, not in `features/`.

## Adding a new feature

1. **Choose a code.** 3–5 uppercase letters, mnemonic. Verify it does not collide with any sibling under the same parent. Codes can be reintroduced only if they have *never* been used; retired codes are not reassigned.
2. **Place the file.**
   - Root feature: `features/<CODE> - <Name>.md`.
   - Branch under a root: `features/<ROOT-CODE> - <Root Name>/<BRANCH-CODE> - <Branch Name>.md`. Create the directory if it doesn't exist.
   - Deeper levels nest the same way.
3. **Write the front-matter** per [`schema.md`](../schema.md): `status`, `summary`, `description`, `capabilities`, `related`. Codes in `related:` are full hyphenated forms.
4. **Add a body** with the heading `# <CODE> — <Name>`. Body text is optional for thin leaves; rich features get prose, sub-headings, and an enumeration of branches when known.
5. **Update the parent index.**
   - For a new root: append a row to the root index in `features/README.md` under the appropriate group.
   - For a new branch: append a row to the parent's branch listing (in the parent file's body, or its own README if conventions in this project use one).

## Editorial conventions

- **Timeless.** No "currently", "now", "recently", "in progress", or other change-history language. The spec describes the desired system at any point in its life.
- **No source-code references.** Spec language is paths-and-files-free.
- **No architecture leakage.** Frameworks, libraries, internal protocols, schema mechanics, build systems — none of those names belong in a feature file. The project's architecture docs name them.
- **UI-agnostic where possible.** Prefer "select an entity" over "click an entity"; prefer "navigate" over "tap arrow." Concrete interaction details belong at deep levels of the tree, not at the root.
- **DRY.** A capability lives in exactly one feature; cross-references via `related:`.

## Updating an existing feature

- **Display name change:** rename the file. The code segment is preserved. No front-matter edit needed.
- **Code change:** avoid. If unavoidable, update the file, the index, every `related:` cross-reference, every `FEATURE:` source-code comment, every ticket reference. Prefer adding a new code and retiring the old.
- **Status change:** update `status:`. Common transition is `planned → partial → implemented`. A retired feature stays in place with `status: retired` and a note explaining the retirement.
- **Capability change:** edit the `capabilities:` list. Added capabilities should be discrete and user-facing.

## Triggering audits

When a feature is added or its capabilities change, the active aspects for the project are now potentially out of date for that feature. The runner picks this up on the next `on-change` cadence pass. If the change is significant, a human or upstream agent may invoke targeted audits via the runner explicitly.

## Don't

- Don't put architecture details in feature files.
- Don't put change-history language ("recently added", "as of v2"). Feature files describe the desired system at any point in time.
- Don't reuse a retired code.
- Don't pre-link to nonexistent feature codes in `related:`. Add the cross-reference once both features exist.
