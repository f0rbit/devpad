import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { add_link } from "../../graph.js";
import { PROJECT_GRAPH_TASK_CAP, project_graph } from "../../project-graph.js";
import { refresh_rollup_chain } from "../../rollup.js";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
});

describe("project_graph", () => {
	test("returns every task in the project, including fold kinds", async () => {
		const project = await seed_project(db, owner_id);
		const plain = await seed_task(db, owner_id, { project_id: project.id, kind: "task" });
		const milestone = await seed_task(db, owner_id, { project_id: project.id, kind: "milestone" });
		const goal = await seed_task(db, owner_id, { project_id: project.id, kind: "goal" });
		// a task in a different project must not appear
		const other_project = await seed_project(db, owner_id);
		await seed_task(db, owner_id, { project_id: other_project.id });

		const result = await project_graph(db, { project_id: project.id, owner_id });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.tasks.map((t) => t.id).toSorted()).toEqual([plain.id, milestone.id, goal.id].toSorted());
	});

	test("links are scoped to the project — a link crossing into another project is excluded", async () => {
		const project = await seed_project(db, owner_id);
		const a = await seed_task(db, owner_id, { project_id: project.id });
		const b = await seed_task(db, owner_id, { project_id: project.id });
		await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });

		const other_project = await seed_project(db, owner_id);
		const outside = await seed_task(db, owner_id, { project_id: other_project.id });
		await add_link(db, { src_id: a.id, dst_id: outside.id, kind: "relates_to" });

		const result = await project_graph(db, { project_id: project.id, owner_id });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.links).toHaveLength(1);
		expect(result.value.links[0]?.dst_id).toBe(b.id);
	});

	test("rollups are present for fold-kind (milestone/goal) tasks with children", async () => {
		const project = await seed_project(db, owner_id);
		const milestone = await seed_task(db, owner_id, { project_id: project.id, kind: "milestone" });
		await seed_task(db, owner_id, { project_id: project.id, parent_id: milestone.id, progress: "COMPLETED" });
		await seed_task(db, owner_id, { project_id: project.id, parent_id: milestone.id });
		await refresh_rollup_chain(db, milestone.id);

		const result = await project_graph(db, { project_id: project.id, owner_id });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const rollup = result.value.rollups[milestone.id];
		expect(rollup).toBeDefined();
		expect(rollup?.direct_total).toBe(2);
		expect(rollup?.direct_done).toBe(1);
	});

	test("another user's project is not found", async () => {
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		const intruder = await seed_user(db);

		const result = await project_graph(db, { project_id: project.id, owner_id: intruder.id });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_found");
	});

	test("a nonexistent project is not found", async () => {
		const result = await project_graph(db, { project_id: "project_does_not_exist", owner_id });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_found");
	});

	test("a project over the task cap errors instead of silently truncating", async () => {
		const project = await seed_project(db, owner_id);
		for (let i = 0; i <= PROJECT_GRAPH_TASK_CAP; i++) {
			await seed_task(db, owner_id, { project_id: project.id });
		}

		const result = await project_graph(db, { project_id: project.id, owner_id });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("project_graph_capped");
	});
});
