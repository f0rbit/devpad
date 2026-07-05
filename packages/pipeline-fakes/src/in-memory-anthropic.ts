import { ok, type Result } from "@f0rbit/corpus";
import type {
	AnthropicError,
	AnthropicProvider,
	CreateMessagesInput,
	CreateMessagesOutput,
} from "./anthropic-provider.ts";

const make_id = (): string => `msg_${crypto.randomUUID().slice(0, 12)}`;

const count_tokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

const echo_reply = (input: CreateMessagesInput): string => {
	const last_user = [...input.messages].reverse().find((m) => m.role === "user");
	if (!last_user) return "[echo: no user message]";
	return `echo:${last_user.content}`;
};

export type AnthropicCall = {
	input: CreateMessagesInput;
	output: CreateMessagesOutput;
	at: string;
};

export class InMemoryAnthropicProvider implements AnthropicProvider {
	readonly calls: AnthropicCall[] = [];

	readonly messages = {
		create: async (input: CreateMessagesInput): Promise<Result<CreateMessagesOutput, AnthropicError>> => {
			const reply = echo_reply(input);
			const input_tokens =
				input.messages.reduce((acc, m) => acc + count_tokens(m.content), 0) + count_tokens(input.system ?? "");
			const output_tokens = count_tokens(reply);
			const output: CreateMessagesOutput = {
				id: make_id(),
				model: input.model,
				role: "assistant",
				content: reply,
				stop_reason: input.max_tokens && output_tokens >= input.max_tokens ? "max_tokens" : "end_turn",
				usage: { input_tokens, output_tokens },
			};
			this.calls.push({ input, output, at: new Date().toISOString() });
			return ok(output);
		},
	};
}
