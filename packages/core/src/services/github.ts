import { commit_detail } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";
import { batchedQuery } from "./batch.js";
import type { ServiceError } from "./errors.js";
import { createLogger } from "../../utils/logger";

const github_log = createLogger("core.github");

type GitHubBranchFromAPI = Awaited<ReturnType<Octokit["rest"]["repos"]["listBranches"]>>["data"][number];
type GitHubRepoListItem = Endpoints["GET /user/repos"]["response"]["data"][0];
type GitHubRepoMetadata = Endpoints["GET /repos/{owner}/{repo}"]["response"]["data"];

export type GitHubBranch = {
	commit: GitHubBranchFromAPI["commit"] & {
		message: string;
		author_name: string;
		author_email: string;
		date: string;
		avatar_url: string | null;
		author_user: string;
	};
} & GitHubBranchFromAPI;

function createOctokit(access_token: string): Octokit {
	return new Octokit({ auth: access_token });
}

// DB rows carry a nullable author_name; the enriched-commit shape the
// branch list consumes requires a string — coalesce at this boundary,
// matching what the fetch path does for the same field.
const to_commit_info = (row: typeof commit_detail.$inferSelect) => ({
	sha: row.sha,
	url: row.url,
	message: row.message,
	avatar_url: row.avatar_url,
	author_user: row.author_user,
	author_name: row.author_name ?? "",
	author_email: row.author_email,
	date: row.date,
});

export async function getRepos(access_token: string): Promise<Result<GitHubRepoListItem[], ServiceError>> {
	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.listForAuthenticatedUser({
		sort: "updated",
		per_page: 100,
	});
	return ok(response.data);
}

export async function getRepoMetadata(
	owner: string,
	repo: string,
	access_token: string,
): Promise<Result<GitHubRepoMetadata, ServiceError>> {
	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.get({ owner, repo });
	return ok(response.data);
}

export async function getBranches(
	db: Database,
	owner: string,
	repo: string,
	access_token: string,
): Promise<Result<GitHubBranch[], ServiceError>> {
	const octokit = createOctokit(access_token);

	const branches_response = await octokit.rest.repos.listBranches({
		owner,
		repo,
		per_page: 100,
	});

	const commits = new Set<string>();
	const branches = branches_response.data;

	for (const branch of branches) {
		commits.add(branch.commit.sha);
	}

	const commit_details = await getCommitDetails(db, owner, repo, commits, access_token);
	const commit_map = new Map(commit_details.map((c) => [c.sha, c]));

	const enriched_branches: GitHubBranch[] = branches.map((branch) => {
		const enriched_commit = commit_map.get(branch.commit.sha) || {
			sha: branch.commit.sha,
			url: branch.commit.url,
			message: "",
			author_name: "",
			author_email: "",
			date: "",
			avatar_url: null,
			author_user: "",
		};

		const enriched_branch: GitHubBranch = { ...branch, commit: enriched_commit };
		return enriched_branch;
	});

	enriched_branches.sort((a, b) => {
		if (a.name === "main" || a.name === "master") return -1;
		if (b.name === "main" || b.name === "master") return 1;
		return new Date(b.commit.date).getTime() - new Date(a.commit.date).getTime();
	});

	return ok(enriched_branches);
}

async function getCommitDetails(
	db: Database,
	owner: string,
	repo: string,
	commit_shas: Set<string>,
	access_token: string,
) {
	const shas = Array.from(commit_shas);
	const existing = await batchedQuery(
		shas,
		(condition) => db.select().from(commit_detail).where(condition),
		commit_detail.sha,
	);

	const existing_shas = new Set(existing.map((c) => c.sha));
	const missing_shas = Array.from(shas.filter((sha) => !existing_shas.has(sha)));

	let commits = existing.map(to_commit_info);

	if (missing_shas.length > 0) {
		const octokit = createOctokit(access_token);

		const fetched = await Promise.all(
			missing_shas.map(async (commit_sha) => {
				const response = await octokit.rest.repos.getCommit({ owner, repo, ref: commit_sha }).catch((e: unknown) => {
					github_log.warn("getCommit fetch failed, skipping sha", {
						sha: commit_sha,
						error: e instanceof Error ? e.message : String(e),
					});
					return null;
				});
				return response?.data ?? null;
			}),
		);

		const valid_commits = fetched.filter((c): c is NonNullable<typeof c> => c !== null);

		if (valid_commits.length > 0) {
			const values = valid_commits.map((c) => ({
				sha: c.sha,
				url: c.url,
				message: c.commit.message,
				avatar_url: c.author?.avatar_url ?? null,
				author_user: c.author?.login ?? "",
				author_name: c.commit.author?.name ?? "",
				author_email: c.commit.author?.email ?? "",
				date: c.commit.author?.date ?? "",
			}));

			await db.insert(commit_detail).values(values);
			commits = commits.concat(values);
		}
	}

	return commits;
}

export async function getSpecification(
	owner: string,
	repo: string,
	access_token: string,
): Promise<Result<string, ServiceError>> {
	if (!access_token) return err({ kind: "github_error", message: "GitHub access token is required" });

	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.getReadme({ owner, repo });

	if ("content" in response.data && response.data.content) {
		const decoded = atob(response.data.content.replace(/\n/g, ""));
		return ok(decoded);
	}

	return err({ kind: "github_error", message: "README content not found in response" });
}
