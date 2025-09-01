import { commit_detail, db } from "@devpad/schema/database";
import { GitHub } from "arctic";
import { Octokit } from "@octokit/rest";
import { inArray } from "drizzle-orm";
import type { Endpoints } from "@octokit/types";
import type { GitHubBranch } from "../data/interfaces.js";

export const github = new GitHub(Bun.env.GITHUB_CLIENT_ID!, Bun.env.GITHUB_CLIENT_SECRET!);

class GitHubError extends Error {
	constructor(
		message: string,
		public status?: number,
		public response?: any
	) {
		super(message);
		this.name = "GitHubError";
	}
}

function createOctokit(accessToken: string): Octokit {
	return new Octokit({
		auth: accessToken,
	});
}

export async function getRepos(access_token: string) {
	try {
		const octokit = createOctokit(access_token);
		const response = await octokit.rest.repos.listForAuthenticatedUser({
			sort: "updated",
			per_page: 100,
		});
		return response.data;
	} catch (error: any) {
		console.error("Error getting user repos:", error);
		throw new GitHubError("Failed to fetch user repositories", error.status, error);
	}
}

export async function getRepo(owner: string, repo: string, access_token: string, branch?: string | null) {
	try {
		const octokit = createOctokit(access_token);
		const ref = branch || "HEAD";

		console.log(`Fetching GitHub repo: ${owner}/${repo}@${ref}`);
		const start = performance.now();

		// Get the zipball download URL using Octokit
		const response = await octokit.rest.repos.downloadZipballArchive({
			owner,
			repo,
			ref,
		});

		console.log(`Fetched repo in ${performance.now() - start}ms`);

		// Octokit returns the response directly as an ArrayBuffer for binary data
		return {
			status: response.status,
			async arrayBuffer() {
				return response.data as ArrayBuffer;
			},
		};
	} catch (error: any) {
		console.error("Error fetching GitHub repository:", error);
		throw new GitHubError("Failed to fetch repository archive", error.status, error);
	}
}

/**
 * Fetch repository branches with commit details using Octokit
 */
export async function getBranches(owner: string, repo: string, access_token: string): Promise<GitHubBranch[]> {
	try {
		const octokit = createOctokit(access_token);

		// Fetch all branches
		const branchesResponse = await octokit.rest.repos.listBranches({
			owner,
			repo,
			per_page: 100,
		});

		const commits = new Set<string>();
		const branches = branchesResponse.data;

		// Collect all commit SHAs that need details
		for (const branch of branches) {
			commits.add(branch.commit.sha);
		}

		// Get commit details for all commits
		const commit_details = await getCommitDetails(owner, repo, commits, access_token);
		const commit_map = new Map(commit_details.map(commit => [commit.sha, commit]));

		// Merge branch data with commit details
		const enrichedBranches: GitHubBranch[] = branches.map(branch => {
			const enrichedCommit = commit_map.get(branch.commit.sha) || {
				sha: branch.commit.sha,
				url: branch.commit.url,
				message: "",
				author_name: "",
				author_email: "",
				date: "",
				avatar_url: null,
				author_user: "",
			};

			return {
				...branch,
				commit: enrichedCommit,
			} as GitHubBranch;
		});

		// Sort branches: main/master first, then by commit date
		enrichedBranches.sort((a, b) => {
			if (a.name === "main" || a.name === "master") return -1;
			if (b.name === "main" || b.name === "master") return 1;

			const dateA = new Date(a.commit.date).getTime();
			const dateB = new Date(b.commit.date).getTime();
			return dateB - dateA;
		});

		return enrichedBranches;
	} catch (error: any) {
		console.error("Error fetching branches:", error);
		throw new GitHubError("Failed to fetch repository branches", error.status, error);
	}
}

async function getCommitDetails(owner: string, repo: string, commit_shas: Set<string>, access_token: string) {
	// Search for existing commits in the database
	const shas = Array.from(commit_shas);
	const existing = await db.select().from(commit_detail).where(inArray(commit_detail.sha, shas));

	const existing_shas = new Set(existing.map((commit: any) => commit.sha));
	const missing_shas = new Set(shas.filter(sha => !existing_shas.has(sha)));

	console.log(`Fetching missing commits: ${missing_shas.size}`, missing_shas);

	let commits = existing;

	// Fetch missing commits using Octokit
	if (missing_shas.size > 0) {
		try {
			const octokit = createOctokit(access_token);

			const commit_details = await Promise.all(
				Array.from(missing_shas).map(async commit_sha => {
					try {
						const response = await octokit.rest.repos.getCommit({
							owner,
							repo,
							ref: commit_sha,
						});
						return response.data;
					} catch (error: any) {
						console.warn(`Failed to fetch commit ${commit_sha}:`, error.message);
						return null;
					}
				})
			);

			// Filter out failed requests and map to database schema
			const validCommits = commit_details.filter((c): c is NonNullable<typeof c> => c !== null);

			if (validCommits.length > 0) {
				const values = validCommits.map(c => ({
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
		} catch (error: any) {
			console.error("Error fetching commit details:", error);
			// Continue with existing commits even if new ones fail
		}
	}

	return commits;
}

export async function getSpecification(owner: string, repo: string, access_token: string) {
	if (!access_token) {
		throw new GitHubError("GitHub access token is required to fetch repository README");
	}

	try {
		const octokit = createOctokit(access_token);

		const response = await octokit.rest.repos.getReadme({
			owner,
			repo,
		});

		// Decode the base64 content
		if ("content" in response.data && response.data.content) {
			return Buffer.from(response.data.content, "base64").toString("utf-8");
		}

		throw new GitHubError("README content not found in response");
	} catch (error: any) {
		console.warn(`README: Code ${error.status} - ${error.message}`);
		throw new GitHubError("Failed to fetch repository README", error.status, error);
	}
}
