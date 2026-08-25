/**
 * Unit tests for src/interface-commands.ts's pure helpers — declaration
 * content building, corpus-compatible hashing, and the `check` verb's exit
 * code decision. The filesystem/tsc-touching parts (collecting `.d.ts`
 * files, running `tsc --emitDeclarationOnly`) aren't unit tested here,
 * matching the existing CLI convention (only pure helpers get direct unit
 * coverage — see task-progress.test.ts).
 */

import { describe, expect, test } from "bun:test";
import { build_interface_content, compute_local_hash, interface_check_exit_code } from "../../src/interface-commands";

describe("build_interface_content", () => {
	test("normalizes declaration files under the given package name as the title", () => {
		const content = build_interface_content([{ path: "index.d.ts", content: "export type A = string;" }], "my-pkg");

		expect(content.title).toBe("my-pkg");
		expect(content.html).toContain("export type A = string;");
	});
});

describe("compute_local_hash — must match the server's corpus content_hash", () => {
	test("is deterministic for the same content", async () => {
		const content = { title: "my-pkg", html: "export type A = string;" };

		const first = await compute_local_hash(content);
		const second = await compute_local_hash(content);

		expect(first).toBe(second);
	});

	test("differs when the content differs", async () => {
		const a = await compute_local_hash({ title: "my-pkg", html: "export type A = string;" });
		const b = await compute_local_hash({ title: "my-pkg", html: "export type A = number;" });

		expect(a).not.toBe(b);
	});
});

describe("interface_check_exit_code — the `check` verb's pass/fail decision", () => {
	test("exits 0 when the local hash matches the approved hash", () => {
		expect(interface_check_exit_code("abc123", "abc123")).toBe(0);
	});

	test("exits 1 when the local hash drifts from the approved hash", () => {
		expect(interface_check_exit_code("abc123", "def456")).toBe(1);
	});

	test("exits 1 when there is no approved base at all", () => {
		expect(interface_check_exit_code("abc123", null)).toBe(1);
	});
});
