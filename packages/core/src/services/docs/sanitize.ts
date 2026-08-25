/**
 * @module core/services/docs/sanitize
 *
 * v2.4 (task A4.1, gap 7 in architecture-decisions) — sanitize-on-push: the
 * STORED corpus artifact is the safe one, so every consumer (DocViewer,
 * agent `plans pull`, interface-report diffing) gets safe HTML without
 * having to re-sanitize. Pure AST-based sanitization via `hast-util-*`
 * (already vetted, dependency-pinned in the workspace lockfile via
 * astro/remark) — no DOM required, so this runs identically in Cloudflare
 * Workers, bun, and tests.
 *
 * `allowComments: false` means EVERY comment is stripped on a raw push,
 * including a forged `devpad:thread:*` marker an agent tries to smuggle in
 * (adversary checklist). This is deliberate and has a direct consequence for
 * the annotation engine (task A4.2): thread markers are embedded AFTER the
 * last sanitize-on-push, directly into the already-clean head content, and
 * that embed step is NEVER re-run through `sanitize_html` (which would
 * immediately strip the markers it just added). The only untrusted string in
 * a thread mutation is the human-authored entry body, which goes through
 * `sanitize_text` (a plain-text HTML-escape) before being embedded into the
 * marker's JSON — see `markers.ts`.
 *
 * v2.4 (B3, CSS-exfil fix) — the A4 verifier found that `<style>` content
 * round-trips untouched: `@import url("https://evil…")` and any `url(...)`
 * function (background-image, `behavior:`, `-moz-binding:`, `@font-face src`)
 * are all live network-egress vectors an agent-authored doc could smuggle
 * out through — no script execution needed, just the browser fetching a
 * stylesheet/image/font at render time. We chose FILTER over strip-`<style>`
 * or a full CSS-AST sanitizer: `<style>` stays useful for real layout/color
 * CSS (an existing test asserts `.foo { color: red; }` survives), and a
 * regex scrub of `@import` + `url(...)` is proportionate given the DocViewer
 * ALSO gets a CSP + sandboxed-iframe render path (defense in depth — see
 * `packages/worker/src/routes/v1/docs.ts`'s `/render` route) rather than
 * leaning on this being a perfect CSS parser (it isn't; it can't catch e.g.
 * CSS escape obfuscation like `\75rl(...)`, and never needs to).
 */

import { fromHtml } from "hast-util-from-html";
import { type Schema, defaultSchema, sanitize } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";

const schema: Schema = {
	...defaultSchema,
	allowComments: false,
	allowDoctypes: false,
	tagNames: [...(defaultSchema.tagNames ?? []), "style"],
	// script/iframe/object/embed/form are dropped WITH their contents (not
	// merely unwrapped) — `defaultSchema.strip` already drops `script`.
	strip: [...(defaultSchema.strip ?? []), "iframe", "object", "embed", "form"],
	// `defaultSchema.protocols` already excludes `javascript:`/`data:` from
	// `href`/`src` by allowlisting only http/https/mailto/etc — inherited
	// as-is via the spread above.
};

const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const CSS_IMPORT_RE = /@import\b[^;]*;?/gi;
const CSS_URL_RE = /url\([^)]*\)/gi;

/** Strips `@import` at-rules and neutralizes every `url(...)` function (background/behavior/-moz-binding/@font-face src alike) inside `<style>` blocks — the network-egress surface a `<style>` tag otherwise offers. Non-url CSS (colors, layout, fonts-by-keyword) is untouched. */
export function sanitize_css(css: string): string {
	return css.replace(CSS_IMPORT_RE, "").replace(CSS_URL_RE, "url()");
}

/** CSS-only re-scrub for content that must NOT go through the full `sanitize_html` comment-stripping pass (e.g. reconciling already-stored docs that carry live annotation markers). */
export function sanitize_style_blocks(html: string): string {
	return html.replace(
		STYLE_BLOCK_RE,
		(_match, open: string, css: string, close: string) => `${open}${sanitize_css(css)}${close}`,
	);
}

/** Sanitizes agent-authored HTML on ingest (push). The returned string is the artifact every consumer trusts. */
export function sanitize_html(html: string): string {
	const tree = fromHtml(html, { fragment: true });
	const clean = sanitize(tree, schema);
	return sanitize_style_blocks(toHtml(clean));
}

const TEXT_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escapes a plain-text string (e.g. a thread entry body) for safe embedding inside stored HTML. Never treats input as markup. */
export function sanitize_text(text: string): string {
	return text.replace(/[&<>"']/g, (ch) => TEXT_ESCAPES[ch] ?? ch);
}
