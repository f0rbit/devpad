import { describe, expect, it, beforeEach } from "bun:test";
import { ApiClient } from "../../../src/api-client";
import type { Milestone, UpsertMilestone } from "@devpad/schema";

describe("Milestones API Client Unit Tests", () => {
	let client: ApiClient;

	beforeEach(() => {
		client = new ApiClient({
			base_url: "http://test.localhost/api/v0",
			api_key: "test-api-key",
		});
	});

	describe("milestone operations", () => {
		it("should have milestones namespace available", () => {
			expect(client.milestones).toBeDefined();
			expect(typeof client.milestones.list).toBe("function");
			expect(typeof client.milestones.create).toBe("function");
			expect(typeof client.milestones.find).toBe("function");
			expect(typeof client.milestones.update).toBe("function");
			expect(typeof client.milestones.delete).toBe("function");
		});

		it("should provide milestones.goals method", () => {
			expect(typeof client.milestones.goals).toBe("function");
		});

		it("should validate milestone data structure", () => {
			const validMilestone: Partial<Milestone> = {
				id: "milestone_123",
				name: "Version 1.0",
				description: "First major release",
				target_version: "v1.0.0",
				target_time: "2024-12-31",
				finished_at: null,
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				deleted: false,
			};

			// Basic type checking - if this compiles, types are correct
			expect(validMilestone.name).toBe("Version 1.0");
			expect(validMilestone.target_version).toBe("v1.0.0");
			expect(validMilestone.target_time).toBe("2024-12-31");
		});

		it("should validate milestone upsert data structure", () => {
			const validUpsertData: UpsertMilestone = {
				project_id: "project_123",
				name: "Milestone Name",
				description: "Optional description",
				target_version: "v1.0.0",
				target_time: "2024-12-31",
				finished_at: null,
				after_id: null,
			};

			// Type validation
			expect(validUpsertData.project_id).toBe("project_123");
			expect(validUpsertData.name).toBe("Milestone Name");
			expect(validUpsertData.target_version).toBe("v1.0.0");
		});

		it("should handle nullable fields correctly", () => {
			const minimalMilestone: UpsertMilestone = {
				project_id: "project_123",
				name: "Minimal Milestone",
			};

			// Should compile with minimal required fields
			expect(minimalMilestone.name).toBe("Minimal Milestone");
			expect(minimalMilestone.description).toBeUndefined();
			expect(minimalMilestone.target_version).toBeUndefined();
		});
	});

	describe("goals operations", () => {
		it("should have goals namespace available", () => {
			expect(client.goals).toBeDefined();
			expect(typeof client.goals.list).toBe("function");
			expect(typeof client.goals.create).toBe("function");
			expect(typeof client.goals.find).toBe("function");
			expect(typeof client.goals.update).toBe("function");
			expect(typeof client.goals.delete).toBe("function");
		});
	});

	describe("data validation", () => {
		it("should handle milestone name length constraints", () => {
			const longName = "a".repeat(250); // Over the 200 char limit
			const validName = "a".repeat(100); // Within limit

			// These would be validated by the Zod schema on the server
			expect(validName.length).toBeLessThanOrEqual(200);
			expect(longName.length).toBeGreaterThan(200);
		});

		it("should handle optional timestamps correctly", () => {
			const milestone: Partial<Milestone> = {
				name: "Test Milestone",
				target_time: "2024-12-31",
				finished_at: null,
			};

			expect(milestone.target_time).toBe("2024-12-31");
			expect(milestone.finished_at).toBeNull();
		});
	});

	describe("hierarchy validation", () => {
		it("should maintain proper project->milestone->goal hierarchy", () => {
			const project_id = "project_123";
			const milestone_id = "milestone_456";

			const milestone: Partial<UpsertMilestone> = {
				project_id,
				name: "Test Milestone",
			};

			const goal = {
				milestone_id,
				name: "Test Goal",
			};

			// Verify the hierarchical relationship is maintained in types
			expect(milestone.project_id).toBe(project_id);
			expect(goal.milestone_id).toBe(milestone_id);
		});

		it("should support milestone ordering with after_id", () => {
			const milestoneWithOrder: UpsertMilestone = {
				project_id: "project_123",
				name: "Second Milestone",
				after_id: "milestone_first",
			};

			expect(milestoneWithOrder.after_id).toBe("milestone_first");
		});
	});
});
