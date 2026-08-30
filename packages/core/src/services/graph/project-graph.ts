import type { Task, TaskLink } from "@devpad/schema";
import { task, task_link } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq, inArray } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { getProjectById } from "../projects.js";
import { type RollupCounts, rollups_for } from "./rollup.js";

/**
 * Whole-project graph read (v2.5, canvas home task P2.2). The canvas draws
 * every task in a project at once — unlike `near()`'s BFS neighborhood,
 * this is a flat "give me everything" read, so it needs its own ceiling
 * instead of a depth cap. 2000 tasks is a deliberately generous line: it's
 * roughly an order of magnitude past any real devpad project's task count
 * today, so a project that ever hits it is either a data problem or a
 * genuinely new scale the canvas UI hasn't been designed for yet — either
 * way, silently truncating would draw a graph that lies about completeness,
 * so this errors instead of paging.
 */
export const PROJECT_GRAPH_TASK_CAP = 2000;

export type ProjectGraphCappedError = {
	kind: "project_graph_capped";
	message: string;
	cap: number;
	count: number;
};

export type ProjectGraphError = ServiceError | ProjectGraphCappedError;

export type ProjectGraph = {
	tasks: Task[];
	links: TaskLink[];
	rollups: Record<string, RollupCounts>;
};

/**
 * All tasks in a project (every `kind`, including the `milestone`/`goal`
 * fold kinds — deliberately NOT `tasks.ts`'s `NOT_FOLD_KIND`-filtered read;
 * the canvas draws the whole graph, folded nodes included), every
 * `task_link` with BOTH ends inside that task set (a link whose `dst_id`
 * points at another project is not this project's edge; a link with a null
 * `dst_id`, e.g. an external ref, is kept — there's no "other project" it
 * could belong to), and batched rollup counts for every task returned.
 * Ownership-scoped here (not just at the route) so the rule is defined and
 * tested once.
 */
export async function project_graph(
	db: Database,
	input: { project_id: string; owner_id: string },
): Promise<Result<ProjectGraph, ProjectGraphError>> {
	const { project_id, owner_id } = input;

	const project_result = await getProjectById(db, project_id);
	if (!project_result.ok) return project_result;
	if (project_result.value.owner_id !== owner_id) return errors.notFound("project", project_id);

	const task_rows = await db
		.select()
		.from(task)
		.where(and(eq(task.project_id, project_id), eq(task.deleted, false)));

	if (task_rows.length > PROJECT_GRAPH_TASK_CAP) {
		return err({
			kind: "project_graph_capped",
			message: `Project ${project_id} has ${String(task_rows.length)} tasks, over the ${String(PROJECT_GRAPH_TASK_CAP)}-task canvas cap`,
			cap: PROJECT_GRAPH_TASK_CAP,
			count: task_rows.length,
		});
	}

	const task_ids = task_rows.map((t) => t.id);
	const task_id_set = new Set(task_ids);

	const candidate_links =
		task_ids.length === 0
			? []
			: await db
					.select()
					.from(task_link)
					.where(and(eq(task_link.deleted, false), inArray(task_link.src_id, task_ids)));
	const links = candidate_links.filter((link) => link.dst_id == null || task_id_set.has(link.dst_id));

	const rollups_result = await rollups_for(db, task_ids);
	if (!rollups_result.ok) return rollups_result;

	return ok({ tasks: task_rows, links, rollups: rollups_result.value });
}
