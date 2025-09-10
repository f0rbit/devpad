/**
 * MCP Test Client for integration testing
 * Uses in-memory interface for fast, reliable testing
 */

import { log } from "./test-utils";
import { DevpadMCPServer } from "@devpad/mcp/src/index";

export class MCPTestClient {
	private server: DevpadMCPServer | null = null;
	private next_id = 1;

	/**
	 * Start the MCP server with given configuration
	 * @param apiKey API key for authentication
	 * @param baseUrl Base URL for the API
	 */
	async start(apiKey: string, baseUrl?: string): Promise<void> {
		log("Starting MCP server in-memory...");

		this.server = new DevpadMCPServer(apiKey, baseUrl);

		log("MCP server started in-memory");
	}

	/**
	 * Send a JSON-RPC request and wait for response
	 */
	async sendRequest(method: string, params?: any): Promise<any> {
		if (!this.server) {
			throw new Error("MCP server not started");
		}

		const id = this.next_id++;
		const request = {
			jsonrpc: "2.0",
			id,
			method,
			params: params || {},
		};

		// Process request directly through in-memory interface
		const response = await this.server.processRequest(request);

		// Handle errors
		if (response.error) {
			throw new Error(`MCP Error: ${response.error.message}`);
		}

		return response;
	}

	/**
	 * Call a tool and get the result
	 */
	async callTool(tool_name: string, args: any): Promise<any> {
		const response = await this.sendRequest("tools/call", {
			name: tool_name,
			arguments: args,
		});
		return response;
	}

	/**
	 * List available tools
	 */
	async listTools(): Promise<any> {
		const response = await this.sendRequest("tools/list");
		return response;
	}

	/**
	 * Stop the MCP server
	 */
	async stop(): Promise<void> {
		if (this.server) {
			log("Stopping MCP server...");
			this.server = null;
			log("MCP server stopped");
		}
	}
}
