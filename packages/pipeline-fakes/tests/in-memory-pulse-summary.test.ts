import { describe, expect, test } from "bun:test";
import { InMemoryPulseSummaryProvider } from "../src/in-memory-pulse-summary.ts";

describe("InMemoryPulseSummaryProvider", () => {
	test("returns empty snapshot when no response is seeded", async () => {
		const provider = new InMemoryPulseSummaryProvider();
		const result = await provider.fetch({ package: "p", environment: "e", version_id: "v", window_ms: 600_000 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.metrics).toEqual({});
			expect(result.value.sample_count).toBe(0);
		}
		expect(provider.calls).toHaveLength(1);
	});

	test("returns seeded snapshot keyed by (package, environment, version_id)", async () => {
		const provider = new InMemoryPulseSummaryProvider();
		provider.set_next_response(
			{ package: "p", environment: "prod", version_id: "v1" },
			{
				metrics: { error_rate: 0.05 },
				window_start_ms: 0,
				window_end_ms: 1000,
				sample_count: 10,
			}
		);

		const result = await provider.fetch({ package: "p", environment: "prod", version_id: "v1", window_ms: 1000 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.metrics.error_rate).toBe(0.05);
	});

	test("returns empty snapshot when key doesn't match", async () => {
		const provider = new InMemoryPulseSummaryProvider();
		provider.set_next_response(
			{ package: "p", environment: "prod", version_id: "v1" },
			{
				metrics: { error_rate: 0.05 },
				window_start_ms: 0,
				window_end_ms: 1000,
				sample_count: 10,
			}
		);

		const result = await provider.fetch({ package: "p", environment: "staging", version_id: "v1", window_ms: 1000 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.metrics).toEqual({});
	});

	test("set_next_error surfaces an error for the matching key", async () => {
		const provider = new InMemoryPulseSummaryProvider();
		provider.set_next_error({ package: "p", environment: "prod", version_id: "v1" }, { code: "network", message: "offline" });

		const result = await provider.fetch({ package: "p", environment: "prod", version_id: "v1", window_ms: 1000 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("network");
			expect(result.error.message).toBe("offline");
		}
	});

	test("records every fetch call in order", async () => {
		const provider = new InMemoryPulseSummaryProvider();
		await provider.fetch({ package: "a", environment: "e", version_id: "v1", window_ms: 1 });
		await provider.fetch({ package: "b", environment: "e", version_id: "v2", window_ms: 2 });
		expect(provider.calls).toHaveLength(2);
		expect(provider.calls[0]?.query.package).toBe("a");
		expect(provider.calls[1]?.query.package).toBe("b");
	});
});
