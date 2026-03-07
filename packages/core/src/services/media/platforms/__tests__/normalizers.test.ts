import { describe, expect, test } from "bun:test";
import { type GitHubTimelineData, normalizeGitHub } from "../github/timeline";
import { normalizeReddit, type RedditTimelineData } from "../reddit/timeline";
import { normalizeTwitter, type TwitterTimelineData } from "../twitter/timeline";

describe("normalizeGitHub", () => {
	test("empty data returns empty array", () => {
		const data: GitHubTimelineData = { commits: [], prs: [] };
		expect(normalizeGitHub(data)).toEqual([]);
	});

	test("normalizes commits to timeline items", () => {
		const data: GitHubTimelineData = {
			commits: [
				{
					sha: "abc1234567890",
					message: "fix: resolve login issue",
					author_name: "dev",
					author_email: "dev@test.com",
					author_date: "2024-06-15T10:00:00.000Z",
					committer_name: "dev",
					committer_email: "dev@test.com",
					committer_date: "2024-06-15T10:00:00.000Z",
					url: "https://github.com/user/repo/commit/abc1234",
					branch: "main",
					additions: 10,
					deletions: 3,
					files_changed: 2,
					_repo: "user/repo",
				},
			],
			prs: [],
		};
		const items = normalizeGitHub(data);
		expect(items.length).toBe(1);

		const item = items[0];
		expect(item.id).toBe("github:commit:user/repo:abc1234");
		expect(item.platform).toBe("github");
		expect(item.type).toBe("commit");
		expect(item.timestamp).toBe("2024-06-15T10:00:00.000Z");
		expect(item.title).toBe("fix: resolve login issue");
		expect(item.url).toBe("https://github.com/user/repo/commit/abc1234");
		expect(item.payload.type).toBe("commit");
		if (item.payload.type === "commit") {
			expect(item.payload.sha).toBe("abc1234567890");
			expect(item.payload.repo).toBe("user/repo");
			expect(item.payload.branch).toBe("main");
			expect(item.payload.additions).toBe(10);
			expect(item.payload.deletions).toBe(3);
			expect(item.payload.files_changed).toBe(2);
		}
	});

	test("truncates long commit messages", () => {
		const long_message = "a".repeat(200);
		const data: GitHubTimelineData = {
			commits: [
				{
					sha: "abc1234567890",
					message: long_message,
					author_name: "dev",
					author_email: "dev@test.com",
					author_date: "2024-06-15T10:00:00.000Z",
					committer_name: "dev",
					committer_email: "dev@test.com",
					committer_date: "2024-06-15T10:00:00.000Z",
					url: "https://github.com/user/repo/commit/abc1234",
					branch: "main",
					_repo: "user/repo",
				},
			],
			prs: [],
		};
		const items = normalizeGitHub(data);
		expect(items[0].title.length).toBeLessThanOrEqual(72);
		expect(items[0].title.endsWith("...")).toBe(true);
	});

	test("normalizes PRs to timeline items", () => {
		const data: GitHubTimelineData = {
			commits: [],
			prs: [
				{
					id: 1,
					number: 42,
					title: "Add feature X",
					body: "Description here",
					state: "merged" as const,
					url: "https://github.com/user/repo/pull/42",
					created_at: "2024-06-14T08:00:00.000Z",
					updated_at: "2024-06-15T12:00:00.000Z",
					closed_at: "2024-06-15T12:00:00.000Z",
					merged_at: "2024-06-15T12:00:00.000Z",
					head_ref: "feature-x",
					base_ref: "main",
					commit_shas: ["sha1", "sha2"],
					merge_commit_sha: "merge-sha",
					author_login: "dev",
					additions: 100,
					deletions: 20,
					changed_files: 5,
					_repo: "user/repo",
				},
			],
		};
		const items = normalizeGitHub(data);
		expect(items.length).toBe(1);

		const item = items[0];
		expect(item.id).toBe("github:pr:user/repo:42");
		expect(item.platform).toBe("github");
		expect(item.type).toBe("pull_request");
		expect(item.timestamp).toBe("2024-06-15T12:00:00.000Z");
		expect(item.title).toBe("Add feature X");
		if (item.payload.type === "pull_request") {
			expect(item.payload.repo).toBe("user/repo");
			expect(item.payload.number).toBe(42);
			expect(item.payload.state).toBe("merged");
			expect(item.payload.head_ref).toBe("feature-x");
			expect(item.payload.base_ref).toBe("main");
			expect(item.payload.additions).toBe(100);
			expect(item.payload.deletions).toBe(20);
			expect(item.payload.changed_files).toBe(5);
			expect(item.payload.commit_shas).toEqual(["sha1", "sha2"]);
			expect(item.payload.merge_commit_sha).toBe("merge-sha");
		}
	});

	test("PR uses merged_at for timestamp when available, otherwise updated_at", () => {
		const merged_pr: GitHubTimelineData = {
			commits: [],
			prs: [
				{
					id: 1,
					number: 1,
					title: "Merged PR",
					body: null,
					state: "merged" as const,
					url: "https://github.com/user/repo/pull/1",
					created_at: "2024-06-14T08:00:00.000Z",
					updated_at: "2024-06-15T12:00:00.000Z",
					closed_at: "2024-06-15T12:00:00.000Z",
					merged_at: "2024-06-15T11:00:00.000Z",
					head_ref: "feature",
					base_ref: "main",
					commit_shas: [],
					merge_commit_sha: null,
					author_login: "dev",
					_repo: "user/repo",
				},
			],
		};
		expect(normalizeGitHub(merged_pr)[0].timestamp).toBe("2024-06-15T11:00:00.000Z");

		const open_pr: GitHubTimelineData = {
			commits: [],
			prs: [
				{
					id: 2,
					number: 2,
					title: "Open PR",
					body: null,
					state: "open" as const,
					url: "https://github.com/user/repo/pull/2",
					created_at: "2024-06-14T08:00:00.000Z",
					updated_at: "2024-06-16T09:00:00.000Z",
					closed_at: null,
					merged_at: null,
					head_ref: "feature",
					base_ref: "main",
					commit_shas: [],
					merge_commit_sha: null,
					author_login: "dev",
					_repo: "user/repo",
				},
			],
		};
		expect(normalizeGitHub(open_pr)[0].timestamp).toBe("2024-06-16T09:00:00.000Z");
	});

	test("commits and PRs combined", () => {
		const data: GitHubTimelineData = {
			commits: [
				{
					sha: "abc1234567890",
					message: "commit 1",
					author_name: "dev",
					author_email: "dev@test.com",
					author_date: "2024-06-15T10:00:00.000Z",
					committer_name: "dev",
					committer_email: "dev@test.com",
					committer_date: "2024-06-15T10:00:00.000Z",
					url: "https://github.com/user/repo/commit/abc1234",
					branch: "main",
					_repo: "user/repo",
				},
			],
			prs: [
				{
					id: 1,
					number: 1,
					title: "PR 1",
					body: null,
					state: "open" as const,
					url: "https://github.com/user/repo/pull/1",
					created_at: "2024-06-14T08:00:00.000Z",
					updated_at: "2024-06-15T12:00:00.000Z",
					closed_at: null,
					merged_at: null,
					head_ref: "feature",
					base_ref: "main",
					commit_shas: [],
					merge_commit_sha: null,
					author_login: "dev",
					_repo: "user/repo",
				},
			],
		};
		const items = normalizeGitHub(data);
		expect(items.length).toBe(2);
		expect(items[0].type).toBe("commit");
		expect(items[1].type).toBe("pull_request");
	});
});

describe("normalizeTwitter", () => {
	const baseTweet = {
		id: "tweet-1",
		text: "Hello Twitter!",
		created_at: "2024-06-15T10:00:00.000Z",
		author_id: "user-1",
		public_metrics: {
			retweet_count: 5,
			reply_count: 2,
			like_count: 10,
			quote_count: 1,
		},
	};

	const baseMeta = {
		id: "user-1",
		username: "testuser",
		name: "Test User",
		created_at: "2020-01-01T00:00:00.000Z",
		verified: false,
		verified_type: "none" as const,
		protected: false,
		public_metrics: {
			followers_count: 100,
			following_count: 50,
			tweet_count: 1,
			listed_count: 1,
		},
		fetched_at: "2024-06-15T12:00:00.000Z",
	};

	test("empty data returns empty array", () => {
		const data: TwitterTimelineData = { tweets: [], media: [], meta: null };
		expect(normalizeTwitter(data)).toEqual([]);
	});

	test("normalizes tweet to timeline item", () => {
		const data: TwitterTimelineData = {
			tweets: [baseTweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		expect(items.length).toBe(1);

		const item = items[0];
		expect(item.id).toBe("twitter:tweet:tweet-1");
		expect(item.platform).toBe("twitter");
		expect(item.type).toBe("post");
		expect(item.timestamp).toBe("2024-06-15T10:00:00.000Z");
		expect(item.url).toBe("https://twitter.com/testuser/status/tweet-1");
		if (item.payload.type === "post") {
			expect(item.payload.content).toBe("Hello Twitter!");
			expect(item.payload.author_handle).toBe("testuser");
			expect(item.payload.author_name).toBe("Test User");
			expect(item.payload.reply_count).toBe(2);
			expect(item.payload.repost_count).toBe(6);
			expect(item.payload.like_count).toBe(10);
			expect(item.payload.has_media).toBe(false);
			expect(item.payload.is_reply).toBe(false);
			expect(item.payload.is_repost).toBe(false);
		}
	});

	test("detects retweet via referenced_tweets", () => {
		const tweet = {
			...baseTweet,
			referenced_tweets: [{ type: "retweeted" as const, id: "original-1" }],
		};
		const data: TwitterTimelineData = {
			tweets: [tweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		if (items[0].payload.type === "post") {
			expect(items[0].payload.is_repost).toBe(true);
		}
	});

	test("detects reply via in_reply_to_user_id", () => {
		const tweet = {
			...baseTweet,
			in_reply_to_user_id: "other-user",
		};
		const data: TwitterTimelineData = {
			tweets: [tweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		if (items[0].payload.type === "post") {
			expect(items[0].payload.is_reply).toBe(true);
		}
	});

	test("detects media via attachments.media_keys", () => {
		const tweet = {
			...baseTweet,
			attachments: { media_keys: ["mk-1", "mk-2"] },
		};
		const data: TwitterTimelineData = {
			tweets: [tweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		if (items[0].payload.type === "post") {
			expect(items[0].payload.has_media).toBe(true);
		}
	});

	test("no media when attachments is undefined", () => {
		const data: TwitterTimelineData = {
			tweets: [baseTweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		if (items[0].payload.type === "post") {
			expect(items[0].payload.has_media).toBe(false);
		}
	});

	test("uses 'i' as username fallback when meta is null", () => {
		const data: TwitterTimelineData = {
			tweets: [baseTweet],
			media: [],
			meta: null,
		};
		const items = normalizeTwitter(data);
		expect(items[0].url).toBe("https://twitter.com/i/status/tweet-1");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.author_handle).toBe("user-1");
		}
	});

	test("repost_count combines retweets and quotes", () => {
		const data: TwitterTimelineData = {
			tweets: [baseTweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		if (items[0].payload.type === "post") {
			expect(items[0].payload.repost_count).toBe(5 + 1);
		}
	});

	test("truncates long tweet text in title", () => {
		const tweet = { ...baseTweet, text: "a".repeat(200) };
		const data: TwitterTimelineData = {
			tweets: [tweet],
			media: [],
			meta: baseMeta,
		};
		const items = normalizeTwitter(data);
		expect(items[0].title.length).toBeLessThanOrEqual(72);
		expect(items[0].title.endsWith("...")).toBe(true);
	});
});

describe("normalizeReddit", () => {
	const basePost = {
		id: "post-1",
		name: "t3_post1",
		title: "Test post title",
		selftext: "This is a self post",
		url: "https://reddit.com/r/test/comments/post1/test",
		permalink: "/r/test/comments/post1/test",
		subreddit: "test",
		subreddit_prefixed: "r/test",
		author: "test-user",
		created_utc: 1718445600,
		score: 42,
		num_comments: 5,
		is_self: true,
		is_video: false,
	};

	const baseComment = {
		id: "comment-1",
		name: "t1_comment1",
		body: "Great post!",
		permalink: "/r/test/comments/post1/test/comment1",
		link_id: "t3_post1",
		link_title: "Test post title",
		link_permalink: "/r/test/comments/post1/test",
		subreddit: "test",
		subreddit_prefixed: "r/test",
		author: "test-user",
		created_utc: 1718445600,
		score: 10,
		is_submitter: false,
		stickied: false,
		edited: false,
		parent_id: "t3_post1",
	};

	test("empty data returns empty array", () => {
		const data: RedditTimelineData = { posts: [], comments: [] };
		expect(normalizeReddit(data, "user")).toEqual([]);
	});

	test("normalizes post to timeline item", () => {
		const data: RedditTimelineData = { posts: [basePost], comments: [] };
		const items = normalizeReddit(data, "test-user");
		expect(items.length).toBe(1);

		const item = items[0];
		expect(item.id).toBe("reddit:post:post-1");
		expect(item.platform).toBe("reddit");
		expect(item.type).toBe("post");
		expect(item.timestamp).toBe(new Date(1718445600 * 1000).toISOString());
		expect(item.title).toBe("Test post title");
		expect(item.url).toBe("https://reddit.com/r/test/comments/post1/test");
		if (item.payload.type === "post") {
			expect(item.payload.author_handle).toBe("test-user");
			expect(item.payload.reply_count).toBe(5);
			expect(item.payload.like_count).toBe(42);
			expect(item.payload.has_media).toBe(false);
			expect(item.payload.is_reply).toBe(false);
			expect(item.payload.is_repost).toBe(false);
			expect(item.payload.subreddit).toBe("test");
		}
	});

	test("self post uses selftext as content", () => {
		const data: RedditTimelineData = { posts: [basePost], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.content).toBe("This is a self post");
		}
	});

	test("link post uses url as content", () => {
		const link_post = {
			...basePost,
			is_self: false,
			url: "https://example.com/article",
		};
		const data: RedditTimelineData = { posts: [link_post], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.content).toContain("https://example.com/article");
		}
	});

	test("detects media for video posts", () => {
		const video_post = { ...basePost, is_video: true };
		const data: RedditTimelineData = { posts: [video_post], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.has_media).toBe(true);
		}
	});

	test("detects media for imgur links", () => {
		const imgur_post = {
			...basePost,
			is_self: false,
			url: "https://imgur.com/abc123",
		};
		const data: RedditTimelineData = { posts: [imgur_post], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.has_media).toBe(true);
		}
	});

	test("detects media for i.redd.it links", () => {
		const reddit_img = {
			...basePost,
			is_self: false,
			url: "https://i.redd.it/abc123.jpg",
		};
		const data: RedditTimelineData = { posts: [reddit_img], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.has_media).toBe(true);
		}
	});

	test("normalizes comment to timeline item", () => {
		const data: RedditTimelineData = { posts: [], comments: [baseComment] };
		const items = normalizeReddit(data, "test-user");
		expect(items.length).toBe(1);

		const item = items[0];
		expect(item.id).toBe("reddit:comment:comment-1");
		expect(item.platform).toBe("reddit");
		expect(item.type).toBe("comment");
		expect(item.url).toBe("https://reddit.com/r/test/comments/post1/test/comment1");
		if (item.payload.type === "comment") {
			expect(item.payload.content).toBe("Great post!");
			expect(item.payload.author_handle).toBe("test-user");
			expect(item.payload.parent_title).toBe("Test post title");
			expect(item.payload.subreddit).toBe("test");
			expect(item.payload.score).toBe(10);
			expect(item.payload.is_op).toBe(false);
		}
	});

	test("comment parent_url prepends https://reddit.com for relative links", () => {
		const data: RedditTimelineData = { posts: [], comments: [baseComment] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "comment") {
			expect(items[0].payload.parent_url).toBe("https://reddit.com/r/test/comments/post1/test");
		}
	});

	test("comment parent_url preserves absolute links", () => {
		const comment = {
			...baseComment,
			link_permalink: "https://reddit.com/r/test/comments/post1/test",
		};
		const data: RedditTimelineData = { posts: [], comments: [comment] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "comment") {
			expect(items[0].payload.parent_url).toBe("https://reddit.com/r/test/comments/post1/test");
		}
	});

	test("posts and comments combined", () => {
		const data: RedditTimelineData = {
			posts: [basePost],
			comments: [baseComment],
		};
		const items = normalizeReddit(data, "test-user");
		expect(items.length).toBe(2);
		expect(items[0].type).toBe("post");
		expect(items[1].type).toBe("comment");
	});

	test("truncates long post content", () => {
		const post = { ...basePost, selftext: "a".repeat(300) };
		const data: RedditTimelineData = { posts: [post], comments: [] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "post") {
			expect(items[0].payload.content.length).toBeLessThanOrEqual(200);
		}
	});

	test("is_submitter maps to is_op", () => {
		const op_comment = { ...baseComment, is_submitter: true };
		const data: RedditTimelineData = { posts: [], comments: [op_comment] };
		const items = normalizeReddit(data, "test-user");
		if (items[0].payload.type === "comment") {
			expect(items[0].payload.is_op).toBe(true);
		}
	});
});
