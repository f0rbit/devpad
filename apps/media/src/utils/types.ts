import type { CommitGroup, DateGroup, GitHubRepo, PlatformSettings, TimelineItem } from "@devpad/schema/media";

export type { CommentPayload, CommitGroup, CommitPayload, DateGroup, GitHubRepo, Platform, PlatformSettings, PostPayload, PRCommit, PullRequestPayload, TimelineItem, TimelineType } from "@devpad/schema/media";

export type Connection = {
	account_id: string;
	platform: string;
	platform_username: string | null;
	is_active: boolean;
	last_fetched_at: string | null;
	created_at: string;
};

export type ConnectionWithSettings = Connection & {
	settings?: PlatformSettings;
};

export type ConnectionsResponse = {
	accounts: Connection[];
};

export type ConnectionsWithSettingsResponse = {
	accounts: ConnectionWithSettings[];
};

export type TimelineEntry = TimelineItem | CommitGroup;

export type TimelineGroup = DateGroup;

export type TimelineResponse = {
	data: {
		groups: TimelineGroup[];
	};
	meta: {
		version: string;
		generated_at: string;
		github_usernames?: string[];
	};
};

export type ProfileSummary = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
};

export type ProfilesListResponse = {
	profiles: ProfileSummary[];
};

export type ProfileTimelineResponse = {
	meta: {
		profile_id: string;
		profile_slug: string;
		profile_name: string;
		generated_at: string;
	};
	data: {
		groups: TimelineGroup[];
	};
};

export type ProfileWithRelations = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	filters: Array<{
		id: string;
		account_id: string;
		filter_type: "include" | "exclude";
		filter_key: string;
		filter_value: string;
	}>;
};

export type ProfileDetailResponse = {
	profile: ProfileWithRelations;
};

export type CredentialStatus = {
	exists: boolean;
	isVerified: boolean;
	clientId: string | null;
};

export type SaveCredentialsRequest = {
	profile_id: string;
	client_id: string;
	client_secret: string;
	redirect_uri?: string;
};

export type SaveCredentialsResponse = {
	success: boolean;
	id: string;
	message: string;
};
