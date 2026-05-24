import { err, ok, type Result } from "@f0rbit/corpus";
import type { GithubError, GithubProvider, GithubRepo, WorkflowDispatchInput, WorkflowRun } from "./github-provider.ts";

type RepoKey = `${string}/${string}`;
const key = (owner: string, repo: string): RepoKey => `${owner}/${repo}` as RepoKey;

export type DispatchRecord = WorkflowDispatchInput & { run_id: number; dispatched_at: string };

export class InMemoryGithubProvider implements GithubProvider {
	private readonly repos = new Map<RepoKey, GithubRepo>();
	private readonly runs = new Map<RepoKey, WorkflowRun[]>();
	private run_counter = 1000;

	readonly dispatched: DispatchRecord[] = [];

	register_repo(repo: GithubRepo): void {
		this.repos.set(key(repo.owner, repo.name), repo);
	}

	set_run_conclusion(run_id: number, conclusion: WorkflowRun["conclusion"], status: WorkflowRun["status"] = "completed"): void {
		for (const list of this.runs.values()) {
			const found = list.find(r => r.id === run_id);
			if (found) {
				found.status = status;
				found.conclusion = conclusion;
				return;
			}
		}
	}

	readonly repo = {
		get: async (input: { owner: string; repo: string }): Promise<Result<GithubRepo, GithubError>> => {
			const found = this.repos.get(key(input.owner, input.repo));
			if (!found) return err({ code: "not_found", message: `repo ${input.owner}/${input.repo} not registered` });
			return ok(found);
		},
	};

	readonly actions = {
		workflows: {
			dispatch: async (input: WorkflowDispatchInput): Promise<Result<{ run_id: number }, GithubError>> => {
				const repo_key = key(input.owner, input.repo);
				if (!this.repos.has(repo_key)) {
					return err({ code: "not_found", message: `repo ${input.owner}/${input.repo} not registered` });
				}
				this.run_counter += 1;
				const run_id = this.run_counter;
				const run: WorkflowRun = {
					id: run_id,
					owner: input.owner,
					repo: input.repo,
					workflow_id: input.workflow_id,
					ref: input.ref,
					status: "queued",
					conclusion: null,
					created_at: new Date().toISOString(),
				};
				const existing = this.runs.get(repo_key) ?? [];
				existing.push(run);
				this.runs.set(repo_key, existing);
				this.dispatched.push({ ...input, run_id, dispatched_at: run.created_at });
				return ok({ run_id });
			},
		},
		runs: {
			list: async (input: { owner: string; repo: string; workflow_id?: string }): Promise<Result<WorkflowRun[], GithubError>> => {
				const list = this.runs.get(key(input.owner, input.repo)) ?? [];
				const filtered = input.workflow_id ? list.filter(r => r.workflow_id === input.workflow_id) : list;
				return ok([...filtered]);
			},
		},
	};
}
