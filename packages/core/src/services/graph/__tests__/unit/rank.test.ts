import { describe, expect, test } from "bun:test";
import { needs_rebalance, rank_between, rank_validate } from "../../rank.js";

// Seeded PRNG (mulberry32) so the property test is deterministic/reproducible.
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("rank_between", () => {
	test("first key when both bounds are null", () => {
		const first = rank_between(null, null);
		expect(rank_validate(first)).toBe(true);
		expect(first.length).toBeGreaterThan(0);
	});

	test("append-only inserts (b always null) stay strictly increasing", () => {
		let prev = rank_between(null, null);
		for (let i = 0; i < 200; i++) {
			const next = rank_between(prev, null);
			expect(next > prev).toBe(true);
			prev = next;
		}
	});

	test("prepend-only inserts (a always null) stay strictly decreasing", () => {
		let prev = rank_between(null, null);
		for (let i = 0; i < 200; i++) {
			const next = rank_between(null, prev);
			expect(next < prev).toBe(true);
			prev = next;
		}
	});

	test("midpoint insert always lands strictly between adjacent neighbors", () => {
		const a = rank_between(null, null);
		const b = rank_between(a, null);
		const mid = rank_between(a, b);
		expect(mid > a).toBe(true);
		expect(mid < b).toBe(true);
	});

	test("legacy empty-string rank ('' default) is treated the same as null", () => {
		const before_null = rank_between(null, "i0");
		const before_empty = rank_between("", "i0");
		expect(before_null).toBe(before_empty);
	});

	test("swaps out-of-order bounds instead of producing an invalid key", () => {
		const a = rank_between(null, null);
		const b = rank_between(a, null);
		const mid = rank_between(b, a); // passed backwards
		expect(mid > a).toBe(true);
		expect(mid < b).toBe(true);
	});

	test("throws on equal bounds (caller bug, not a valid insert)", () => {
		const a = rank_between(null, null);
		expect(() => rank_between(a, a)).toThrow();
	});

	test("repeated adjacent-key inserts (worst case for key growth) never collide", () => {
		// Insert 500 keys, always between the SAME two immediate neighbors —
		// the pathological "always insert between a fixed pair" pattern that
		// forces key length to grow (needs_rebalance is the accepted mitigation).
		const lo = rank_between(null, null);
		const hi = rank_between(lo, null);
		let cursor = hi;
		const generated: string[] = [];
		for (let i = 0; i < 500; i++) {
			cursor = rank_between(lo, cursor);
			expect(cursor > lo).toBe(true);
			expect(cursor < hi).toBe(true);
			generated.push(cursor);
		}
		expect(new Set(generated).size).toBe(generated.length);
	});

	test("10k seeded-random midpoint inserts stay sorted with no duplicates", () => {
		const rng = mulberry32(0x5eed1e5);
		const list: string[] = [rank_between(null, null)];

		for (let i = 0; i < 10_000; i++) {
			const idx = Math.floor(rng() * (list.length + 1));
			const lo = idx === 0 ? null : (list[idx - 1] ?? null);
			const hi = idx === list.length ? null : (list[idx] ?? null);
			const key = rank_between(lo, hi);
			list.splice(idx, 0, key);
		}

		for (let i = 1; i < list.length; i++) {
			expect(list[i]! > list[i - 1]!).toBe(true);
		}
		expect(new Set(list).size).toBe(list.length);
	});
});

describe("rank_validate", () => {
	test("accepts every charset-valid generated key", () => {
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			cursor = rank_between(cursor, null);
			expect(rank_validate(cursor)).toBe(true);
		}
	});

	test("rejects out-of-charset input", () => {
		expect(rank_validate("")).toBe(false);
		expect(rank_validate("HELLO")).toBe(false);
		expect(rank_validate("i0!")).toBe(false);
		expect(rank_validate("i 0")).toBe(false);
	});
});

describe("needs_rebalance", () => {
	test("false for freshly generated keys", () => {
		const ranks: string[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 20; i++) {
			cursor = rank_between(cursor, null);
			ranks.push(cursor);
		}
		expect(needs_rebalance(ranks)).toBe(false);
	});

	test("true once a key exceeds the length heuristic", () => {
		expect(needs_rebalance(["i0", "i0" + "0".repeat(40)])).toBe(true);
	});

	test("false for an empty list", () => {
		expect(needs_rebalance([])).toBe(false);
	});
});
