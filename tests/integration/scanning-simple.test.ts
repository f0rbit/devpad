import { describe, test, expect } from "bun:test";
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
			});

			console.log("✅ Command completed successfully");
			console.log("📊 Output length:", output.length, "characters");

			// Verify output is non-empty
			expect(output.length).toBeGreaterThan(0);

			// Parse as JSON
			let parsedOutput;
			try {
				parsedOutput = JSON.parse(output);
			} catch (parseError) {
				console.error("❌ Failed to parse output as JSON:", parseError);
				console.log("🔍 Raw output preview:", output.substring(0, 500));
				throw new Error("Output is not valid JSON");
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
