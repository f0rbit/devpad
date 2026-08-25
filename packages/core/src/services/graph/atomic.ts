import type { Database } from "@devpad/schema/database/types";
import type { Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import { errors, type DatabaseError } from "../errors.js";

/**
 * Runs `fn` as one atomic unit against `db`.
 *
 * D1 has no interactive transactions (no BEGIN/COMMIT over raw SQL) — its
 * only atomicity primitive is `db.batch()`, an array of pre-built statements
 * committed together. bun-sqlite (dev/test) has real transactions but not
 * that API. Every multi-statement graph mutation goes through this helper
 * rather than hand-rolling either path inline.
 *
 * bun-sqlite uses a uniquely-named `SAVEPOINT` rather than bare `BEGIN` —
 * task A2's outbox wiring (`write_with_event`) makes `run_atomic` calls
 * nest routinely (e.g. `apply()` wraps a batch of ops, several of which are
 * themselves `set_parent`/`claim`/`add_link` calls that wrap their own
 * write+event pair). Plain `BEGIN` cannot nest in SQLite; `SAVEPOINT` can,
 * and — critically — behaves identically to a real transaction when it IS
 * the outermost call (SQLite auto-opens an implicit transaction for a bare
 * top-level savepoint), so this is a strict superset of the old behavior,
 * not a weaker one.
 *
 * Known limitation: on D1, `fn` currently runs un-transacted (documented,
 * not exercised by this phase's bun-sqlite test suite — the D1 batch API
 * wants an array of statements built up-front, not an arbitrary callback,
 * so wiring true D1 atomicity here is a follow-up once a mutation path
 * actually needs it in production). The bun-sqlite path IS fully atomic:
 * a guard failure inside `fn` rolls back everything `fn` already did,
 * including at nested call depths.
 */
export async function run_atomic<T, E>(
	db: Database,
	fn: () => Promise<Result<T, E>>,
): Promise<Result<T, E | DatabaseError>> {
	const batch = (db as unknown as { batch?: unknown }).batch;
	if (typeof batch === "function") {
		// D1: see the "Known limitation" note above.
		return fn();
	}

	const savepoint = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
	await db.run(sql.raw(`SAVEPOINT "${savepoint}"`));
	let result: Result<T, E>;
	try {
		result = await fn();
	} catch (cause) {
		await db.run(sql.raw(`ROLLBACK TO SAVEPOINT "${savepoint}"`));
		await db.run(sql.raw(`RELEASE SAVEPOINT "${savepoint}"`));
		return errors.dbError(cause instanceof Error ? cause.message : "run_atomic: fn() threw");
	}
	if (!result.ok) {
		await db.run(sql.raw(`ROLLBACK TO SAVEPOINT "${savepoint}"`));
		await db.run(sql.raw(`RELEASE SAVEPOINT "${savepoint}"`));
		return result;
	}
	try {
		await db.run(sql.raw(`RELEASE SAVEPOINT "${savepoint}"`));
		return result;
	} catch (cause) {
		return errors.dbError(cause instanceof Error ? cause.message : "commit failed");
	}
}
