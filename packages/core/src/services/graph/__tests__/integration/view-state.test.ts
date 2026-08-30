import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { DEFAULT_VIEW_LAYOUT, get_project_view_state, put_project_view_state } from "../../view-state.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
});

describe("project view-state", () => {
	test("a project with no view-state row returns the default empty layout", async () => {
		const project = await seed_project(db, owner_id);

		const result = await get_project_view_state(db, { project_id: project.id, owner_id });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual(DEFAULT_VIEW_LAYOUT);
	});

	test("put then get round-trips the pinned layout", async () => {
		const project = await seed_project(db, owner_id);
		const layout = { pins: { task_1: { x: 120, y: 40 } } };

		const put_result = await put_project_view_state(db, { project_id: project.id, owner_id, layout });
		expect(put_result.ok).toBe(true);

		const get_result = await get_project_view_state(db, { project_id: project.id, owner_id });
		expect(get_result.ok).toBe(true);
		if (!get_result.ok) return;
		expect(get_result.value).toEqual(layout);
	});

	test("a second put is last-write-wins — fully replaces the layout, no merge", async () => {
		const project = await seed_project(db, owner_id);
		await put_project_view_state(db, { project_id: project.id, owner_id, layout: { pins: { a: { x: 1, y: 1 } } } });

		const result = await put_project_view_state(db, {
			project_id: project.id,
			owner_id,
			layout: { pins: { b: { x: 2, y: 2 } } },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual({ pins: { b: { x: 2, y: 2 } } });
	});

	test("another user's project is not found on get", async () => {
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		const intruder = await seed_user(db);

		const result = await get_project_view_state(db, { project_id: project.id, owner_id: intruder.id });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_found");
	});

	test("another user's project is not found on put", async () => {
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		const intruder = await seed_user(db);

		const result = await put_project_view_state(db, {
			project_id: project.id,
			owner_id: intruder.id,
			layout: { pins: {} },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_found");
	});
});
