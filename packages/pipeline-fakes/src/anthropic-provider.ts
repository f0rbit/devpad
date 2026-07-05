import type { Result } from "@f0rbit/corpus";

export type AnthropicError =
	| { code: "rate_limited"; message: string; retry_after_ms?: number }
	| { code: "validation"; message: string }
	| { code: "unauthorized"; message: string }
	| { code: "internal"; message: string };

export type AnthropicMessage = {
	role: "user" | "assistant";
	content: string;
};

export type CreateMessagesInput = {
	model: string;
	system?: string;
	messages: AnthropicMessage[];
	max_tokens?: number;
	temperature?: number;
};

export type CreateMessagesOutput = {
	id: string;
	model: string;
	role: "assistant";
	content: string;
	stop_reason: "end_turn" | "max_tokens";
	usage: { input_tokens: number; output_tokens: number };
};

/**
 * Minimal subset of the Anthropic Messages API used by the analysis evaluator stub
 * and the vault adapter. The production provider wraps the official SDK; the in-memory
 * provider records calls for assertions.
 */
export type AnthropicProvider = {
	messages: {
		create(input: CreateMessagesInput): Promise<Result<CreateMessagesOutput, AnthropicError>>;
	};
};
