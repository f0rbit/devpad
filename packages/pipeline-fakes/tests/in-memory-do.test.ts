import { describe, expect, test } from "bun:test";
import { InMemoryDurableObjectNamespace, InMemoryDurableObjectState } from "../src/in-memory-do.ts";

describe("InMemoryDurableObjectState", () => {
	test("storage round-trips put/get/delete", async () => {
		const ctx = new InMemoryDurableObjectState("run_test");
		await ctx.storage.put("foo", 42);
		expect(await ctx.storage.get<number>("foo")).toBe(42);
		await ctx.storage.delete("foo");
		expect(await ctx.storage.get<number>("foo")).toBeUndefined();
	});

	test("setAlarm + manualFireAlarm invokes the registered handler", async () => {
		const ctx = new InMemoryDurableObjectState("run_alarm");
		let fired = 0;
		ctx.registerAlarmHandler(async () => {
			fired += 1;
		});
		await ctx.storage.setAlarm(Date.now() + 1000);
		expect(ctx.alarm_ms).not.toBeNull();
		await ctx.manualFireAlarm();
		expect(fired).toBe(1);
		expect(ctx.alarm_ms).toBeNull();
	});

	test("id.equals compares by name", () => {
		const a = new InMemoryDurableObjectState("a");
		const b = new InMemoryDurableObjectState("a");
		const c = new InMemoryDurableObjectState("c");
		expect(a.id.equals(b.id)).toBe(true);
		expect(a.id.equals(c.id)).toBe(false);
	});
});

describe("InMemoryDurableObjectNamespace", () => {
	test("get(id) returns the same instance for the same id", async () => {
		type Env = { x: number };
		const ns = new InMemoryDurableObjectNamespace<Env>({ x: 1 }, (_ctx) => ({
			fetch: async () => new Response("ok"),
			alarm: async () => {},
		}));
		const id = ns.idFromName("run_a");
		const a = ns.get(id);
		const b = ns.get(id);
		expect(a).toBe(b);
	});

	test("get(id) creates fresh instances for different ids", () => {
		type Env = Record<string, never>;
		const ns = new InMemoryDurableObjectNamespace<Env>({}, (_ctx) => ({
			fetch: async () => new Response("ok"),
			alarm: async () => {},
		}));
		const a = ns.get(ns.idFromName("run_a"));
		const b = ns.get(ns.idFromName("run_b"));
		expect(a).not.toBe(b);
	});

	test("manualFireAlarm proxies into the DO instance", async () => {
		type Env = Record<string, never>;
		let alarm_fires = 0;
		const ns = new InMemoryDurableObjectNamespace<Env>({}, (_ctx) => ({
			fetch: async () => new Response("ok"),
			alarm: async () => {
				alarm_fires += 1;
			},
		}));
		const stub = ns.get(ns.idFromName("run_alarm"));
		await stub.manualFireAlarm();
		expect(alarm_fires).toBe(1);
	});
});
