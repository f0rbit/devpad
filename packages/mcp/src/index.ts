#!/usr/bin/env node

import { ApiClient, getTool, tools as sharedTools } from "@devpad/api";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// Helper to convert Zod schema to JSON Schema for MCP
function zodToMCPSchema(schema: any) {
	try {
		const jsonSchema = zodToJsonSchema(schema, {
			target: "openApi3",
			$refStrategy: "none",
		}) as any;
		// Remove the $schema property that zod-to-json-schema adds
		const { $schema, ...cleanSchema } = jsonSchema;

		if (jsonSchema.type === "object") return jsonSchema;

		// Ensure every tool schema is an object
		return {
			type: "object",
			properties: {
				value: cleanSchema, // wrap non-objects under "value"
			},
			required: [],
		};
	} catch (error) {
		// Fallback for problematic schemas
		return {
			type: "object",
			properties: {},
			additionalProperties: true,
		};
	}
}

function assertObjectRootSchema(tools: any[]) {
	tools.forEach((tool, i) => {
		if (tool.inputSchema.type !== "object") {
			console.error(`! Tool ${i} (${tool.name}) has non-object root type: ${tool.inputSchema.type}`);
		}
	});
	return tools;
}

// Convert shared tools to MCP format
const tools = Object.values(sharedTools).map(tool => ({
	name: tool.name,
	description: tool.description,
	inputSchema: zodToMCPSchema(tool.inputSchema),
}));

class DevpadMCPServer {
	private server: Server;
	private apiClient: ApiClient;

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
			}
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

		this.server.setRequestHandler(CallToolRequestSchema, async request => {
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
	async processRequest(request: any): Promise<any> {
		try {
			let result: any;
			if (request.method === "tools/list") {
				result = { tools };
			} else if (request.method === "tools/call") {
				const { name, arguments: args } = request.params;

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
	main().catch(error => {
		console.error("Server error:", error);
		process.exit(1);
	});
}
