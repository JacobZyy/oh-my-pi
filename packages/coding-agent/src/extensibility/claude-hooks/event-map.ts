/**
 * Claude Code → omp Hook Event Mapping
 *
 * Maps Claude Code hook event names to omp's HookEvent type discriminators.
 * Events listed under UNMAPPED_EVENTS lack a corresponding omp event and
 * will be silently skipped at runtime.
 */

import type { ClaudeCodeHookEventName } from "./types";

// =============================================================================
// Event Name Mapping Table
// =============================================================================

/**
 * Direct event name mapping from Claude Code to omp.
 */
export const CC_TO_OMP_EVENT: Partial<Record<ClaudeCodeHookEventName, string>> = {
	SessionStart: "session_start",
	UserPromptSubmit: "before_agent_start",
	PreToolUse: "tool_execution_start",
	PostToolUse: "tool_execution_end",
	PostToolUseFailure: "tool_execution_end",
	SubagentStart: "agent_start",
	SubagentStop: "agent_end",
	Stop: "turn_end",
	StopFailure: "turn_end",
	PreCompact: "auto_compaction_start",
	PostCompact: "auto_compaction_end",
	SessionEnd: "session_shutdown",
};

/** Reverse lookup: omp event type → Claude Code event name. */
export const OMP_TO_CC_EVENT: Record<string, ClaudeCodeHookEventName> = {};
for (const [cc, omp] of Object.entries(CC_TO_OMP_EVENT)) {
	if (omp) {
		OMP_TO_CC_EVENT[omp] = cc as ClaudeCodeHookEventName;
	}
}

// =============================================================================
// Unmapped Events
// =============================================================================

/**
 * Claude Code hook events that currently have no corresponding omp event.
 * Hooks registered for these events will not fire in omp.
 */
export const UNMAPPED_EVENTS: ClaudeCodeHookEventName[] = [
	"Setup",
	"UserPromptExpansion",
	"PermissionRequest",
	"PermissionDenied",
	"PostToolBatch",
	"Notification",
	"TeammateIdle",
	"TaskCreated",
	"TaskCompleted",
	"InstructionsLoaded",
	"ConfigChange",
	"CwdChanged",
	"FileChanged",
	"WorktreeCreate",
	"WorktreeRemove",
	"Elicitation",
	"ElicitationResult",
];

const UNMAPPED_SET = new Set<string>(UNMAPPED_EVENTS);

export function isMapped(ccEvent: string): boolean {
	return ccEvent in CC_TO_OMP_EVENT;
}

export function isUnmapped(ccEvent: string): boolean {
	return UNMAPPED_SET.has(ccEvent);
}
