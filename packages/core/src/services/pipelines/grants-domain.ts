import type { PipelineGrant } from "@devpad/schema";

/**
 * Check if a grant scope matches a requested scope.
 * Supports wildcards only as trailing segment matchers.
 *
 * Examples:
 * - "anthropic:messages" matches "anthropic:messages"
 * - "github:read:my-org/*" matches "github:read:my-org/repo-x"
 * - "anthropic:*" matches "anthropic:anything"
 * - "anthropic:messages:specific" does NOT match "anthropic:messages:other"
 *
 * Grants and scopes must match part-by-part. Only the final part can be a wildcard.
 */
export function is_grant_match(grant: { scope: string }, scope: string): boolean {
	const grant_parts = grant.scope.split(":");
	const scope_parts = scope.split(":");

	// Grant and scope must have the same number of parts (unless grant ends with *)
	if (grant_parts.length !== scope_parts.length) {
		// Exception: if last grant part is *, it can match longer scopes
		const last_grant = grant_parts[grant_parts.length - 1];
		if (last_grant.endsWith("*") && grant_parts.length === scope_parts.length) {
			// OK, lengths match
		} else if (last_grant === "*" && grant_parts.length === scope_parts.length) {
			// OK, exact match
		} else {
			// Length mismatch and no wildcard to bridge it
			return false;
		}
	}

	// Check each part: exact match or wildcard
	for (let i = 0; i < grant_parts.length; i++) {
		const grant_seg = grant_parts[i];
		const scope_seg = scope_parts[i];

		// If grant segment is just *, it matches anything
		if (grant_seg === "*") {
			return true;
		}

		// If grant segment ends with *, match prefix
		if (grant_seg.endsWith("*")) {
			const prefix = grant_seg.slice(0, -1); // Remove the *
			if (!scope_seg.startsWith(prefix)) {
				return false;
			}
			// Matched
			continue;
		}

		// Exact match required
		if (grant_seg !== scope_seg) {
			return false;
		}
	}

	return true;
}

/**
 * Auto-approval policy table: (scope, stage) → auto-approve.
 * Phase 1: only ("anthropic:messages", "staging") auto-approves.
 * Easy to extend with new entries as policy evolves.
 */
const AUTO_APPROVAL_POLICY: Array<[scope: string, stage: string]> = [
	["anthropic:messages", "staging"],
];

export function is_auto_approvable(scope: string, stage_name: string): boolean {
	return AUTO_APPROVAL_POLICY.some(
		([policy_scope, policy_stage]) => policy_scope === scope && policy_stage === stage_name
	);
}

export interface GrantVerdict {
	granted: boolean;
	reason?: string;
}

/**
 * Evaluate a list of grants against a requested scope and stage.
 * Returns { granted: true } if any grant matches, otherwise { granted: false, reason }.
 */
export function evaluate_grant_check(
	grants: PipelineGrant[],
	scope: string,
	stage_name: string
): GrantVerdict {
	const matching_grants = grants.filter((g) =>
		g.stage_name === stage_name && is_grant_match(g, scope) && g.granted_at !== null
	);

	if (matching_grants.length > 0) {
		return { granted: true };
	}

	return {
		granted: false,
		reason: `No approved grant found for scope "${scope}" at stage "${stage_name}"`,
	};
}
