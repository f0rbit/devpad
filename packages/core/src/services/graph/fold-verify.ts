import { goal, milestone, project, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";

/**
 * Task A5.3 — the `devpad admin verify-fold` dual-read verb. Compares the
 * FROZEN `milestone`/`goal` tables (the pre-fold source of truth, one
 * direction only) against their `task`-row projections and reports any
 * divergence. Deliberately one-directional: a milestone/goal created AFTER
 * the fold never existed in the frozen table in the first place, so there is
 * nothing to compare it against — that is the expected, correct steady
 * state, not a gap this verb should flag.
 */

export type FoldDiff =
	| { kind: "missing_row"; entity: "milestone" | "goal"; id: string }
	| {
			kind: "field_mismatch";
			entity: "milestone" | "goal";
			id: string;
			field: string;
			expected: unknown;
			actual: unknown;
	  }
	| {
			kind: "completion_mismatch";
			entity: "milestone" | "goal";
			id: string;
			expected_finished: boolean;
			actual_completed: boolean;
	  }
	| { kind: "ordering_violation"; entity: "milestone"; id: string; after_id: string };

export type FoldVerifyReport = {
	milestone_count: number;
	goal_count: number;
	diffs: FoldDiff[];
	clean: boolean;
};

function field_diff(
	entity: "milestone" | "goal",
	id: string,
	field: string,
	expected: unknown,
	actual: unknown,
): FoldDiff | null {
	if (expected === actual) return null;
	return { kind: "field_mismatch", entity, id, field, expected, actual };
}

/** Scoped to one owner's projects — this is a per-user diagnostic, not a system-wide dump. */
export async function verify_fold(db: Database, owner_id: string): Promise<Result<FoldVerifyReport, ServiceError>> {
	const diffs: FoldDiff[] = [];

	const milestone_rows = await db
		.select({ milestone })
		.from(milestone)
		.innerJoin(project, eq(milestone.project_id, project.id))
		.where(and(eq(project.owner_id, owner_id), eq(milestone.deleted, false)));

	const rank_by_id = new Map<string, string>();

	for (const { milestone: m } of milestone_rows) {
		const rows = await db
			.select()
			.from(task)
			.where(and(eq(task.id, m.id), eq(task.kind, "milestone")));
		if (rows.length === 0) {
			diffs.push({ kind: "missing_row", entity: "milestone", id: m.id });
			continue;
		}
		const projected = rows[0];
		rank_by_id.set(m.id, projected.rank);

		const checks: (FoldDiff | null)[] = [
			field_diff("milestone", m.id, "project_id", m.project_id, projected.project_id),
			field_diff("milestone", m.id, "name", m.name, projected.title),
			field_diff("milestone", m.id, "description", m.description, projected.description),
			field_diff("milestone", m.id, "target_time", m.target_time, projected.end_time),
			field_diff("milestone", m.id, "target_version", m.target_version, projected.summary),
		];
		for (const diff of checks) if (diff) diffs.push(diff);

		const expected_finished = m.finished_at != null;
		const actual_completed = projected.progress === "COMPLETED";
		if (expected_finished !== actual_completed) {
			diffs.push({ kind: "completion_mismatch", entity: "milestone", id: m.id, expected_finished, actual_completed });
		}
	}

	for (const { milestone: m } of milestone_rows) {
		if (!m.after_id) continue;
		const this_rank = rank_by_id.get(m.id);
		const after_rank = rank_by_id.get(m.after_id);
		if (this_rank == null || after_rank == null) continue;
		if (!(after_rank < this_rank)) {
			diffs.push({ kind: "ordering_violation", entity: "milestone", id: m.id, after_id: m.after_id });
		}
	}

	const goal_rows = await db
		.select({ goal })
		.from(goal)
		.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
		.innerJoin(project, eq(milestone.project_id, project.id))
		.where(and(eq(project.owner_id, owner_id), eq(goal.deleted, false)));

	for (const { goal: g } of goal_rows) {
		const rows = await db
			.select()
			.from(task)
			.where(and(eq(task.id, g.id), eq(task.kind, "goal")));
		if (rows.length === 0) {
			diffs.push({ kind: "missing_row", entity: "goal", id: g.id });
			continue;
		}
		const projected = rows[0];

		const checks: (FoldDiff | null)[] = [
			field_diff("goal", g.id, "milestone_id", g.milestone_id, projected.parent_id),
			field_diff("goal", g.id, "name", g.name, projected.title),
			field_diff("goal", g.id, "description", g.description, projected.description),
			field_diff("goal", g.id, "target_time", g.target_time, projected.end_time),
		];
		for (const diff of checks) if (diff) diffs.push(diff);

		const expected_finished = g.finished_at != null;
		const actual_completed = projected.progress === "COMPLETED";
		if (expected_finished !== actual_completed) {
			diffs.push({ kind: "completion_mismatch", entity: "goal", id: g.id, expected_finished, actual_completed });
		}
	}

	return ok({
		milestone_count: milestone_rows.length,
		goal_count: goal_rows.length,
		diffs,
		clean: diffs.length === 0,
	});
}
