import type {
	Account,
	CommitGroup,
	DateGroup,
	PlatformSettings,
	Profile,
	Timeline,
	TimelineItem,
} from "@devpad/schema/media";

export type {
	CommentPayload,
	CommitGroup,
	CommitPayload,
	DateGroup,
	GitHubRepo,
	Platform,
	PlatformSettings,
	PostPayload,
	PRCommit,
	PullRequestPayload,
	TimelineItem,
	TimelineType,
} from "@devpad/schema/media";

export type Connection = Account;

export type ConnectionWithSettings = Account & {
	settings?: PlatformSettings;
};

export type TimelineEntry = TimelineItem | CommitGroup;

export type TimelineGroup = DateGroup;

export type ProfileSummary = Profile;

export type ProfileTimelineResponse = Timeline;
