import { describe, expect, it } from "bun:test";
import { devpad_uuid, headers, URL } from "./config";

describe("tasks", () => {
	let task_uuid: string | null = null; // get this from the get all tasks endpoint

	it("should get all tasks", async () => {
		const response = await fetch(`${URL}/tasks`, {
			method: "GET",
			headers,
		});
		expect(response.status).toEqual(200);
		expect(response.statusText).toEqual("OK");
		const json = await response.json();
		expect(json).toBeDefined();
		expect(json.length).toBeGreaterThan(0);
		// expect that we have at least one task connected to devpad project
		const task = json.find((task: any) => task.task.project_id == devpad_uuid);
		expect(task).toBeDefined();
		task_uuid = task.task.id;
	});

	it("should get a task by id", async () => {
		const response = await fetch(`${URL}/tasks?id=${task_uuid}`, {
			method: "GET",
			headers,
		});
		expect(response.status).toEqual(200);
		expect(response.statusText).toEqual("OK");
		const task = await response.json();
		expect(task).toBeDefined();
		expect(task.task.id).toEqual(task_uuid);
	});

	it("should get a task by name", async () => {
		const response = await fetch(`${URL}/tasks?project=${devpad_uuid}`, {
			method: "GET",
			headers,
		});
		const task = await response.json();
		expect(task).toBeDefined();
		// expect that the the found task is also in this json
		expect(task.find((task: any) => task.task.id == task_uuid)).toBeDefined();
	});
});
