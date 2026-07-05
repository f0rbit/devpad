import type { Result } from "@f0rbit/corpus";

export type GithubError =
	| { code: "not_found"; message: string }
	| { code: "validation"; message: string }
	| { code: "unauthorized"; message: string }
	| { code: "internal"; message: string };

export type GithubRepo = {
	owner: string;
	name: string;
	default_branch: string;
	private: boolean;
};

export type WorkflowDispatchInput = {
	owner: string;
	repo: string;
	workflow_id: string;
	ref: string;
	inputs?: Record<string, string>;
};

export type WorkflowRun = {
	id: number;
	owner: string;
	repo: string;
	workflow_id: string;
	ref: string;
	status: "queued" | "in_progress" | "completed";
	conclusion: "success" | "failure" | "cancelled" | null;
	created_at: string;
};

/**
 * Subset of the GitHub REST API used by the orchestrator + scaffolder.
 * Mirrors `octokit.rest.{repos, actions}` shapes so the production provider is a
 * thin Octokit wrapper.
 */
export interface GithubProvider {
	repo: {
		get(input: { owner: string; repo: string }): Promise<Result<GithubRepo, GithubError>>;
	};
	actions: {
		workflows: {
			dispatch(input: WorkflowDispatchInput): Promise<Result<{ run_id: number }, GithubError>>;
		};
		runs: {
			list(input: { owner: string; repo: string; workflow_id?: string }): Promise<Result<WorkflowRun[], GithubError>>;
		};
	};
}
