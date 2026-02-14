#!/usr/bin/env node

/**
 * Version Synchronization Script for devpad Packages
 *
 * This script synchronizes versions across all publishable packages
 * using the version stored in .github/VERSION as the source of truth.
 *
 * Usage:
 *   node scripts/sync-versions.js                    # Use version from .github/VERSION
 *   node scripts/sync-versions.js --version 1.2.3    # Set specific version
 *   node scripts/sync-versions.js --bump patch       # Bump version (patch/minor/major)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Publishable packages
const PUBLISHABLE_PACKAGES = ["api", "cli", "mcp"];

// All packages (for dependency updates)
const ALL_PACKAGES = ["api", "cli", "mcp", "schema", "core", "worker"];

/**
 * Read current version from .github/VERSION
 */
function getCurrentVersion() {
	const versionFile = path.join(rootDir, ".github", "VERSION");
	if (!fs.existsSync(versionFile)) {
		throw new Error(".github/VERSION file not found");
	}
	return fs.readFileSync(versionFile, "utf8").trim();
}

/**
 * Write version to .github/VERSION
 */
function saveVersion(version) {
	const versionFile = path.join(rootDir, ".github", "VERSION");
	fs.writeFileSync(versionFile, version);
	console.log(`✅ Updated .github/VERSION to ${version}`);
}

/**
 * Parse semantic version
 */
function parseVersion(version) {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
	if (!match) {
		throw new Error(`Invalid version format: ${version}`);
	}
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: parseInt(match[3], 10),
		prerelease: match[4] || null,
	};
}

/**
 * Bump version based on type
 */
function bumpVersion(currentVersion, bumpType) {
	const parsed = parseVersion(currentVersion);

	switch (bumpType) {
		case "major":
			return `${parsed.major + 1}.0.0`;
		case "minor":
			return `${parsed.major}.${parsed.minor + 1}.0`;
		case "patch":
			return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
		default:
			throw new Error(`Invalid bump type: ${bumpType}`);
	}
}

/**
 * Update package.json version
 */
function updatePackageVersion(packageName, version, updateDeps = true) {
	const packagePath = path.join(rootDir, "packages", packageName, "package.json");

	if (!fs.existsSync(packagePath)) {
		console.warn(`⚠️  Package ${packageName} not found at ${packagePath}`);
		return false;
	}

	const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
	const oldVersion = packageJson.version;

	// Update version
	packageJson.version = version;

	// Update dependencies if requested
	if (updateDeps) {
		// Update dependencies to other @devpad packages
		for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
			if (packageJson[depType]) {
				for (const dep in packageJson[depType]) {
					if (dep.startsWith("@devpad/") && PUBLISHABLE_PACKAGES.includes(dep.replace("@devpad/", ""))) {
						// For publishable packages, use the exact version
						packageJson[depType][dep] = `^${version}`;
					}
					// Keep workspace:* for internal-only packages
				}
			}
		}
	}

	// Write updated package.json
	fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, "\t") + "\n");

	if (oldVersion !== version) {
		console.log(`✅ Updated @devpad/${packageName}: ${oldVersion} → ${version}`);
	} else {
		console.log(`✅ @devpad/${packageName} already at version ${version}`);
	}

	return true;
}

/**
 * Get changed packages since last tag
 */
async function getChangedPackages(lastTag) {
	const { execSync } = await import("child_process");

	try {
		// Get list of changed files since last tag
		const changed = execSync(`git diff ${lastTag}...HEAD --name-only`, { encoding: "utf8" }).split("\n").filter(Boolean);

		const changedPackages = new Set();

		for (const file of changed) {
			// Check if file is in a package directory
			const match = file.match(/^packages\/([^/]+)\//);
			if (match && PUBLISHABLE_PACKAGES.includes(match[1])) {
				changedPackages.add(match[1]);
			}
		}

		return Array.from(changedPackages);
	} catch (error) {
		console.warn("⚠️  Could not determine changed packages:", error.message);
		return PUBLISHABLE_PACKAGES; // Return all packages if we can't determine changes
	}
}

/**
 * Main execution
 */
async function main() {
	const args = process.argv.slice(2);
	let targetVersion = null;
	let onlyChanged = false;

	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--version" && args[i + 1]) {
			targetVersion = args[i + 1];
			i++;
		} else if (args[i] === "--bump" && args[i + 1]) {
			const currentVersion = getCurrentVersion();
			targetVersion = bumpVersion(currentVersion, args[i + 1]);
			i++;
		} else if (args[i] === "--only-changed") {
			onlyChanged = true;
		}
	}

	// If no version specified, use current version from .github/VERSION
	if (!targetVersion) {
		targetVersion = getCurrentVersion();
	}

	console.log(`\n📦 Synchronizing packages to version ${targetVersion}\n`);

	// Determine which packages to update
	let packagesToUpdate = PUBLISHABLE_PACKAGES;

	if (onlyChanged) {
		const lastTag = `v${getCurrentVersion()}`;
		const changed = await getChangedPackages(lastTag);
		if (changed.length > 0) {
			packagesToUpdate = changed;
			console.log(`📝 Updating only changed packages: ${changed.join(", ")}\n`);
		} else {
			console.log("ℹ️  No packages have changed since last version\n");
			return;
		}
	}

	// Update publishable packages
	for (const pkg of packagesToUpdate) {
		updatePackageVersion(pkg, targetVersion, true);
	}

	// Update internal packages (keep workspace:* but ensure consistency)
	console.log("\n📚 Checking internal packages...");
	const internalPackages = ALL_PACKAGES.filter(p => !PUBLISHABLE_PACKAGES.includes(p));
	for (const pkg of internalPackages) {
		const packagePath = path.join(rootDir, "packages", pkg, "package.json");
		if (fs.existsSync(packagePath)) {
			const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
			// Only update version, keep workspace:* references
			if (packageJson.version !== targetVersion) {
				packageJson.version = targetVersion;
				fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, "\t") + "\n");
				console.log(`✅ Updated @devpad/${pkg} version to ${targetVersion}`);
			}
		}
	}

	// Save version to .github/VERSION
	saveVersion(targetVersion);

	// Update root package.json version
	const rootPackagePath = path.join(rootDir, "package.json");
	const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));
	if (rootPackage.version !== targetVersion) {
		rootPackage.version = targetVersion;
		fs.writeFileSync(rootPackagePath, JSON.stringify(rootPackage, null, "\t") + "\n");
		console.log(`✅ Updated root package.json to ${targetVersion}`);
	}

	console.log("\n✨ Version synchronization complete!\n");

	// Show summary
	console.log("Summary:");
	console.log(`  Version: ${targetVersion}`);
	console.log(`  Updated: ${packagesToUpdate.length} publishable packages`);
	console.log(`  Packages: ${packagesToUpdate.map(p => `@devpad/${p}`).join(", ")}`);

	// Remind about committing changes
	console.log("\n💡 Don't forget to commit these changes:");
	console.log("  git add -A");
	console.log(`  git commit -m "chore: bump version to ${targetVersion}"`);
}

// Run the script
main().catch(error => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});
