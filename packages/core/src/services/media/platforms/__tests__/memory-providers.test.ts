import { beforeEach, describe, expect, test } from "bun:test";
import type { GitHubRepoCommitsStore, GitHubRepoMeta, GitHubRepoPRsStore } from "@devpad/schema/media";
import { GitHubMemoryProvider } from "../github-memory";
import { RedditMemoryProvider } from "../reddit-memory";
import { TwitterMemoryProvider } from "../twitter-memory";

describe("GitHubMemoryProvider", () => {
	let provider: GitHubMemoryProvider;

	beforeEach(() => {
		provider = new GitHubMemoryProvider();
	});

	test("fetch returns default data", async () => {
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.username).toBe("test-user");
			expect(result.value.meta.repositories).toEqual([]);
			expect(result.value.repos.size).toBe(0);
		}
	});

	test("fetch returns configured username", async () => {
		provider.setUsername("custom-user");
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.username).toBe("custom-user");
		}
	});

	test("fetch returns configured repositories", async () => {
		const repos: GitHubRepoMeta[] = [
			{
				owner: "user",
				name: "repo1",
				full_name: "user/repo1",
				default_branch: "main",
				branches: ["main"],
				is_private: false,
				pushed_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			},
		];
		provider.setRepositories(repos);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.repositories.length).toBe(1);
			expect(result.value.meta.total_repos_available).toBe(1);
			expect(result.value.meta.repos_fetched).toBe(1);
		}
	});

	test("setRepoData adds repo data to map", async () => {
		const commits: GitHubRepoCommitsStore = {
			owner: "user",
			repo: "repo1",
			branches: ["main"],
			commits: [],
			total_commits: 0,
			fetched_at: new Date().toISOString(),
		};
		const prs: GitHubRepoPRsStore = {
			owner: "user",
			repo: "repo1",
			pull_requests: [],
			total_prs: 0,
			fetched_at: new Date().toISOString(),
		};
		provider.setRepoData("user/repo1", { commits, prs });
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.repos.size).toBe(1);
			expect(result.value.repos.get("user/repo1")).toBeDefined();
		}
	});

	test("setSimulateRateLimit causes fetch to return rate_limited error", async () => {
		provider.setSimulateRateLimit(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("rate_limited");
		}
	});

	test("setSimulateAuthExpired causes fetch to return auth_expired error", async () => {
		provider.setSimulateAuthExpired(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("auth_expired");
		}
	});

	test("rate_limited takes priority over auth_expired", async () => {
		provider.setSimulateRateLimit(true);
		provider.setSimulateAuthExpired(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("rate_limited");
		}
	});

	test("getCallCount increments on each fetch", async () => {
		expect(provider.getCallCount()).toBe(0);
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(1);
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(2);
	});

	test("getCallCount increments even on simulated errors", async () => {
		provider.setSimulateRateLimit(true);
		await provider.fetch("token");
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(2);
	});

	test("reset clears call count", async () => {
		await provider.fetch("token");
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(2);
		provider.reset();
		expect(provider.getCallCount()).toBe(0);
	});

	test("platform is github", () => {
		expect(provider.platform).toBe("github");
	});
});

describe("TwitterMemoryProvider", () => {
	let provider: TwitterMemoryProvider;

	beforeEach(() => {
		provider = new TwitterMemoryProvider();
	});

	test("fetch returns default data", async () => {
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.username).toBe("testuser");
			expect(result.value.meta.id).toBe("123456789");
			expect(result.value.tweets.tweets).toEqual([]);
			expect(result.value.tweets.media).toEqual([]);
		}
	});

	test("setTweets configures tweet data", async () => {
		const tweets = [
			{
				id: "tweet-1",
				text: "Hello world",
				created_at: new Date().toISOString(),
				author_id: "123",
				public_metrics: {
					retweet_count: 0,
					reply_count: 0,
					like_count: 5,
					quote_count: 0,
				},
			},
		];
		provider.setTweets(tweets);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.tweets.tweets.length).toBe(1);
			expect(result.value.tweets.total_tweets).toBe(1);
			expect(result.value.tweets.tweets[0].text).toBe("Hello world");
		}
	});

	test("setMedia configures media data", async () => {
		const media = [
			{
				media_key: "mk-1",
				type: "photo" as const,
				url: "https://example.com/photo.jpg",
			},
		];
		provider.setMedia(media);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.tweets.media.length).toBe(1);
		}
	});

	test("setSimulateRateLimit causes fetch to return rate_limited error", async () => {
		provider.setSimulateRateLimit(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("rate_limited");
		}
	});

	test("setSimulateAuthExpired causes fetch to return auth_expired error", async () => {
		provider.setSimulateAuthExpired(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("auth_expired");
		}
	});

	test("getCallCount increments on each fetch", async () => {
		expect(provider.getCallCount()).toBe(0);
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(1);
	});

	test("reset clears call count", async () => {
		await provider.fetch("token");
		provider.reset();
		expect(provider.getCallCount()).toBe(0);
	});

	test("platform is twitter", () => {
		expect(provider.platform).toBe("twitter");
	});

	test("constructor config sets initial data", async () => {
		const provider = new TwitterMemoryProvider({
			userId: "custom-id",
			username: "custom-name",
			name: "Custom Name",
		});
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.id).toBe("custom-id");
			expect(result.value.meta.username).toBe("custom-name");
			expect(result.value.meta.name).toBe("Custom Name");
		}
	});
});

describe("RedditMemoryProvider", () => {
	let provider: RedditMemoryProvider;

	beforeEach(() => {
		provider = new RedditMemoryProvider();
	});

	test("fetch returns default data", async () => {
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.username).toBe("test-user");
			expect(result.value.posts.posts).toEqual([]);
			expect(result.value.comments.comments).toEqual([]);
		}
	});

	test("setPosts configures post data", async () => {
		const posts = [
			{
				id: "post-1",
				name: "t3_post1",
				title: "Test post",
				selftext: "Hello",
				url: "https://reddit.com/r/test/post-1",
				permalink: "/r/test/post-1",
				subreddit: "test",
				subreddit_prefixed: "r/test",
				author: "test-user",
				created_utc: Date.now() / 1000,
				score: 42,
				num_comments: 5,
				is_self: true,
				is_video: false,
			},
		];
		provider.setPosts(posts);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posts.posts.length).toBe(1);
			expect(result.value.posts.total_posts).toBe(1);
			expect(result.value.posts.posts[0].title).toBe("Test post");
		}
	});

	test("setComments configures comment data", async () => {
		const comments = [
			{
				id: "comment-1",
				name: "t1_comment1",
				body: "Great post!",
				permalink: "/r/test/comments/abc/test/comment1",
				link_id: "t3_abc",
				link_title: "Test post",
				link_permalink: "/r/test/comments/abc/test",
				subreddit: "test",
				subreddit_prefixed: "r/test",
				author: "test-user",
				created_utc: Date.now() / 1000,
				score: 10,
				is_submitter: false,
				stickied: false,
				edited: false,
				parent_id: "t3_abc",
			},
		];
		provider.setComments(comments);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.comments.comments.length).toBe(1);
			expect(result.value.comments.total_comments).toBe(1);
		}
	});

	test("setSimulateRateLimit causes fetch to return rate_limited error", async () => {
		provider.setSimulateRateLimit(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("rate_limited");
		}
	});

	test("setSimulateAuthExpired causes fetch to return auth_expired error", async () => {
		provider.setSimulateAuthExpired(true);
		const result = await provider.fetch("token");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("auth_expired");
		}
	});

	test("getCallCount increments on each fetch", async () => {
		expect(provider.getCallCount()).toBe(0);
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(1);
		await provider.fetch("token");
		expect(provider.getCallCount()).toBe(2);
	});

	test("reset clears call count", async () => {
		await provider.fetch("token");
		provider.reset();
		expect(provider.getCallCount()).toBe(0);
	});

	test("platform is reddit", () => {
		expect(provider.platform).toBe("reddit");
	});

	test("fetchForUsername delegates to fetch", async () => {
		const fetchResult = await provider.fetch("token");
		provider.reset();
		const usernameResult = await provider.fetchForUsername("token", "someuser");
		expect(usernameResult.ok).toBe(fetchResult.ok);
		expect(provider.getCallCount()).toBe(1);
	});

	test("constructor config overrides meta defaults", async () => {
		const provider = new RedditMemoryProvider({
			username: "custom-user",
			meta: { total_karma: 5000, is_gold: true },
		});
		const result = await provider.fetch("token");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.meta.username).toBe("custom-user");
			expect(result.value.meta.total_karma).toBe(5000);
			expect(result.value.meta.is_gold).toBe(true);
		}
	});
});
