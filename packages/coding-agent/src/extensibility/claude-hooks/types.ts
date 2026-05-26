/**
 * Claude Code Hook Config Types
 *
 * Mirrors the .claude/settings.json hooks schema so omp can parse and execute
 * Claude Code-compatible command hooks. See https://code.claude.com/docs/en/hooks
 * for the authoritative schema.
 */

// =============================================================================
// Hook Handler Types
// =============================================================================

/** Supported hook handler types. */
export type ClaudeCodeHookHandlerType = "command" | "http";

/** Duration string format: "30s", "2m", "1h", "0s" (no timeout). */
export type Duration = string;

/**
 * Command hook handler — spawns a shell process.
 */
export interface ClaudeCodeCommandHook {
	type: "command";
	/** Shell command to run. */
	command: string;
	/** Optional arguments appended after command. */
	args?: string[];
	/**
	 * Optional permission-rule condition that further filters when this
	 * handler runs (e.g. "Bash(rm *)" runs only for Bash calls matching rm *).
	 */
	if?: string;
	/** Timeout (e.g. "30s"), defaults to "60s". */
	timeout?: Duration;
}

/**
 * HTTP hook handler — POSTs the event JSON to an endpoint.
 */
export interface ClaudeCodeHttpHook {
	type: "http";
	/** URL to POST to. */
	url: string;
	/** Optional extra headers. */
	headers?: Record<string, string>;
	/**
	 * Optional permission-rule condition.
	 */
	if?: string;
	/** Timeout (e.g. "30s"), defaults to "60s". */
	timeout?: Duration;
}

/** A single hook handler within a hook group. */
export type ClaudeCodeHookHandler = ClaudeCodeCommandHook | ClaudeCodeHttpHook;

// =============================================================================
// Matcher Group
// =============================================================================

/**
 * A matcher group: fires when `event` occurs and `matcher` matches the
 * event-specific discriminator (tool name, session mode, etc.).
 */
export interface ClaudeCodeHookGroup {
	/**
	 * Matcher string. Semantics depend on the containing event:
	 *   - Tool events: tool name or regex pattern
	 *   - SessionStart: "startup" | "resume" | "clear" | "compact"
	 *   - SessionEnd: "clear" | "resume" | "logout" | …
	 *   - etc.
	 *   - "*", "", or omitted means match all.
	 */
	matcher?: string;
	/** One or more handlers to run when the matcher matches. */
	hooks: ClaudeCodeHookHandler[];
}

// =============================================================================
// Hook Events
// =============================================================================

/**
 * All Claude Code hook event names.
 * Defined as a union so we can use them as dictionary keys.
 */
export type ClaudeCodeHookEventName =
	| "SessionStart"
	| "Setup"
	| "UserPromptSubmit"
	| "UserPromptExpansion"
	| "PreToolUse"
	| "PermissionRequest"
	| "PermissionDenied"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "PostToolBatch"
	| "Notification"
	| "SubagentStart"
	| "SubagentStop"
	| "TaskCreated"
	| "TaskCompleted"
	| "Stop"
	| "StopFailure"
	| "TeammateIdle"
	| "InstructionsLoaded"
	| "ConfigChange"
	| "CwdChanged"
	| "FileChanged"
	| "WorktreeCreate"
	| "WorktreeRemove"
	| "PreCompact"
	| "PostCompact"
	| "Elicitation"
	| "ElicitationResult"
	| "SessionEnd";

/**
 * The top-level hooks schema as it appears in .claude/settings.json.
 * Each key is an event name; each value is an array of matcher groups.
 *
 * Example:
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "check.sh" }] }]
 *   }
 * }
 * ```
 */
export type ClaudeCodeHooksConfig = Partial<Record<ClaudeCodeHookEventName, ClaudeCodeHookGroup[]>>;

// =============================================================================
// Parsed Hook Config (our internal representation)
// =============================================================================

/** A parsed, ready-to-execute Claude Code hook entry. */
export interface ClaudeCodeHookConfig {
	/** The Claude Code event name. */
	event: ClaudeCodeHookEventName;
	/** Matcher string (for tool events: tool name/regex; others: session state, etc.). */
	matcher: string;
	/** The handler to execute. */
	handler: ClaudeCodeHookHandler;
	/** Source level for diagnostics. */
	level: "user" | "project";
	/** Path to the source settings file for diagnostics. */
	sourcePath: string;
}

// =============================================================================
// Execution Input/Output (JSON protocol)
// =============================================================================

/**
 * JSON input written to the hook's stdin.
 * Matches Claude Code's hook input format.
 */
export interface ClaudeCodeHookInput {
	hook_event_name: string;
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	/** For tool events: the tool name. */
	tool_name?: string;
	/** For tool events: the tool's input arguments. */
	tool_input?: Record<string, unknown>;
	/** For tool events: the tool's result (PostToolUse only). */
	tool_result?: unknown;
	/** For tool events: error message (PostToolUseFailure only). */
	tool_error?: string;
	/** For SessionStart: how the session started. */
	session_start_reason?: string;
	/** For SessionEnd: why the session ended. */
	session_end_reason?: string;
	/** For UserPromptSubmit: the user's prompt text. */
	prompt?: string;
	/** For Stop: the assistant's response text. */
	stop_hook_active?: boolean;
	/** For PreCompact/PostCompact: what triggered compaction. */
	compact_trigger?: "manual" | "auto";
	/** For SubagentStart/SubagentStop: the agent type. */
	agent_type?: string;
}

/**
 * Permission decision from a hook's stdout.
 */
export interface ClaudeCodeHookDecision {
	hookSpecificOutput: {
		hookEventName: string;
		/** "allow" | "deny" | undefined (no decision) */
		permissionDecision?: "allow" | "deny";
		permissionDecisionReason?: string;
	};
}
