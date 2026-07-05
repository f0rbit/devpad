import { describe, expect, test } from "bun:test";
import { InMemoryGithubProvider } from "../src/in-memory-github";

const sample_repo = { owner: "f0rbit", name: "devpad", default_branch: "main", private: false };

describe("InMemoryGithubProvider", () => {
	test("registered repos are retrievable; unknown repos return not_found", async () => {
		const gh = new InMemoryGithubProvider();
		gh.register_repo(sample_repo);

		const found = await gh.repo.get({ owner: "f0rbit", repo: "devpad" });
		if (!found.ok) throw new Error(found.error.message);
		expect(found.value.default_branch).toBe("main");

		const missing = await gh.repo.get({ owner: "f0rbit", repo: "ghost" });
		if (missing.ok) throw new Error("expected not_found");
		expect(missing.error.code).toBe("not_found");
	});

	test("workflow dispatch records the run and exposes it via list", async () => {
		const gh = new InMemoryGithubProvider();
		gh.register_repo(sample_repo);

		const first = await gh.actions.workflows.dispatch({
			owner: "f0rbit",
			repo: "devpad",
			workflow_id: "deploy.yml",
			ref: "main",
			inputs: { version_set_id: "vs_abc" },
		});
		if (!first.ok) throw new Error(first.error.message);

		const second = await gh.actions.workflows.dispatch({
			owner: "f0rbit",
			repo: "devpad",
			workflow_id: "deploy.yml",
			ref: "main",
		});
		if (!second.ok) throw new Error(second.error.message);

		expect(gh.dispatched).toHaveLength(2);
		expect(gh.dispatched[0].inputs).toEqual({ version_set_id: "vs_abc" });
		expect(second.value.run_id).not.toBe(first.value.run_id);

		const runs = await gh.actions.runs.list({ owner: "f0rbit", repo: "devpad" });
		if (!runs.ok) throw new Error(runs.error.message);
		expect(runs.value).toHaveLength(2);
		expect(runs.value.every((r) => r.status === "queued")).toBe(true);
	});

	test("set_run_conclusion mutates the recorded run", async () => {
		const gh = new InMemoryGithubProvider();
		gh.register_repo(sample_repo);
		const dispatched = await gh.actions.workflows.dispatch({
			owner: "f0rbit",
			repo: "devpad",
			workflow_id: "deploy.yml",
			ref: "main",
		});
		if (!dispatched.ok) throw new Error(dispatched.error.message);

		gh.set_run_conclusion(dispatched.value.run_id, "success");
		const runs = await gh.actions.runs.list({ owner: "f0rbit", repo: "devpad" });
		if (!runs.ok) throw new Error(runs.error.message);
		expect(runs.value[0].status).toBe("completed");
		expect(runs.value[0].conclusion).toBe("success");
	});

	test("dispatch against an unregistered repo returns not_found", async () => {
		const gh = new InMemoryGithubProvider();
		const dispatched = await gh.actions.workflows.dispatch({
			owner: "ghost",
			repo: "missing",
			workflow_id: "deploy.yml",
			ref: "main",
		});
		if (dispatched.ok) throw new Error("expected not_found");
		expect(dispatched.error.code).toBe("not_found");
	});
});
