import { commit_detail } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { Octokit } from "@octokit/rest";
import type { Endpoints } from "@octokit/types";
import { inArray } from "drizzle-orm";
import type { ServiceError } from "./errors.js";

type GitHubBranchFromAPI = Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][0];

export interface GitHubBranch extends GitHubBranchFromAPI {
	commit: GitHubBranchFromAPI["commit"] & {
		message: string;
		author_name: string;
		author_email: string;
		date: string;
		avatar_url: string | null;
		author_user: string;
	};
}

function createOctokit(access_token: string): Octokit {
	return new Octokit({ auth: access_token });
}

export async function getRepos(access_token: string): Promise<Result<any[], ServiceError>> {
	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.listForAuthenticatedUser({
		sort: "updated",
		per_page: 100,
	});
	return ok(response.data);
}

export async function getRepoMetadata(owner: string, repo: string, access_token: string): Promise<Result<any, ServiceError>> {
	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.get({ owner, repo });
	return ok(response.data);
}

export async function getBranches(db: Database, owner: string, repo: string, access_token: string): Promise<Result<GitHubBranch[], ServiceError>> {
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
	const commit_map = new Map(commit_details.map(c => [c.sha, c]));

	const enriched_branches: GitHubBranch[] = branches.map(branch => {
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

		return { ...branch, commit: enriched_commit } as GitHubBranch;
	});

	enriched_branches.sort((a, b) => {
		if (a.name === "main" || a.name === "master") return -1;
		if (b.name === "main" || b.name === "master") return 1;
		return new Date(b.commit.date).getTime() - new Date(a.commit.date).getTime();
	});

	return ok(enriched_branches);
}

async function getCommitDetails(db: Database, owner: string, repo: string, commit_shas: Set<string>, access_token: string) {
	const shas = Array.from(commit_shas);
	const existing = await db.select().from(commit_detail).where(inArray(commit_detail.sha, shas));

	const existing_shas = new Set(existing.map((c: any) => c.sha));
	const missing_shas = Array.from(shas.filter(sha => !existing_shas.has(sha)));

	let commits = [...existing];

	if (missing_shas.length > 0) {
		const octokit = createOctokit(access_token);

		const fetched = await Promise.all(
			missing_shas.map(async commit_sha => {
				const response = await octokit.rest.repos.getCommit({ owner, repo, ref: commit_sha }).catch(() => null);
				return response?.data ?? null;
			})
		);

		const valid_commits = fetched.filter((c): c is NonNullable<typeof c> => c !== null);

		if (valid_commits.length > 0) {
			const values = valid_commits.map(c => ({
				sha: c.sha,
				url: c.url,
				message: c.commit.message ?? "",
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

export async function getSpecification(owner: string, repo: string, access_token: string): Promise<Result<string, ServiceError>> {
	if (!access_token) return err({ kind: "github_error", message: "GitHub access token is required" });

	const octokit = createOctokit(access_token);
	const response = await octokit.rest.repos.getReadme({ owner, repo });

	if ("content" in response.data && response.data.content) {
		const decoded = atob(response.data.content.replace(/\n/g, ""));
		return ok(decoded);
	}

	return err({ kind: "github_error", message: "README content not found in response" });
}
