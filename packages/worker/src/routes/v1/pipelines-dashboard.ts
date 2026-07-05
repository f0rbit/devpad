/**
 * @module worker/routes/v1/pipelines-dashboard
 *
 * Worker proxy route for the pipeline observability dashboard
 * (Phase 2.D.2). Reads from the unified D1 binding (the orchestrator and
 * the main worker share `devpad-unified-db` per AGENTS.md) — no need to
 * hop through the orchestrator HTTP API.
 *
 * Surface: `GET /v1/pipelines/dashboard?project_id=...&window_ms=...`
 *
 * Flow:
 *
 *  1. `requireAuth` middleware ensures a session/user is present (401).
 *  2. Ownership check via `doesUserOwnProject` happens BEFORE any pipeline
 *     read so we never leak counts to non-owners (403).
 *  3. Resolve the project to its pipeline_package(s) — a project may have
 *     multiple packages; we aggregate across them.
 *  4. Call `get_dashboard` for each package and merge the snapshots.
 *  5. Optionally enrich with pulse `GET /summary` — if pulse is unreachable
 *     or unconfigured, we still render the response with `pulse: null`
 *     (NOT a 503). The dashboard is run-data first; pulse is best-effort.
 *  6. Stamp `Cache-Control: public, max-age=30` (shorter than pulse's 60s
 *     since pipeline state changes more frequently).
 */

import { pipelines, projects } from "@devpad/core/services";
import type { DashboardResponse } from "@devpad/schema/validation";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

// ─── pulse forward helper ───────────────────────────────────────────

/**
 * Local helper mirroring pulse.ts's `forward_to_pulse` but returning a
 * parsed JSON body (or null on any failure). We want the dashboard to
 * render even when pulse is unreachable — see the route handler for the
 * surrounding logic.
 */
const try_pulse_summary = async (
	c: Context<AppContext>,
	project_id: string,
): Promise<Record<string, unknown> | null> => {
	const config = c.get("config");
	const pulse_api_base = config.pulse_api_base;
	const pulse_internal_key = config.pulse_internal_key;
	if (!pulse_api_base || !pulse_internal_key) return null;

	const url = new URL(`${pulse_api_base}/summary/${project_id}`);

	let response: Response;
	try {
		response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Authorization: `Bearer ${pulse_internal_key}`,
				"Content-Type": "application/json",
			},
		});
	} catch {
		c.get("log")?.warning("dashboard_pulse_unreachable", { project_id });
		return null;
	}

	if (!response.ok) {
		c.get("log")?.warning("dashboard_pulse_non_ok", { project_id, status: response.status });
		return null;
	}

	const content_type = response.headers.get("content-type") ?? "";
	if (!content_type.includes("application/json")) return null;

	try {
		const body = (await response.json());
		return body;
	} catch {
		return null;
	}
};

// ─── Snapshot aggregation ───────────────────────────────────────────

/**
 * Combine multiple per-package `DashboardResponse` snapshots into one.
 * Counts add; verdict counts add; percentiles re-derive as a weighted
 * approximation (we don't have raw samples here, so we pick the max of
 * the per-package p95 and the count-weighted mean of p50 — close enough
 * for the at-a-glance view, and documented as such).
 *
 * Rollback rate weights by deploy_count (numerator = sum of rollback
 * counts, denominator = sum of deploy counts).
 *
 * Single-package call → no aggregation, just return the snapshot as-is.
 */
const aggregate_snapshots = (
	snapshots: ReadonlyArray<{ snap: DashboardResponse; deploys: number; rollbacks: number }>,
): DashboardResponse => {
	if (snapshots.length === 1) return snapshots[0].snap;
	if (snapshots.length === 0) {
		return {
			run_counts: { total: 0, completed: 0, failed: 0, cancelled: 0, rolled_back: 0, in_flight: 0 },
			verdict_counts: {
				manual: { pass: 0, fail: 0, pending: 0 },
				auto: { pass: 0, fail: 0, pending: 0 },
				analysis: { pass: 0, fail: 0, pending: 0 },
			},
			latency_p50_ms: null,
			latency_p95_ms: null,
			approval_turnaround_p50_ms: null,
			rollback_rate: null,
		};
	}

	const out: DashboardResponse = {
		run_counts: { total: 0, completed: 0, failed: 0, cancelled: 0, rolled_back: 0, in_flight: 0 },
		verdict_counts: {
			manual: { pass: 0, fail: 0, pending: 0 },
			auto: { pass: 0, fail: 0, pending: 0 },
			analysis: { pass: 0, fail: 0, pending: 0 },
		},
		latency_p50_ms: null,
		latency_p95_ms: null,
		approval_turnaround_p50_ms: null,
		rollback_rate: null,
	};

	const p50s: number[] = [];
	const p95s: number[] = [];
	const tatns: number[] = [];
	let total_deploys = 0;
	let total_rollbacks = 0;

	for (const { snap, deploys, rollbacks } of snapshots) {
		out.run_counts.total += snap.run_counts.total;
		out.run_counts.completed += snap.run_counts.completed;
		out.run_counts.failed += snap.run_counts.failed;
		out.run_counts.cancelled += snap.run_counts.cancelled;
		out.run_counts.rolled_back += snap.run_counts.rolled_back;
		out.run_counts.in_flight += snap.run_counts.in_flight;

		for (const key of ["manual", "auto", "analysis"] as const) {
			out.verdict_counts[key].pass += snap.verdict_counts[key].pass;
			out.verdict_counts[key].fail += snap.verdict_counts[key].fail;
			out.verdict_counts[key].pending += snap.verdict_counts[key].pending;
		}

		if (snap.latency_p50_ms !== null) p50s.push(snap.latency_p50_ms);
		if (snap.latency_p95_ms !== null) p95s.push(snap.latency_p95_ms);
		if (snap.approval_turnaround_p50_ms !== null) tatns.push(snap.approval_turnaround_p50_ms);

		total_deploys += deploys;
		total_rollbacks += rollbacks;
	}

	out.latency_p50_ms = p50s.length === 0 ? null : Math.max(...p50s);
	out.latency_p95_ms = p95s.length === 0 ? null : Math.max(...p95s);
	out.approval_turnaround_p50_ms = tatns.length === 0 ? null : Math.max(...tatns);
	out.rollback_rate = total_deploys === 0 ? null : total_rollbacks / total_deploys;

	return out;
};

// ─── Route ──────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

app.get("/dashboard", requireAuth, async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "project_id required" }, 400);

	// Ownership BEFORE any DB read of pipeline_* tables.
	const ownership = await projects.doesUserOwnProject(db, user.id, project_id);
	if (!ownership.ok || !ownership.value) {
		c.get("log")?.warning("dashboard_forbidden", { project_id, user_id: user.id });
		return c.json({ error: "Forbidden" }, 403);
	}

	const window_raw = c.req.query("window_ms");
	let window_ms = DEFAULT_WINDOW_MS;
	if (window_raw !== undefined) {
		const parsed = Number.parseInt(window_raw, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return c.json({ error: "window_ms must be a positive integer" }, 400);
		}
		window_ms = Math.min(parsed, MAX_WINDOW_MS);
	}

	// Resolve the project's pipeline_package(s).
	const packages_result = await pipelines.list_packages(db, { project_id });
	if (!packages_result.ok) {
		c.get("log")?.error("dashboard_packages_lookup_failed", { project_id, error: packages_result.error });
		return c.json({ error: "Failed to load pipeline packages" }, 500);
	}
	const packages = packages_result.value;

	if (packages.length === 0) {
		// No package linked → return an empty snapshot rather than 404 so the
		// UI can render its empty state without an error toast.
		c.header("Cache-Control", "public, max-age=30");
		return c.json({
			...aggregate_snapshots([]),
			pulse: null,
		});
	}

	// Call get_dashboard for each package.
	const per_package: Array<{ snap: DashboardResponse; deploys: number; rollbacks: number }> = [];
	for (const pkg of packages) {
		const dash = await pipelines.get_dashboard({ db }, { package_id: pkg.id, window_ms });
		if (!dash.ok) {
			c.get("log")?.error("dashboard_aggregator_failed", { package_id: pkg.id, error: dash.error });
			return c.json({ error: "Failed to aggregate dashboard" }, 500);
		}
		// Cheap re-derive of deploy/rollback weights for cross-package aggregation:
		// from the snapshot we have run_counts.total, the rollback_rate, and
		// run_counts.rolled_back. We invert the rate to get totals (best-effort:
		// the snapshot's run_counts.total already counts all runs, so we treat
		// `rolled_back` as the rollback count and `total - rolled_back - cancelled - in_flight`
		// as the closest deploy proxy. The aggregator-only path below is exact;
		// this is only here so multi-package rollback_rate has a denominator.
		const rolled_back = dash.value.run_counts.rolled_back;
		const cancelled = dash.value.run_counts.cancelled;
		const in_flight = dash.value.run_counts.in_flight;
		const total = dash.value.run_counts.total;
		const deploys = Math.max(0, total - rolled_back - cancelled - in_flight);
		per_package.push({ snap: dash.value, deploys, rollbacks: rolled_back });
	}

	const combined = aggregate_snapshots(per_package);
	const pulse = await try_pulse_summary(c, project_id);

	c.header("Cache-Control", "public, max-age=30");
	return c.json({
		...combined,
		pulse,
	});
});

export default app;
