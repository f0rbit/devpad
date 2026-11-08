/**
 * @module tests/integration/pulse-providers
 *
 * #158 — the orchestrator's pulse provider wiring against a fake
 * `PULSE` Fetcher. Asserts the REAL pulse wire contract:
 *
 * - ingest:  `POST /e`, `X-Pulse-Key: pk_*` header, body
 *   `{ project_id, events: [{ name: "event", properties: { ... } }] }`
 *   (dimensions ride in `properties` — pulse's event schema has no
 *   top-level package/environment/version_id fields)
 * - read-back: `GET /events/:project_id?ts_from&ts_to&limit=` with
 *   `Authorization: Bearer <read key>` (devpad key, scope "pulse")
 */

import { describe, expect, test } from "bun:test";
import type { Fetcher } from "@cloudflare/workers-types";
import { z } from "zod";
import {
	aggregate_rows,
	chunk_events,
	event_matches_query,
	type PulseEventRow,
	make_pulse_emitter,
	make_pulse_summary_client,
	MAX_PULSE_BATCH,
	to_pulse_wire_event,
} from "../../src/providers/pulse";

const ingest_body_schema = z.object({
	project_id: z.string(),
	events: z.array(z.object({ name: z.string(), properties: z.record(z.string(), z.unknown()) })).min(1),
});

type Call = { url: string; init: RequestInit | undefined };

type FetchScript = {
	/** Called for every fetch; null = fall through to the default 204. */
	respond: (url: string, init: RequestInit | undefined) => Response | null;
};

const make_fake_pulse_fetcher = (script: FetchScript) => {
	const calls: Call[] = [];
	const fetcher = {
		fetch: async (url: string | Request, init?: RequestInit) => {
			const u = typeof url === "string" ? url : url.url;
			calls.push({ url: u, init });
			return script.respond(u, init) ?? new Response("", { status: 204 });
		},
	};
	return { fetcher: fetcher as unknown as Fetcher, calls };
};

const emitter_config = { project_id: "pulse_project_orch", ingest_key: { get: async () => "pk_orch" } };
const summary_config = { project_id: "pulse_project_orch", read_key: { get: async () => "dpk_orch" } };

const GATE_EVENT = {
	event: "gate_analysis_verdict",
	run_id: "pipeline-run_x",
	stage: "onebox",
	template: { template_id: "default" },
	verdict: "Pass",
} as const;

const empty_page_with_cursor = (cursor: string): Response =>
	new Response(JSON.stringify({ events: [], next_cursor: cursor }), { status: 200 });

let row_id = 0;

const event_row = (over: Record<string, unknown>): PulseEventRow => {
	row_id += 1;
	return {
		id: row_id,
		project_id: "pulse_project_orch",
		name: typeof over.name === "string" ? over.name : "event",
		ts: Date.now(),
		session_id: "sess_default",
		properties: over,
	};
};

describe("pulse emitter — POST /e wire contract", () => {
	test("posts /e with X-Pulse-Key, content-type and the ingest body shape", async () => {
		const { fetcher, calls } = make_fake_pulse_fetcher({ respond: () => null });
		const emitter = make_pulse_emitter(fetcher, emitter_config);
		const result = await emitter.emit(GATE_EVENT);
		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://pulse/e");
		expect(calls[0]?.init?.method).toBe("POST");
		const headers = z.record(z.string(), z.string()).parse(calls[0]?.init?.headers);
		expect(headers["X-Pulse-Key"]).toBe("pk_orch");
		expect(headers["content-type"]).toBe("application/json");
		const raw_body = calls[0]?.init?.body;
		const body = ingest_body_schema.parse(JSON.parse(typeof raw_body === "string" ? raw_body : ""));
		expect(body.project_id).toBe("pulse_project_orch");
		expect(body.events).toHaveLength(1);
		const event = body.events[0];
		expect(event.name).toBe("event");
		expect(event.properties.name).toBe("gate_analysis_verdict");
		// Dimensions ride in properties — the stage doubles as environment,
		// unknown dims degrade to "unknown" (never dropped).
		expect(event.properties.environment).toBe("onebox");
		expect(event.properties.version_id).toBe("unknown");
	});

	test("maps package_id-bearing route events onto the package dimension", () => {
		const event = to_pulse_wire_event({
			event: "artifact_uploaded",
			package_id: "factory-pkg",
			store_id: "version-sets",
		});
		expect(event.properties.package).toBe("factory-pkg");
		expect(event.properties.name).toBe("artifact_uploaded");
		expect(event.properties.environment).toBe("unknown");
	});

	test("unconfigured config no-ops without touching the fetcher", async () => {
		const { fetcher, calls } = make_fake_pulse_fetcher({ respond: () => null });
		const emitter = make_pulse_emitter(fetcher, { project_id: undefined, ingest_key: emitter_config.ingest_key });
		expect((await emitter.emit(GATE_EVENT)).ok).toBe(true);
		expect((await emitter.emit(GATE_EVENT)).ok).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe("pulse emitter — ≤9-event chunking", () => {
	// pulse 500s on batches of 10+ (f0rbit/pulse#13). The orchestrator's
	// PulseEmitter API is single-event, so the chunk constant + pure
	// helper are the contract; any future batch path routes through
	// send_pulse_events / chunk_events and inherits the behaviour.
	test("chunk_events splits 10 events into 9 + 1", () => {
		const ten = Array.from({ length: 10 }, (_, i) => ({ i }));
		const batches = chunk_events(ten, MAX_PULSE_BATCH);
		expect(MAX_PULSE_BATCH).toBe(9);
		expect(batches).toHaveLength(2);
		expect(batches[0]?.length).toBe(9);
		expect(batches[1]?.length).toBe(1);
	});
});

describe("pulse summary client — GET /events/:project_id read-back", () => {
	test("bounded read-back with bearer auth and dimension filtering → snapshot", async () => {
		const rows = [
			event_row({ package: "factory-pkg", environment: "staging", version_id: "vs_test" }),
			event_row({
				name: "request",
				package: "factory-pkg",
				environment: "staging",
				version_id: "vs_test",
				duration_ms: 120,
			}),
			event_row({
				name: "request",
				package: "factory-pkg",
				environment: "staging",
				version_id: "vs_test",
				duration_ms: 400,
			}),
			event_row({ name: "error", package: "factory-pkg", environment: "staging", version_id: "vs_test" }),
			// Same dims but wrong package — must be excluded.
			event_row({ package: "other-pkg", environment: "staging", version_id: "vs_test" }),
			// No dims at all (untagged browser noise) — must be excluded.
			event_row({ name: "session_started" }),
		];
		const { fetcher, calls } = make_fake_pulse_fetcher({
			respond: () => new Response(JSON.stringify({ events: rows }), { status: 200 }),
		});
		const client = make_pulse_summary_client(fetcher, summary_config);
		const result = await client.fetch({
			package: "factory-pkg",
			environment: "staging",
			version_id: "vs_test",
			window_ms: 60_000,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain("/events/pulse_project_orch");
		expect(calls[0]?.url).toContain("limit=500");
		expect(calls[0]?.url).toContain("ts_from=");
		expect(calls[0]?.url).toContain("ts_to=");
		const auth_header = (calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization;
		expect(auth_header).toBe("Bearer dpk_orch");
		const snapshot = result.value;
		expect(snapshot.metrics.events_total).toBe(4);
		expect(snapshot.metrics.request_count).toBe(2);
		expect(snapshot.metrics.errors).toBe(1);
		expect(snapshot.metrics.error_rate).toBe(0.5);
		expect(snapshot.metrics.latency_p95_ms).toBe(400);
		expect(snapshot.sample_count).toBe(4);
		expect(snapshot.window_end_ms - snapshot.window_start_ms).toBe(60_000);
	});

	test("second page continuation is bounded to two page fetches", async () => {
		const { fetcher, calls } = make_fake_pulse_fetcher({
			respond: (url) => empty_page_with_cursor(url.includes("cursor=") ? "last" : "4711"),
		});
		const client = make_pulse_summary_client(fetcher, summary_config);
		const result = await client.fetch({
			package: "factory-pkg",
			environment: "staging",
			version_id: "vs_test",
			window_ms: 60_000,
		});
		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls.some((c) => c.url.includes("cursor=4711"))).toBe(true);
	});

	test("rejects a malformed pulse response with a validation error", async () => {
		const { fetcher } = make_fake_pulse_fetcher({
			respond: () => new Response(JSON.stringify({ events: [{ ts: "not-a-number" }] }), { status: 200 }),
		});
		const client = make_pulse_summary_client(fetcher, summary_config);
		const result = await client.fetch({
			package: "factory-pkg",
			environment: "staging",
			version_id: "vs_test",
			window_ms: 60_000,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.code).toBe("validation");
		expect(result.error.message).toContain("schema validation");
	});

	test("maps non-2xx statuses to typed errors", async () => {
		const { fetcher, calls } = make_fake_pulse_fetcher({ respond: () => new Response("denied", { status: 403 }) });
		const client = make_pulse_summary_client(fetcher, summary_config);
		const result = await client.fetch({
			package: "factory-pkg",
			environment: "staging",
			version_id: "vs_test",
			window_ms: 60_000,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.code).toBe("unauthorized");
		expect(calls).toHaveLength(1);
	});

	test("unbounded config returns typed not_configured without fetching", async () => {
		const { fetcher, calls } = make_fake_pulse_fetcher({ respond: () => null });
		const client = make_pulse_summary_client(fetcher, { project_id: "pulse_project_orch", read_key: undefined });
		const result = await client.fetch({
			package: "factory-pkg",
			environment: "staging",
			version_id: "vs_test",
			window_ms: 60_000,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.code).toBe("not_configured");
		expect(calls).toHaveLength(0);
	});
});

describe("pulse read-back — pure bits", () => {
	test("event_matches_query requires the full dimension triple", () => {
		const query = { package: "p", environment: "staging", version_id: "v", window_ms: 1000 };
		const base = { ts: 0, name: "event" } as const;
		expect(
			event_matches_query(
				{
					...base,
					id: 1,
					project_id: "proj",
					session_id: "s",
					properties: { package: "p", environment: "staging", version_id: "v" },
				},
				query,
			),
		).toBe(true);
		expect(
			event_matches_query(
				{
					...base,
					id: 1,
					project_id: "proj",
					session_id: "s",
					properties: { package: "p", environment: "staging", version_id: "other" },
				},
				query,
			),
		).toBe(false);
		expect(event_matches_query({ ...base, id: 1, project_id: "proj", session_id: "s", properties: null }, query)).toBe(
			false,
		);
	});

	test("aggregate_rows computes sessions/latency/error_rate over the window", () => {
		const rows = [1, 2, 3, 4].map((id) =>
			event_row({
				name: id % 2 === 0 ? "request" : "error",
				duration_ms: id * 10,
				package: "p",
				environment: "e",
				version_id: "v",
			}),
		);
		const query = { package: "p", environment: "e", version_id: "v", window_ms: 120_000 };
		const snapshot = aggregate_rows(rows, query, 1_000);
		expect(snapshot.metrics.request_count).toBe(2);
		expect(snapshot.metrics.errors).toBe(2);
		expect(snapshot.metrics.error_rate).toBe(1);
		expect(snapshot.metrics.latency_p95_ms).toBe(40);
		expect(snapshot.sample_count).toBe(4);
		expect(snapshot.window_start_ms).toBe(1_000 - 120_000);
	});
});
