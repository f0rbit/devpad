import { describe, expect, test } from "bun:test";
import { InMemoryAnthropicProvider } from "../src/in-memory-anthropic";

describe("InMemoryAnthropicProvider", () => {
	test("echoes the last user message and records the call", async () => {
		const anthropic = new InMemoryAnthropicProvider();

		const reply = await anthropic.messages.create({
			model: "claude-opus-4-7",
			messages: [
				{ role: "user", content: "ping" },
				{ role: "assistant", content: "irrelevant" },
				{ role: "user", content: "deploy onebox" },
			],
		});
		if (!reply.ok) throw new Error(reply.error.message);

		expect(reply.value.content).toBe("echo:deploy onebox");
		expect(reply.value.role).toBe("assistant");
		expect(reply.value.stop_reason).toBe("end_turn");
		expect(anthropic.calls).toHaveLength(1);
		expect(anthropic.calls[0].output.content).toBe("echo:deploy onebox");
	});

	test("returns stop_reason 'max_tokens' when output_tokens hits the cap", async () => {
		const anthropic = new InMemoryAnthropicProvider();
		const reply = await anthropic.messages.create({
			model: "claude-opus-4-7",
			max_tokens: 1,
			messages: [{ role: "user", content: "longer message that produces many tokens" }],
		});
		if (!reply.ok) throw new Error(reply.error.message);
		expect(reply.value.stop_reason).toBe("max_tokens");
	});

	test("usage counts include system prompt tokens", async () => {
		const anthropic = new InMemoryAnthropicProvider();
		const reply = await anthropic.messages.create({
			model: "claude-opus-4-7",
			system: "a very long system prompt that adds tokens",
			messages: [{ role: "user", content: "hi" }],
		});
		if (!reply.ok) throw new Error(reply.error.message);
		expect(reply.value.usage.input_tokens).toBeGreaterThan(5);
	});
});
