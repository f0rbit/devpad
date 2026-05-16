import { describe, expect, test } from "bun:test";
import type { PipelineGrant } from "@devpad/schema";
import { evaluate_grant_check, is_auto_approvable, is_grant_match } from "../../grants-domain.js";

describe("grants-domain", () => {
	describe("is_grant_match", () => {
		const test_cases: Array<{
			grant_scope: string;
			requested_scope: string;
			should_match: boolean;
			description: string;
		}> = [
			// Exact matches
			{
				grant_scope: "anthropic:messages",
				requested_scope: "anthropic:messages",
				should_match: true,
				description: "exact match: anthropic:messages",
			},
			{
				grant_scope: "github:read:my-org",
				requested_scope: "github:read:my-org",
				should_match: true,
				description: "exact match with three parts",
			},

			// Wildcard matches
			{
				grant_scope: "anthropic:*",
				requested_scope: "anthropic:messages",
				should_match: true,
				description: "single wildcard matches segment",
			},
			{
				grant_scope: "github:read:my-org/*",
				requested_scope: "github:read:my-org/repo-x",
				should_match: true,
				description: "trailing wildcard matches resource",
			},
			{
				grant_scope: "github:read:my-org/*",
				requested_scope: "github:read:my-org/repo-y",
				should_match: true,
				description: "trailing wildcard matches different resource",
			},
			{
				grant_scope: "*:*",
				requested_scope: "github:read",
				should_match: true,
				description: "multiple wildcards",
			},

			// Non-matches
			{
				grant_scope: "anthropic:models",
				requested_scope: "anthropic:messages",
				should_match: false,
				description: "different action",
			},
			{
				grant_scope: "github:read",
				requested_scope: "github:read:my-org",
				should_match: false,
				description: "grant too short for requested scope",
			},
			{
				grant_scope: "anthropic:messages:specific",
				requested_scope: "anthropic:messages:other",
				should_match: false,
				description: "different resource, no wildcard",
			},
			{
				grant_scope: "anthropic:messages",
				requested_scope: "github:read",
				should_match: false,
				description: "completely different provider",
			},
		];

		for (const tc of test_cases) {
			test(tc.description, () => {
				const result = is_grant_match({ scope: tc.grant_scope }, tc.requested_scope);
				expect(result).toBe(tc.should_match);
			});
		}
	});

	describe("is_auto_approvable", () => {
		test("auto-approves anthropic:messages at staging", () => {
			const result = is_auto_approvable("anthropic:messages", "staging");
			expect(result).toBe(true);
		});

		test("does not auto-approve anthropic:messages at production", () => {
			const result = is_auto_approvable("anthropic:messages", "production");
			expect(result).toBe(false);
		});

		test("does not auto-approve other scopes", () => {
			const result = is_auto_approvable("github:read:my-org/*", "staging");
			expect(result).toBe(false);
		});

		test("does not auto-approve unknown combinations", () => {
			const result = is_auto_approvable("custom:scope", "staging");
			expect(result).toBe(false);
		});
	});

	describe("evaluate_grant_check", () => {
		const build_grant = (overrides: Partial<PipelineGrant> = {}): PipelineGrant => ({
			id: "pipeline-grant_123",
			package_id: "pipeline-package_pkg",
			stage_name: "staging",
			scope: "anthropic:messages",
			granted_by: "user_123",
			granted_at: "2024-01-01T00:00:00Z",
			created_at: "2024-01-01T00:00:00Z",
			updated_at: "2024-01-01T00:00:00Z",
			created_by: "user",
			modified_by: "user",
			protected: false,
			deleted: false,
			...overrides,
		});

		test("grants when matching approved grant exists", () => {
			const grants = [
				build_grant({
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];

			const result = evaluate_grant_check(grants, "anthropic:messages", "staging");
			expect(result.granted).toBe(true);
		});

		test("denies when no matching grant exists", () => {
			const grants = [
				build_grant({
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];

			const result = evaluate_grant_check(grants, "anthropic:messages", "staging");
			expect(result.granted).toBe(false);
			expect(result.reason).toContain("No approved grant found");
		});

		test("denies when grant is not yet approved (granted_at is null)", () => {
			const grants = [
				build_grant({
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: null,
				}),
			];

			const result = evaluate_grant_check(grants, "anthropic:messages", "staging");
			expect(result.granted).toBe(false);
		});

		test("denies when stage does not match", () => {
			const grants = [
				build_grant({
					scope: "anthropic:messages",
					stage_name: "production",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];

			const result = evaluate_grant_check(grants, "anthropic:messages", "staging");
			expect(result.granted).toBe(false);
		});

		test("grants when wildcard grant matches scope", () => {
			const grants = [
				build_grant({
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];

			const result = evaluate_grant_check(grants, "github:read:my-org/repo-x", "staging");
			expect(result.granted).toBe(true);
		});

		test("grants when any matching grant exists (multiple grants)", () => {
			const grants = [
				build_grant({
					id: "grant_1",
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
				build_grant({
					id: "grant_2",
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];

			const result = evaluate_grant_check(grants, "anthropic:messages", "staging");
			expect(result.granted).toBe(true);
		});
	});
});
