import type { Milestone, UpsertMilestone } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { goal, milestone, project } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { doesUserOwnProject } from "./projects.js";

export async function getUserMilestones(db: any, user_id: string): Promise<Result<Milestone[], ServiceError>> {
	const result = await db
		.select({ milestone })
		.from(milestone)
		.innerJoin(project, eq(milestone.project_id, project.id))
		.where(and(eq(project.owner_id, user_id), eq(milestone.deleted, false)))
		.orderBy(desc(milestone.created_at));

	return ok(result.map((r: any) => r.milestone));
}

export async function getProjectMilestones(db: any, project_id: string): Promise<Result<Milestone[], ServiceError>> {
	const result = await db
		.select()
		.from(milestone)
		.where(and(eq(milestone.project_id, project_id), eq(milestone.deleted, false)));

	const sorted = result.sort((a: Milestone, b: Milestone) => {
		if (a.after_id === b.id) return 1;
		if (b.after_id === a.id) return -1;
		return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
	});

	return ok(sorted);
}

export async function getMilestone(db: any, milestone_id: string): Promise<Result<Milestone | null, ServiceError>> {
	const result = await db.select().from(milestone).where(eq(milestone.id, milestone_id));

	const record = result[0];
	if (!record || record.deleted) return err({ kind: "not_found", resource: "milestone", id: milestone_id });
	return ok(record);
}

export async function upsertMilestone(db: any, data: UpsertMilestone, owner_id: string): Promise<Result<Milestone, ServiceError>> {
	const previous_result = data.id ? await getMilestone(db, data.id) : null;
	const previous = previous_result?.ok ? previous_result.value : null;

	const owns_result = await doesUserOwnProject(db, owner_id, data.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	if (previous && previous.deleted) {
		return err({ kind: "bad_request", message: "Cannot modify deleted milestone" });
	}

	const exists = !!previous;
	const upsert = {
		...data,
		updated_at: new Date().toISOString(),
	};
	if (upsert.id === "" || upsert.id == null) delete upsert.id;

	let result: Milestone | null = null;
	if (exists && upsert.id) {
		const update_result = await db
			.update(milestone)
			.set(upsert as any)
			.where(eq(milestone.id, upsert.id))
			.returning();
		result = update_result[0] || null;
	} else {
		const insert_result = await db
			.insert(milestone)
			.values(upsert as any)
			.onConflictDoUpdate({ target: [milestone.id], set: upsert as any })
			.returning();
		result = insert_result[0] || null;
	}

	if (!result) return err({ kind: "db_error", message: "Milestone upsert failed" });
	return ok(result);
}

export async function deleteMilestone(db: any, milestone_id: string, owner_id: string): Promise<Result<void, ServiceError>> {
	const milestone_result = await getMilestone(db, milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value) return err({ kind: "not_found", resource: "milestone", id: milestone_id });

	const owns_result = await doesUserOwnProject(db, owner_id, milestone_result.value.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	await db.update(goal).set({ deleted: true, updated_at: new Date().toISOString() }).where(eq(goal.milestone_id, milestone_id));

	await db.update(milestone).set({ deleted: true, updated_at: new Date().toISOString() }).where(eq(milestone.id, milestone_id));

	return ok(undefined);
}

export async function completeMilestone(db: any, milestone_id: string, owner_id: string, target_version?: string): Promise<Result<Milestone, ServiceError>> {
	const data: Partial<UpsertMilestone> = {
		id: milestone_id,
		finished_at: new Date().toISOString(),
	};

	if (target_version) {
		data.target_version = target_version;
	}

	return upsertMilestone(db, data as UpsertMilestone, owner_id);
}

export async function addMilestoneAction(_db: any, _data: { owner_id: string; milestone_id: string; type: ActionType; description: string }): Promise<Result<boolean, ServiceError>> {
	return ok(true);
}
