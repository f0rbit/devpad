
import { describe, expect, it } from "bun:test";
import type { Project } from "../src/server/projects";

const headers = { "Authorization": "Bearer 878daa046fd33f89eb518fd258e420c2769a22dad851ed93cb547025d77a8819" };
const url = "http://localhost:4321/api/v0";

describe("projects", () => {
  let devpad_uuid: string | null = null; // get this from the get all projects endpoint

  it("should get all projects", async () => {
    const response = await fetch(`${url}/projects`, {
      method: "GET",
      headers,
    });
    expect(response.status).toEqual(200);
    expect(response.statusText).toEqual("OK");
    const json = await response.json();
    expect(json).toBeDefined();
    expect(json.length).toBeGreaterThan(0);
    devpad_uuid = json.find((project: Project) => project.name == "devpad")!.id;
  });


  it("should get a project by id", async () => {
    const response = await fetch(`${url}/projects?id=${devpad_uuid}`, {
      method: "GET",
      headers,
    });
    expect(response.status).toEqual(200);
    expect(response.statusText).toEqual("OK");
    const project = await response.json();
    expect(project).toBeDefined();
    expect(project.id).toEqual(devpad_uuid);
    expect(project.name).toEqual("devpad");
  });

  it("should get a project by name", async () => {
    const response = await fetch(`${url}/projects?name=devpad`, {
      method: "GET",
      headers,
    });
    const project = await response.json();
    expect(project).toBeDefined();
    expect(project.name).toEqual("devpad");
    expect(project.id).toEqual(devpad_uuid);
  });
});


