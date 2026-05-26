/**
 * Claude Code Hook Bridge — Public API
 *
 * Parses Claude Code hook configurations from settings.json files and
 * bridges them into omp's extension event system.
 */

export { createClaudeCodeHookBridge } from "./bridge";
export { parseHooksConfig, parseHooksFromJson } from "./discovery";
export { CC_TO_OMP_EVENT, OMP_TO_CC_EVENT, UNMAPPED_EVENTS, isMapped, isUnmapped } from "./event-map";
export { executeCommandHook } from "./executor";
export type { ClaudeCodeHookResult } from "./executor";
export type {
	ClaudeCodeHookConfig,
	ClaudeCodeHookEventName,
	ClaudeCodeCommandHook,
	ClaudeCodeHttpHook,
	ClaudeCodeHookGroup,
	ClaudeCodeHookHandler,
	ClaudeCodeHooksConfig,
	ClaudeCodeHookInput,
	ClaudeCodeHookDecision,
} from "./types";

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionFactory } from "../extensions/types";
import { type ClaudeCodeHookConfig } from "./types";
import { parseHooksFromJson } from "./discovery";
import { createClaudeCodeHookBridge } from "./bridge";

/**
 * Convenience: parse hooks from user and project settings.json files,
 * returning an ExtensionFactory ready to be used as an inline extension.
 */
export function createClaudeHookFactory(
	cwd: string,
	home: string,
): ExtensionFactory | null {
	const configs: ClaudeCodeHookConfig[] = [];

	const userSettingsPath = path.join(home, ".claude", "settings.json");
	if (fs.existsSync(userSettingsPath)) {
		try {
			configs.push(...parseHooksFromJson(fs.readFileSync(userSettingsPath, "utf-8"), userSettingsPath, "user"));
		} catch { /* skip unreadable */ }
	}

	const projectSettingsPath = path.join(cwd, ".claude", "settings.json");
	if (fs.existsSync(projectSettingsPath)) {
		try {
			configs.push(...parseHooksFromJson(fs.readFileSync(projectSettingsPath, "utf-8"), projectSettingsPath, "project"));
		} catch { /* skip unreadable */ }
	}

	if (configs.length === 0) return null;
	return createClaudeCodeHookBridge(configs, cwd);
}
