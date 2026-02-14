import { describe, expect, it } from "bun:test";
import type { Bindings } from "../../bindings.js";
import * as blogSchema from "../blog.js";
import { createD1Database } from "../d1.js";
import * as mediaSchema from "../media.js";
import * as devpadSchema from "../schema.js";

describe("createD1Database", () => {
	it("is a callable function", () => {
		expect(typeof createD1Database).toBe("function");
	});
});

describe("unified schema exports", () => {
	const devpad_tables = [
		"user",
		"session",
		"api_keys",
		"project",
		"action",
		"tracker_result",
		"todo_updates",
		"milestone",
		"goal",
		"task",
		"checklist",
		"checklist_item",
		"codebase_tasks",
		"tag",
		"task_tag",
		"commit_detail",
		"tag_config",
		"ignore_path",
	] as const;

	const blog_tables = ["blog_posts", "blog_categories", "blog_tags", "blog_integrations", "blog_fetch_links", "blog_post_projects"] as const;

	const media_tables = ["media_profiles", "media_accounts", "media_rate_limits", "media_account_settings", "media_profile_filters", "media_platform_credentials"] as const;

	it("exports all devpad tables", () => {
		for (const table of devpad_tables) {
			expect(devpadSchema).toHaveProperty(table);
		}
	});

	it("exports all blog tables", () => {
		for (const table of blog_tables) {
			expect(blogSchema).toHaveProperty(table);
		}
	});

	it("exports all media tables", () => {
		for (const table of media_tables) {
			expect(mediaSchema).toHaveProperty(table);
		}
	});
});

describe("Bindings type", () => {
	it("has the expected shape at type level", () => {
		const mock_bindings: Bindings = {
			DB: {} as D1Database,
			BLOG_CORPUS_BUCKET: {} as R2Bucket,
			MEDIA_CORPUS_BUCKET: {} as R2Bucket,
			ENVIRONMENT: "test",
			API_URL: "http://localhost",
			FRONTEND_URL: "http://localhost",
			GITHUB_CLIENT_ID: "id",
			GITHUB_CLIENT_SECRET: "secret",
			JWT_SECRET: "jwt",
			ENCRYPTION_KEY: "key",
			REDDIT_CLIENT_ID: "reddit-id",
			REDDIT_CLIENT_SECRET: "reddit-secret",
			TWITTER_CLIENT_ID: "twitter-id",
			TWITTER_CLIENT_SECRET: "twitter-secret",
		};

		expect(mock_bindings.ENVIRONMENT).toBe("test");
		expect(mock_bindings.API_URL).toBe("http://localhost");
		expect(mock_bindings.FRONTEND_URL).toBe("http://localhost");
		expect(mock_bindings.GITHUB_CLIENT_ID).toBe("id");
		expect(mock_bindings.GITHUB_CLIENT_SECRET).toBe("secret");
		expect(mock_bindings.JWT_SECRET).toBe("jwt");
		expect(mock_bindings.ENCRYPTION_KEY).toBe("key");
	});
});
