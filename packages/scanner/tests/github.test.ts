import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchFileContent, fetchRepoTree, scanGitHubRepo } from "../src/github.js";
import type { ScanConfig } from "../src/types.js";

const original_fetch = globalThis.fetch;

const mockFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>) => {
	globalThis.fetch = handler as typeof fetch;
};

afterEach(() => {
	globalThis.fetch = original_fetch;
});

const json_response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});

const tree_response = {
	tree: [
		{ path: "src/index.ts", type: "blob", sha: "abc123", size: 100 },
		{ path: "src/utils.ts", type: "blob", sha: "def456", size: 200 },
		{ path: "src", type: "tree", sha: "ghi789", size: 0 },
		{ path: "node_modules", type: "tree", sha: "jkl012", size: 0 },
	],
	truncated: false,
};

describe("fetchRepoTree", () => {
	test("returns tree entries on success", async () => {
		mockFetch(async () => json_response(tree_response));

		const result = await fetchRepoTree("owner", "repo", "main", "token123");
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.length).toBe(4);
		expect(result.value[0]).toEqual({
			path: "src/index.ts",
			type: "blob",
			sha: "abc123",
			size: 100,
		});
	});

	test("returns error Result on 404", async () => {
		mockFetch(async () => new Response("Not Found", { status: 404 }));

		const result = await fetchRepoTree("owner", "repo", "main", "token123");
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("github_api_error");
		if (result.error.kind !== "github_api_error") return;
		expect(result.error.status).toBe(404);
	});

	test("returns rate_limited error on 403 with rate limit headers", async () => {
		mockFetch(
			async () =>
				new Response("Rate limited", {
					status: 403,
					headers: { "Retry-After": "60" },
				})
		);

		const result = await fetchRepoTree("owner", "repo", "main", "token123");
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("rate_limited");
		if (result.error.kind !== "rate_limited") return;
		expect(result.error.retry_after).toBe(60);
	});

	test("handles network errors gracefully", async () => {
		mockFetch(async () => {
			throw new Error("network failure");
		});

		const result = await fetchRepoTree("owner", "repo", "main", "token123");
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("github_api_error");
		if (result.error.kind !== "github_api_error") return;
		expect(result.error.status).toBe(0);
		expect(result.error.message).toBe("network failure");
	});

	test("sends correct authorization header", async () => {
		let captured_headers: HeadersInit | undefined;

		mockFetch(async (_url: string, init?: RequestInit) => {
			captured_headers = init?.headers;
			return json_response(tree_response);
		});

		await fetchRepoTree("owner", "repo", "main", "my-secret-token");
		expect(captured_headers).toBeDefined();
		expect((captured_headers as Record<string, string>)["Authorization"]).toBe("Bearer my-secret-token");
	});
});

describe("fetchFileContent", () => {
	test("decodes base64 content correctly", async () => {
		const content = "console.log('hello world')";
		const encoded = btoa(content);

		mockFetch(async () =>
			json_response({
				content: encoded,
				encoding: "base64",
			})
		);

		const result = await fetchFileContent("owner", "repo", "src/index.ts", "main", "token");
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toBe("console.log('hello world')");
	});

	test("handles base64 content with newlines", async () => {
		const content = "line1\nline2\nline3";
		const raw_encoded = btoa(content);
		const encoded_with_newlines = raw_encoded.slice(0, 10) + "\n" + raw_encoded.slice(10);

		mockFetch(async () =>
			json_response({
				content: encoded_with_newlines,
				encoding: "base64",
			})
		);

		const result = await fetchFileContent("owner", "repo", "test.ts", "main", "token");
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toBe(content);
	});

	test("handles missing content gracefully", async () => {
		mockFetch(async () =>
			json_response({
				encoding: "base64",
			})
		);

		const result = await fetchFileContent("owner", "repo", "missing.ts", "main", "token");
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("parse_error");
	});

	test("handles 404 error", async () => {
		mockFetch(async () => new Response("Not Found", { status: 404 }));

		const result = await fetchFileContent("owner", "repo", "missing.ts", "main", "token");
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("github_api_error");
		if (result.error.kind !== "github_api_error") return;
		expect(result.error.status).toBe(404);
	});
});

describe("scanGitHubRepo", () => {
	const config: ScanConfig = {
		tags: [{ name: "TODO", match: ["TODO:"] }],
		ignore: ["node_modules"],
	};

	test("integrates tree + content + parser correctly", async () => {
		const file_content = "// TODO: implement this feature";
		const encoded = btoa(file_content);

		let call_count = 0;
		mockFetch(async (url: string) => {
			call_count++;
			if (url.includes("/git/trees/")) {
				return json_response({
					tree: [
						{ path: "src/index.ts", type: "blob", sha: "abc", size: 50 },
						{ path: "node_modules/pkg/index.js", type: "blob", sha: "def", size: 100 },
					],
					truncated: false,
				});
			}
			return json_response({ content: encoded, encoding: "base64" });
		});

		const result = await scanGitHubRepo("owner", "repo", "main", "token", config);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.length).toBe(1);
		expect(result.value[0]!.text).toBe("implement this feature");
		expect(result.value[0]!.file).toBe("src/index.ts");
		expect(result.value[0]!.tag).toBe("TODO");
	});

	test("filters out ignored paths", async () => {
		const encoded = btoa("// TODO: hidden");

		mockFetch(async (url: string) => {
			if (url.includes("/git/trees/")) {
				return json_response({
					tree: [{ path: "node_modules/pkg/index.js", type: "blob", sha: "abc", size: 50 }],
					truncated: false,
				});
			}
			return json_response({ content: encoded, encoding: "base64" });
		});

		const result = await scanGitHubRepo("owner", "repo", "main", "token", config);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.length).toBe(0);
	});

	test("propagates tree fetch errors", async () => {
		mockFetch(async () => new Response("Server Error", { status: 500 }));

		const result = await scanGitHubRepo("owner", "repo", "main", "token", config);
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.error.kind).toBe("github_api_error");
	});

	test("skips files that fail to fetch content", async () => {
		let request_count = 0;
		mockFetch(async (url: string) => {
			request_count++;
			if (url.includes("/git/trees/")) {
				return json_response({
					tree: [
						{ path: "src/good.ts", type: "blob", sha: "abc", size: 50 },
						{ path: "src/bad.ts", type: "blob", sha: "def", size: 50 },
					],
					truncated: false,
				});
			}
			if (url.includes("bad.ts")) {
				return new Response("Not Found", { status: 404 });
			}
			return json_response({
				content: btoa("// TODO: found me"),
				encoding: "base64",
			});
		});

		const result = await scanGitHubRepo("owner", "repo", "main", "token", config);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.length).toBe(1);
		expect(result.value[0]!.file).toBe("src/good.ts");
	});

	test("handles multiple files with multiple TODOs", async () => {
		const file1 = "// TODO: first\n// TODO: second";
		const file2 = "// TODO: third";

		mockFetch(async (url: string) => {
			if (url.includes("/git/trees/")) {
				return json_response({
					tree: [
						{ path: "a.ts", type: "blob", sha: "abc", size: 50 },
						{ path: "b.ts", type: "blob", sha: "def", size: 50 },
					],
					truncated: false,
				});
			}
			if (url.includes("a.ts")) {
				return json_response({ content: btoa(file1), encoding: "base64" });
			}
			return json_response({ content: btoa(file2), encoding: "base64" });
		});

		const result = await scanGitHubRepo("owner", "repo", "main", "token", config);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.length).toBe(3);
	});
});
