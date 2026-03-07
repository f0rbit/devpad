import { describe, expect, test } from "bun:test";
import { initialState, isCircuitOpen, type RateLimitState, shouldFetch, updateOnFailure, updateOnSuccess } from "../rate-limits";

describe("rate-limits", () => {
	describe("initialState", () => {
		test("returns default state with all nulls and zero failures", () => {
			const state = initialState();
			expect(state.remaining).toBeNull();
			expect(state.limit_total).toBeNull();
			expect(state.reset_at).toBeNull();
			expect(state.consecutive_failures).toBe(0);
			expect(state.last_failure_at).toBeNull();
			expect(state.circuit_open_until).toBeNull();
		});
	});

	describe("isCircuitOpen", () => {
		test("returns false when circuit_open_until is null", () => {
			const state = initialState();
			expect(isCircuitOpen(state)).toBe(false);
		});

		test("returns true when circuit_open_until is in the future", () => {
			const state: RateLimitState = {
				...initialState(),
				circuit_open_until: new Date(Date.now() + 60_000),
			};
			expect(isCircuitOpen(state)).toBe(true);
		});

		test("returns false when circuit_open_until is in the past", () => {
			const state: RateLimitState = {
				...initialState(),
				circuit_open_until: new Date(Date.now() - 1000),
			};
			expect(isCircuitOpen(state)).toBe(false);
		});

		test("returns false when circuit_open_until is exactly now (boundary)", () => {
			const now = new Date();
			const state: RateLimitState = {
				...initialState(),
				circuit_open_until: now,
			};
			expect(isCircuitOpen(state)).toBe(false);
		});
	});

	describe("shouldFetch", () => {
		test("returns true for initial state", () => {
			expect(shouldFetch(initialState())).toBe(true);
		});

		test("returns false when circuit is open", () => {
			const state: RateLimitState = {
				...initialState(),
				circuit_open_until: new Date(Date.now() + 60_000),
			};
			expect(shouldFetch(state)).toBe(false);
		});

		test("returns true when circuit was open but has expired", () => {
			const state: RateLimitState = {
				...initialState(),
				circuit_open_until: new Date(Date.now() - 1000),
			};
			expect(shouldFetch(state)).toBe(true);
		});

		test("returns false when rate limited (remaining = 0 and reset in future)", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				reset_at: new Date(Date.now() + 60_000),
			};
			expect(shouldFetch(state)).toBe(false);
		});

		test("returns true when remaining is 0 but reset is in the past", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				reset_at: new Date(Date.now() - 1000),
			};
			expect(shouldFetch(state)).toBe(true);
		});

		test("returns true when remaining is 0 but reset_at is null", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				reset_at: null,
			};
			expect(shouldFetch(state)).toBe(true);
		});

		test("returns true when remaining is null", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: null,
				reset_at: new Date(Date.now() + 60_000),
			};
			expect(shouldFetch(state)).toBe(true);
		});

		test("returns true when remaining > 0", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 10,
				reset_at: new Date(Date.now() + 60_000),
			};
			expect(shouldFetch(state)).toBe(true);
		});
	});

	describe("updateOnSuccess", () => {
		test("resets failures and clears circuit", () => {
			const state: RateLimitState = {
				...initialState(),
				consecutive_failures: 5,
				last_failure_at: new Date(),
				circuit_open_until: new Date(Date.now() + 60_000),
			};
			const headers = new Headers();
			const result = updateOnSuccess(state, headers);
			expect(result.consecutive_failures).toBe(0);
			expect(result.last_failure_at).toBeNull();
			expect(result.circuit_open_until).toBeNull();
		});

		test("parses X-RateLimit-Remaining header", () => {
			const headers = new Headers({ "X-RateLimit-Remaining": "42" });
			const result = updateOnSuccess(initialState(), headers);
			expect(result.remaining).toBe(42);
		});

		test("parses X-RateLimit-Limit header", () => {
			const headers = new Headers({ "X-RateLimit-Limit": "100" });
			const result = updateOnSuccess(initialState(), headers);
			expect(result.limit_total).toBe(100);
		});

		test("parses X-RateLimit-Reset header as unix timestamp", () => {
			const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
			const headers = new Headers({ "X-RateLimit-Reset": String(resetTimestamp) });
			const result = updateOnSuccess(initialState(), headers);
			expect(result.reset_at).not.toBeNull();
			expect(result.reset_at!.getTime()).toBe(resetTimestamp * 1000);
		});

		test("returns null for missing headers", () => {
			const headers = new Headers();
			const result = updateOnSuccess(initialState(), headers);
			expect(result.remaining).toBeNull();
			expect(result.limit_total).toBeNull();
			expect(result.reset_at).toBeNull();
		});

		test("returns null for non-numeric header values", () => {
			const headers = new Headers({
				"X-RateLimit-Remaining": "abc",
				"X-RateLimit-Limit": "xyz",
				"X-RateLimit-Reset": "not-a-number",
			});
			const result = updateOnSuccess(initialState(), headers);
			expect(result.remaining).toBeNull();
			expect(result.limit_total).toBeNull();
			expect(result.reset_at).toBeNull();
		});
	});

	describe("updateOnFailure", () => {
		test("increments consecutive failures", () => {
			const state = initialState();
			const result = updateOnFailure(state);
			expect(result.consecutive_failures).toBe(1);
		});

		test("sets last_failure_at to current time", () => {
			const before = Date.now();
			const result = updateOnFailure(initialState());
			const after = Date.now();
			expect(result.last_failure_at).not.toBeNull();
			expect(result.last_failure_at!.getTime()).toBeGreaterThanOrEqual(before);
			expect(result.last_failure_at!.getTime()).toBeLessThanOrEqual(after);
		});

		test("does not open circuit below threshold (< 3 failures)", () => {
			let state = initialState();
			state = updateOnFailure(state);
			expect(state.consecutive_failures).toBe(1);
			expect(state.circuit_open_until).toBeNull();

			state = updateOnFailure(state);
			expect(state.consecutive_failures).toBe(2);
			expect(state.circuit_open_until).toBeNull();
		});

		test("opens circuit at exactly 3 failures (threshold)", () => {
			let state = initialState();
			state = updateOnFailure(state);
			state = updateOnFailure(state);
			state = updateOnFailure(state);
			expect(state.consecutive_failures).toBe(3);
			expect(state.circuit_open_until).not.toBeNull();
			const expected_open_until = Date.now() + 5 * 60 * 1000;
			expect(state.circuit_open_until!.getTime()).toBeGreaterThan(expected_open_until - 1000);
			expect(state.circuit_open_until!.getTime()).toBeLessThanOrEqual(expected_open_until + 1000);
		});

		test("keeps circuit open for additional failures beyond threshold", () => {
			let state = initialState();
			for (let i = 0; i < 5; i++) {
				state = updateOnFailure(state);
			}
			expect(state.consecutive_failures).toBe(5);
			expect(state.circuit_open_until).not.toBeNull();
		});

		test("sets remaining to 0 when retryAfter is provided", () => {
			const state: RateLimitState = { ...initialState(), remaining: 10 };
			const result = updateOnFailure(state, 120);
			expect(result.remaining).toBe(0);
		});

		test("preserves existing remaining when retryAfter is not provided", () => {
			const state: RateLimitState = { ...initialState(), remaining: 10 };
			const result = updateOnFailure(state);
			expect(result.remaining).toBe(10);
		});

		test("sets reset_at based on retryAfter seconds", () => {
			const before = Date.now();
			const result = updateOnFailure(initialState(), 120);
			const after = Date.now();
			expect(result.reset_at).not.toBeNull();
			expect(result.reset_at!.getTime()).toBeGreaterThanOrEqual(before + 120_000);
			expect(result.reset_at!.getTime()).toBeLessThanOrEqual(after + 120_000);
		});

		test("preserves existing reset_at when retryAfter is not provided", () => {
			const existing_reset = new Date(Date.now() + 30_000);
			const state: RateLimitState = { ...initialState(), reset_at: existing_reset };
			const result = updateOnFailure(state);
			expect(result.reset_at).toBe(existing_reset);
		});
	});

	describe("circuit breaker lifecycle", () => {
		test("circuit opens after threshold failures then closes after duration", () => {
			let state = initialState();
			state = updateOnFailure(state);
			state = updateOnFailure(state);
			state = updateOnFailure(state);

			expect(isCircuitOpen(state)).toBe(true);
			expect(shouldFetch(state)).toBe(false);

			state = {
				...state,
				circuit_open_until: new Date(Date.now() - 1),
			};

			expect(isCircuitOpen(state)).toBe(false);
			expect(shouldFetch(state)).toBe(true);
		});

		test("success after circuit closes resets state completely", () => {
			let state = initialState();
			state = updateOnFailure(state);
			state = updateOnFailure(state);
			state = updateOnFailure(state);

			state = {
				...state,
				circuit_open_until: new Date(Date.now() - 1),
			};

			const headers = new Headers({ "X-RateLimit-Remaining": "99" });
			state = updateOnSuccess(state, headers);

			expect(state.consecutive_failures).toBe(0);
			expect(state.circuit_open_until).toBeNull();
			expect(state.last_failure_at).toBeNull();
			expect(state.remaining).toBe(99);
		});
	});
});
