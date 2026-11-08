import { describe, expect, test } from "bun:test";
import type { VersionBinding } from "@devpad/pipeline-fakes";
import { SECRET_BINDING_TYPES, merge_bindings } from "../../bindings.js";

const platform = (names: string[]): VersionBinding[] =>
	names.map((name) => ({ type: "service", name, service: name.toLowerCase() }));

describe("merge_bindings (#160)", () => {
	test("preserves every non-platform live binding verbatim, unknown types included", () => {
		const live = [
			{ type: "d1", name: "DB", id: "db-1" },
			{ type: "r2_bucket", name: "CORPUS_BUCKET", bucket_name: "bkt" },
			{ type: "queue", name: "FETCH_QUEUE", queue_name: "q" },
			{ type: "ai", name: "AI" },
			{ type: "plain_text", name: "EXTRACTION_MODEL", text: "claude-haiku-5-5" },
			{ type: "some_future_type", name: "WEIRD", extra_field: { nested: true } },
		];
		const merged = merge_bindings({ live, platform: platform(["ANTHROPIC", "PULSE"]) });
		expect(merged.bindings.slice(0, live.length)).toEqual(live);
		expect(merged.keep_bindings).toEqual([]);
	});

	test("platform bindings overlay live ones by name — replaced, never duplicated", () => {
		const live = [
			{ type: "service", name: "ANTHROPIC", service: "vault-stale" },
			{ type: "service", name: "PULSE", service: "pulse-stale" },
			{ type: "d1", name: "DB", id: "db-1" },
		];
		const merged = merge_bindings({
			live,
			platform: [
				{ type: "service", name: "ANTHROPIC", service: "anthropic" },
				{ type: "service", name: "PULSE", service: "pulse-api" },
			],
		});
		const by_name = new Map(merged.bindings.map((b) => [b.name, b]));
		expect(by_name.get("ANTHROPIC")).toEqual({ type: "service", name: "ANTHROPIC", service: "anthropic" });
		expect(by_name.get("PULSE")).toEqual({ type: "service", name: "PULSE", service: "pulse-api" });
		expect(by_name.get("DB")).toEqual({ type: "d1", name: "DB", id: "db-1" });
		expect(merged.bindings.filter((b) => b.name === "ANTHROPIC")).toHaveLength(1);
		expect(merged.bindings.filter((b) => b.name === "PULSE")).toHaveLength(1);
	});

	test("identity vars (CALLER_*) replace the previous version's values", () => {
		const live = [
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "old-vs" },
			{ type: "plain_text", name: "CALLER_ENV", text: "production" },
		];
		const merged = merge_bindings({
			live,
			platform: [{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "new-vs" }],
		});
		const caller = merged.bindings.filter((b) => b.name === "CALLER_VERSION_SET_ID");
		expect(caller).toHaveLength(1);
		expect(caller[0].text).toBe("new-vs");
	});

	test("secret bindings are excluded from the explicit list and land in keep_bindings", () => {
		const live = [
			{ type: "d1", name: "DB", id: "db-1" },
			{ type: "secret_text", name: "API_SECRET" },
			{ type: "secret_key", name: "KEY_SECRET" },
		];
		const merged = merge_bindings({ live, platform: [] });
		expect(merged.bindings.map((b) => b.name)).toEqual(["DB"]);
		expect(merged.keep_bindings.toSorted()).toEqual([...SECRET_BINDING_TYPES].toSorted());
	});

	test("keep_bindings omits the field concern: empty when no secrets", () => {
		const merged = merge_bindings({ live: [{ type: "d1", name: "DB" }], platform: [] });
		expect(merged.keep_bindings).toEqual([]);
	});

	test("dedupes live same-name entries — last read wins", () => {
		const live = [
			{ type: "plain_text", name: "ENV", text: "stale" },
			{ type: "plain_text", name: "ENV", text: "fresh" },
		];
		const merged = merge_bindings({ live, platform: [] });
		expect(merged.bindings).toHaveLength(1);
		expect(merged.bindings[0].text).toBe("fresh");
	});

	test("empty live set yields just the platform set", () => {
		const plat = platform(["ANTHROPIC", "PULSE"]);
		const merged = merge_bindings({ live: [], platform: plat });
		expect(merged.bindings).toEqual(plat);
		expect(merged.keep_bindings).toEqual([]);
	});
});
