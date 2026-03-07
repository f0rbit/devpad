import { describe, expect, test } from "bun:test";
import { connection, type RefreshAttempt } from "../connections";

const { categorize, strategy, aggregate, shouldRegen } = connection;

describe("connections pure functions", () => {
	describe("categorizeAccountsByPlatform", () => {
		test("empty array returns empty categories", () => {
			const result = categorize([]);
			expect(result.github).toEqual([]);
			expect(result.reddit).toEqual([]);
			expect(result.twitter).toEqual([]);
			expect(result.other).toEqual([]);
		});

		test("groups accounts by platform", () => {
			const accounts = [
				{ id: "1", platform: "github" },
				{ id: "2", platform: "reddit" },
				{ id: "3", platform: "twitter" },
				{ id: "4", platform: "github" },
				{ id: "5", platform: "bluesky" },
			];
			const result = categorize(accounts);
			expect(result.github).toEqual([
				{ id: "1", platform: "github" },
				{ id: "4", platform: "github" },
			]);
			expect(result.reddit).toEqual([{ id: "2", platform: "reddit" }]);
			expect(result.twitter).toEqual([{ id: "3", platform: "twitter" }]);
			expect(result.other).toEqual([{ id: "5", platform: "bluesky" }]);
		});

		test("all accounts in one platform", () => {
			const accounts = [
				{ id: "1", platform: "github" },
				{ id: "2", platform: "github" },
			];
			const result = categorize(accounts);
			expect(result.github.length).toBe(2);
			expect(result.reddit.length).toBe(0);
			expect(result.twitter.length).toBe(0);
			expect(result.other.length).toBe(0);
		});

		test("unknown platforms go to other", () => {
			const accounts = [
				{ id: "1", platform: "youtube" },
				{ id: "2", platform: "mastodon" },
			];
			const result = categorize(accounts);
			expect(result.other.length).toBe(2);
		});
	});

	describe("determineRefreshStrategy", () => {
		test("returns github for github platform", () => {
			expect(strategy("github")).toBe("github");
		});

		test("returns reddit for reddit platform", () => {
			expect(strategy("reddit")).toBe("reddit");
		});

		test("returns twitter for twitter platform", () => {
			expect(strategy("twitter")).toBe("twitter");
		});

		test("returns generic for unknown platforms", () => {
			expect(strategy("bluesky")).toBe("generic");
			expect(strategy("youtube")).toBe("generic");
			expect(strategy("mastodon")).toBe("generic");
			expect(strategy("")).toBe("generic");
		});
	});

	describe("aggregateRefreshResults", () => {
		test("empty attempts returns zeros", () => {
			const result = aggregate([]);
			expect(result.succeeded).toBe(0);
			expect(result.failed).toBe(0);
			expect(result.errors).toEqual([]);
		});

		test("all successes", () => {
			const attempts: RefreshAttempt[] = [
				{ accountId: "1", success: true },
				{ accountId: "2", success: true },
				{ accountId: "3", success: true },
			];
			const result = aggregate(attempts);
			expect(result.succeeded).toBe(3);
			expect(result.failed).toBe(0);
			expect(result.errors).toEqual([]);
		});

		test("all failures with errors", () => {
			const attempts: RefreshAttempt[] = [
				{ accountId: "1", success: false, error: "timeout" },
				{ accountId: "2", success: false, error: "auth expired" },
			];
			const result = aggregate(attempts);
			expect(result.succeeded).toBe(0);
			expect(result.failed).toBe(2);
			expect(result.errors).toEqual(["timeout", "auth expired"]);
		});

		test("mixed results", () => {
			const attempts: RefreshAttempt[] = [
				{ accountId: "1", success: true },
				{ accountId: "2", success: false, error: "rate limited" },
				{ accountId: "3", success: true },
				{ accountId: "4", success: false },
			];
			const result = aggregate(attempts);
			expect(result.succeeded).toBe(2);
			expect(result.failed).toBe(2);
			expect(result.errors).toEqual(["rate limited"]);
		});

		test("failure without error string is not included in errors array", () => {
			const attempts: RefreshAttempt[] = [{ accountId: "1", success: false }];
			const result = aggregate(attempts);
			expect(result.failed).toBe(1);
			expect(result.errors).toEqual([]);
		});
	});

	describe("shouldRegenerateTimeline", () => {
		test("returns false when succeeded is 0", () => {
			expect(shouldRegen(0)).toBe(false);
		});

		test("returns true when succeeded is greater than 0", () => {
			expect(shouldRegen(1)).toBe(true);
			expect(shouldRegen(5)).toBe(true);
			expect(shouldRegen(100)).toBe(true);
		});
	});
});
