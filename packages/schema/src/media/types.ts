import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";

export {
	media_account_settings as accountSettings,
	media_accounts as accounts,
	media_platform_credentials as platformCredentials,
	media_profile_filters as profileFilters,
	media_profiles as profiles,
	media_rate_limits as rateLimits,
} from "../database/media.js";
export { api_keys as apiKeys } from "../database/schema.js";
export * from "../errors.js";
export * from "./branded.js";

import type {
	media_account_settings as accountSettings,
	media_accounts as accounts,
	media_platform_credentials as platformCredentials,
	media_profile_filters as profileFilters,
	media_profiles as profiles,
	media_rate_limits as rateLimits,
} from "../database/media.js";
import type { api_keys as apiKeys } from "../database/schema.js";

export type Profile = InferSelectModel<typeof profiles>;
export type NewProfile = InferInsertModel<typeof profiles>;
export type ProfileFilter = InferSelectModel<typeof profileFilters>;
export type NewProfileFilter = InferInsertModel<typeof profileFilters>;
export type PlatformCredential = InferSelectModel<typeof platformCredentials>;
export type NewPlatformCredential = InferInsertModel<typeof platformCredentials>;

export {
	type GitHubMetaStore,
	GitHubMetaStoreSchema,
	type GitHubRepoCommit,
	GitHubRepoCommitSchema,
	type GitHubRepoCommitsStore,
	GitHubRepoCommitsStoreSchema,
	type GitHubRepoMeta,
	GitHubRepoMetaSchema,
	type GitHubRepoPR,
	GitHubRepoPRSchema,
	type GitHubRepoPRsStore,
	GitHubRepoPRsStoreSchema,
	type RedditComment,
	RedditCommentSchema,
	type RedditCommentsStore,
	RedditCommentsStoreSchema,
	type RedditMetaStore,
	RedditMetaStoreSchema,
	type RedditPost,
	RedditPostSchema,
	type RedditPostsStore,
	RedditPostsStoreSchema,
	type TweetMedia,
	TweetMediaSchema,
	type TweetMetrics,
	TweetMetricsSchema,
	type TweetUrl,
	TweetUrlSchema,
	type TwitterMetaStore,
	TwitterMetaStoreSchema,
	type TwitterTweet,
	TwitterTweetSchema,
	type TwitterTweetsStore,
	TwitterTweetsStoreSchema,
	type TwitterUserMetrics,
	TwitterUserMetricsSchema,
} from "./platforms/index.js";
export type { MultiStorePlatform, Platform } from "./platforms.js";
export {
	BlueskyAuthorSchema,
	BlueskyFeedItemSchema,
	BlueskyPostSchema,
	BlueskyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubBaseEventSchema,
	GitHubEventSchema,
	GitHubExtendedCommitSchema,
	GitHubPullRequestSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	isMultiStorePlatform,
	MULTI_STORE_PLATFORMS,
	PLATFORMS,
	PlatformSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms.js";
export {
	type AddFilterInput,
	AddFilterSchema,
	type CreateProfileInput,
	CreateProfileSchema,
	type FilterKey,
	FilterKeySchema,
	type FilterType,
	FilterTypeSchema,
	SlugSchema,
	type UpdateProfileInput,
	UpdateProfileSchema,
} from "./profiles.js";
export {
	type BlueskySettings,
	BlueskySettingsSchema,
	type DevpadSettings,
	DevpadSettingsSchema,
	type GitHubSettings,
	GitHubSettingsSchema,
	type PlatformSettings,
	PlatformSettingsSchemaMap,
	type YouTubeSettings,
	YouTubeSettingsSchema,
} from "./settings.js";
export type {
	CommentPayload,
	CommitGroup,
	CommitPayload,
	DateGroup,
	Payload,
	PostPayload,
	PRCommit,
	PullRequestPayload,
	TaskPayload,
	Timeline,
	TimelineItem,
	TimelineType,
	VideoPayload,
} from "./timeline.js";
export {
	CommentPayloadSchema,
	CommitGroupSchema,
	CommitPayloadSchema,
	DateGroupSchema,
	PayloadSchema,
	PostPayloadSchema,
	PullRequestPayloadSchema,
	TaskPayloadSchema,
	TimelineItemSchema,
	TimelineSchema,
	TimelineTypeSchema,
	VideoPayloadSchema,
} from "./timeline.js";

import type {
	BlueskyAuthorSchema,
	BlueskyFeedItemSchema,
	BlueskyPostSchema,
	BlueskyRawSchema,
	DevpadRawSchema,
	DevpadTaskSchema,
	GitHubBaseEventSchema,
	GitHubEventSchema,
	GitHubExtendedCommitSchema,
	GitHubPullRequestSchema,
	GitHubRawSchema,
	GitHubRepoSchema,
	YouTubeRawSchema,
	YouTubeThumbnailSchema,
	YouTubeVideoSchema,
} from "./platforms.js";

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;
export type GitHubExtendedCommit = z.infer<typeof GitHubExtendedCommitSchema>;
export type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>;
export type GitHubBaseEvent = z.infer<typeof GitHubBaseEventSchema>;
export type GitHubEvent = z.infer<typeof GitHubEventSchema>;
export type GitHubRaw = z.infer<typeof GitHubRawSchema>;

export type BlueskyAuthor = z.infer<typeof BlueskyAuthorSchema>;
export type BlueskyPost = z.infer<typeof BlueskyPostSchema>;
export type BlueskyFeedItem = z.infer<typeof BlueskyFeedItemSchema>;
export type BlueskyRaw = z.infer<typeof BlueskyRawSchema>;

export type YouTubeThumbnail = z.infer<typeof YouTubeThumbnailSchema>;
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;
export type YouTubeRaw = z.infer<typeof YouTubeRawSchema>;

export type DevpadTask = z.infer<typeof DevpadTaskSchema>;
export type DevpadRaw = z.infer<typeof DevpadRawSchema>;

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type AccountWithUser = {
	id: string;
	profile_id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
	user_id: string;
	last_fetched_at?: string | null;
};

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type RateLimit = InferSelectModel<typeof rateLimits>;
export type NewRateLimit = InferInsertModel<typeof rateLimits>;

export type AccountSetting = InferSelectModel<typeof accountSettings>;
export type NewAccountSetting = InferInsertModel<typeof accountSettings>;

export type CorpusPath = `media/raw/github/${string}` | `media/raw/bluesky/${string}` | `media/raw/youtube/${string}` | `media/raw/devpad/${string}` | `media/timeline/${string}`;
