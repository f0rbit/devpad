import { describe, expect, test } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { TEST_USER_ID } from "./setup";

class MediaIntegrationTest extends BaseIntegrationTest {}

const testInstance = new MediaIntegrationTest();
setupBaseIntegrationTest(testInstance);

const SKIP_REASON = "not yet implemented (Phase 3)";

const uniqueSlug = () => `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("media API client integration", () => {
	test("should verify media client namespace exists", () => {
		expect(testInstance.client.media).toBeDefined();
		expect(testInstance.client.media.profiles).toBeDefined();
		expect(testInstance.client.media.connections).toBeDefined();
		expect(testInstance.client.media.timeline).toBeDefined();
	});

	test("should list media profiles (empty)", async () => {
		const result = await testInstance.client.media.profiles.list();
		expect(result.ok).toBe(true);
	});

	test("should create a media profile", async () => {
		const result = await testInstance.client.media.profiles.create({
			slug: uniqueSlug(),
			name: "Test Media Profile",
		});
		expect(result.ok).toBe(true);
	});

	test("should get media timeline (returns error with empty data)", async () => {
		const result = await testInstance.client.media.timeline.get(TEST_USER_ID);
		// Timeline service errors when no accounts exist -- expected for empty test DB
		expect(result.ok).toBe(false);
	});

	describe("profiles CRUD lifecycle", () => {
		test.skip(`should create a profile - ${SKIP_REASON}`, () => {});
		test.skip(`should get profile by id - ${SKIP_REASON}`, () => {});
		test.skip(`should list profiles - ${SKIP_REASON}`, () => {});
		test.skip(`should update a profile - ${SKIP_REASON}`, () => {});
		test.skip(`should delete a profile - ${SKIP_REASON}`, () => {});
	});

	describe("profile filters", () => {
		test.skip(`should create a profile for filter tests - ${SKIP_REASON}`, () => {});
		test.skip(`should list filters (initially empty) - ${SKIP_REASON}`, () => {});
		test.skip(`should add a filter - ${SKIP_REASON}`, () => {});
		test.skip(`should remove a filter - ${SKIP_REASON}`, () => {});
		test.skip(`cleanup: delete filter test profile - ${SKIP_REASON}`, () => {});
	});

	describe("connections", () => {
		test.skip(`should list connections without crashing - ${SKIP_REASON}`, () => {});
	});

	describe("timeline", () => {
		test.skip(`should get timeline without crashing - ${SKIP_REASON}`, () => {});
	});
});
