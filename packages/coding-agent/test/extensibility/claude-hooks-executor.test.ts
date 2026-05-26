import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeCommandHook } from "@oh-my-pi/pi-coding-agent/extensibility/claude-hooks";

describe("executeCommandHook", () => {
	let tmpDir: string;
	let scriptPath: string;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hook-test-"));
		scriptPath = path.join(tmpDir, "test-hook.sh");
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolves CLAUDE_PLUGIN_ROOT via shell env var", async () => {
		fs.writeFileSync(scriptPath, "#!/bin/bash\necho \"PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT\"\nexit 0\n");
		fs.chmodSync(scriptPath, 0o755);

		const result = await executeCommandHook(
			{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/test-hook.sh" },
			{ hook_event_name: "Stop", cwd: os.homedir() },
			os.homedir(),
			tmpDir,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(`PLUGIN_ROOT=${tmpDir}`);
		expect(result.error).toBeUndefined();
	});

	it("treats exit code 2 as block (deny)", async () => {
		fs.writeFileSync(scriptPath, "#!/bin/bash\nexit 2\n");

		const result = await executeCommandHook(
			{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/test-hook.sh" },
			{ hook_event_name: "PreToolUse", cwd: os.homedir() },
			os.homedir(),
			tmpDir,
		);

		expect(result.exitCode).toBe(2);
		expect(result.decision?.hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("parses JSON decision from stdout", async () => {
		const decision = JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "test reason",
			},
		});
		fs.writeFileSync(scriptPath, `#!/bin/bash\necho '${decision}'\n`);

		const result = await executeCommandHook(
			{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/test-hook.sh" },
			{ hook_event_name: "PreToolUse", cwd: os.homedir() },
			os.homedir(),
			tmpDir,
		);

		expect(result.exitCode).toBe(0);
		expect(result.decision?.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(result.decision?.hookSpecificOutput.permissionDecisionReason).toBe("test reason");
	});

	it("handles non-existent command gracefully", async () => {
		const result = await executeCommandHook(
			{ type: "command", command: "/nonexistent/path/script.sh" },
			{ hook_event_name: "Stop", cwd: os.homedir() },
			os.homedir(),
			undefined,
		);

		expect(result.exitCode).not.toBe(0);
	});
});
