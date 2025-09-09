#!/usr/bin/env node

/**
 * Pre-publish Preparation Script for devpad Packages
 *
 * This script prepares packages for npm publishing by:
 * - Replacing workspace: protocol with actual versions
 * - Validating package.json requirements
 * - Ensuring build artifacts exist
 *
 * Usage:
 *   node scripts/prepare-publish.js <package-name> <version>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * Validate package.json has required fields for npm
 */
function validatePackageJson(pkg) {
	const required = ["name", "version", "description", "main"];
	const missing = required.filter(field => !pkg[field]);

	if (missing.length > 0) {
		throw new Error(`Missing required fields: ${missing.join(", ")}`);
	}

	// Warn about recommended fields
	const recommended = ["keywords", "author", "license", "repository", "homepage"];
	const missingRecommended = recommended.filter(field => !pkg[field]);

	if (missingRecommended.length > 0) {
		console.warn(`⚠️  Missing recommended fields: ${missingRecommended.join(", ")}`);
	}

	return true;
}

/**
 * Replace workspace: dependencies with actual versions
 */
function replaceWorkspaceDependencies(pkg, version) {
	const updated = { ...pkg };

	for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
		if (updated[depType]) {
			for (const dep in updated[depType]) {
				if (updated[depType][dep] === "workspace:*") {
					// Check if this is a publishable package
					if (dep === "@devpad/api" || dep === "@devpad/cli" || dep === "@devpad/mcp") {
						// Use caret range for published packages
						updated[depType][dep] = `^${version}`;
						console.log(`  📦 Replaced ${dep}: workspace:* → ^${version}`);
					} else if (dep === "@devpad/schema") {
						// Schema is not published, need to handle differently
						// For now, we'll skip it but warn
						console.warn(`  ⚠️  Warning: ${dep} is not publishable but referenced as workspace:*`);
						console.warn(`     You may need to bundle or inline this dependency`);
						delete updated[depType][dep]; // Remove for now
					}
				}
			}
		}
	}

	return updated;
}

/**
 * Check if build artifacts exist
 */
function checkBuildArtifacts(packagePath, pkg) {
	// Check main entry point
	if (pkg.main) {
		const mainPath = path.join(packagePath, pkg.main);
		if (!fs.existsSync(mainPath)) {
			throw new Error(`Main entry point not found: ${pkg.main}`);
		}
	}

	// Check types if specified
	if (pkg.types) {
		const typesPath = path.join(packagePath, pkg.types);
		if (!fs.existsSync(typesPath)) {
			console.warn(`⚠️  Types file not found: ${pkg.types}`);
		}
	}

	// Check bin executables
	if (pkg.bin) {
		for (const [name, binPath] of Object.entries(pkg.bin)) {
			const fullPath = path.join(packagePath, binPath);
			if (!fs.existsSync(fullPath)) {
				throw new Error(`Bin executable not found: ${name} -> ${binPath}`);
			}
		}
	}

	// Check files array
	if (pkg.files) {
		for (const file of pkg.files) {
			const filePath = path.join(packagePath, file);
			if (!fs.existsSync(filePath)) {
				console.warn(`⚠️  File/directory in 'files' not found: ${file}`);
			}
		}
	}

	return true;
}

/**
 * Main preparation function
 */
async function preparePackage(packageName, version) {
	const packagePath = path.join(rootDir, "packages", packageName);
	const packageJsonPath = path.join(packagePath, "package.json");

	if (!fs.existsSync(packageJsonPath)) {
		throw new Error(`Package not found: ${packageName}`);
	}

	console.log(`\n📦 Preparing @devpad/${packageName} for publishing...`);

	// Read package.json
	const originalPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

	// Backup original package.json
	const backupPath = path.join(packagePath, "package.json.backup");
	fs.writeFileSync(backupPath, JSON.stringify(originalPkg, null, 2));
	console.log(`  ✅ Created backup: package.json.backup`);

	// Validate package.json
	console.log(`  🔍 Validating package.json...`);
	validatePackageJson(originalPkg);

	// Update version
	const updatedPkg = { ...originalPkg, version };
	console.log(`  ✅ Updated version: ${originalPkg.version} → ${version}`);

	// Replace workspace dependencies
	console.log(`  🔄 Replacing workspace dependencies...`);
	const finalPkg = replaceWorkspaceDependencies(updatedPkg, version);

	// Write updated package.json
	fs.writeFileSync(packageJsonPath, JSON.stringify(finalPkg, null, 2));
	console.log(`  ✅ Updated package.json`);

	// Check build artifacts
	console.log(`  📋 Checking build artifacts...`);
	try {
		checkBuildArtifacts(packagePath, finalPkg);
		console.log(`  ✅ All build artifacts present`);
	} catch (error) {
		console.error(`  ❌ ${error.message}`);
		console.log(`  🔨 Attempting to build package...`);

		// Try to build the package
		try {
			execSync("bun run build", { cwd: packagePath, stdio: "inherit" });
			console.log(`  ✅ Build successful`);

			// Check again
			checkBuildArtifacts(packagePath, finalPkg);
		} catch (buildError) {
			console.error(`  ❌ Build failed`);
			throw buildError;
		}
	}

	// Create .npmignore if it doesn't exist
	const npmignorePath = path.join(packagePath, ".npmignore");
	if (!fs.existsSync(npmignorePath)) {
		const npmignoreContent = `
# Source files
src/
*.ts
!*.d.ts

# Config files
tsconfig.json
.eslintrc.*
.prettierrc.*

# Test files
tests/
*.test.*
*.spec.*

# Misc
*.backup
.DS_Store
node_modules/
`;
		fs.writeFileSync(npmignorePath, npmignoreContent.trim());
		console.log(`  ✅ Created .npmignore`);
	}

	console.log(`\n✨ Package @devpad/${packageName} is ready for publishing!`);
	console.log(`\nNext steps:`);
	console.log(`  1. Review the changes: diff package.json.backup package.json`);
	console.log(`  2. Test locally: npm pack`);
	console.log(`  3. Publish: npm publish --access public`);
	console.log(`  4. Restore original: mv package.json.backup package.json`);

	return finalPkg;
}

/**
 * CLI entry point
 */
async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error("Usage: node prepare-publish.js <package-name> <version>");
		console.error("Example: node prepare-publish.js api 1.2.3");
		process.exit(1);
	}

	const [packageName, version] = args;

	// Validate version format
	if (!/^\d+\.\d+\.\d+/.test(version)) {
		console.error(`Invalid version format: ${version}`);
		console.error("Expected format: X.Y.Z (e.g., 1.2.3)");
		process.exit(1);
	}

	try {
		await preparePackage(packageName, version);
	} catch (error) {
		console.error(`\n❌ Error: ${error.message}`);

		// Try to restore backup if it exists
		const packagePath = path.join(rootDir, "packages", packageName);
		const backupPath = path.join(packagePath, "package.json.backup");
		const packageJsonPath = path.join(packagePath, "package.json");

		if (fs.existsSync(backupPath)) {
			fs.copyFileSync(backupPath, packageJsonPath);
			console.log(`  ✅ Restored original package.json from backup`);
		}

		process.exit(1);
	}
}

// Run if called directly
if (import.meta.url === `file://${__filename}`) {
	main();
}
