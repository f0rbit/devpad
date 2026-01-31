import type { TimelineItem } from "@devpad/schema/media";
import type { Backend, Result } from "@f0rbit/corpus";
import type { AppContext } from "../context";
import type { ServiceError } from "../route-helpers";
import type { RawSnapshot } from "../sync";
import { combineTimelines, groupByDate, groupCommits, type TimelineEntry } from "./grouping";
import { loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount } from "./loaders";
import { normalizeGitHub, normalizeReddit, normalizers, normalizeTwitter } from "./normalizers";
import { generateProfileTimeline, loadProfileSettings, type ProfileSettings, type ProfileTimelineError, type ProfileTimelineOptions, type ProfileTimelineResult } from "./profile";

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
