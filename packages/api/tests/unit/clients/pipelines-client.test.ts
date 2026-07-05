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

	it("exposes pipelines.packages.* methods", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		expect(typeof client.pipelines.packages).toBe("object");
		expect(typeof client.pipelines.packages.list).toBe("function");
		expect(typeof client.pipelines.packages.get).toBe("function");
	});

	it("pipelines.packages.list accepts no filter and returns a promise", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		const result = client.pipelines.packages.list();
		expect(result).toBeInstanceOf(Promise);
	});

	it("pipelines.packages.list issues GET /packages with project_id query when set", async () => {
		const recorded: Array<{ url: string; method: string }> = [];
		const fake_fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
			recorded.push({ url, method: init?.method ?? "GET" });
			return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
		};
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
			custom_fetch: fake_fetch as unknown as typeof fetch,
		});

		await client.pipelines.packages.list({ project_id: "project_alpha" });
		expect(recorded.length).toBe(1);
		expect(recorded[0].method).toBe("GET");
		expect(recorded[0].url).toContain("/packages");
		expect(recorded[0].url).toContain("project_id=project_alpha");
	});

	it("pipelines.packages.get issues GET /packages/:id", async () => {
		const recorded: Array<{ url: string; method: string }> = [];
		const fake_fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
			recorded.push({ url, method: init?.method ?? "GET" });
			return new Response(JSON.stringify({ id: "pipeline-package_x" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
			custom_fetch: fake_fetch as unknown as typeof fetch,
		});

		await client.pipelines.packages.get("pipeline-package_x");
		expect(recorded.length).toBe(1);
		expect(recorded[0].method).toBe("GET");
		expect(recorded[0].url).toContain("/packages/pipeline-package_x");
	});

	it("exposes pipelines.packages.create/update/delete methods", () => {
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
		});

		expect(typeof client.pipelines.packages.create).toBe("function");
		expect(typeof client.pipelines.packages.update).toBe("function");
		expect(typeof client.pipelines.packages.delete).toBe("function");
	});

	it("pipelines.packages.create issues POST /packages with body", async () => {
		const recorded: Array<{ url: string; method: string; body: string | null }> = [];
		const fake_fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
			recorded.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
			return new Response(JSON.stringify({ id: "pipeline-package_new", name: "new-pkg" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
			custom_fetch: fake_fetch as unknown as typeof fetch,
		});

		await client.pipelines.packages.create({
			id: "pipeline-package_new",
			name: "new-pkg",
			owner_id: "user_1",
			repo_url: "https://github.com/x/y",
		});
		expect(recorded.length).toBe(1);
		expect(recorded[0].method).toBe("POST");
		expect(recorded[0].url).toContain("/packages");
		expect(recorded[0].body).toContain("pipeline-package_new");
	});

	it("pipelines.packages.update issues PATCH /packages/:id with body", async () => {
		const recorded: Array<{ url: string; method: string; body: string | null }> = [];
		const fake_fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
			recorded.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
			return new Response(JSON.stringify({ id: "pipeline-package_x", repo_url: "https://new.example/x" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
			custom_fetch: fake_fetch as unknown as typeof fetch,
		});

		await client.pipelines.packages.update("pipeline-package_x", { repo_url: "https://new.example/x" });
		expect(recorded.length).toBe(1);
		expect(recorded[0].method).toBe("PATCH");
		expect(recorded[0].url).toContain("/packages/pipeline-package_x");
		expect(recorded[0].body).toContain("new.example");
	});

	it("pipelines.packages.delete issues DELETE /packages/:id", async () => {
		const recorded: Array<{ url: string; method: string }> = [];
		const fake_fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
			recorded.push({ url, method: init?.method ?? "GET" });
			return new Response(JSON.stringify({ deleted: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const client = new ApiClient({
			base_url: "http://test.localhost/api/v1",
			api_key: "test-api-key",
			custom_fetch: fake_fetch as unknown as typeof fetch,
		});

		await client.pipelines.packages.delete("pipeline-package_x");
		expect(recorded.length).toBe(1);
		expect(recorded[0].method).toBe("DELETE");
		expect(recorded[0].url).toContain("/packages/pipeline-package_x");
	});
});

describe("Pipelines MCP tool schemas", () => {
	const expected_tools = [
		"devpad_pipelines_list",
		"devpad_pipelines_get",
		"devpad_pipelines_create",
		"devpad_pipelines_approve",
		"devpad_pipelines_cancel",
		"devpad_pipelines_rollback",
	];

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
			}).success,
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

	it("registers devpad_pipelines_packages_{list,get} tools", () => {
		const tool_list = tools.devpad_pipelines_packages_list;
		const tool_get = tools.devpad_pipelines_packages_get;
		expect(tool_list).toBeDefined();
		expect(tool_get).toBeDefined();
		expect(tool_list?.name).toBe("devpad_pipelines_packages_list");
		expect(tool_get?.name).toBe("devpad_pipelines_packages_get");
		expect(typeof tool_list?.execute).toBe("function");
		expect(typeof tool_get?.execute).toBe("function");
	});

	it("devpad_pipelines_packages_list accepts empty input and optional project_id", () => {
		const tool = tools.devpad_pipelines_packages_list!;
		expect(tool.inputSchema.safeParse({}).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: "project_alpha" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ project_id: 123 }).success).toBe(false);
	});

	it("devpad_pipelines_packages_get requires package_id", () => {
		const tool = tools.devpad_pipelines_packages_get!;
		expect(tool.inputSchema.safeParse({ package_id: "pipeline-package_x" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_packages_create requires id, name, owner_id", () => {
		const tool = tools.devpad_pipelines_packages_create!;
		expect(tool).toBeDefined();
		const valid = { id: "pipeline-package_x", name: "x", owner_id: "user_1" };
		expect(tool.inputSchema.safeParse(valid).success).toBe(true);
		expect(tool.inputSchema.safeParse({ ...valid, project_id: "project_a" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ name: "x", owner_id: "user_1" }).success).toBe(false);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_packages_update requires id; rest is optional", () => {
		const tool = tools.devpad_pipelines_packages_update!;
		expect(tool).toBeDefined();
		expect(tool.inputSchema.safeParse({ id: "pipeline-package_x" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ id: "pipeline-package_x", repo_url: "https://new.example/x" }).success).toBe(
			true,
		);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});

	it("devpad_pipelines_packages_delete requires id", () => {
		const tool = tools.devpad_pipelines_packages_delete!;
		expect(tool).toBeDefined();
		expect(tool.inputSchema.safeParse({ id: "pipeline-package_x" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({}).success).toBe(false);
	});
});
