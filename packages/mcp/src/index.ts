#!/usr/bin/env node

import { ApiClient, getTool, tools as sharedTools } from "@devpad/api";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

type JsonSchemaObject = Record<string, unknown>;

type MCPTool = {
	name: string;
	description: string;
	inputSchema: JsonSchemaObject;
};

type MCPRequest = {
	jsonrpc?: "2.0";
	id: string | number;
	method: string;
	params?: { name: string; arguments?: Record<string, unknown> };
};

type MCPContentResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type MCPResult = { tools: MCPTool[] } | MCPContentResult;

type MCPResponse = {
	jsonrpc: "2.0";
	id: string | number;
	result: MCPResult;
};

// Helper to convert Zod schema to JSON Schema for MCP.
// `schema` is typed `unknown` (rather than `z.ZodType`) deliberately: annotating
// it as an actual Zod type here makes `zodToJsonSchema`'s call below hit
// "type instantiation is excessively deep" under this repo's zod /
// zod-to-json-schema version pairing (reproduced in isolation, unrelated to
// @devpad/api) — the cast at the call site keeps that structural comparison
// from ever happening while `zodToJsonSchema`'s own declared parameter type
// still governs what's actually passed through.
function zodToMCPSchema(schema: unknown): JsonSchemaObject {
	try {
		const jsonSchema = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
			target: "openApi3",
			$refStrategy: "none",
		}) as JsonSchemaObject;
		// Remove the $schema property that zod-to-json-schema adds
		const { $schema: _, ...cleanSchema } = jsonSchema;

		if (jsonSchema.type === "object") return jsonSchema;

		// Ensure every tool schema is an object
		return {
			type: "object",
			properties: {
				value: cleanSchema, // wrap non-objects under "value"
			},
			required: [],
		};
	} catch {
		// Fallback for problematic schemas
		return {
			type: "object",
			properties: {},
			additionalProperties: true,
		};
	}
}

function assertObjectRootSchema(tools: MCPTool[]): MCPTool[] {
	tools.forEach((tool, i) => {
		if (tool.inputSchema.type !== "object") {
			console.error(`! Tool ${String(i)} (${tool.name}) has non-object root type: ${String(tool.inputSchema.type)}`);
		}
	});
	return tools;
}

// Convert shared tools to MCP format
const tools = Object.values(sharedTools).map((tool) => ({
	name: tool.name,
	description: tool.description,
	inputSchema: zodToMCPSchema(tool.inputSchema),
}));

class DevpadMCPServer {
	private readonly server: Server;
	private readonly apiClient: ApiClient;

	constructor(api_key?: string, base_url?: string) {
		this.server = new Server(
			{
				name: "devpad-mcp-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		// Use provided parameters or fall back to environment variables
		const final_api_key = api_key || process.env.DEVPAD_API_KEY;
		const final_base_url = base_url || process.env.DEVPAD_BASE_URL || "https://devpad.tools/api/v1";

		if (!final_api_key) {
			throw new Error("DEVPAD_API_KEY is required");
		}

		this.apiClient = new ApiClient({
			api_key: final_api_key,
			base_url: final_base_url,
		});

		this.setupHandlers();
	}

	private setupHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools };
		});

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			try {
				const tool = getTool(name);
				if (!tool) {
					throw new Error(`Unknown tool: ${name}`);
				}

				// Parse and validate input
				const input = tool.inputSchema.parse(args);

				// Execute the tool
				const tool_result = await tool.execute(this.apiClient, input);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(tool_result, null, 2),
						},
					],
				};
			} catch (error) {
				const error_message = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [
						{
							type: "text",
							text: `Error: ${error_message}`,
						},
					],
					isError: true,
				};
			}
		});
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error("devpad MCP server running on stdio");
	}

	/**
	 * In-memory interface for testing - processes JSON-RPC requests directly
	 * @param request JSON-RPC request object
	 * @returns JSON-RPC response object
	 */
	async processRequest(request: MCPRequest): Promise<MCPResponse> {
		try {
			let result: MCPResult;
			if (request.method === "tools/list") {
				result = { tools };
			} else if (request.method === "tools/call") {
				const params = request.params;
				if (!params) throw new Error("Missing params for tools/call");
				const { name, arguments: args } = params;

				const tool = getTool(name);
				if (!tool) {
					throw new Error(`Unknown tool: ${name}`);
				}

				// Parse and validate input
				const input = tool.inputSchema.parse(args);

				// Execute the tool
				const tool_result = await tool.execute(this.apiClient, input);

				result = {
					content: [
						{
							type: "text",
							text: JSON.stringify(tool_result, null, 2),
						},
					],
				};
			} else {
				throw new Error(`Unknown method: ${request.method}`);
			}

			return {
				jsonrpc: "2.0",
				id: request.id,
				result,
			};
		} catch (error) {
			const error_message = error instanceof Error ? error.message : "Unknown error";
			return {
				jsonrpc: "2.0",
				id: request.id,
				result: {
					content: [
						{
							type: "text",
							text: `Error: ${error_message}`,
						},
					],
					isError: true,
				},
			};
		}
	}
}

async function main() {
	assertObjectRootSchema(tools);
	const server = new DevpadMCPServer();
	await server.run();
}

// Export the server class for testing
export { DevpadMCPServer };

// Check if this file is being run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
	main().catch((error: unknown) => {
		console.error("Server error:", error);
		process.exit(1);
	});
}
