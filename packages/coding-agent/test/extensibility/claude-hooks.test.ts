import { describe, expect, it } from "bun:test";
import {
	parseHooksConfig,
	parseHooksFromJson,
} from "@oh-my-pi/pi-coding-agent/extensibility/claude-hooks";
import { CC_TO_OMP_EVENT, UNMAPPED_EVENTS, isMapped, isUnmapped } from "@oh-my-pi/pi-coding-agent/extensibility/claude-hooks/event-map";

describe("event-map", () => {
	it("maps all known mapped events to omp events", () => {
		expect(CC_TO_OMP_EVENT.SessionStart).toBe("session_start");
		expect(CC_TO_OMP_EVENT.PreToolUse).toBe("tool_execution_start");
		expect(CC_TO_OMP_EVENT.PostToolUse).toBe("tool_execution_end");
		expect(CC_TO_OMP_EVENT.SubagentStart).toBe("agent_start");
		expect(CC_TO_OMP_EVENT.SubagentStop).toBe("agent_end");
		expect(CC_TO_OMP_EVENT.Stop).toBe("turn_end");
		expect(CC_TO_OMP_EVENT.PreCompact).toBe("auto_compaction_start");
		expect(CC_TO_OMP_EVENT.PostCompact).toBe("auto_compaction_end");
		expect(CC_TO_OMP_EVENT.SessionEnd).toBe("session_shutdown");
		expect(CC_TO_OMP_EVENT.UserPromptSubmit).toBe("before_agent_start");
		expect(CC_TO_OMP_EVENT.PostToolUseFailure).toBe("tool_execution_end");
		expect(CC_TO_OMP_EVENT.StopFailure).toBe("turn_end");
	});

	it("identifies mapped events", () => {
		expect(isMapped("PreToolUse")).toBe(true);
		expect(isMapped("SessionStart")).toBe(true);
	});

	it("identifies unmapped events", () => {
		expect(isUnmapped("Setup")).toBe(true);
		expect(isUnmapped("Notification")).toBe(true);
		expect(isUnmapped("WorktreeCreate")).toBe(true);
	});

	it("returns false for unknown events", () => {
		expect(isMapped("NonExistentEvent")).toBe(false);
		expect(isUnmapped("NonExistentEvent")).toBe(false);
	});

	it("all unmapped events are documented", () => {
		// All events that are unmapped should be in the UNMAPPED_EVENTS list
		const allCKEvents = [
			...Object.keys(CC_TO_OMP_EVENT),
			...UNMAPPED_EVENTS,
		];
		expect(new Set(allCKEvents).size).toBe(allCKEvents.length); // no duplicates
	});

	it("no event is both mapped and unmapped", () => {
		for (const cc of Object.keys(CC_TO_OMP_EVENT)) {
			expect(isUnmapped(cc)).toBe(false);
		}
	});
});

describe("parseHooksConfig", () => {
	it("returns empty for missing hooks key", () => {
		expect(parseHooksConfig({}, "test.json", "user")).toEqual([]);
	});

	it("returns empty for null hooks", () => {
		expect(parseHooksConfig({ hooks: null as unknown as Record<string, unknown> }, "test.json", "user")).toEqual([]);
	});

	it("returns empty for non-object hooks", () => {
		expect(parseHooksConfig({ hooks: "not an object" as unknown as Record<string, unknown> }, "test.json", "user")).toEqual([]);
	});

	it("skips unknown event names", () => {
		const configs = parseHooksConfig({
			hooks: {
				MadeUpEvent: [{ hooks: [{ type: "command", command: "echo hi" }] }],
			},
		}, "test.json", "user");
		expect(configs).toEqual([]);
	});

	it("skips unmapped events", () => {
		// Setup is explicitly unmapped
		const configs = parseHooksConfig({
			hooks: {
				Setup: [{ hooks: [{ type: "command", command: "echo hi" }] }],
			},
		}, "test.json", "user");
		expect(configs).toEqual([]);
	});

	it("parses a simple PreToolUse hook", () => {
		const configs = parseHooksConfig({
			hooks: {
				PreToolUse: [{
					matcher: "Bash",
					hooks: [{ type: "command", command: "check.sh", args: ["--verbose"] }],
				}],
			},
		}, "test.json", "user");
		expect(configs).toHaveLength(1);
		expect(configs[0].event).toBe("PreToolUse");
		expect(configs[0].matcher).toBe("Bash");
		expect(configs[0].handler.type).toBe("command");
		expect((configs[0].handler as { type: "command"; command: string }).command).toBe("check.sh");
		expect((configs[0].handler as { type: "command"; args?: string[] }).args).toEqual(["--verbose"]);
		expect(configs[0].level).toBe("user");
		expect(configs[0].sourcePath).toBe("test.json");
	});

	it("defaults matcher to '*' when missing", () => {
		const configs = parseHooksConfig({
			hooks: {
				PreToolUse: [{
					hooks: [{ type: "command", command: "echo hi" }],
				}],
			},
		}, "test.json", "user");
		expect(configs[0].matcher).toBe("*");
	});

	it("skips non-command handler types", () => {
		const configs = parseHooksConfig({
			hooks: {
				PreToolUse: [{
					hooks: [{ type: "http", url: "https://example.com" } as unknown as { type: "command"; command: string }],
				}],
			},
		}, "test.json", "user");
		expect(configs).toEqual([]);
	});

	it("parses multiple events", () => {
		const configs = parseHooksConfig({
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "pre.sh" }] }],
				PostToolUse: [{ hooks: [{ type: "command", command: "post.sh" }] }],
				SessionStart: [{ hooks: [{ type: "command", command: "start.sh" }] }],
			},
		}, "test.json", "user");
		expect(configs).toHaveLength(3);
		expect(configs.map(c => c.event).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionStart"]);
	});
});

describe("parseHooksFromJson", () => {
	it("returns empty for invalid JSON", () => {
		expect(parseHooksFromJson("{not json}", "test.json", "user")).toEqual([]);
	});

	it("parses valid JSON with hooks", () => {
		const json = JSON.stringify({
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "test.sh" }] }],
			},
		});
		const configs = parseHooksFromJson(json, "test.json", "user");
		expect(configs).toHaveLength(1);
		expect((configs[0].handler as { type: "command"; command: string }).command).toBe("test.sh");
});
});
// v
