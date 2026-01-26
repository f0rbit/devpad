import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { escapeSQL, generateInserts } from "../utils/sql-escape.ts";

describe("escapeSQL", () => {
	it("returns NULL for null and undefined", () => {
		expect(escapeSQL(null)).toBe("NULL");
		expect(escapeSQL(undefined)).toBe("NULL");
	});

	it("handles numbers", () => {
		expect(escapeSQL(42)).toBe("42");
		expect(escapeSQL(0)).toBe("0");
		expect(escapeSQL(-1)).toBe("-1");
		expect(escapeSQL(3.14)).toBe("3.14");
	});

	it("handles booleans", () => {
		expect(escapeSQL(true)).toBe("1");
		expect(escapeSQL(false)).toBe("0");
	});

	it("handles plain strings", () => {
		expect(escapeSQL("hello")).toBe("'hello'");
		expect(escapeSQL("")).toBe("''");
	});

	it("escapes single quotes in strings", () => {
		expect(escapeSQL("it's")).toBe("'it''s'");
		expect(escapeSQL("he said 'hello'")).toBe("'he said ''hello'''");
	});

	it("handles JSON objects", () => {
		const obj = { key: "value", nested: { a: 1 } };
		const result = escapeSQL(obj);
		expect(result).toBe(`'${JSON.stringify(obj)}'`);
	});

	it("handles JSON objects with single quotes in values", () => {
		const obj = { message: "it's done" };
		const result = escapeSQL(obj);
		expect(result).toBe(`'{"message":"it''s done"}'`);
	});

	it("handles arrays", () => {
		const arr = [1, 2, 3];
		const result = escapeSQL(arr);
		expect(result).toBe("'[1,2,3]'");
	});
});

describe("generateInserts", () => {
	it("returns empty array for empty rows", () => {
		expect(generateInserts([], "test_table")).toEqual([]);
	});

	it("generates INSERT OR IGNORE statements", () => {
		const rows = [{ id: 1, name: "Alice" }];
		const result = generateInserts(rows, "users");
		expect(result).toEqual(["INSERT OR IGNORE INTO users (id, name) VALUES (1, 'Alice');"]);
	});

	it("handles multiple rows", () => {
		const rows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const result = generateInserts(rows, "users");
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("Alice");
		expect(result[1]).toContain("Bob");
	});

	it("handles null values in rows", () => {
		const rows = [{ id: 1, email: null }];
		const result = generateInserts(rows, "users");
		expect(result[0]).toBe("INSERT OR IGNORE INTO users (id, email) VALUES (1, NULL);");
	});

	it("handles JSON data columns", () => {
		const rows = [{ id: 1, data: { foo: "bar" } }];
		const result = generateInserts(rows, "action");
		expect(result[0]).toContain('\'{"foo":"bar"}\'');
	});
});

describe("migration round-trip", () => {
	it("generates valid SQL that can be executed", () => {
		const db = new Database(":memory:");

		db.run(`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT
		)`);

		db.run("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')");
		db.run("INSERT INTO users (id, name, email) VALUES (2, 'Bob', NULL)");
		db.run("INSERT INTO users (id, name, email) VALUES (3, 'O''Brien', 'obrien@test.com')");

		const rows = db.query("SELECT * FROM users").all() as Record<string, unknown>[];
		const inserts = generateInserts(rows, "users");

		const target = new Database(":memory:");
		target.run(`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT
		)`);

		for (const stmt of inserts) {
			target.run(stmt);
		}

		const result = target.query("SELECT * FROM users ORDER BY id").all() as { id: number; name: string; email: string | null }[];
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ id: 1, name: "Alice", email: "alice@test.com" });
		expect(result[1]).toEqual({ id: 2, name: "Bob", email: null });
		expect(result[2]).toEqual({ id: 3, name: "O'Brien", email: "obrien@test.com" });

		db.close();
		target.close();
	});

	it("handles JSON data round-trip", () => {
		const db = new Database(":memory:");

		db.run("CREATE TABLE actions (id INTEGER PRIMARY KEY, data TEXT)");
		const json_data = JSON.stringify({ type: "CREATE_TASK", items: [1, 2, 3] });
		db.run("INSERT INTO actions (id, data) VALUES (1, ?)", [json_data]);

		const rows = db.query("SELECT * FROM actions").all() as Record<string, unknown>[];
		const inserts = generateInserts(rows, "actions");

		const target = new Database(":memory:");
		target.run("CREATE TABLE actions (id INTEGER PRIMARY KEY, data TEXT)");

		for (const stmt of inserts) {
			target.run(stmt);
		}

		const result = target.query("SELECT * FROM actions").all() as { id: number; data: string }[];
		expect(result).toHaveLength(1);
		expect(JSON.parse(result[0].data)).toEqual({ type: "CREATE_TASK", items: [1, 2, 3] });

		db.close();
		target.close();
	});

	it("INSERT OR IGNORE skips duplicates", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
		db.run("INSERT INTO users (id, name) VALUES (1, 'Alice')");

		const rows = [{ id: 1, name: "Alice" }];
		const inserts = generateInserts(rows, "users");

		// run twice - should not error
		for (const stmt of inserts) {
			db.run(stmt);
		}
		for (const stmt of inserts) {
			db.run(stmt);
		}

		const result = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
		expect(result.count).toBe(1);

		db.close();
	});

	it("preserves foreign key order with realistic schema", () => {
		const db = new Database(":memory:");
		db.run("PRAGMA foreign_keys = OFF");

		db.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
		db.run("CREATE TABLE project (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES user(id), name TEXT NOT NULL)");
		db.run("CREATE TABLE task (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES user(id), project_id TEXT REFERENCES project(id), title TEXT NOT NULL)");

		db.run("INSERT INTO user VALUES ('u1', 'Tom')");
		db.run("INSERT INTO project VALUES ('p1', 'u1', 'devpad')");
		db.run("INSERT INTO task VALUES ('t1', 'u1', 'p1', 'Build migration')");

		const migration_order = ["user", "project", "task"];
		const all_inserts: string[] = ["PRAGMA foreign_keys = OFF;", "BEGIN TRANSACTION;"];

		for (const table of migration_order) {
			const rows = db.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
			all_inserts.push(...generateInserts(rows, table));
		}

		all_inserts.push("COMMIT;", "PRAGMA foreign_keys = ON;");

		const target = new Database(":memory:");
		target.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
		target.run("CREATE TABLE project (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES user(id), name TEXT NOT NULL)");
		target.run("CREATE TABLE task (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES user(id), project_id TEXT REFERENCES project(id), title TEXT NOT NULL)");

		for (const stmt of all_inserts) {
			target.run(stmt);
		}

		const users = target.query("SELECT COUNT(*) as count FROM user").get() as { count: number };
		const projects = target.query("SELECT COUNT(*) as count FROM project").get() as { count: number };
		const tasks = target.query("SELECT COUNT(*) as count FROM task").get() as { count: number };

		expect(users.count).toBe(1);
		expect(projects.count).toBe(1);
		expect(tasks.count).toBe(1);

		db.close();
		target.close();
	});
});
