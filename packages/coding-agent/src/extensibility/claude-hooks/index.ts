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
import { logger } from "@oh-my-pi/pi-utils";
import type { ExtensionFactory } from "../extensions/types";
import { type ClaudeCodeHookConfig } from "./types";
import { parseHooksFromJson } from "./discovery";
import { createClaudeCodeHookBridge } from "./bridge";
import { listClaudePluginRoots } from "../../discovery/helpers";

/**
 * Discover Claude Code hook configs from plugin hooks.json files.
 * When multiple versions of the same plugin exist, only the highest
 * version is collected.
 */
export async function discoverPluginHookConfigs(home: string): Promise<ClaudeCodeHookConfig[]> {
	const configs: ClaudeCodeHookConfig[] = [];
	try {
		const { roots } = await listClaudePluginRoots(home);

		// Deduplicate: keep only the highest version per (marketplace, plugin)
		const bestVersion = new Map<string, { version: string; root: typeof roots[0] }>();
		for (const root of roots) {
			const key = `${root.marketplace}/${root.plugin}`;
			const existing = bestVersion.get(key);
			if (!existing || Bun.semver.order(root.version, existing.version) > 0) {
				bestVersion.set(key, { version: root.version, root });
			}
		}

		for (const { root } of bestVersion.values()) {
			const hooksPath = path.join(root.path, "hooks", "hooks.json");
			try {
				if (fs.existsSync(hooksPath)) {
					const content = fs.readFileSync(hooksPath, "utf-8");
					const parsed = parseHooksFromJson(content, hooksPath, "project");
					if (parsed.length > 0) {
						configs.push(...parsed);
						logger.debug("Claude Code hooks: loaded from plugin", {
							plugin: root.id,
							version: root.version,
							hookCount: parsed.length,
						});
					}
				}
			} catch { /* skip unreadable */ }
		}
	} catch (error) {
		logger.debug("Claude Code hooks: failed to scan plugins", { error: String(error) });
	}
	return configs;
}

/**
 * Convenience: parse hooks from user settings.json, project settings.json,
 * and all installed plugin hooks.json files. Returns an ExtensionFactory or null.
 */
export async function createClaudeHookFactoryAsync(
	cwd: string,
	home: string,
): Promise<ExtensionFactory | null> {
	const configs: ClaudeCodeHookConfig[] = [];

	// User-level: ~/.claude/settings.json
	const userSettingsPath = path.join(home, ".claude", "settings.json");
	if (fs.existsSync(userSettingsPath)) {
		try {
			configs.push(...parseHooksFromJson(fs.readFileSync(userSettingsPath, "utf-8"), userSettingsPath, "user"));
		} catch { /* skip unreadable */ }
	}

	// Project-level: .claude/settings.json
	const projectSettingsPath = path.join(cwd, ".claude", "settings.json");
	if (fs.existsSync(projectSettingsPath)) {
		try {
			configs.push(...parseHooksFromJson(fs.readFileSync(projectSettingsPath, "utf-8"), projectSettingsPath, "project"));
		} catch { /* skip unreadable */ }
	}

	// Plugin hooks: ~/.claude/plugins/cache/<plugin>/hooks/hooks.json
	const pluginConfigs = await discoverPluginHookConfigs(home);
	configs.push(...pluginConfigs);

	if (configs.length === 0) return null;
	return createClaudeCodeHookBridge(configs, cwd);
}

/**
 * Sync convenience: parse hooks from user and project settings.json only
 * (does NOT scan plugins). For full discovery use createClaudeHookFactoryAsync.
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
