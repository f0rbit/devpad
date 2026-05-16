import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../../src/api-client";
import { tools } from "../../../src/tools";

/**
 * Pipelines API Client + MCP Tools Tests
 *
 * Validates:
 * 1. The pipelines namespace exists with all expected methods
 * 2. MCP tool schemas accept valid inputs and reject invalid ones
 * 3. MCP tools are registered correctly
 */

describe("Pipelines API Client", () => {
	it("exposes pipelines.* methods", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		expect(typeof client.pipelines).toBe("object");
		expect(typeof client.pipelines.list).toBe("function");
		expect(typeof client.pipelines.get).toBe("function");
		expect(typeof client.pipelines.create).toBe("function");
		expect(typeof client.pipelines.approve).toBe("function");
		expect(typeof client.pipelines.cancel).toBe("function");
		expect(typeof client.pipelines.rollback).toBe("function");
	});

	it("pipelines.list returns a promise", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.list();
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.get accepts a run_id and returns a promise", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.get("run_123");
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.create accepts package_id and version_set_id", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.create({
			package_id: "pkg_123",
			version_set_id: "vs_456",
		});
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.approve accepts run_id and decision details", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.approve("run_123", {
			stage_name: "staging",
			decision: "approved",
			user_id: "user_456",
		});
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.approve accepts optional reason", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.approve("run_123", {
			stage_name: "staging",
			decision: "denied",
			user_id: "user_456",
			reason: "Failing tests",
		});
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.cancel accepts run_id", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.cancel("run_123");
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.rollback accepts run_id", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.rollback("run_123");
		expect(result).toBeInstanceOf(Promise);
	});
});

describe("Pipelines MCP tool schemas", () => {
	const expected_tools = ["devpad_pipelines_list", "devpad_pipelines_get", "devpad_pipelines_create", "devpad_pipelines_approve", "devpad_pipelines_cancel", "devpad_pipelines_rollback"];

	it("registers every expected pipelines tool", () => {
		for (const name of expected_tools) {
			expect(tools[name]).toBeDefined();
			expect(tools[name]?.name).toBe(name);
			expect(tools[name]?.inputSchema).toBeDefined();
			expect(typeof tools[name]?.execute).toBe("function");
		}
	});

	it("devpad_pipelines_list accepts empty input", () => {
		const tool = tools.devpad_pipelines_list!;
		expect(tool.inputSchema.safeParse({}).success).toBe(true);
	});

	it("devpad_pipelines_get requires run_id", () => {
		const tool = tools.devpad_pipelines_get!;
		expect(tool.inputSchema.safeParse({ run_id: "run_123" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_create requires package_id and version_set_id", () => {
		const tool = tools.devpad_pipelines_create!;
		expect(
			tool.inputSchema.safeParse({
				package_id: "pkg_123",
				version_set_id: "vs_456",
			}).success
		).toBe(true);
		expect(tool.inputSchema.safeParse({ package_id: "pkg_123" }).success).toBe(false);
		expect(tool.inputSchema.safeParse({ version_set_id: "vs_456" }).success).toBe(false);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_approve requires run_id, stage_name, decision, and user_id", () => {
		const tool = tools.devpad_pipelines_approve!;
		const valid = {
			run_id: "run_123",
			stage_name: "staging",
			decision: "approved",
			user_id: "user_456",
		};
		expect(tool.inputSchema.safeParse(valid).success).toBe(true);

		const with_reason = {
			...valid,
			reason: "All tests passed",
		};
		expect(tool.inputSchema.safeParse(with_reason).success).toBe(true);

		expect(tool.inputSchema.safeParse({ ...valid, decision: "maybe" }).success).toBe(false);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_cancel requires run_id", () => {
		const tool = tools.devpad_pipelines_cancel!;
		expect(tool.inputSchema.safeParse({ run_id: "run_123" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_rollback requires run_id", () => {
		const tool = tools.devpad_pipelines_rollback!;
		expect(tool.inputSchema.safeParse({ run_id: "run_123" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});
});
