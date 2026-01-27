import type { Backend } from "@f0rbit/corpus";
import type { TimelineItem } from "@devpad/schema/media";
import type { AppContext } from "../infrastructure/context";
import type { RawSnapshot } from "../sync";
import type { Result } from "../utils";
import type { ServiceError } from "../utils/route-helpers";
import { type TimelineEntry, combineTimelines, groupByDate, groupCommits } from "./grouping";
import { loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount } from "./loaders";
import { normalizeGitHub, normalizeReddit, normalizeTwitter, normalizers } from "./normalizers";
import { type ProfileSettings, type ProfileTimelineError, type ProfileTimelineOptions, type ProfileTimelineResult, generateProfileTimeline, loadProfileSettings } from "./profile";

type TimelineOptions = {
	from?: string;
	to?: string;
};

type TimelineResult = {
	meta: { version: string | number; created_at: string | Date; github_usernames: string[] };
	data: { groups: { date: string; items: TimelineEntry[] }[] };
};

export const timeline = {
	// === Grouping ===
	combine: combineTimelines,
	group: groupCommits,
	byDate: groupByDate,

	// === Loaders ===
	loaders: {
		github: loadGitHubDataForAccount,
		reddit: loadRedditDataForAccount,
		twitter: loadTwitterDataForAccount,
	},

	// === Normalizers ===
	normalizers: {
		github: normalizeGitHub,
		reddit: normalizeReddit,
		twitter: normalizeTwitter,
		all: normalizers,
	},

	// === Profile Timeline ===
	profile: {
		generate: generateProfileTimeline,
		load: loadProfileSettings,
	},
};

export type { TimelineEntry, ProfileTimelineOptions, ProfileTimelineResult, ProfileSettings, ProfileTimelineError };
