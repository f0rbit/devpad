/**
 * Fractional-indexing rank keys (task A1.2, option A1 in the v2.4 plan).
 *
 * Lives in `@devpad/schema` (not `@devpad/core`) so both the server
 * (graph service reparents/rebalances) and the browser (the outline's
 * quick-add appends a new sibling after the last existing one, tab/shift-tab
 * reparent computes its own insertion point) share one implementation —
 * `packages/core/src/services/graph/rank.ts` re-exports this module rather
 * than duplicating it (task B1.2's grounding surfaced quick-add's
 * empty-rank collision bug; see the outline's `mutations.ts`).
 *
 * Ported from the algorithm in rocicorp/fractional-indexing (CC0), which
 * itself implements https://observablehq.com/@dgreensp/implementing-fractional-indexing.
 * We hand-roll this (instead of taking the npm dependency) so the key
 * alphabet, validation, and rebalance heuristic are ours to own and test —
 * see the plan's "Open choice A" for the full rationale.
 *
 * Keys are "self-headed": the same base-36 alphabet supplies both the digit
 * values AND the integer-part length markers (the reference algorithm calls
 * this passing `digits` without a separate `intDigits`). Base 36 has an even
 * length (36), which self-heading requires. The first half of the alphabet
 * ('0'..'h') are negative-length heads, the second half ('i'..'z') positive —
 * so `rank_between(null, null)` returns the shortest positive key, "i0".
 *
 * A key is never hand-typed; it only ever comes from `rank_between`, so the
 * validator (`rank_validate`) only needs to guard the charset, not the full
 * self-headed grammar the generator itself enforces internally.
 */

const BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = BASE36_DIGITS.length; // 36, must stay even (self-heading requires it)
const HALF = BASE / 2;
const ZERO = BASE36_DIGITS.charAt(0);
const LAST_DIGIT = BASE36_DIGITS.charAt(BASE - 1);

const RANK_PATTERN = /^[0-9a-z]+$/;

/** Zod refinement source: charset-only validity check for a stored rank. */
export const rank_validate = (value: string): boolean => RANK_PATTERN.test(value);

/**
 * Length heuristic the A2 sweeper uses to decide whether a sibling set needs
 * rebalancing. Adversarial "always insert at the same boundary" patterns grow
 * keys roughly one char per insert; this is a generous ceiling before that
 * becomes a real storage/comparison cost.
 */
const REBALANCE_LENGTH_THRESHOLD = 30;
export const needs_rebalance = (ranks: string[]): boolean => ranks.some((r) => r.length > REBALANCE_LENGTH_THRESHOLD);

const digit_value = (c: string): number => {
	const v = BASE36_DIGITS.indexOf(c);
	if (v < 0) throw new Error(`rank: invalid digit '${c}'`);
	return v;
};
const digit_char = (v: number): string => {
	if (v < 0 || v >= BASE) throw new Error(`rank: digit value out of range: ${String(v)}`);
	return BASE36_DIGITS.charAt(v);
};

/** Fractional part between `a` and `b` (both already integer-part-stripped). */
function midpoint(a: string, b: string | null): string {
	if (b != null && a >= b) throw new Error(`rank: invalid bounds '${a}' >= '${b}'`);
	if (a.slice(-1) === ZERO || b?.slice(-1) === ZERO) throw new Error("rank: trailing zero digit");

	if (b) {
		let n = 0;
		while ((a[n] ?? ZERO) === b[n]) n++;
		if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
	}

	const digit_a = a ? digit_value(a.charAt(0)) : 0;
	const digit_b = b != null ? digit_value(b.charAt(0)) : BASE;

	if (digit_b - digit_a > 1) return digit_char(Math.round(0.5 * (digit_a + digit_b)));
	if (b && b.length > 1) return b.slice(0, 1);
	return digit_char(digit_a) + midpoint(a.slice(1), null);
}

function integer_length(head: string): number {
	const i = digit_value(head);
	return i < HALF ? HALF - i + 1 : i - HALF + 2;
}

function integer_part(key: string): string {
	if (key.length === 0) throw new Error("rank: empty order key");
	const head = key.charAt(0);
	const len = integer_length(head);
	if (len > key.length) throw new Error(`rank: invalid order key: ${key}`);
	return key.slice(0, len);
}

const SMALLEST_INTEGER = BASE36_DIGITS[0] + ZERO.repeat(HALF);
const is_smallest_integer = (int_part: string): boolean => int_part === SMALLEST_INTEGER;

function increment_integer(x: string): string | null {
	const head = x.charAt(0);
	let trailing = "";
	for (let i = x.length - 1; i >= 1; i--) {
		const d = digit_value(x.charAt(i)) + 1;
		if (d === BASE) trailing = ZERO + trailing;
		else return head + x.slice(1, i) + digit_char(d) + trailing;
	}
	const head_index = digit_value(head);
	if (head_index === BASE - 1) return null; // largest possible integer already
	const new_head = digit_char(head_index + 1);
	const length_delta = integer_length(new_head) - integer_length(head);
	return new_head + (length_delta > 0 ? trailing + ZERO : length_delta < 0 ? trailing.slice(1) : trailing);
}

function decrement_integer(x: string): string | null {
	const head = x.charAt(0);
	let trailing = "";
	for (let i = x.length - 1; i >= 1; i--) {
		const d = digit_value(x.charAt(i)) - 1;
		if (d === -1) trailing = LAST_DIGIT + trailing;
		else return head + x.slice(1, i) + digit_char(d) + trailing;
	}
	const head_index = digit_value(head);
	if (head_index === 0) return null; // smallest possible integer already
	const new_head = digit_char(head_index - 1);
	const length_delta = integer_length(new_head) - integer_length(head);
	return new_head + (length_delta > 0 ? trailing + LAST_DIGIT : length_delta < 0 ? trailing.slice(1) : trailing);
}

/**
 * Generates a rank key that sorts strictly between `a` and `b`.
 *
 * `a` is the lower-neighbor rank (or null for "insert at the very start"),
 * `b` the upper-neighbor rank (or null for "insert at the very end"). Both
 * null means "first key ever". Legacy rows default `rank` to `""` rather
 * than a real key (schema default, task A1.1) — `""` is treated exactly like
 * `null` here so pre-migration rows behave as "no rank yet".
 *
 * Throws on caller bugs (`a` not strictly less than `b`) — this is a pure
 * function with no I/O, so callers wrap it at the Result boundary rather
 * than this module returning `Result` itself (matches the plan's signature).
 */
export function rank_between(a: string | null, b: string | null): string {
	let lo = a === "" ? null : a;
	let hi = b === "" ? null : b;
	if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
	if (lo != null && hi != null && lo === hi) throw new Error(`rank: invalid bounds '${lo}' === '${hi}'`);

	if (lo == null) {
		if (hi == null) return BASE36_DIGITS.charAt(HALF) + ZERO; // shortest positive head: "i0"

		const ib = integer_part(hi);
		const fb = hi.slice(ib.length);
		if (is_smallest_integer(ib)) return ib + midpoint("", fb);
		if (ib < hi) return ib;

		const dec = decrement_integer(ib);
		if (dec == null) throw new Error("rank: cannot decrement any further (at the smallest possible key)");
		return dec;
	}

	if (hi == null) {
		const ia = integer_part(lo);
		const fa = lo.slice(ia.length);
		const inc = increment_integer(ia);
		return inc == null ? ia + midpoint(fa, null) : inc;
	}

	const ia = integer_part(lo);
	const fa = lo.slice(ia.length);
	const ib = integer_part(hi);
	const fb = hi.slice(ib.length);
	if (ia === ib) return ia + midpoint(fa, fb);

	const inc = increment_integer(ia);
	if (inc == null) throw new Error("rank: cannot increment any further (at the largest possible key)");
	if (inc < hi) return inc;
	return ia + midpoint(fa, null);
}
