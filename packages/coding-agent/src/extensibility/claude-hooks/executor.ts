/**
 * Claude Code Hook Executor
 *
 * Runs command hooks using Claude Code's stdin/stdout JSON protocol.
 * Commands are executed through a shell (sh -c) so that ${CLAUDE_PLUGIN_ROOT}
 * and other environment variable references are expanded by the shell, matching
 * Claude Code's behavior exactly.
 *
 * HTTP hooks are not yet implemented.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { ClaudeCodeCommandHook, ClaudeCodeHookDecision, ClaudeCodeHookInput } from "./types";

/**
 * Parse a duration string like "30s", "2m", "10s" into milliseconds.
 * Returns 60000 (60s) for invalid or missing strings.
 */
function parseDurationMs(duration?: string): number {
	if (!duration || duration === "0s") return 0;
	const match = /^(\d+)(s|m|h)$/.exec(duration);
	if (!match) return 60_000;
	const value = Number.parseInt(match[1], 10);
	switch (match[2]) {
		case "h":
			return value * 3_600_000;
		case "m":
			return value * 60_000;
		default:
			return value * 1_000;
	}
}

/**
 * Attempt to parse a Claude Code hook decision from stdout.
 * Returns null if the output is not a valid decision JSON.
 */
function parseDecision(stdout: string): ClaudeCodeHookDecision | null {
	if (!stdout.trim()) return null;
	try {
		const parsed = JSON.parse(stdout);
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.hookSpecificOutput &&
			typeof parsed.hookSpecificOutput === "object" &&
			typeof parsed.hookSpecificOutput.hookEventName === "string"
		) {
			return parsed as ClaudeCodeHookDecision;
		}
	} catch {
		// Not JSON → no decision
	}
	return null;
}

/** Result of executing a command hook. */
export interface ClaudeCodeHookResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/** Parsed decision, if the hook returned one. */
	decision: ClaudeCodeHookDecision | null;
	/** Error thrown during execution, if any. */
	error?: Error;
}

/**
 * Execute a Claude Code command hook via a shell (sh -c).
 *
 * Sets CLAUDE_PLUGIN_ROOT as an environment variable so the shell can
 * expand ${CLAUDE_PLUGIN_ROOT} in the command, matching Claude Code's
 * behavior. The hook command string (including args) is passed as the
 * argument to sh -c.
 *
 * Exit code conventions (per Claude Code spec):
 *   - 0: success, stdout may contain a JSON decision
 *   - 2: block the operation (equivalent to permissionDecision: "deny")
 *   - other: non-blocking error, logged as warning
 */
export async function executeCommandHook(
	hook: ClaudeCodeCommandHook,
	input: ClaudeCodeHookInput,
	cwd: string,
	claudePluginRoot: string | undefined,
	signal?: AbortSignal,
): Promise<ClaudeCodeHookResult> {
	const args = hook.args ?? [];
	const timeoutMs = parseDurationMs(hook.timeout) || 60_000;

	// Build the full command string (shell will handle expansion)
	const commandStr = args.length > 0
		? `${hook.command} ${args.join(" ")}`
		: hook.command;

	// Set CLAUDE_PLUGIN_ROOT in env so ${CLAUDE_PLUGIN_ROOT} is expanded by the shell
	const env: Record<string, string> = { ...(process.env as Record<string, string>) };
	if (claudePluginRoot) {
		env.CLAUDE_PLUGIN_ROOT = claudePluginRoot;
	}

	try {
		// Use Bun.spawn directly for shell + env support, then manually
		// handle stdin writing and output collection
		const proc = Bun.spawn({
			cmd: ["sh", "-c", commandStr],
			cwd,
			env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
		});

		// Write JSON input to stdin and close
		const stdin = proc.stdin;
		if (stdin) {
			stdin.write(new TextEncoder().encode(JSON.stringify(input)));
			stdin.end();
		}

		// Set up timeout and abort handling
		let killed = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const kill = () => {
			if (!killed) {
				killed = true;
				proc.kill();
			}
		};

		if (timeoutMs > 0) {
			timeoutId = setTimeout(kill, timeoutMs);
		}

		if (signal) {
			if (signal.aborted) {
				kill();
			} else {
				signal.addEventListener("abort", kill, { once: true });
			}
		}

		// Wait for process to exit
		const exitCode = await proc.exited;

		if (timeoutId) clearTimeout(timeoutId);
		if (signal) signal.removeEventListener("abort", kill);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		if (exitCode === 2) {
			return {
				exitCode,
				stdout,
				stderr,
				decision: {
					hookSpecificOutput: {
						hookEventName: input.hook_event_name,
						permissionDecision: "deny",
						permissionDecisionReason: "hook exited with code 2 (block)",
					},
				},
			};
		}

		const decision = parseDecision(stdout);
		return { exitCode, stdout, stderr, decision };
	} catch (error) {
		logger.warn("Claude Code hook execution failed", {
			command: hook.command,
			event: input.hook_event_name,
			error: String(error),
		});
		return {
			exitCode: -1,
			stdout: "",
			stderr: String(error),
			decision: null,
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}
