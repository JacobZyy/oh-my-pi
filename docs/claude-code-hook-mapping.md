# Claude Code Hook Mapping Reference

Documents the mapping between [Claude Code hooks](https://code.claude.com/docs/en/hooks) and omp's extension event system.

## Overview

omp bridges Claude Code command hooks defined in `.claude/settings.json` (and plugin `hooks.json` files) into the omp extension event system. When a mapped omp event fires, matching Claude Code hooks are executed using Claude Code's stdin/stdout JSON protocol.

Hook configurations are read from:
- `~/.claude/settings.json` (user-level)
- `.claude/settings.json` (project-level)

Only `type: "command"` hooks are supported. `http`, `mcp_tool`, `prompt`, and `agent` hook types are not yet implemented.

## Mapped Events (12)

| Claude Code Event | omp Event | Description |
|---|---|---|
| `SessionStart` | `session_start` | Session begins or resumes |
| `UserPromptSubmit` | `before_agent_start` | User submits a prompt, before agent loop starts |
| `PreToolUse` | `tool_call` | Before a tool executes; can block |
| `PostToolUse` | `tool_result` | After a tool succeeds |
| `PostToolUseFailure` | `tool_result` | After a tool fails (same omp event, hook receives error via `isError`) |
| `SubagentStart` | `agent_start` | Subagent spawns |
| `SubagentStop` | `agent_end` | Subagent finishes |
| `Stop` | `turn_end` | Agent finishes responding |
| `StopFailure` | `turn_end` | Turn ends due to API error |
| `PreCompact` | `auto_compaction_start` | Before context compaction |
| `PostCompact` | `auto_compaction_end` | After context compaction |
| `SessionEnd` | `session_shutdown` | Session terminates |

## Unmapped Events (17)

These Claude Code events have no corresponding omp event and are silently skipped:

| Claude Code Event | Reason |
|---|---|
| `Setup` | omp has no `--init-only` / `--maintenance` mode |
| `UserPromptExpansion` | omp does not expose slash command expansion to hooks |
| `PermissionRequest` | omp has no permission dialog system |
| `PermissionDenied` | No auto-mode classifier permission denials |
| `PostToolBatch` | No parallel-tool-batch completion event |
| `Notification` | No notification system |
| `TeammateIdle` | No agent team idle concept |
| `TaskCreated` | No task creation event (can be observed via `tool_call(todo_write)`) |
| `TaskCompleted` | No task completion event (can be observed via `tool_result(todo_write)`) |
| `InstructionsLoaded` | No instructions-load tracking |
| `ConfigChange` | No config change watcher |
| `CwdChanged` | No directory change tracking |
| `FileChanged` | No file system watcher |
| `WorktreeCreate` | No worktree creation hook |
| `WorktreeRemove` | No worktree removal hook |
| `Elicitation` | No MCP elicitation support |
| `ElicitationResult` | No MCP elicitation support |

## Matcher Support

Claude Code matchers (`*`, exact string, pipe-separated list, regex) are fully supported for tool events.

The `if` condition field supports the `ToolName(pattern)` format with `*` glob matching.

## Exit Code Conventions

Per Claude Code spec:
- **0**: success; stdout may contain a JSON `{ hookSpecificOutput: { ... } }` decision
- **2**: block the operation (equivalent to `permissionDecision: "deny"`)
- **Other**: non-blocking error, logged as warning

## Hook Decision Format

When a hook wants to influence omp behavior, it prints a JSON decision to stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked"
  }
}
```

Supported decision types:
- `permissionDecision: "deny"` — blocks tool execution (for `PreToolUse`)
- No output or `exit 0` — no decision, normal flow continues
