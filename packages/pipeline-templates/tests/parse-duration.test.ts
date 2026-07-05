import { describe, expect, test } from "bun:test";
import { parse_duration } from "../src/index";

const unwrap_ok = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!r.ok) throw new Error(`expected ok, got err: ${JSON.stringify(r.error)}`);
	return r.value;
};

describe("parse_duration", () => {
	test.each([
		["0", 0],
		["500ms", 500],
		["30s", 30_000],
		["30m", 30 * 60_000],
		["1h", 60 * 60_000],
		["2h", 120 * 60_000],
		["1d", 86_400_000],
		["1.5h", Math.round(1.5 * 3_600_000)],
	])("parses %s correctly", (input, expected) => {
		expect(unwrap_ok(parse_duration(input)).ms).toBe(expected);
	});

	test("bare number → milliseconds", () => {
		expect(unwrap_ok(parse_duration("123")).ms).toBe(123);
	});

	test("invalid input returns err(duration_parse)", () => {
		const r = parse_duration("hello");
		if (r.ok) throw new Error("expected err");
		expect(r.error.code).toBe("duration_parse");
		expect(r.error.input).toBe("hello");
	});

	test("empty string returns err(duration_parse)", () => {
		const r = parse_duration("");
		expect(r.ok).toBe(false);
	});
});
