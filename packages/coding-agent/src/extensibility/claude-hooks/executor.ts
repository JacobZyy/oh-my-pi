/**
 * Claude Code Hook Executor
 *
 * Runs command hooks using Claude Code's stdin/stdout JSON protocol.
 * HTTP hooks are not yet implemented.
 */

import { logger, ptree } from "@oh-my-pi/pi-utils";
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
 * Execute a Claude Code command hook.
 *
 * Writes `input` as JSON to the process stdin, captures stdout/stderr,
 * and parses any hook decision from the output.
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
	signal?: AbortSignal,
): Promise<ClaudeCodeHookResult> {
	const args = hook.args ?? [];
	const timeoutMs = parseDurationMs(hook.timeout) || 60_000;

	try {
		const result = await ptree.exec(
			[hook.command, ...args],
			{
				cwd,
				signal,
				timeout: timeoutMs,
				input: JSON.stringify(input),
				allowNonZero: true,
				allowAbort: true,
			},
		);

		if (result.exitCode === 2) {
			return {
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				decision: {
					hookSpecificOutput: {
						hookEventName: input.hook_event_name,
						permissionDecision: "deny",
						permissionDecisionReason: "hook exited with code 2 (block)",
					},
				},
			};
		}

		const decision = parseDecision(result.stdout);
		return {
			exitCode: result.exitCode ?? 0,
			stdout: result.stdout,
			stderr: result.stderr,
			decision,
		};
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
