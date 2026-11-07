/**
 * @module core/services/pipelines/dispatch
 *
 * The {@link Dispatcher} seam for external deploy mode (#155). CI-performed
 * deploys are triggered by dispatching the package's GitHub Actions
 * workflow (`external_target.workflow` on `owner/name`) with
 * `{ stage, sha, run_id }` inputs; the workflow deploys and then reports
 * back via `POST /runs/:id/events`.
 *
 * RunDeps carries an optional `dispatcher`; external runs fail fast with a
 * typed error when it's absent. The in-memory recording implementation
 * lives in `@devpad/pipeline-fakes` (`InMemoryDispatcher`); the production
 * implementation (`VaultDispatcher`, `packages/pipelines/src/providers/`)
 * calls vault's `GitHubVault.dispatch_workflow` RPC — vault holds the
 * GitHub token and enforces the `github:dispatch:<repo>/<workflow>`
 * grant against the package/environment identity. Dispatches are NEVER
 * retried automatically — `workflow_dispatch` is not idempotent.
 */

import type { GithubError } from "@devpad/pipeline-fakes";
import type { Result } from "@f0rbit/corpus";

export type DispatchInput = {
	/** Orchestrator-side package id — vault's caller identity, checked
	 * against the `github:dispatch:*` grant for the package's
	 * production stage. The dispatcher always dispatches the production
	 * stage (external staging is CI-own). */
	package_id: string;
	/** GitHub repo in `owner/name` form. */
	repo: string;
	/** Workflow file name (e.g. `deploy.yml`). */
	workflow: string;
	/** Git ref to dispatch against. */
	ref: string;
	inputs: { stage: string; sha: string; run_id: string };
};

export type DispatchError = GithubError;

export type Dispatcher = {
	dispatch(input: DispatchInput): Promise<Result<void, DispatchError>>;
};

/**
 * The stage external production dispatches happen for. External deploy
 * runs walk `[staging, production]`; staging is CI-own, so the orchestrator
 * only ever claims + dispatches `production`.
 */
export const EXTERNAL_DISPATCH_STAGE = "production";
