/**
 * Spawn the audit agent for one batch.
 *
 * Currently invokes the Claude Code CLI (`claude`) in headless mode with the
 * prompt streamed via a file. Other agents can be added by extending the
 * `AGENT_ADAPTERS` map.
 */

import { spawn, execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

const AGENT_ADAPTERS = {
	claude: {
		buildArgs(promptFile) {
			// `claude -p <prompt>` runs headless; --dangerously-skip-permissions
			// is required for non-interactive multi-tool agent runs in our setup.
			return ['-p', `@${promptFile}`, '--dangerously-skip-permissions', '--no-session-persistence'];
		},
		bin: process.platform === 'win32' ? 'claude.cmd' : 'claude',
	},
};

/**
 * Run an agent against a prompt; tee output to logFile.
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
	log.write(`# rubric audit log — ${new Date().toISOString()}\n\n$ ${adapter.bin} ${args.join(' ')}\n\n`);

	return await new Promise((resolve, reject) => {
		const child = spawn(adapter.bin, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: process.platform === 'win32',
		});
		let timer = null;
		const arm = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				log.write(`\n[runner] idle timeout after ${IDLE_TIMEOUT_MS / 1000}s — killing agent\n`);
				killTree(child);
				resolve({ exitCode: -1, timedOut: true });
			}, IDLE_TIMEOUT_MS);
		};
		const onData = (chunk) => { log.write(chunk); arm(); };
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('error', reject);
		child.on('close', (code) => {
			if (timer) clearTimeout(timer);
			log.end(`\n[runner] agent exited with code ${code}\n`);
			resolve({ exitCode: code, timedOut: false });
		});
		arm();
	});
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
