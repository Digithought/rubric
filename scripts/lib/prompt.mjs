/**
 * Build the audit prompt for one (aspect, feature batch) invocation.
 *
 * The audit agent is a Claude-Code-like CLI agent with file-system access. It
 * reads the relevant feature files, performs investigation, decides verdicts,
 * files gap tickets directly into the project's ticket queue, and writes the
 * run log. The runner does **not** parse the agent's stdout — it only
 * dispatches; the agent owns all artifacts.
 */

import { relative } from 'node:path';

export function buildAuditPrompt({
	aspect,
	aspectPromptBody,
	ticketTemplateBody,
	features,        // batch
	repoRoot,
	runLogPath,      // absolute
	runId,
	runStartedAt,
}) {
	const aspectName = aspect.name;
	const ticketSystem = aspect.data['ticket-system'] || 'tess';
	const ticketStage = aspect.data['ticket-stage'] || 'plan';
	const featureList = features
		.map(f => `- ${f.code} — ${f.name}  (${rel(f.path, repoRoot)})`)
		.join('\n');

	const tplSection = ticketTemplateBody
		? `\n## Gap-ticket template\n\nFile gap tickets that match the structure of this template, filling in placeholders. Save each ticket as a new file under \`tickets/${ticketStage}/<aspect>-<feature-slug>.md\`. Before creating, search the existing tickets directory for an open ticket with the same (feature, aspect) pair and skip duplicates.\n\n\`\`\`\n${ticketTemplateBody.trim()}\n\`\`\`\n`
		: `\n## Gap tickets\n\nFor each gap, write a markdown ticket file under \`tickets/${ticketStage}/${aspectName}-<feature-code-lower>.md\`. The ticket should reference the feature code, describe the gap, list expected evidence, and end with a TODO list. Search the tickets directory first to avoid duplicates.\n`;

	return `You are running a **rubric audit** for the aspect **${aspectName}** over a batch of features.

Working directory is the project root. You have file-system access. You may read source code, tests, help content, ticket queues — whatever the aspect's prompt directs.

## Aspect prompt (verbatim)

${aspectPromptBody.trim()}

## Features in this batch

${featureList}

Each feature's full spec is in the listed file. Read the front-matter (\`status\`, \`summary\`, \`description\`, \`capabilities\`, \`related\`) and the body before deciding.
${tplSection}
## Run log

When finished, write a single run log file at:

  ${rel(runLogPath, repoRoot)}

The log must start with this YAML front-matter:

\`\`\`yaml
---
aspect: ${aspectName}
runner: ${runId}
started: ${runStartedAt}
finished: <ISO-datetime when you finish>
batch:
${features.map(f => `  - ${f.code}`).join('\n')}
---
\`\`\`

Below the front-matter, include:

1. A \`## Verdicts\` section with one bullet per feature in the form:
   - \`<CODE> — covered\` (with a short evidence note)
   - \`<CODE> — gap (ticket: <relative-path>)\`
   - \`<CODE> — partial (ticket: <relative-path>)\` and the scope of the partial
   - \`<CODE> — n/a (<short reason>)\`
2. A \`## Notes\` section for free-form observations, surprises, follow-ups, or features you couldn't confidently judge.

## Constraints

- Use **judgement** for applicability. There is no static matrix. If the aspect doesn't apply, mark \`n/a\` with a short reason — don't file a ticket.
- Do **not** edit code or content to fix the gap. The audit surfaces gaps; remediation is a separate ticketed activity.
- Do **not** expand the batch. Stay within the features above. Note adjacent observations only.
- Do **not** invent feature codes. If a code in the batch isn't in \`features/\`, note it and skip.
- Stay efficient. If a single feature is taking outsized investigation, mark it \`partial\` with a sketch and let a follow-up ticket carry the deeper dig.

Begin.`;
}

function rel(absPath, repoRoot) {
	const r = relative(repoRoot, absPath);
	return r.split('\\').join('/');
}
