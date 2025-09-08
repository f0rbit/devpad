/**
 * MCP Test Client for integration testing
 * Spawns the MCP server as a subprocess and communicates via JSON-RPC
 */

import { spawn, type Subprocess } from "bun";
import { log } from "./test-utils";

export class MCPTestClient {
	private process: Subprocess | null = null;
	private messageId = 1;
	private responseBuffer = "";
	private pendingResponses = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();

	/**
	 * Start the MCP server with given configuration
	 */
	async start(apiKey: string, baseUrl?: string): Promise<void> {
		log("Starting MCP server subprocess...");

		this.process = spawn({
			cmd: ["node", "packages/mcp/dist/index.js"],
			env: {
				...process.env,
				DEVPAD_API_KEY: apiKey,
				DEVPAD_BASE_URL: baseUrl || "http://localhost:3001/api/v0",
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		// Set up stdout reader
		this.setupResponseReader();

		// Wait for server to be ready
		await this.waitForReady();
		log("MCP server started and ready");
	}

	/**
	 * Set up continuous reading of stdout for responses
	 */
	private async setupResponseReader() {
		if (!this.process?.stdout) return;

		const stdout = this.process.stdout as ReadableStream<Uint8Array>;
		const reader = stdout.getReader();
		const decoder = new TextDecoder();

		// Continuously read from stdout
		(async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const text = decoder.decode(value, { stream: true });
					this.responseBuffer += text;

					// Process complete JSON-RPC messages
					this.processResponseBuffer();
				}
			} catch (error) {
				log(`Error reading MCP stdout: ${error}`);
			}
		})();
	}

	/**
	 * Process accumulated response buffer for complete JSON-RPC messages
	 */
	private processResponseBuffer() {
		const lines = this.responseBuffer.split("\n");
		this.responseBuffer = lines.pop() || ""; // Keep incomplete line in buffer

		for (const line of lines) {
			if (!line.trim()) continue;

			try {
				const response = JSON.parse(line);

				// Handle response with ID (response to our request)
				if (response.id !== undefined) {
					const pending = this.pendingResponses.get(response.id);
					if (pending) {
						this.pendingResponses.delete(response.id);
						if (response.error) {
							pending.reject(response.error);
						} else {
							pending.resolve(response);
						}
					}
				}
			} catch (error) {
				// Not valid JSON, ignore
			}
		}
	}

	/**
	 * Wait for server to be ready by sending an initialize request
	 */
	private async waitForReady(): Promise<void> {
		const initResponse = await this.sendRequest("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "mcp-test-client",
				version: "1.0.0",
			},
		});

		if (!initResponse.result) {
			throw new Error("Failed to initialize MCP server");
		}

		// Send initialized notification
		await this.sendNotification("notifications/initialized", {});
	}

	/**
	 * Send a JSON-RPC request and wait for response
	 */
	async sendRequest(method: string, params?: any): Promise<any> {
		if (!this.process?.stdin) {
			throw new Error("MCP server not started");
		}

		const id = this.messageId++;
		const request = {
			jsonrpc: "2.0",
			method,
			params: params || {},
			id,
		};

		// Create promise for response
		const responsePromise = new Promise((resolve, reject) => {
			this.pendingResponses.set(id, { resolve, reject });

			// Timeout after 5 seconds
			setTimeout(() => {
				if (this.pendingResponses.has(id)) {
					this.pendingResponses.delete(id);
					reject(new Error(`Request timeout for method: ${method}`));
				}
			}, 5000);
		});

		// Send request using Bun's simpler stdin write method
		const stdinWriter = this.process.stdin as any;
		await stdinWriter.write(JSON.stringify(request) + "\n");

		return responsePromise;
	}

	/**
	 * Send a JSON-RPC notification (no response expected)
	 */
	async sendNotification(method: string, params?: any): Promise<void> {
		if (!this.process?.stdin) {
			throw new Error("MCP server not started");
		}

		const notification = {
			jsonrpc: "2.0",
			method,
			params: params || {},
		};

		// Send notification using Bun's simpler stdin write method
		const stdinWriter = this.process.stdin as any;
		await stdinWriter.write(JSON.stringify(notification) + "\n");
	}

	/**
	 * Call a tool and get the result
	 */
	async callTool(toolName: string, args: any): Promise<any> {
		return this.sendRequest("tools/call", {
			name: toolName,
			arguments: args,
		});
	}

	/**
	 * List available tools
	 */
	async listTools(): Promise<any> {
		return this.sendRequest("tools/list");
	}

	/**
	 * Stop the MCP server
	 */
	async stop(): Promise<void> {
		if (this.process) {
			log("Stopping MCP server...");
			this.process.kill();
			await this.process.exited;
			this.process = null;
			log("MCP server stopped");
		}
	}
}
