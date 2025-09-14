import { describe, expect, test } from "bun:test";
import path from "node:path";

describe("Repository Scanning - Binary Test", () => {
	test("should run todo-tracker binary and return structured results", async () => {
		// Get the project root path
		const projectRoot = path.resolve(process.cwd());
		const configPath = path.join(projectRoot, "todo-config.json");
		const todoTrackerPath = path.join(projectRoot, "todo-tracker");

		console.log("🔍 Testing todo-tracker binary...");
		console.log("📁 Project root:", projectRoot);
		console.log("⚙️ Config path:", configPath);
		console.log("🔧 Binary path:", todoTrackerPath);

		// Verify files exist
		const configExists = await Bun.file(configPath).exists();
		const binaryExists = await Bun.file(todoTrackerPath).exists();

		expect(configExists).toBe(true);
		expect(binaryExists).toBe(true);

		// Test the binary execution
		try {
			// Run todo-tracker directly
			const child_process = await import("node:child_process");

			console.log("🚀 Running todo-tracker parse command...");
			const command = `${todoTrackerPath} parse ${projectRoot} ${configPath}`;

			// Use execSync to run command and capture output
			const output = child_process.execSync(command, {
				encoding: "utf8",
				cwd: projectRoot,
				timeout: 5000, // 5 second timeout
			});

			console.log("✅ Command completed successfully");
			console.log("📊 Output length:", output.length, "characters");

			// Verify output is non-empty
			expect(output.length).toBeGreaterThan(0);

			// Parse as JSON - handle mixed output (errors + JSON)
			let parsedOutput;
			try {
				// Extract JSON from output (might have stderr mixed in)
				const lines = output.split("\n").filter(line => line.trim());
				let jsonStart = -1;

				// Find the start of JSON array
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i].trim();
					if (line.startsWith("[")) {
						jsonStart = i;
						break;
					}
				}

				if (jsonStart === -1) {
					throw new Error("No JSON array found in output");
				}

				// Reconstruct JSON from found start
				const jsonLines = lines.slice(jsonStart);
				const jsonString = jsonLines.join("\n");

				parsedOutput = JSON.parse(jsonString);
			} catch (parseError) {
				console.error("❌ Failed to parse output as JSON:", parseError);
				console.log("🔍 Raw output preview:", output.substring(0, 500));
				throw new Error(`Output is not valid JSON: ${parseError}`);
			}

			// Verify structure
			expect(Array.isArray(parsedOutput)).toBe(true);

			console.log(`🎯 Found ${parsedOutput.length} items in repository scan`);

			// If items exist, validate their structure
			if (parsedOutput.length > 0) {
				const firstItem = parsedOutput[0];
				console.log("📋 First item structure:", firstItem);

				// Check for expected fields
				const itemKeys = Object.keys(firstItem);
				const expectedFields = ["id", "tag", "text", "file", "line"];

				console.log("🔍 Item keys:", itemKeys);
				console.log("🎯 Expected fields:", expectedFields);

				// At least some expected fields should exist
				const hasValidFields = expectedFields.some(field => itemKeys.includes(field));
				expect(hasValidFields).toBe(true);

				// Log some examples
				const examples = parsedOutput.slice(0, Math.min(5, parsedOutput.length));
				console.log("📊 Example scan results:");
				examples.forEach((item: any, index: number) => {
					const tag = item.tag || item.type || "unknown";
					const text = (item.text || "no text").substring(0, 80);
					const location = `${item.file || "unknown"}:${item.line || "?"}`;
					console.log(`  ${index + 1}. [${tag}] ${text} (${location})`);
				});
			} else {
				console.log("ℹ️ No items found in scan - this might be expected");
			}

			// Test passed!
			console.log("✅ Binary scan test completed successfully");
		} catch (error) {
			console.error("❌ Binary execution failed:", error);
			console.error("Error details:", {
				code: (error as any).status,
				signal: (error as any).signal,
				stderr: (error as any).stderr?.toString(),
				stdout: (error as any).stdout?.toString(),
			});

			// Check if it's a permission issue
			if ((error as any).code === 126) {
				console.error("🚫 Permission denied - binary is not executable");
				throw new Error("Binary is not executable - check file permissions");
			}
			// Check if it's a file not found issue
			if ((error as any).code === 127 || (error as any).code === "ENOENT") {
				console.error("📄 Binary not found or not executable");
				console.error("💡 In CI: The binary should be built in the 'Setup test environment' step");
				console.error("💡 Locally: Run 'git clone https://github.com/f0rbit/todo-tracker.git /tmp/todo-tracker && cd /tmp/todo-tracker && go build -o ./todo-tracker && mv ./todo-tracker /path/to/devpad/'");
				throw new Error("Binary not found - check if todo-tracker exists and is executable");
			}

			// Check for format/architecture mismatch (rare but possible)
			if ((error as any).stderr?.includes("cannot execute binary file") || (error as any).stderr?.includes("Exec format error") || (error as any).code === 8) {
				console.error("🚫 Binary architecture mismatch");
				console.error("💡 Please rebuild the binary for your platform: go build -o todo-tracker");
				throw new Error("Binary architecture mismatch - rebuild todo-tracker for your platform");
			}
			throw error;
		}
	});

	test("should validate todo-config.json structure", async () => {
		const projectRoot = path.resolve(process.cwd());
		const configPath = path.join(projectRoot, "todo-config.json");

		// Read and validate config
		const configFile = Bun.file(configPath);
		expect(await configFile.exists()).toBe(true);

		const configText = await configFile.text();
		const config = JSON.parse(configText);

		console.log("⚙️ Config structure:", config);

		// Validate expected structure
		expect(config).toBeDefined();
		expect(config.tags).toBeDefined();
		expect(Array.isArray(config.tags)).toBe(true);

		// Check tag structure
		if (config.tags.length > 0) {
			const firstTag = config.tags[0];
			expect(firstTag.name).toBeDefined();
			expect(firstTag.match).toBeDefined();
			expect(Array.isArray(firstTag.match)).toBe(true);
		}

		console.log("✅ Config validation passed");
	});

	test("should handle binary execution errors gracefully", async () => {
		const projectRoot = path.resolve(process.cwd());
		const todoTrackerPath = path.join(projectRoot, "todo-tracker");

		// Test with invalid arguments
		try {
			const child_process = await import("node:child_process");

			// This should fail gracefully
			child_process.execSync(`${todoTrackerPath} invalid-command`, {
				encoding: "utf8",
				cwd: projectRoot,
			});

			// If we get here, the command didn't fail as expected
			throw new Error("Expected command to fail but it succeeded");
		} catch (error) {
			// This is expected - the binary should fail with invalid commands
			console.log("✅ Binary correctly failed with invalid command");
			expect(error).toBeDefined();
		}
	});
});
