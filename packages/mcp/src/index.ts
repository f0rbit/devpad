#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient, tools as sharedTools, getTool } from "@devpad/api";
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

	constructor() {
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

		const apiKey = process.env.DEVPAD_API_KEY;
		const baseUrl = process.env.DEVPAD_BASE_URL || "https://devpad.tools/api/v0";

		if (!apiKey) {
			console.error("DEVPAD_API_KEY environment variable is required");
			process.exit(1);
		}

		this.apiClient = new ApiClient({
			api_key: apiKey,
			base_url: baseUrl,
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
				const result = await tool.execute(this.apiClient, input);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [
						{
							type: "text",
							text: `Error: ${errorMessage}`,
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
}

async function main() {
	assertObjectRootSchema(tools);
	const server = new DevpadMCPServer();
	await server.run();
}

// Check if this file is being run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
	main().catch(error => {
		console.error("Server error:", error);
		process.exit(1);
	});
}
