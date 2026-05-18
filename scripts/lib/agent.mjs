/**
 * Spawn the audit agent for one batch.
 *
 * Invokes the Claude Code CLI (`claude`) in headless mode with stream-json
 * output, so the runner can tee per-turn progress to BOTH the per-batch log
 * file and its own stdout in near-real-time. Other agents can be added by
 * extending the `AGENT_ADAPTERS` map.
 *
 * Cross-platform binary resolution: we use bare `claude` (no extension) and
 * rely on `shell: true` on Windows so cmd.exe's PATHEXT picks up whichever
 * shim/binary is installed (`claude.cmd` from the npm shim, `claude.exe`
 * from the native installer).
 */

import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DIFF_LINE_CAP = 50;
const TOOL_RESULT_CAP = 4000;

const AGENT_ADAPTERS = {
	claude: {
		bin: 'claude',
		buildArgs(promptFile) {
			return [
				'-p', `@${promptFile}`,
				'--dangerously-skip-permissions',
				'--no-session-persistence',
				'--verbose',
				'--output-format', 'stream-json',
			];
		},
		formatStream: formatClaudeStreamLine,
	},
};

/**
 * Run an agent against a prompt; tee output to logFile AND process.stdout.
 *
 * @returns {Promise<{exitCode:number, timedOut:boolean}>}
 */
export async function runAgent({ agent = 'claude', prompt, cwd, logFile, dryRun = false }) {
	const adapter = AGENT_ADAPTERS[agent];
	if (!adapter) throw new Error(`Unknown agent: ${agent}`);
	await mkdir(dirname(logFile), { recursive: true });
	const promptFile = logFile.replace(/\.log$/, '.prompt.md');
	await writeFile(promptFile, prompt, 'utf-8');

	if (dryRun) {
		console.log(`[dry-run] would invoke ${adapter.bin} with prompt at ${promptFile}`);
		return { exitCode: 0, timedOut: false };
	}

	const args = adapter.buildArgs(promptFile);
	const log = createWriteStream(logFile, { flags: 'a' });
	const header = `# rubric audit log — ${new Date().toISOString()}\n\n$ ${adapter.bin} ${args.join(' ')}\n\n`;
	log.write(header);

	try {
		return await new Promise((resolve, reject) => {
			const child = spawn(adapter.bin, args, {
				cwd,
				stdio: ['ignore', 'pipe', 'pipe'],
				shell: process.platform === 'win32',
			});

			let idleTimer = null;
			let resultExitCode = null;
			let settled = false;
			let timedOut = false;

			function settle(code) {
				if (settled) return;
				settled = true;
				clearTimeout(idleTimer);
				log.end(`\n[runner] agent exited with code ${code}\n`);
				resolve({ exitCode: code, timedOut });
			}

			function armIdleTimer() {
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = setTimeout(() => {
					timedOut = true;
					const msg = `\n[runner] idle timeout after ${IDLE_TIMEOUT_MS / 1000}s — killing agent\n`;
					process.stderr.write(msg);
					log.write(msg);
					killTree(child);
				}, IDLE_TIMEOUT_MS);
			}

			/** Write to stdout and log with backpressure: pause stdin-source if log can't keep up. */
			function writeOut(text) {
				process.stdout.write(text);
				if (!log.write(text)) {
					child.stdout.pause();
					log.once('drain', () => child.stdout.resume());
				}
			}

			function processLine(line) {
				if (!adapter.formatStream) {
					writeOut(line + '\n');
					return;
				}
				const out = adapter.formatStream(line);
				if (out.text) writeOut(out.text);
				if (out.done) {
					resultExitCode = out.exitCode ?? 0;
					clearTimeout(idleTimer);
					// Tree-kill on the `result` message rather than wait for a clean
					// exit. On Windows the CLI sometimes leaves MCP server children
					// (chrome-devtools-mcp, playwright-mcp) running after a clean
					// exit; taskkill /T /F reaps them while the parent PID is valid.
					killTree(child);
				}
			}

			armIdleTimer();

			let buf = '';
			child.stdout.on('data', (chunk) => {
				if (resultExitCode == null) armIdleTimer();
				buf += chunk.toString();
				const lines = buf.split('\n');
				buf = lines.pop() ?? '';
				for (const line of lines) processLine(line);
			});

			child.stderr.on('data', (chunk) => {
				if (resultExitCode == null) armIdleTimer();
				process.stderr.write(chunk);
				log.write(chunk);
			});

			child.on('error', reject);
			child.on('close', (code) => {
				if (buf) processLine(buf);
				settle(resultExitCode ?? code ?? 1);
			});
		});
	} finally {
		// Reset any ANSI colour the agent might have left dangling.
		process.stdout.write('\x1b[0m');
	}
}

// ── Stream formatter for Claude's --output-format stream-json ────────────────

/** Sum of tokens occupying the model's context window for one turn. */
function contextSize(usage) {
	if (!usage) return 0;
	return (usage.input_tokens ?? 0)
		+ (usage.cache_read_input_tokens ?? 0)
		+ (usage.cache_creation_input_tokens ?? 0);
}

/** Render `text` as lines each prefixed with `prefix`, capped at `cap` total lines. */
function prefixLines(text, prefix, cap) {
	const lines = String(text ?? '').split('\n');
	if (lines.length <= cap) return lines.map(l => `${prefix}${l}`).join('\n');
	const shown = lines.slice(0, cap).map(l => `${prefix}${l}`).join('\n');
	return `${shown}\n… [+${lines.length - cap} more lines truncated]`;
}

/** Format a tool_use block. Edit/Write get +/- diff view; rest is JSON-snippet. */
function formatToolInput(name, input) {
	if (input && typeof input === 'object') {
		if (name === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
			const header = input.file_path ? `${input.file_path}\n` : '';
			const oldBudget = Math.floor(DIFF_LINE_CAP / 2);
			const newBudget = DIFF_LINE_CAP - oldBudget;
			return `${header}${prefixLines(input.old_string, '- ', oldBudget)}\n${prefixLines(input.new_string, '+ ', newBudget)}`;
		}
		if (name === 'Write' && typeof input.content === 'string') {
			const header = input.file_path ? `${input.file_path}\n` : '';
			return `${header}${prefixLines(input.content, '+ ', DIFF_LINE_CAP)}`;
		}
		return JSON.stringify(input).slice(0, 200);
	}
	return String(input ?? '');
}

/**
 * Convert one line of Claude stream-json to human-readable text.
 * Returns { text?, done?, exitCode?, usage? }. `done: true` means the agent
 * emitted its final result — runner should kill rather than wait for exit.
 */
function formatClaudeStreamLine(line) {
	if (!line.trim()) return { text: '' };
	try {
		const obj = JSON.parse(line);
		if (obj.type === 'system' && obj.subtype === 'init') {
			return { text: `[session ${obj.session_id ?? '?'}]\n` };
		}
		if (obj.type === 'assistant') {
			const content = obj.message?.content ?? [];
			const parts = [];
			for (const block of content) {
				if (block.type === 'text' && block.text) {
					parts.push(`\n[ASSISTANT]\n${block.text}\n`);
				} else if (block.type === 'tool_use') {
					parts.push(`\n[TOOL:${block.name}]\n${formatToolInput(block.name, block.input)}\n`);
				}
			}
			const usage = obj.message?.usage;
			return { text: parts.join(''), usage: usage ? contextSize(usage) : undefined };
		}
		if (obj.type === 'user') {
			const content = obj.message?.content ?? [];
			const parts = [];
			for (const block of content) {
				if (block.type === 'tool_result') {
					const text = Array.isArray(block.content)
						? block.content.map(c => c.text ?? '').join('')
						: String(block.content ?? '');
					const shown = text.length > TOOL_RESULT_CAP
						? `${text.slice(0, TOOL_RESULT_CAP)}\n… [+${text.length - TOOL_RESULT_CAP} more chars truncated]`
						: text;
					parts.push(`  ✓ ${shown}\n`);
				} else if (block.type === 'text' && block.text) {
					parts.push(`\n[USER]\n${block.text}\n`);
				}
			}
			return { text: parts.join('') };
		}
		if (obj.type === 'result') {
			const status = obj.is_error ? '✗ ERROR' : '✓ DONE';
			const cost = obj.total_cost_usd != null ? ` | cost $${obj.total_cost_usd.toFixed(4)}` : '';
			const dur = obj.duration_ms != null ? ` | ${(obj.duration_ms / 1000).toFixed(1)}s` : '';
			return {
				text: `\n[RESULT ${status}${dur}${cost}]\n${obj.result ?? ''}\n`,
				done: true,
				exitCode: obj.is_error ? 1 : 0,
			};
		}
	} catch {
		/* not JSON — pass through */
	}
	return { text: line + '\n' };
}

function killTree(child) {
	if (!child || child.killed || child.exitCode != null) return;
	if (process.platform === 'win32') {
		try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); }
		catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
	} else {
		try { child.kill('SIGKILL'); } catch { /* gone */ }
	}
}
