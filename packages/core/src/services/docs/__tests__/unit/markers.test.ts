import { describe, expect, test } from "bun:test";
import type { ThreadMarker } from "@devpad/schema/validation";
import {
	begin_comment,
	embed_marker,
	markers_to_marks,
	parse_markers,
	replace_marker,
	strip_markers,
} from "../../markers.js";

function make_marker(overrides: Partial<ThreadMarker> = {}): ThreadMarker {
	return {
		id: "thread_1",
		anchor: { quote: "world", prefix: "Hello ", suffix: ", this", start: 6, end: 11 },
		status: "open",
		blocking: false,
		entries: [{ author: "tom", channel: "user", body: "nice point", at: "2024-01-01T00:00:00.000Z" }],
		...overrides,
	};
}

describe("markers — parse/embed round-trip (task A4.2)", () => {
	test("embed then strip recovers the exact original content, byte-for-byte", () => {
		const html = "<p>Hello world, this is a test.</p>";
		const marker = make_marker();

		const embedded = embed_marker(html, marker, { start: marker.anchor.start, end: marker.anchor.end });
		const { stripped } = strip_markers(embedded);

		expect(stripped).toBe(html);
	});

	test("parse recovers the exact marker JSON that was embedded", () => {
		const html = "<p>Hello world, this is a test.</p>";
		const marker = make_marker();
		const embedded = embed_marker(html, marker, { start: marker.anchor.start, end: marker.anchor.end });

		const { threads, orphans } = parse_markers(embedded);

		expect(orphans).toHaveLength(0);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.marker).toEqual(marker);
	});

	test("an unpaired begin marker parses as a typed orphan, never a crash", () => {
		const marker = make_marker({ id: "thread_2" });
		const dangling = begin_comment(marker) + "<p>some text with no matching end</p>";

		const { threads, orphans } = parse_markers(dangling);

		expect(threads).toHaveLength(0);
		expect(orphans).toHaveLength(1);
		expect(orphans[0]?.reason).toBe("unpaired_begin");
		expect(orphans[0]?.marker?.id).toBe("thread_2");
	});

	test("a marker-shaped comment with invalid JSON payload parses as malformed, never crashes or executes", () => {
		const bad_payload = Buffer.from("{not valid json", "utf-8").toString("base64");
		const hostile = `<!-- devpad:thread:begin thread_evil ${bad_payload} --><!-- devpad:thread:end thread_evil -->`;

		const { threads, orphans } = parse_markers(hostile);

		expect(threads).toHaveLength(0);
		expect(orphans).toHaveLength(1);
		expect(orphans[0]?.reason).toBe("malformed");
		expect(orphans[0]?.marker).toBeNull();
	});

	test("a marker-shaped comment with a hostile JSON payload (schema-invalid) is rejected, never trusted", () => {
		const hostile_json = JSON.stringify({ id: "thread_evil", not_a_valid_marker_field: "<script>alert(1)</script>" });
		const payload = Buffer.from(hostile_json, "utf-8").toString("base64");
		const hostile = `<!-- devpad:thread:begin thread_evil ${payload} --><!-- devpad:thread:end thread_evil -->`;

		const { threads, orphans } = parse_markers(hostile);

		expect(threads).toHaveLength(0);
		expect(orphans).toHaveLength(1);
		expect(orphans[0]?.reason).toBe("malformed");
	});

	test("replace_marker swaps the JSON payload in place without moving the bracketed content", () => {
		const html = "<p>Hello world, this is a test.</p>";
		const marker = make_marker();
		const embedded = embed_marker(html, marker, { start: marker.anchor.start, end: marker.anchor.end });

		const updated = { ...marker, status: "resolved" as const };
		const replaced = replace_marker(embedded, marker.id, updated);

		expect(replaced).not.toBeNull();
		if (!replaced) return;
		const { stripped } = strip_markers(replaced);
		expect(stripped).toBe(html);
		const { threads } = parse_markers(replaced);
		expect(threads[0]?.marker.status).toBe("resolved");
	});

	test("replace_marker returns null for an unknown thread id", () => {
		const html = "<p>plain</p>";
		expect(replace_marker(html, "thread_missing", make_marker())).toBeNull();
	});
});

describe("markers_to_marks — render-route anchor connection (B3 fast-follow #4)", () => {
	test("wraps a paired thread's bracketed content in <mark data-thread-id>, dropping the comment syntax", () => {
		const html = "<p>Hello world, this is a test.</p>";
		// Raw-HTML offsets (include the leading "<p>"): "world" spans [9, 14).
		const marker = make_marker({ anchor: { quote: "world", prefix: "Hello ", suffix: ", this", start: 9, end: 14 } });
		const embedded = embed_marker(html, marker, { start: 9, end: 14 });

		const marked = markers_to_marks(embedded);

		expect(marked).toBe(`<p>Hello <mark data-thread-id="thread_1">world</mark>, this is a test.</p>`);
	});

	test("two non-overlapping threads both get wrapped, independent of processing order", () => {
		const html = "<p>Hello world, this is a test.</p>";
		// Raw-HTML offsets: "Hello" spans [3, 8), "test" spans [26, 30).
		const first = make_marker({
			id: "thread_1",
			anchor: { quote: "Hello", prefix: "<p>", suffix: " world", start: 3, end: 8 },
		});
		const second = make_marker({
			id: "thread_2",
			anchor: { quote: "test", prefix: "a ", suffix: ".</p>", start: 26, end: 30 },
		});

		const step1 = embed_marker(html, first, { start: 3, end: 8 });
		const step2 = embed_marker(step1, second, { start: 26, end: 30 });

		const marked = markers_to_marks(step2);

		expect(marked).toBe(
			`<p><mark data-thread-id="thread_1">Hello</mark> world, this is a <mark data-thread-id="thread_2">test</mark>.</p>`,
		);
	});

	test("an unpaired (orphan) marker has no target range to wrap — it's stripped, same as strip_markers", () => {
		const marker = make_marker({ id: "thread_orphan" });
		const dangling = begin_comment(marker) + "<p>some text with no matching end</p>";

		expect(markers_to_marks(dangling)).toBe(strip_markers(dangling).stripped);
	});
});
