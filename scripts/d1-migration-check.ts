/**
 * Local-only D1 migration check for 0023 (external deploy mode).
 *
 * Applies migrations through 0022 on a throwaway local D1, seeds pipeline rows,
 * applies 0023, then asserts rows/FKs/indexes survived the pipeline_run rebuild.
 * Never touches a remote database: every wrangler call passes --local.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source_dir = join(root, "packages/schema/src/database/drizzle");
const wrangler_bin = join(root, "node_modules/.bin/wrangler");
const db_name = "migration-check";
const target_migration = "0023_external_deploy_mode.sql";

const work = mkdtempSync(join(tmpdir(), "d1-migration-check-"));
const migrations_dir = join(work, "migrations");
const persist_dir = join(work, "state");
mkdirSync(migrations_dir);

writeFileSync(
	join(work, "wrangler.jsonc"),
	JSON.stringify({
		name: "migration-check",
		main: "worker.js",
		compatibility_date: "2025-01-01",
		d1_databases: [
			{ binding: "DB", database_name: db_name, database_id: "00000000-0000-0000-0000-000000000000", migrations_dir },
		],
	}),
);

const failures: string[] = [];

type Wrangler = { ok: boolean; out: string };

const wrangler = (args: string[]): Wrangler => {
	const proc = Bun.spawnSync([wrangler_bin, ...args, "--local", "--persist-to", persist_dir], {
		cwd: work,
		env: { ...process.env, CI: "1", NO_COLOR: "1" },
	});
	return { ok: proc.exitCode === 0, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
};

const apply = (): void => {
	const res = wrangler(["d1", "migrations", "apply", db_name]);
	if (res.ok) return;
	console.error(res.out);
	throw new Error("migrations apply failed");
};

type Row = Record<string, unknown>;

const query = (sql: string): Row[] => {
	const res = wrangler(["d1", "execute", db_name, "--json", "--command", sql]);
	if (!res.ok) throw new Error(`query failed: ${sql}\n${res.out}`);
	const start = res.out.search(/^\[\s*$/m);
	if (start < 0) throw new Error(`no JSON in output of: ${sql}\n${res.out}`);
	const parsed: unknown = (() => {
		try {
			const end = res.out.lastIndexOf("\n]") + 2;
			return JSON.parse(res.out.slice(start, end));
		} catch {
			throw new Error(`unparseable JSON from: ${sql}\n${res.out}`);
		}
	})();
	if (!Array.isArray(parsed)) throw new Error(`unexpected output: ${res.out}`);
	const last: unknown = parsed[parsed.length - 1];
	if (typeof last !== "object" || last === null || !("results" in last) || !Array.isArray(last.results)) return [];
	return last.results as Row[];
};

const rejects = (sql: string): boolean => !wrangler(["d1", "execute", db_name, "--command", sql]).ok;

const check = (label: string, passed: boolean, detail?: unknown): void => {
	console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
	if (passed) return;
	if (detail !== undefined) console.log(`     ${JSON.stringify(detail)}`);
	failures.push(label);
};

const snapshot = () => ({
	runs: query("SELECT id FROM pipeline_run ORDER BY id").map((r) => r.id),
	events: query("SELECT id FROM pipeline_stage_event ORDER BY id").map((r) => r.id),
	approvals: query("SELECT id FROM pipeline_approval ORDER BY id").map((r) => r.id),
	packages: query("SELECT id FROM pipeline_package ORDER BY id").map((r) => r.id),
});

const run = (): void => {
	const files = readdirSync(source_dir)
		.filter((name) => name.endsWith(".sql"))
		.toSorted();
	if (!files.includes(target_migration)) throw new Error(`${target_migration} not found`);
	for (const file of files.filter((name) => name < target_migration))
		copyFileSync(join(source_dir, file), join(migrations_dir, file));

	console.log("applying migrations through 0022");
	apply();

	query(
		[
			"INSERT INTO user (id, name) VALUES ('u1', 'tester')",
			"INSERT INTO pipeline_package (id, owner_id, name) VALUES ('pkg1', 'u1', 'demo')",
			"INSERT INTO pipeline_run (id, package_id, version_set_id, shape, resolved_rollout, resolved_gates) VALUES ('run1', 'pkg1', 'vs1', 'atomic', '{}', '{}')",
			"INSERT INTO pipeline_run (id, package_id, version_set_id, shape, resolved_rollout, resolved_gates, status) VALUES ('run2', 'pkg1', 'vs2', 'atomic', '{}', '{}', 'completed')",
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind, idempotency_hash) VALUES ('ev1', 'run1', 'staging', 'deploy_started', 'h1')",
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind, idempotency_hash) VALUES ('ev2', 'run1', 'staging', 'deploy_started', 'h1x')",
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind) VALUES ('ev3', 'run2', 'production', 'deploy_started')",
			"INSERT INTO pipeline_approval (id, run_id, stage_name, decision, decided_by) VALUES ('ap1', 'run1', 'production', 'approved', 'u1')",
		].join("; "),
	);
	const before = snapshot();
	check(
		"seed counts (2 runs, 3 events, 1 approval, 1 package)",
		before.runs.length === 2 &&
			before.events.length === 3 &&
			before.approvals.length === 1 &&
			before.packages.length === 1,
		before,
	);

	console.log(`applying ${target_migration}`);
	copyFileSync(join(source_dir, target_migration), join(migrations_dir, target_migration));
	apply();

	const error_migration = "0024_run_error.sql";
	console.log(`applying ${error_migration}`);
	copyFileSync(join(source_dir, error_migration), join(migrations_dir, error_migration));
	apply();
	const run_columns = query("SELECT name FROM pragma_table_info('pipeline_run')").map((r) => r.name);
	check("pipeline_run.error exists after 0024", run_columns.includes("error"), run_columns);

	const after = snapshot();
	check("pipeline_run rows + ids preserved", JSON.stringify(after.runs) === JSON.stringify(before.runs), after.runs);
	check(
		"pipeline_stage_event rows + ids preserved",
		JSON.stringify(after.events) === JSON.stringify(before.events),
		after.events,
	);
	check(
		"pipeline_approval rows + ids preserved",
		JSON.stringify(after.approvals) === JSON.stringify(before.approvals),
		after.approvals,
	);
	check(
		"pipeline_package rows + ids preserved",
		JSON.stringify(after.packages) === JSON.stringify(before.packages),
		after.packages,
	);

	const approval = query("SELECT run_id, decision, decided_by FROM pipeline_approval WHERE id = 'ap1'")[0];
	check(
		"approval columns preserved",
		approval.run_id === "run1" && approval.decision === "approved" && approval.decided_by === "u1",
		approval,
	);

	const fk = query("PRAGMA foreign_key_check");
	check("PRAGMA foreign_key_check empty", fk.length === 0, fk);

	check(
		"run with NULL version_set_id and commit_sha inserts",
		!rejects(
			"INSERT INTO pipeline_run (id, package_id, shape, resolved_rollout, resolved_gates) VALUES ('run3', 'pkg1', 'atomic', '{}', '{}')",
		),
	);
	check(
		"run with commit_sha inserts",
		!rejects(
			"INSERT INTO pipeline_run (id, package_id, commit_sha, shape, resolved_rollout, resolved_gates) VALUES ('run4', 'pkg1', 'abc', 'atomic', '{}', '{}')",
		),
	);

	check(
		"duplicate (run_id, idempotency_hash) rejected",
		rejects(
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind, idempotency_hash) VALUES ('ev4', 'run1', 'staging', 'deploy_started', 'h1')",
		),
	);
	check(
		"two NULL idempotency hashes allowed",
		!rejects(
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind) VALUES ('ev5', 'run1', 'staging', 'deploy_started')",
		) &&
			!rejects(
				"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind) VALUES ('ev6', 'run1', 'staging', 'deploy_started')",
			),
	);

	check(
		"child FK to pipeline_run enforced (orphan event rejected)",
		rejects(
			"INSERT INTO pipeline_stage_event (id, run_id, stage_name, kind) VALUES ('ev7', 'nope', 'staging', 'deploy_started')",
		),
	);

	check(
		"pipeline_dispatch insert ok",
		!rejects(
			"INSERT INTO pipeline_dispatch (id, run_id, stage_name, commit_sha) VALUES ('d1', 'run4', 'production', 'abc')",
		),
	);
	check(
		"pipeline_dispatch duplicate (run_id, stage_name) rejected",
		rejects(
			"INSERT INTO pipeline_dispatch (id, run_id, stage_name, commit_sha) VALUES ('d2', 'run4', 'production', 'abc')",
		),
	);

	const pkg = query(
		"SELECT deploy_mode, external_target IS NULL AS target_null FROM pipeline_package WHERE id = 'pkg1'",
	)[0];
	check(
		"pipeline_package.deploy_mode defaults to orchestrated",
		pkg.deploy_mode === "orchestrated" && pkg.target_null === 1,
		pkg,
	);

	const leftovers = query("SELECT name FROM sqlite_master WHERE name LIKE '\\_\\_%' ESCAPE '\\'");
	check("no leftover __tmp_/__new_ tables", leftovers.length === 0, leftovers);

	const final_fk = query("PRAGMA foreign_key_check");
	check("PRAGMA foreign_key_check empty after writes", final_fk.length === 0, final_fk);
};

try {
	run();
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	failures.push("script error");
} finally {
	rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error(`\n${String(failures.length)} check(s) failed: ${failures.join("; ")}`);
	process.exit(1);
}
console.log("\nall migration checks passed");
