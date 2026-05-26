/**
 * Claude Code Hook Discovery
 *
 * Parses Claude Code hook configurations from settings.json and plugin
 * hooks.json files. Does NOT use the omp capability registry — outputs
 * flat ClaudeCodeHookConfig arrays consumed by ClaudeCodeHookBridge.
 */

import { logger, tryParseJson } from "@oh-my-pi/pi-utils";
import type {
	ClaudeCodeHookConfig,
	ClaudeCodeHookGroup,
	ClaudeCodeHookHandler,
	ClaudeCodeHooksConfig,
	ClaudeCodeHookEventName,
} from "./types";
import { isMapped } from "./event-map";

/** Known Claude Code hook event names (validation). */
const KNOWN_EVENTS: Set<string> = new Set([
	"SessionStart", "Setup", "UserPromptSubmit", "UserPromptExpansion",
	"PreToolUse", "PermissionRequest", "PermissionDenied",
	"PostToolUse", "PostToolUseFailure", "PostToolBatch",
	"Notification", "SubagentStart", "SubagentStop",
	"TaskCreated", "TaskCompleted", "Stop", "StopFailure",
	"TeammateIdle", "InstructionsLoaded", "ConfigChange",
	"CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove",
	"PreCompact", "PostCompact", "Elicitation", "ElicitationResult",
	"SessionEnd",
]);

/**
 * Parse a single source (settings.json or hooks.json content) into
 * flat ClaudeCodeHookConfig entries.
 *
 * Filters out:
 *   - Unknown event names
 *   - Non-"command" handler types (http, mcp_tool, prompt, agent not yet supported)
 *   - Events that are not mapped to any omp event (unmapped events are silently
 *     dropped; they're documented in event-map.ts for transparency)
 */
export function parseHooksConfig(
	source: Record<string, unknown>,
	sourcePath: string,
	level: "user" | "project",
): ClaudeCodeHookConfig[] {
	const hooksRaw = source.hooks;
	if (!hooksRaw || typeof hooksRaw !== "object" || Array.isArray(hooksRaw)) {
		return [];
	}

	const hooksConfig = hooksRaw as Record<string, unknown>;
	const entries: ClaudeCodeHookConfig[] = [];

	for (const [eventName, groupsRaw] of Object.entries(hooksConfig)) {
		if (!KNOWN_EVENTS.has(eventName)) {
			logger.debug("Claude Code hooks: unknown event", { event: eventName, source: sourcePath });
			continue;
		}

		// Skip events that have no omp equivalent
		if (!isMapped(eventName)) {
			logger.debug("Claude Code hooks: unmapped event skipped", { event: eventName, source: sourcePath });
			continue;
		}

		const event = eventName as ClaudeCodeHookEventName;

		if (!Array.isArray(groupsRaw)) {
			continue;
		}

		for (const group of groupsRaw) {
			if (!group || typeof group !== "object") continue;

			const typedGroup = group as ClaudeCodeHookGroup;
			const matcher = typedGroup.matcher ?? "*";

			if (!Array.isArray(typedGroup.hooks)) continue;

			for (const handler of typedGroup.hooks) {
				if (!handler || typeof handler !== "object") continue;
				const typedHandler = handler as ClaudeCodeHookHandler;

				// Only command hooks for now
				if (typedHandler.type !== "command") {
					logger.debug("Claude Code hooks: unsupported handler type", {
						type: typedHandler.type,
						event: eventName,
						source: sourcePath,
					});
					continue;
				}

				entries.push({
					event,
					matcher,
					handler: typedHandler,
					level,
					sourcePath,
				});
			}
		}
	}

	return entries;
}

/**
 * Parse hooks from a JSON string (the full settings.json content).
 * Returns empty array on parse failure.
 */
export function parseHooksFromJson(
	json: string,
	sourcePath: string,
	level: "user" | "project",
): ClaudeCodeHookConfig[] {
	const parsed = tryParseJson<Record<string, unknown>>(json);
	if (!parsed) {
		logger.debug("Claude Code hooks: failed to parse JSON", { source: sourcePath });
		return [];
	}
	return parseHooksConfig(parsed, sourcePath, level);
}
