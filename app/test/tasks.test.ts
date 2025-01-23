
import { describe, expect, it } from "bun:test";
const headers = { "Authorization": "Bearer 878daa046fd33f89eb518fd258e420c2769a22dad851ed93cb547025d77a8819" };
const url = "http://localhost:4321/api/v0";
const devpad_uuid = "project_8d8d8142-01a2-4d4c-830e-eca5f7e2cc46";


describe("tasks", () => {
  let task_uuid: string | null = null; // get this from the get all tasks endpoint

  it("should get all tasks", async () => {
    const response = await fetch(`${url}/tasks`, {
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
    const response = await fetch(`${url}/tasks?id=${task_uuid}`, {
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
    const response = await fetch(`${url}/tasks?project=${devpad_uuid}`, {
      method: "GET",
      headers,
    });
    const task = await response.json();
    expect(task).toBeDefined();
    // expect that the the found task is also in this json
    expect(task.find((task: any) => task.task.id == task_uuid)).toBeDefined();

  });
});    
