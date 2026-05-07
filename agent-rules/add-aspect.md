# Rubric agent rules — activate an aspect

Use this when activating a new aspect for the project.

## Steps

1. **Pick a name.** Lowercase, hyphen-separated, mnemonic. Examples: `code`, `unit-tests`, `help`, `agent-ux`, `agent-toolkit`, `marketing`, `accessibility`, `telemetry`.
2. **Check for a default.** If `rubric/defaults/aspects/<name>/` exists, the project will inherit its prompt and ticket template. If not, the project must supply both.
3. **Create the project-side aspect folder.**
   - `aspects/<name>/aspect.md` — required. Front-matter per [`schema.md`](../schema.md): `name`, `status: active`, `level`, `batch`, `cadence`, `ticket-system`, `ticket-stage`, optional `extends`, `applies-to`, `prompt`, `ticket-template`.
   - `aspects/<name>/prompt.md` — optional override. Omit to use the default.
   - `aspects/<name>/ticket-template.md` — optional override. Omit to use the default.
4. **Write the prompt** if no default exists. The prompt is the agent's instructions for auditing one feature for this aspect. It should:
   - Define what evidence of the aspect looks like in this project.
   - Describe how to investigate (where to search, what to read, what to call).
   - Describe how to decide **covered / gap / n/a** — using judgement, not a static matrix.
   - Specify what a **gap ticket** should contain (or refer to the ticket template).
5. **Write the ticket template** if no default exists. Should fit the project's ticket system (tess, GitHub Issues, etc.).
6. **Decide the cadence and level** thoughtfully:
   - `level: root` for high-level concerns (marketing pages typically map to root features).
   - `level: leaf` for fine-grained verification (unit tests, help articles).
   - `batch:` small (4–8) for prompts that need deep investigation; larger (12–24) for shallow checks.
   - Add `on-change` only if the aspect's evidence is colocated with code that triggers commits.
7. **Update `aspects/README.md`** to list the newly active aspect.

## Don't

- Don't activate an aspect "just in case." Each aspect adds audit cost and ticket noise. Activate when the project is ready to act on gap tickets in that aspect.
- Don't fork a default unnecessarily. If the default prompt is close enough, point `extends:` at it and rely on the fallback. Fork only when the project's evidence shape really differs.
- Don't put aspect data (audit results, ticket bodies) in `aspect.md`. That file is configuration, not state.
