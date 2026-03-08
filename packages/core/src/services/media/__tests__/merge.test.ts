import { describe, expect, test } from "bun:test";
import { mergeByKey } from "../merge";

type Item = { id: string; value: number };
const getKey = (item: Item) => item.id;

describe("mergeByKey", () => {
	test("empty existing + incoming returns all incoming as new", () => {
		const incoming: Item[] = [
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		];
		const result = mergeByKey([], incoming, getKey);
		expect(result.merged).toEqual(incoming);
		expect(result.newCount).toBe(2);
	});

	test("null existing + incoming returns all incoming as new", () => {
		const incoming: Item[] = [{ id: "a", value: 1 }];
		const result = mergeByKey(null, incoming, getKey);
		expect(result.merged).toEqual(incoming);
		expect(result.newCount).toBe(1);
	});

	test("undefined existing + incoming returns all incoming as new", () => {
		const incoming: Item[] = [{ id: "a", value: 1 }];
		const result = mergeByKey(undefined, incoming, getKey);
		expect(result.merged).toEqual(incoming);
		expect(result.newCount).toBe(1);
	});

	test("existing + empty incoming returns existing unchanged", () => {
		const existing: Item[] = [
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		];
		const result = mergeByKey(existing, [], getKey);
		expect(result.merged).toEqual(existing);
		expect(result.newCount).toBe(0);
	});

	test("no overlap merges all items", () => {
		const existing: Item[] = [
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		];
		const incoming: Item[] = [
			{ id: "c", value: 3 },
			{ id: "d", value: 4 },
		];
		const result = mergeByKey(existing, incoming, getKey);
		expect(result.merged).toEqual([...existing, ...incoming]);
		expect(result.newCount).toBe(2);
	});

	test("full overlap returns existing only", () => {
		const existing: Item[] = [
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		];
		const incoming: Item[] = [
			{ id: "a", value: 10 },
			{ id: "b", value: 20 },
		];
		const result = mergeByKey(existing, incoming, getKey);
		expect(result.merged).toEqual(existing);
		expect(result.newCount).toBe(0);
	});

	test("partial overlap merges only new items", () => {
		const existing: Item[] = [
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		];
		const incoming: Item[] = [
			{ id: "b", value: 20 },
			{ id: "c", value: 3 },
		];
		const result = mergeByKey(existing, incoming, getKey);
		expect(result.merged).toEqual([
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
			{ id: "c", value: 3 },
		]);
		expect(result.newCount).toBe(1);
	});

	test("preserves existing values for duplicate keys (does not overwrite)", () => {
		const existing: Item[] = [{ id: "a", value: 1 }];
		const incoming: Item[] = [{ id: "a", value: 999 }];
		const result = mergeByKey(existing, incoming, getKey);
		expect(result.merged[0].value).toBe(1);
	});

	test("custom key function", () => {
		type NamedItem = { name: string; category: string; score: number };
		const items_existing: NamedItem[] = [{ name: "alpha", category: "x", score: 10 }];
		const items_incoming: NamedItem[] = [
			{ name: "alpha", category: "y", score: 20 },
			{ name: "beta", category: "x", score: 30 },
		];
		const result = mergeByKey(items_existing, items_incoming, item => item.name);
		expect(result.merged.length).toBe(2);
		expect(result.newCount).toBe(1);
		expect(result.merged[1].name).toBe("beta");
	});

	test("handles large arrays", () => {
		const existing = Array.from({ length: 1000 }, (_, i) => ({ id: `item-${i}`, value: i }));
		const incoming = Array.from({ length: 500 }, (_, i) => ({ id: `item-${i + 800}`, value: i + 800 }));
		const result = mergeByKey(existing, incoming, getKey);
		expect(result.newCount).toBe(300);
		expect(result.merged.length).toBe(1300);
	});
});
