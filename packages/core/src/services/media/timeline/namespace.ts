import { combineTimelines, groupByDate, groupCommits, type TimelineEntry } from "./grouping";
import { loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount } from "./loaders";
import { normalizeGitHub, normalizeReddit, normalizers, normalizeTwitter } from "./normalizers";
import {
	generateProfileTimeline,
	loadProfileSettings,
	type ProfileSettings,
	type ProfileTimelineError,
	type ProfileTimelineOptions,
	type ProfileTimelineResult,
} from "./profile";

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
