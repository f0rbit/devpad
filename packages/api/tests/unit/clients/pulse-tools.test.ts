import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../../src/api-client";
import { tools } from "../../../src/tools";

/**
 * MCP tool input-schema validation. We don't exercise the full network round
 * trip — that's covered upstream by the worker proxy test. Here we only
 * confirm:
 *   1. Each new pulse / alerts tool exists on the registry.
 *   2. Its `inputSchema` accepts a sane happy-path input.
 *   3. It rejects an obviously bad input.
 */

describe("pulse MCP tool input schemas", () => {
	const expected_names = [
		"devpad_pulse_summary",
		"devpad_pulse_events",
		"devpad_pulse_errors",
		"devpad_pulse_logs",
		"devpad_pulse_latency",
		"devpad_alerts_list",
		"devpad_alerts_subscribe",
		"devpad_alerts_unsubscribe",
		"devpad_pulse_key_create",
	];

	it("registers every expected tool", () => {
		for (const name of expected_names) {
			expect(tools[name]).toBeDefined();
			expect(tools[name]?.name).toBe(name);
			expect(tools[name]?.inputSchema).toBeDefined();
			expect(typeof tools[name]?.execute).toBe("function");
		}
	});

	it("devpad_pulse_summary accepts {project_id, range} and rejects missing fields", () => {
		const tool = tools.devpad_pulse_summary!;
		expect(tool.inputSchema.safeParse({ project_id: "p_abc", range: "24h" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p_abc" }).success).toBe(false); // missing range
		expect(tool.inputSchema.safeParse({ project_id: "p_abc", range: "yearly" }).success).toBe(false); // invalid enum
	});

	it("devpad_pulse_events accepts the optional filter shape", () => {
		const tool = tools.devpad_pulse_events!;
		expect(tool.inputSchema.safeParse({ project_id: "p_abc" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p_abc", name: "error", limit: 50 }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p_abc", limit: "fifty" }).success).toBe(false);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pulse_errors requires range", () => {
		const tool = tools.devpad_pulse_errors!;
		expect(tool.inputSchema.safeParse({ project_id: "p", range: "7d", group_by_fingerprint: true }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p" }).success).toBe(false);
	});

	it("devpad_pulse_logs accepts optional level + search", () => {
		const tool = tools.devpad_pulse_logs!;
		expect(tool.inputSchema.safeParse({ project_id: "p", range: "7d", level: "warn", search: "timeout" }).success).toBe(
			true,
		);
		expect(tool.inputSchema.safeParse({ project_id: "p" }).success).toBe(false);
	});

	it("devpad_pulse_latency accepts route + percentiles[]", () => {
		const tool = tools.devpad_pulse_latency!;
		expect(tool.inputSchema.safeParse({ project_id: "p", range: "24h" }).success).toBe(true);
		expect(
			tool.inputSchema.safeParse({ project_id: "p", range: "24h", route: "/api/x", percentiles: [50, 95] }).success,
		).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p", range: "24h", percentiles: ["fifty"] }).success).toBe(false);
	});

	it("devpad_alerts_list requires project_id", () => {
		const tool = tools.devpad_alerts_list!;
		expect(tool.inputSchema.safeParse({ project_id: "p" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_alerts_subscribe accepts a sub envelope and rejects missing required fields", () => {
		const tool = tools.devpad_alerts_subscribe!;
		const ok = tool.inputSchema.safeParse({
			project_id: "p_abc",
			name: "errors only",
			filter: { name: "error" },
			channel: { kind: "discord", webhook_url: "https://discord.test/x" },
			cooldown_seconds: 120,
		});
		expect(ok.success).toBe(true);

		const missing_filter = tool.inputSchema.safeParse({
			project_id: "p_abc",
			name: "x",
			channel: { kind: "discord", webhook_url: "https://discord.test/x" },
		});
		expect(missing_filter.success).toBe(false);
	});

	it("devpad_alerts_unsubscribe requires id", () => {
		const tool = tools.devpad_alerts_unsubscribe!;
		expect(tool.inputSchema.safeParse({ id: "sub_123" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pulse_key_create accepts optional rate_limit_per_min", () => {
		const tool = tools.devpad_pulse_key_create!;
		expect(tool.inputSchema.safeParse({ project_id: "p" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p", rate_limit_per_min: 1200 }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "p", rate_limit_per_min: "lots" }).success).toBe(false);
	});
});

describe("pulse ApiClient namespace", () => {
	it("exposes pulse.* methods", () => {
		const client = new ApiClient({ base_url: "http://test.localhost/api/v1", api_key: "test-api-key-1234" });
		expect(typeof client.pulse.summary).toBe("function");
		expect(typeof client.pulse.events).toBe("function");
		expect(typeof client.pulse.errors).toBe("function");
		expect(typeof client.pulse.logs).toBe("function");
		expect(typeof client.pulse.latency).toBe("function");
		expect(typeof client.pulse.subs.list).toBe("function");
		expect(typeof client.pulse.subs.create).toBe("function");
		expect(typeof client.pulse.subs.delete).toBe("function");
		expect(typeof client.pulse.keys.create).toBe("function");
		expect(typeof client.pulse.keys.delete).toBe("function");
	});
});
