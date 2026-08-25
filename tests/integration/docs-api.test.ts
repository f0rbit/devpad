import { beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

describe("Doc store — push/pull/list (task A4.1)", () => {
	let project: Project;

	beforeEach(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
	});

	test("pushes a new document, sanitizing hostile HTML on ingest", async () => {
		const hostile = [
			`<h1>Design</h1>`,
			`<script>alert(1)</script>`,
			`<img src="x" onerror="alert(1)">`,
			`<a href="javascript:alert(1)">click</a>`,
			`<svg onload="alert(1)"></svg>`,
			`<iframe src="https://evil.example"></iframe>`,
		].join("\n");

		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design doc",
			html: hostile,
		});
		expect(pushed.ok).toBe(true);
		if (!pushed.ok) return;
		expect(pushed.value.head_version).not.toBeNull();
		expect(pushed.value.status).toBe("draft");

		const pulled = await t.client.docs.pull(pushed.value.id);
		expect(pulled.ok).toBe(true);
		if (!pulled.ok) return;
		expect(pulled.value.content?.html).toContain("<h1>Design</h1>");
		expect(pulled.value.content?.html).not.toContain("<script");
		expect(pulled.value.content?.html).not.toContain("onerror");
		expect(pulled.value.content?.html).not.toContain("javascript:");
		expect(pulled.value.content?.html).not.toContain("<iframe");
	});

	test("pushing a second version onto an existing document round-trips and orders lineage newest-first", async () => {
		const first = await t.client.docs.push({
			project_id: project.id,
			kind: "plan",
			title: "Plan v1",
			html: "<p>one</p>",
		});
		if (!first.ok) throw new Error("push failed");

		const second = await t.client.docs.push({
			document_id: first.value.id,
			project_id: project.id,
			kind: "plan",
			title: "Plan v2",
			html: "<p>two</p>",
		});
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.id).toBe(first.value.id);

		const versions = await t.client.docs.versions(first.value.id);
		expect(versions.ok).toBe(true);
		if (!versions.ok) return;
		expect(versions.value.length).toBeGreaterThanOrEqual(2);
		expect(versions.value[0]?.version).toBe(second.value.head_version);

		const pulled_v1 = await t.client.docs.pull(first.value.id, first.value.head_version ?? undefined);
		expect(pulled_v1.ok).toBe(true);
		if (!pulled_v1.ok) return;
		expect(pulled_v1.value.content?.html).toContain("<p>one</p>");
	});

	test("lists documents scoped to a project", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "plan",
			title: "Listed plan",
			html: "<p>x</p>",
		});
		if (!pushed.ok) throw new Error("push failed");

		const listed = await t.client.docs.list({ project_id: project.id });
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.value.some((d) => d.id === pushed.value.id)).toBe(true);
	});
});
