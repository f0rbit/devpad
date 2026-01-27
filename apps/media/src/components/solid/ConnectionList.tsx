import { type ConnectionWithSettings, type ProfileSummary, connections, initMockAuth } from "@/utils/api";
import { Empty } from "@f0rbit/ui";
import { For, Show, createResource, createSignal } from "solid-js";
import { isServer } from "solid-js/web";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";
import { ResourceState } from "./ResourceState";

const ALL_PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad", "reddit", "twitter"];
const HIDDEN_PLATFORMS: Platform[] = ["bluesky", "youtube", "devpad"];
const PLATFORMS = ALL_PLATFORMS.filter(p => !HIDDEN_PLATFORMS.includes(p));

type ConnectionListProps = {
	profileSlug?: string | null;
	initialProfiles?: ProfileSummary[];
	initialConnections?: ConnectionWithSettings[];
};

function NoProfileSelectedError() {
	return (
		<Empty title="No profile selected" description="Please select a profile or create one.">
			<a href="/connections" class="btn">
				Manage Profiles
			</a>
		</Empty>
	);
}

export default function ConnectionList(props: ConnectionListProps) {
	const profileSlug = () => props.profileSlug ?? null;

	// Use initialProfiles directly - no need to refetch if we have SSR data
	const profileList = () => props.initialProfiles ?? [];

	const currentProfile = () => {
		const slug = profileSlug();
		const list = profileList();
		if (!slug || !list) return null;
		return list.find(p => p.slug === slug) ?? null;
	};

	const profileId = () => currentProfile()?.id ?? null;

	// Track whether we've done a client-side fetch yet
	const [hasFetched, setHasFetched] = createSignal(false);

	const [data, { refetch }] = createResource(
		() => {
			const id = profileId();
			// Can't fetch without a profile ID
			if (!id) return null;

			// Skip initial fetch if we have SSR data for this profile
			// (SSR data is valid when initialConnections exists and has items,
			// meaning the SSR fetched for the same profile)
			if (!hasFetched() && props.initialConnections && props.initialConnections.length > 0) {
				return null;
			}

			return id;
		},
		async id => {
			if (isServer) return [];
			setHasFetched(true);
			initMockAuth();
			const result = await connections.listWithSettings(id);
			if (!result.ok) throw new Error(result.error.message);
			return result.value.accounts;
		},
		{
			initialValue: props.initialConnections ?? [],
		}
	);

	const getConnection = (platform: Platform): ConnectionWithSettings | null => {
		return data()?.find(c => c.platform === platform) ?? null;
	};

	const sortedPlatforms = () => {
		const accounts = data();
		if (!accounts) return PLATFORMS;

		return [...PLATFORMS].sort((a, b) => {
			const connA = accounts.find(c => c.platform === a);
			const connB = accounts.find(c => c.platform === b);

			if (connA && !connB) return -1;
			if (!connA && connB) return 1;

			if (connA && connB) {
				if (connA.is_active && !connB.is_active) return -1;
				if (!connA.is_active && connB.is_active) return 1;
			}

			return 0;
		});
	};

	const hasValidProfile = () => !!profileSlug() && !!currentProfile();

	return (
		<div class="flex-col">
			<Show when={!profileSlug()}>
				<NoProfileSelectedError />
			</Show>

			<Show when={profileSlug() && !currentProfile()}>
				<NoProfileSelectedError />
			</Show>

			<Show when={hasValidProfile()}>
				<ResourceState resource={data} loadingMessage="Loading connections..." errorPrefix="Failed to load connections">
					{() => (
						<Show when={profileId()} keyed>
							{id => <For each={sortedPlatforms()}>{platform => <PlatformCard platform={platform} profileId={id} connection={getConnection(platform)} onConnectionChange={refetch} />}</For>}
						</Show>
					)}
				</ResourceState>
			</Show>
		</div>
	);
}
