import { err, ok, type Result, try_catch_async } from "@f0rbit/corpus";
import { parseFileContent, shouldIgnorePath } from "./parser.js";
import type { GitHubTreeEntry, ParsedTask, ScanConfig, ScannerError } from "./types.js";

type TreeResponse = {
	tree: Array<{
		path: string;
		type: string;
		sha: string;
		size?: number;
	}>;
	truncated: boolean;
};

type ContentResponse = {
	content: string;
	encoding: string;
};

const github_headers = (access_token: string) => ({
	Authorization: `Bearer ${access_token}`,
	Accept: "application/vnd.github.v3+json",
	"User-Agent": "devpad-scanner",
});

const network_error = (e: unknown): ScannerError => ({
	kind: "github_api_error",
	status: 0,
	message: e instanceof Error ? e.message : "network error",
});

const handle_error_response = async (response: Response): Promise<ScannerError> => {
	if (response.status === 403) {
		const retry_after_header = response.headers.get("Retry-After");
		const retry_after = retry_after_header ? parseInt(retry_after_header, 10) : undefined;
		return { kind: "rate_limited", retry_after };
	}

	const body = await response.text().catch(() => "unknown error");
	return { kind: "github_api_error", status: response.status, message: body };
};

const parse_json_error = (): ScannerError => ({
	kind: "parse_error",
	message: "failed to parse response json",
});

export const fetchRepoTree = async (owner: string, repo: string, branch: string, access_token: string): Promise<Result<GitHubTreeEntry[], ScannerError>> => {
	const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

	const fetch_result = await try_catch_async(() => fetch(url, { headers: github_headers(access_token) }), network_error);
	if (!fetch_result.ok) return fetch_result;

	const response = fetch_result.value;
	if (!response.ok) return err(await handle_error_response(response));

	const json_result = await try_catch_async(() => response.json() as Promise<TreeResponse>, parse_json_error);
	if (!json_result.ok) return json_result;

	const entries: GitHubTreeEntry[] = json_result.value.tree
		.filter(entry => entry.type === "blob" || entry.type === "tree")
		.map(entry => ({
			path: entry.path,
			type: entry.type as "blob" | "tree",
			sha: entry.sha,
			size: entry.size ?? 0,
		}));

	return ok(entries);
};

export const fetchFileContent = async (owner: string, repo: string, path: string, ref: string, access_token: string): Promise<Result<string, ScannerError>> => {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;

	const fetch_result = await try_catch_async(() => fetch(url, { headers: github_headers(access_token) }), network_error);
	if (!fetch_result.ok) return fetch_result;

	const response = fetch_result.value;
	if (!response.ok) return err(await handle_error_response(response));

	const json_result = await try_catch_async(() => response.json() as Promise<ContentResponse>, parse_json_error);
	if (!json_result.ok) return json_result;

	if (!json_result.value.content) {
		return err({ kind: "parse_error", message: "no content field in response" });
	}

	const decoded = atob(json_result.value.content.replace(/\n/g, ""));
	return ok(decoded);
};

const BATCH_SIZE = 10;

const batch = <T>(items: T[], size: number): T[][] => {
	const result: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		result.push(items.slice(i, i + size));
	}
	return result;
};

export const scanGitHubRepo = async (owner: string, repo: string, branch: string, access_token: string, config: ScanConfig): Promise<Result<ParsedTask[], ScannerError>> => {
	const tree_result = await fetchRepoTree(owner, repo, branch, access_token);
	if (!tree_result.ok) return tree_result;

	const file_paths = tree_result.value
		.filter(entry => entry.type === "blob")
		.filter(entry => !shouldIgnorePath(entry.path, config.ignore))
		.map(entry => entry.path);

	const all_tasks: ParsedTask[] = [];

	for (const file_batch of batch(file_paths, BATCH_SIZE)) {
		const results = await Promise.all(file_batch.map(path => fetchFileContent(owner, repo, path, branch, access_token)));

		for (let i = 0; i < results.length; i++) {
			const result = results[i]!;
			if (!result.ok) continue;
			const tasks = parseFileContent(result.value, file_batch[i]!, config);
			all_tasks.push(...tasks);
		}
	}

	return ok(all_tasks);
};
