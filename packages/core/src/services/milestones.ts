import type { Milestone, Task, UpsertMilestone } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, project, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { SqlCompletionEngine } from "./graph/completion.js";
import type { GraphConflictError } from "./graph/graph.js";
import { write_with_event } from "./graph/outbox.js";
import { rank_between } from "./graph/rank.js";
import { refresh_rollup_chain } from "./graph/rollup.js";
import { doesUserOwnProject } from "./projects.js";

/**
 * v2.4 (task A5.2) — milestones are a compat PROJECTION over `task` rows of
 * `kind='milestone'` (option B1: TypeScript projections over the now-frozen
 * `milestone` table, never SQL views). Every exported signature/shape here
 * is byte-for-byte what it was before the fold — the existing
 * `tests/integration/milestones-goals.test.ts` suite is the compat proof
 * and is UNCHANGED by this rewrite. `target_version` has no task column of
 * its own; it rides in the otherwise-unused `summary` free-text field (same
 * compat-projection detail as the A5.1 backfill migration).
 */

type MilestoneTaskRow = Task;

function milestone_from_task(row: MilestoneTaskRow, after_id: string | null): Milestone {
	return {
		id: row.id,
		project_id: row.project_id ?? "",
		name: row.title,
		description: row.description,
		target_time: row.end_time,
		target_version: row.summary,
		finished_at: row.progress === "COMPLETED" ? row.updated_at : null,
		after_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		deleted: row.deleted,
		created_by: row.created_by,
		modified_by: row.modified_by,
		protected: row.protected,
	};
}

async function get_milestone_row(db: Database, milestone_id: string): Promise<MilestoneTaskRow | null> {
	const rows = await db
		.select()
		.from(task)
		.where(and(eq(task.id, milestone_id), eq(task.kind, "milestone")));
	return rows[0] ?? null;
}

async function milestone_siblings(db: Database, project_id: string): Promise<MilestoneTaskRow[]> {
	return db
		.select()
		.from(task)
		.where(and(eq(task.kind, "milestone"), eq(task.project_id, project_id), eq(task.deleted, false)))
		.orderBy(asc(task.rank), asc(task.created_at), desc(sql`rowid`));
}

/** Groups rows by project, sorts each group by rank, and maps each row to the id of its rank-predecessor (or `null` if first). */
function after_id_map(rows: MilestoneTaskRow[]): Map<string, string | null> {
	const groups = new Map<string, MilestoneTaskRow[]>();
	for (const row of rows) {
		const key = row.project_id ?? "";
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}

	const result = new Map<string, string | null>();
	for (const list of groups.values()) {
		const sorted = list.toSorted((a, b) =>
			a.rank === b.rank ? (a.created_at < b.created_at ? -1 : 1) : a.rank < b.rank ? -1 : 1,
		);
		sorted.forEach((row, idx) => {
			result.set(row.id, idx === 0 ? null : (sorted[idx - 1]?.id ?? null));
		});
	}
	return result;
}

async function single_after_id(db: Database, row: MilestoneTaskRow): Promise<string | null> {
	if (!row.project_id) return null;
	const siblings = await milestone_siblings(db, row.project_id);
	return after_id_map(siblings).get(row.id) ?? null;
}

async function compute_rank(
	db: Database,
	project_id: string,
	after_id_provided: boolean,
	after_id: string | null | undefined,
	current: MilestoneTaskRow | null,
): Promise<Result<string, ServiceError>> {
	if (!after_id_provided) {
		if (current) return ok(current.rank);
		const siblings = await milestone_siblings(db, project_id);
		return ok(rank_between(siblings.at(-1)?.rank ?? null, null));
	}

	const siblings = (await milestone_siblings(db, project_id)).filter((s) => s.id !== current?.id);
	if (after_id == null) {
		return ok(rank_between(null, siblings[0]?.rank ?? null));
	}
	const idx = siblings.findIndex((s) => s.id === after_id);
	if (idx === -1) {
		return err({ kind: "bad_request", message: `after_id ${after_id} does not exist in project ${project_id}` });
	}
	return ok(rank_between(siblings[idx]?.rank ?? null, siblings[idx + 1]?.rank ?? null));
}

export async function getUserMilestones(db: Database, user_id: string): Promise<Result<Milestone[], ServiceError>> {
	const rows = await db
		.select({ task })
		.from(task)
		.innerJoin(project, eq(task.project_id, project.id))
		.where(and(eq(project.owner_id, user_id), eq(task.kind, "milestone"), eq(task.deleted, false)))
		.orderBy(desc(task.created_at), desc(sql`"task".rowid`));

	const milestone_rows = rows.map((r) => r.task);
	const map = after_id_map(milestone_rows);
	return ok(milestone_rows.map((row) => milestone_from_task(row, map.get(row.id) ?? null)));
}

export async function getProjectMilestones(
	db: Database,
	project_id: string,
): Promise<Result<Milestone[], ServiceError>> {
	const rows = await milestone_siblings(db, project_id);
	const map = after_id_map(rows);
	return ok(rows.map((row) => milestone_from_task(row, map.get(row.id) ?? null)));
}

export async function getMilestone(
	db: Database,
	milestone_id: string,
): Promise<Result<Milestone | null, ServiceError>> {
	const row = await get_milestone_row(db, milestone_id);
	if (!row) return err({ kind: "not_found", resource: "milestone", id: milestone_id });
	if (row.deleted) return err({ kind: "not_found", resource: "milestone", id: milestone_id });
	const after_id = await single_after_id(db, row);
	return ok(milestone_from_task(row, after_id));
}

export async function upsertMilestone(
	db: Database,
	data: UpsertMilestone,
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<Milestone, ServiceError | GraphConflictError>> {
	const previous = data.id ? await get_milestone_row(db, data.id) : null;
	const project_id = data.project_id;

	const owns_result = await doesUserOwnProject(db, owner_id, project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	if (previous?.deleted) {
		return err({ kind: "bad_request", message: "Cannot modify deleted milestone" });
	}

	if (auth_channel === "api" && previous?.protected && !data.force) {
		return err({
			kind: "protected",
			entity_id: previous.id,
			message: `Milestone ${previous.id} is protected. Pass force=true to override.`,
			modified_by: previous.modified_by,
			modified_at: previous.updated_at,
		});
	}

	const exists = !!previous;
	const rank_result = await compute_rank(db, project_id, Object.hasOwn(data, "after_id"), data.after_id, previous);
	if (!rank_result.ok) return rank_result;

	const finished_at_provided = Object.hasOwn(data, "finished_at");
	const previously_completed = previous?.progress === "COMPLETED";
	const fresh_complete = finished_at_provided && data.finished_at != null && !previously_completed;
	const fresh_reopen = finished_at_provided && data.finished_at == null && previously_completed;

	const protection = auth_channel === "user" ? { protected: true } : data.force ? { protected: false } : {};
	const provenance = exists
		? { modified_by: auth_channel, ...protection }
		: { created_by: auth_channel, modified_by: auth_channel };

	// Only fields the caller actually supplied are written on an UPDATE — a
	// partial caller (`completeMilestone` supplies `{id, project_id, name,
	// finished_at}`) must never blank out an unrelated field like
	// `description`/`target_version` it didn't mention, matching the pre-fold
	// service's spread-whatever-was-given semantics.
	const reopen_fields = fresh_reopen
		? ({ progress: "IN_PROGRESS", completed_via: null } satisfies { progress: "IN_PROGRESS"; completed_via: null })
		: {};
	const write_payload = {
		rank: rank_result.value,
		updated_at: new Date().toISOString(),
		...(Object.hasOwn(data, "name") ? { title: data.name } : {}),
		...(Object.hasOwn(data, "description") ? { description: data.description ?? null } : {}),
		...(Object.hasOwn(data, "target_time") ? { end_time: data.target_time ?? null } : {}),
		...(Object.hasOwn(data, "target_version") ? { summary: data.target_version ?? null } : {}),
		...reopen_fields,
		...provenance,
	};

	const write_result = await write_with_event(
		db,
		async (): Promise<Result<MilestoneTaskRow | null, ServiceError>> => {
			if (previous) {
				const rows = await db.update(task).set(write_payload).where(eq(task.id, previous.id)).returning();
				return ok(rows[0] ?? null);
			}
			const id = data.id === "" || data.id == null ? `milestone_${crypto.randomUUID()}` : data.id;
			const now = new Date().toISOString();
			const rows = await db
				.insert(task)
				.values({
					id,
					owner_id,
					title: data.name,
					progress: "UNSTARTED",
					visibility: "PRIVATE",
					kind: "milestone",
					completion_policy: "auto_children",
					project_id,
					parent_id: null,
					rank: rank_result.value,
					rev: 0,
					description: data.description ?? null,
					end_time: data.target_time ?? null,
					summary: data.target_version ?? null,
					created_at: now,
					updated_at: now,
					created_by: auth_channel,
					modified_by: auth_channel,
					protected: auth_channel === "user",
				})
				.returning();
			return ok(rows[0] ?? null);
		},
		(row) =>
			row && {
				kind: exists ? "task.updated" : "task.created",
				subject_id: row.id,
				project_id: row.project_id,
				actor: auth_channel,
				payload: exists
					? { kind: "task.updated", fields: Object.keys(write_payload) }
					: { kind: "task.created", title: row.title },
			},
	);
	if (!write_result.ok) return write_result;
	if (!write_result.value) return err({ kind: "db_error", message: "Milestone upsert failed" });

	let final_row = write_result.value;
	if (fresh_complete) {
		const engine = new SqlCompletionEngine(db);
		const complete_result = await engine.complete(final_row.id, auth_channel, final_row.rev);
		if (!complete_result.ok) return complete_result;
		final_row = complete_result.value.completed;
	}

	const rollup_result = await refresh_rollup_chain(db, final_row.parent_id);
	if (!rollup_result.ok) return rollup_result;

	const action_type: ActionType = !exists ? "CREATE_MILESTONE" : "UPDATE_MILESTONE";
	const action_desc = !exists ? "Created milestone" : "Updated milestone";
	const action_result = await addMilestoneAction(db, {
		owner_id,
		milestone_id: final_row.id,
		project_id,
		name: final_row.title,
		type: action_type,
		description: action_desc,
		channel: auth_channel,
	});
	if (!action_result.ok) return action_result;

	const after_id = await single_after_id(db, final_row);
	return ok(milestone_from_task(final_row, after_id));
}

export async function deleteMilestone(
	db: Database,
	milestone_id: string,
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<void, ServiceError>> {
	const milestone_result = await getMilestone(db, milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value) return err({ kind: "not_found", resource: "milestone", id: milestone_id });

	const owns_result = await doesUserOwnProject(db, owner_id, milestone_result.value.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	const action_result = await addMilestoneAction(db, {
		owner_id,
		milestone_id,
		project_id: milestone_result.value.project_id,
		name: milestone_result.value.name,
		type: "DELETE_MILESTONE",
		description: "Deleted milestone",
		channel: auth_channel,
	});
	if (!action_result.ok) return action_result;

	await db
		.update(task)
		.set({ deleted: true, updated_at: new Date().toISOString() })
		.where(and(eq(task.parent_id, milestone_id), eq(task.kind, "goal")));

	await db.update(task).set({ deleted: true, updated_at: new Date().toISOString() }).where(eq(task.id, milestone_id));

	return ok(undefined);
}

export async function completeMilestone(
	db: Database,
	milestone_id: string,
	owner_id: string,
	target_version?: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<Milestone, ServiceError | GraphConflictError>> {
	const current = await getMilestone(db, milestone_id);
	if (!current.ok) return current;
	if (!current.value) return err({ kind: "not_found", resource: "milestone", id: milestone_id });

	return upsertMilestone(
		db,
		{
			id: milestone_id,
			project_id: current.value.project_id,
			name: current.value.name,
			finished_at: new Date().toISOString(),
			...(target_version ? { target_version } : {}),
		},
		owner_id,
		auth_channel,
	);
}

export async function addMilestoneAction(
	db: Database,
	{
		owner_id,
		milestone_id,
		project_id,
		name,
		type,
		description,
		channel = "user",
	}: {
		owner_id: string;
		milestone_id: string;
		project_id: string;
		name: string;
		type: ActionType;
		description: string;
		channel?: "user" | "api";
	},
): Promise<Result<boolean, ServiceError>> {
	await db.insert(action).values({
		owner_id,
		type,
		description,
		data: { project_id, milestone_id, name },
		channel,
	});
	return ok(true);
}
