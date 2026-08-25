import { beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;

function anchor_for(quote: string) {
	const start = DOC_HTML.indexOf(quote);
	return {
		quote,
		prefix: DOC_HTML.slice(Math.max(0, start - 10), start),
		suffix: DOC_HTML.slice(start + quote.length, start + quote.length + 10),
		start,
		end: start + quote.length,
	};
}

describe("Annotation engine — markers-in-doc threads (task A4.2)", () => {
	let project: Project;

	beforeEach(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
	});

	test("create → pull --annotated shows the thread; resolve removes it from unresolved", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: DOC_HTML,
		});
		if (!pushed.ok) throw new Error(`push failed: ${pushed.error.message}`);

		const created = await t.client.docs.createThread(pushed.value.id, {
			...anchor_for("brown fox"),
			body: "seems off",
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.value.head_version).not.toBe(pushed.value.head_version);

		const pulled = await t.client.docs.pull(pushed.value.id);
		expect(pulled.ok).toBe(true);
		if (!pulled.ok) return;
		expect(pulled.value.threads).toHaveLength(1);
		expect(pulled.value.threads[0]?.status).toBe("open");
		expect(pulled.value.orphaned).toHaveLength(0);

		const unresolved_before = await t.client.docs.unresolved({ project_id: project.id });
		expect(unresolved_before.ok).toBe(true);
		if (unresolved_before.ok)
			expect(unresolved_before.value.some((th) => th.document_id === pushed.value.id)).toBe(true);

		const thread_id = pulled.value.threads[0]?.id;
		if (!thread_id) throw new Error("expected a thread id");
		const resolved = await t.client.docs.resolveThread(pushed.value.id, thread_id);
		expect(resolved.ok).toBe(true);

		const unresolved_after = await t.client.docs.unresolved({ project_id: project.id, document_id: pushed.value.id });
		expect(unresolved_after.ok).toBe(true);
		if (unresolved_after.ok) expect(unresolved_after.value).toHaveLength(0);
	});

	test("re-anchors across an edited-doc push (edit before the span) instead of dropping the thread", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: DOC_HTML,
		});
		if (!pushed.ok) throw new Error("push failed");
		const created = await t.client.docs.createThread(pushed.value.id, {
			...anchor_for("brown fox"),
			body: "seems off",
		});
		if (!created.ok) throw new Error("create failed");

		const pulled = await t.client.docs.pull(pushed.value.id);
		if (!pulled.ok || !pulled.value.content) throw new Error("pull failed");
		const edited_html = pulled.value.content.html.replace("<p>", "<p>Once upon a time, ");

		const edited = await t.client.docs.push({
			document_id: pushed.value.id,
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: edited_html,
		});
		expect(edited.ok).toBe(true);

		const pulled_after = await t.client.docs.pull(pushed.value.id);
		expect(pulled_after.ok).toBe(true);
		if (!pulled_after.ok) return;
		expect(pulled_after.value.threads).toHaveLength(1);
		expect(pulled_after.value.threads[0]?.status).toBe("open");
		expect(pulled_after.value.content?.html).toContain("Once upon a time,");
	});

	test("blocking a thread surfaces it in unresolved with blocking=true", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: DOC_HTML,
		});
		if (!pushed.ok) throw new Error("push failed");
		const created = await t.client.docs.createThread(pushed.value.id, {
			...anchor_for("brown fox"),
			body: "must fix",
			blocking: true,
		});
		expect(created.ok).toBe(true);

		const unresolved = await t.client.docs.unresolved({ document_id: pushed.value.id });
		expect(unresolved.ok).toBe(true);
		if (!unresolved.ok) return;
		expect(unresolved.value).toHaveLength(1);
		expect(unresolved.value[0]?.blocking).toBe(true);
	});

	test("reply appends without moving the thread", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: DOC_HTML,
		});
		if (!pushed.ok) throw new Error("push failed");
		const created = await t.client.docs.createThread(pushed.value.id, {
			...anchor_for("brown fox"),
			body: "seems off",
		});
		if (!created.ok) throw new Error("create failed");

		const pulled = await t.client.docs.pull(pushed.value.id);
		if (!pulled.ok) throw new Error("pull failed");
		const thread_id = pulled.value.threads[0]?.id;
		if (!thread_id) throw new Error("expected a thread id");

		const replied = await t.client.docs.replyThread(pushed.value.id, thread_id, "agreed, please rename");
		expect(replied.ok).toBe(true);

		const pulled_after = await t.client.docs.pull(pushed.value.id);
		expect(pulled_after.ok).toBe(true);
		if (!pulled_after.ok) return;
		expect(pulled_after.value.threads).toHaveLength(1);
		expect(pulled_after.value.threads[0]?.entries).toHaveLength(2);
	});
});
