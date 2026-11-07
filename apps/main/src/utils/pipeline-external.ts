/**
 * External deploy mode (#155) helpers for the pipeline pages.
 *
 * `pipeline_package.external_target` is a raw JSON column — the orchestrator
 * validates it at the service boundary, but the read arrives untyped, so every
 * consumer parses defensively here and gets `null` on any malformed shape.
 */
import { external_target, type ExternalTarget } from "@devpad/schema";

export const parse_external_target = (value: unknown): ExternalTarget | null => {
	const parsed = external_target.safeParse(value);
	return parsed.success ? parsed.data : null;
};

export const github_workflow_url = (target: ExternalTarget): string =>
	`https://github.com/${target.repo}/actions/workflows/${target.workflow}`;

export const github_commit_url = (repo: string, sha: string): string => `https://github.com/${repo}/commit/${sha}`;

export const short_sha = (sha: string): string => sha.slice(0, 7);

/** Extract `owner/name` from a GitHub repo URL, or null when it isn't one. */
export const github_repo_from_url = (url: string | null | undefined): string | null => {
	if (!url) return null;
	const match = url.match(/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)/);
	return match?.[1] ?? null;
};
