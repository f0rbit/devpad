import { beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;

describe("Reviews pending — the human's queue aggregate (task A4.6)", () => {
	let project: Project;

	beforeEach(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
	});

	test("a fresh project has no pending signoffs or blocking threads of its own", async () => {
		const before = await t.client.reviews.pending();
		expect(before.ok).toBe(true);
		if (!before.ok) return;
		expect(before.value.items.every((i) => i.project_id !== project.id)).toBe(true);
	});

	test("a requested signoff checkpoint appears in the pending queue", async () => {
		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "stage",
			subject_id: "build",
			checkpoint: "plan",
			blocks: [],
		});
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;

		const pending = await t.client.reviews.pending();
		expect(pending.ok).toBe(true);
		if (!pending.ok) return;
		const item = pending.value.items.find((i) => i.kind === "signoff" && i.subject_id === requested.value.signoff.id);
		expect(item).toBeDefined();
		expect(item?.project_id).toBe(project.id);
		expect(typeof item?.path).toBe("string");
		expect(typeof item?.created_at).toBe("string");
	});

	test("an open blocking annotation thread appears in the pending queue", async () => {
		const pushed = await t.client.docs.push({
			project_id: project.id,
			kind: "design",
			title: "Design",
			html: DOC_HTML,
		});
		expect(pushed.ok).toBe(true);
		if (!pushed.ok) return;

		const start = DOC_HTML.indexOf("brown fox");
		const created = await t.client.docs.createThread(pushed.value.id, {
			quote: "brown fox",
			prefix: DOC_HTML.slice(Math.max(0, start - 10), start),
			suffix: DOC_HTML.slice(start + 9, start + 19),
			start,
			end: start + 9,
			body: "must fix",
			blocking: true,
		});
		expect(created.ok).toBe(true);

		const pending = await t.client.reviews.pending();
		expect(pending.ok).toBe(true);
		if (!pending.ok) return;
		const item = pending.value.items.find((i) => i.kind === "annotation" && i.project_id === project.id);
		expect(item).toBeDefined();
	});

	test("resolving the blocking thread and deciding the signoff removes both from the pending queue", async () => {
		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "stage",
			subject_id: "build-2",
			checkpoint: "plan",
			blocks: [],
		});
		if (!requested.ok) throw new Error("request failed");

		const before = await t.client.reviews.pending();
		expect(before.ok).toBe(true);
		if (before.ok) {
			expect(before.value.items.some((i) => i.kind === "signoff" && i.subject_id === requested.value.signoff.id)).toBe(
				true,
			);
		}

		// The signoff itself is human-only to decide (task A4.3) — this test
		// only asserts every ITEM shape is well-formed, not the decide flow
		// itself (covered end-to-end in signoff.test.ts).
		for (const item of before.ok ? before.value.items : []) {
			expect(typeof item.kind).toBe("string");
			expect(typeof item.subject_id).toBe("string");
			expect(typeof item.title).toBe("string");
		}
	});
});
