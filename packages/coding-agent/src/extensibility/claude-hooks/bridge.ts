/**
 * Claude Code Hook Bridge
 *
 * Bridges Claude Code hook configurations (from settings.json) into omp's
 * extension event system via an ExtensionFactory.
 *
 * The factory registers handlers for mapped extension events and executes
 * matching Claude Code command hooks when those events fire.
 */

import { getProjectDir, logger } from "@oh-my-pi/pi-utils";
import type { ExtensionFactory, ExtensionAPI } from "../extensions/types";
import { CC_TO_OMP_EVENT } from "./event-map";
import type { ClaudeCodeHookConfig, ClaudeCodeHookInput } from "./types";
import { executeCommandHook } from "./executor";

/**
 * Match a hook's matcher against a tool name.
 * Follows Claude Code's matcher semantics:
 *   - "", "*", or omitted → match all
 *   - Only letters, digits, _, | → exact or pipe-separated list
 *   - Contains any other char → JavaScript regex
 */
function matchesTool(matcher: string, toolName: string): boolean {
	if (!matcher || matcher === "*") return true;
	if (/^[\w|]+$/.test(matcher)) {
		const lower = toolName.toLowerCase();
		return matcher.toLowerCase().split("|").some(p => p === lower);
	}
	try {
		return new RegExp(matcher).test(toolName);
	} catch {
		return false;
	}
}

function buildHookInput(ccEvent: string, overrides: Partial<ClaudeCodeHookInput> = {}): ClaudeCodeHookInput {
	return { hook_event_name: ccEvent, cwd: getProjectDir(), ...overrides };
}

function matchesIf(condition: string | undefined, toolName: string, inputStr: string): boolean {
	if (!condition) return true;
	const match = /^(\w+)\((.+)\)$/.exec(condition);
	if (!match) return true;
	const [, condTool, condPattern] = match;
	if (condTool !== toolName) return false;
	const regexPattern = condPattern.replace(/\*/g, ".*").replace(/\?/g, ".");
	try {
		return new RegExp(regexPattern, "i").test(inputStr);
	} catch {
		return true;
	}
}

/**
 * Extract CLAUDE_PLUGIN_ROOT from the hook's sourcePath.
 * Returns undefined for hooks not from plugins (e.g., settings.json).
 */
function getClaudePluginRoot(sourcePath: string): string | undefined {
	const idx = sourcePath.lastIndexOf("/hooks/hooks.json");
	if (idx === -1) return undefined;
	return sourcePath.slice(0, idx);
}

interface HookRunResult {
	denied: boolean;
	reason?: string;
}

async function runMatchingHooks(
	configs: ClaudeCodeHookConfig[],
	ccEvent: string,
	toolName: string | undefined,
	inputStr: string | undefined,
	cwd: string,
): Promise<HookRunResult> {
	for (const config of configs) {
		if (config.event !== ccEvent) continue;
		if (toolName && !matchesTool(config.matcher, toolName)) continue;
		if (config.handler.type === "command" && !matchesIf(config.handler.if, toolName ?? "", inputStr ?? "")) continue;

		const hookInput = buildHookInput(ccEvent, { tool_name: toolName });

		if (config.handler.type === "command") {
			const pluginRoot = getClaudePluginRoot(config.sourcePath);
			const result = await executeCommandHook(config.handler, hookInput, cwd, pluginRoot);

			// Surface hook output to the user (matches Claude Code behavior)
			if (result.stdout.trim()) {
				logger.info("Claude Code hook stdout", {
					event: ccEvent,
					command: (config.handler as { command: string }).command,
					stdout: result.stdout.trim(),
				});
			}
			if (result.stderr.trim()) {
				logger.warn("Claude Code hook stderr", {
					event: ccEvent,
					command: (config.handler as { command: string }).command,
					stderr: result.stderr.trim(),
				});
			}

			if (result.decision?.hookSpecificOutput.permissionDecision === "deny") {
				return {
					denied: true,
					reason: result.decision.hookSpecificOutput.permissionDecisionReason
						?? `blocked by hook: ${config.handler.command}`,
				};
			}
		}
	}
	return { denied: false };
}

/**
 * Create an ExtensionFactory that bridges Claude Code hook configs into omp's
 * extension event system.
 */
export function createClaudeCodeHookBridge(configs: ClaudeCodeHookConfig[], cwd: string): ExtensionFactory {
	if (configs.length === 0) {
		return () => {};
	}

	return (api: ExtensionAPI) => {
		// ── PreToolUse (tool_execution_start, observer-only) ──
		api.on("tool_execution_start", async (event) => {
			const raw = event as unknown as Record<string, unknown>;
			const toolName = String(raw.toolName ?? "");
			logger.debug("Claude Code hooks: tool_execution_start", { toolName });
			void runMatchingHooks(configs, "PreToolUse", toolName, undefined, cwd);
		});

		// ── PostToolUse / PostToolUseFailure (tool_execution_end) ──
		api.on("tool_execution_end", async (event) => {
			const raw = event as unknown as Record<string, unknown>;
			logger.debug("Claude Code hooks: tool_execution_end", { toolName: String(raw.toolName ?? "") });
			void runMatchingHooks(configs, "PostToolUse", undefined, undefined, cwd);
		});

		// ── SessionStart ──
		api.on("session_start", async () => {
			void runMatchingHooks(configs, "SessionStart", undefined, undefined, cwd);
		});

		// ── UserPromptSubmit ──
		if (CC_TO_OMP_EVENT.UserPromptSubmit) {
			api.on("before_agent_start", async (event) => {
				const prompt = String((event as unknown as Record<string, unknown>).prompt ?? "");
				const result = await runMatchingHooks(configs, "UserPromptSubmit", undefined, prompt, cwd);
				if (result.denied) {
					return { message: { customType: "cc-hook-blocked", content: result.reason ?? "blocked", display: false } };
				}
			});
		}

		// ── SubagentStart / SubagentStop ──
		if (CC_TO_OMP_EVENT.SubagentStart) {
			api.on("agent_start", async () => {
				void runMatchingHooks(configs, "SubagentStart", undefined, undefined, cwd);
			});
		}
		if (CC_TO_OMP_EVENT.SubagentStop) {
			api.on("agent_end", async () => {
				void runMatchingHooks(configs, "SubagentStop", undefined, undefined, cwd);
			});
		}

		// ── Stop / StopFailure ──
		if (CC_TO_OMP_EVENT.Stop) {
			api.on("turn_end", async () => {
				void runMatchingHooks(configs, "Stop", undefined, undefined, cwd);
			});
		}

		// ── PreCompact / PostCompact ──
		if (CC_TO_OMP_EVENT.PreCompact) {
			api.on("auto_compaction_start", async () => {
				void runMatchingHooks(configs, "PreCompact", undefined, undefined, cwd);
			});
		}
		if (CC_TO_OMP_EVENT.PostCompact) {
			api.on("auto_compaction_end", async () => {
				void runMatchingHooks(configs, "PostCompact", undefined, undefined, cwd);
			});
		}

		// ── SessionEnd ──
		if (CC_TO_OMP_EVENT.SessionEnd) {
			api.on("session_shutdown", async () => {
				void runMatchingHooks(configs, "SessionEnd", undefined, undefined, cwd);
			});
		}

		logger.debug("Claude Code hook bridge registered", { hookCount: configs.length });
	};
}
