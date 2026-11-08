/**
 * @module @devpad/cli/pipelines-verify
 *
 * Pure helpers for the external-deploy CLI surface (#155):
 *
 * - `resolve_runs_start_flags` — `pipelines runs start` flag validation
 *   (exactly one of `--version-set-id` / `--sha`; `--sha` must be 40-hex).
 * - `evaluate_dispatch_verification` — the `runs verify-dispatch`
 *   decision: the run was created for the expected SHA, a
 *   `pipeline_dispatch` row for the stage exists with status
 *   `dispatched`, and the run is still in an in-flight deploy state.
 *
 * This is the guard chamber's production job runs before deploying: a
 * manual GitHub `workflow_dispatch` without a devpad-approved dispatch
 * fails the guard.
 */

export type OrchestratorHttpInput = { pipelines_url: string; pipelines_token: string };

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const is_sha_like = (s: string): boolean => SHA_PATTERN.test(s);

export type RunsStartFlags = { package?: string; versionSetId?: string; sha?: string };

export type RunsStartTargets =
	| { kind: "orchestrated"; package_id: string; version_set_id: string }
	| { kind: "external"; package_id: string; commit_sha: string };

export type Verified<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Exactly-one-of validation for `runs start`. The package id is always
 * required; orchestrated packages target `--version-set-id`, external
 * packages target `--sha` (40-hex). Cross-mode bodies are rejected
 * here so a CI workflow can't silently target the wrong mode.
 */
export const resolve_runs_start_flags = (flags: RunsStartFlags): Verified<RunsStartTargets> => {
	if (flags.package === undefined || flags.package === "") return { ok: false, error: "--package is required" };
	if (flags.versionSetId !== undefined && flags.sha !== undefined)
		return { ok: false, error: "--version-set-id and --sha are mutually exclusive" };
	if (flags.versionSetId === undefined && flags.sha === undefined)
		return { ok: false, error: "provide exactly one of --version-set-id (orchestrated) or --sha (external)" };
	if (flags.versionSetId !== undefined)
		return { ok: true, value: { kind: "orchestrated", package_id: flags.package, version_set_id: flags.versionSetId } };
	if (flags.sha === undefined || !is_sha_like(flags.sha))
		return { ok: false, error: `--sha must be a 40-hex commit SHA; got "${String(flags.sha)}"` };
	return { ok: true, value: { kind: "external", package_id: flags.package, commit_sha: flags.sha } };
};

export type DispatchRowLite = {
	stage_name: string;
	commit_sha: string | null;
	status: string;
};

export type DispatchesEnvelopeValue = {
	run_id: string;
	run_status: string;
	commit_sha: string | null;
	dispatches: DispatchRowLite[];
};

export type DispatchExpected = { sha: string; stage: string };

const IN_FLIGHT_RUN_STATUSES = ["deploying", "unconfirmed"];

/**
 * The `runs verify-dispatch` decision. Exit-0 requires ALL of:
 *
 * 1. `run.commit_sha === expected.sha` (the run IS this commit's run)
 * 2. a `pipeline_dispatch` row for the expected stage with status
 *    `dispatched` (a devpad-approved dispatch actually happened — a
 *    manual `workflow_dispatch` never creates one)
 * 3. `run_status` is still in-flight (`deploying` or `unconfirmed`) —
 *    a completed/failed/cancelled run means the event trail isn't what
 *    the caller thinks
 */
export const evaluate_dispatch_verification = (
	envelope: DispatchesEnvelopeValue,
	expected: DispatchExpected,
): { ok: true } | { ok: false; reason: string } => {
	if (envelope.commit_sha !== expected.sha)
		return {
			ok: false,
			reason: `run ${envelope.run_id} targets commit_sha ${envelope.commit_sha ?? "(null)"}, expected ${expected.sha}`,
		};
	const row = envelope.dispatches.find((d) => d.stage_name === expected.stage);
	if (row === undefined)
		return { ok: false, reason: `no pipeline_dispatch row for stage "${expected.stage}" on run ${envelope.run_id}` };
	if (row.status !== "dispatched")
		return { ok: false, reason: `dispatch row for stage "${expected.stage}" has status "${row.status}"` };
	if (!IN_FLIGHT_RUN_STATUSES.includes(envelope.run_status))
		return {
			ok: false,
			reason: `run status is "${envelope.run_status}", expected one of ${IN_FLIGHT_RUN_STATUSES.join("|")}`,
		};
	return { ok: true };
};

type EnvelopeResponse = { ok?: boolean; value?: unknown; error?: { message?: string } | string };

const read_envelope = async (response: Response): Promise<EnvelopeResponse | null> => {
	try {
		const parsed: unknown = await response.json();
		return parsed as EnvelopeResponse;
	} catch {
		return null;
	}
};

/**
 * GET the orchestrator's `GET /runs/:id/dispatches` envelope directly
 * (the CLI never adds new ApiClient methods — direct orchestrator HTTP
 * with the admin/session bearer, same mode as artifact uploads).
 */
export const fetch_dispatches_envelope = async (
	input: OrchestratorHttpInput,
	run_id: string,
): Promise<Verified<DispatchesEnvelopeValue>> => {
	const url = `${input.pipelines_url.replace(/\/$/, "")}/runs/${run_id}/dispatches`;
	let response: Response;
	try {
		response = await fetch(url, { headers: { authorization: `Bearer ${input.pipelines_token}` } });
	} catch (cause) {
		return { ok: false, error: `orchestrator unreachable: ${cause instanceof Error ? cause.message : String(cause)}` };
	}
	const body = await read_envelope(response);
	if (!response.ok) {
		const message =
			typeof body?.error === "object" && typeof body.error.message === "string"
				? body.error.message
				: response.statusText;
		return { ok: false, error: `GET /runs/${run_id}/dispatches failed: ${String(response.status)} ${message}` };
	}
	if (body === null || body.ok !== true || body.value === undefined)
		return { ok: false, error: "unexpected response envelope from orchestrator" };
	const value = body.value;
	if (
		typeof value !== "object" ||
		value === null ||
		!("run_id" in value) ||
		!("run_status" in value) ||
		!("dispatches" in value)
	)
		return { ok: false, error: "GET /runs/:id/dispatches returned an unexpected value shape" };
	return { ok: true, value: value as DispatchesEnvelopeValue };
};
