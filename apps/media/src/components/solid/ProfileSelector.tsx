import { Button, Chevron, Dropdown, DropdownDivider, DropdownItem, DropdownMenu, DropdownTrigger } from "@f0rbit/ui";
import { Check, Plus, Users } from "lucide-solid";
import { createEffect, createResource, For, on, Show } from "solid-js";
import { isServer } from "solid-js/web";
import { getClient } from "../../utils/client";
import type { ProfileSummary } from "../../utils/types";

type AuthState = { authenticated: true; profiles: ProfileSummary[] } | { authenticated: false };

export type ProfileSelectorProps = {
	currentSlug: string | null;
	initialProfiles?: ProfileSummary[];
	isAuthenticated?: boolean;
};

const fetchAuthAndProfiles = async (initial?: AuthState): Promise<AuthState> => {
	// If we have SSR data, use it directly without fetching
	if (initial !== undefined) {
		return initial;
	}

	if (isServer) {
		return { authenticated: false };
	}

	const result = await getClient().media.profiles.list();
	if (!result.ok) {
		if (result.error.status === 401) {
			return { authenticated: false };
		}
		console.error("[ProfileSelector] Failed to fetch profiles:", result.error);
		return { authenticated: true, profiles: [] };
	}
	return { authenticated: true, profiles: result.value as ProfileSummary[] };
};

const getSlugFromUrl = () => {
	if (isServer) return null;
	return new URLSearchParams(window.location.search).get("profile");
};

const buildUrl = (path: string, slug: string | null) => {
	if (!slug) return path;
	return `${path}?profile=${encodeURIComponent(slug)}`;
};

export default function ProfileSelector(props: ProfileSelectorProps) {
	const initialState = (): AuthState | undefined => {
		if (props.initialProfiles !== undefined) {
			return props.isAuthenticated !== false ? { authenticated: true, profiles: props.initialProfiles } : { authenticated: false };
		}
		return undefined;
	};

	const [authState] = createResource(
		() => initialState(),
		initial => fetchAuthAndProfiles(initial)
	);

	const currentSlug = () => getSlugFromUrl() ?? props.currentSlug;

	const hasInitialData = () => props.initialProfiles !== undefined;

	const profileList = () => {
		if (hasInitialData() && !authState()) {
			return props.initialProfiles ?? [];
		}
		const state = authState();
		if (!state?.authenticated) return props.initialProfiles ?? [];
		return state.profiles;
	};

	const isAuthenticated = () => {
		const state = authState();

		if (state !== undefined) {
			return state.authenticated;
		}

		if (props.isAuthenticated !== undefined) {
			return props.isAuthenticated;
		}

		if (props.initialProfiles !== undefined && props.initialProfiles.length > 0) {
			return true;
		}

		return false;
	};

	const currentProfile = () => {
		const slug = currentSlug();
		if (!slug) return null;
		return profileList().find(p => p.slug === slug) ?? null;
	};

	const buttonLabel = () => {
		if (!hasInitialData() && authState.loading) return "Loading...";
		const profile = currentProfile();
		return profile?.name ?? "Select Profile";
	};

	createEffect(
		on(
			() => authState(),
			state => {
				if (!state?.authenticated) return;
				const list = state.profiles;
				if (list.length === 0) return;
				if (currentSlug()) return;

				const firstProfile = list[0];
				if (!firstProfile) return;

				const url = new URL(window.location.href);
				url.searchParams.set("profile", firstProfile.slug);
				window.location.href = url.toString();
			}
		)
	);

	const handleSelect = (slug: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("profile", slug);
		window.location.href = url.toString();
	};

	const handleLogin = () => {
		window.location.href = "/api/auth/login";
	};

	const handleManageProfiles = () => {
		window.location.href = buildUrl("/connections", currentSlug());
	};

	const hasNoProfiles = () => {
		if (!hasInitialData() && authState.loading) return false;
		if (!isAuthenticated()) return false;
		return profileList().length === 0;
	};

	const isLoading = () => !hasInitialData() && authState.loading;

	return (
		<Show when={!isLoading()} fallback={<div class="auth-loading" />}>
			<Show when={isAuthenticated()} fallback={<Button onClick={handleLogin}>Login</Button>}>
				<Show
					when={!hasNoProfiles()}
					fallback={
						<a href={buildUrl("/connections", currentSlug())} class="profile-selector-create-link">
							<Plus size={14} />
							<span>Create Profile</span>
						</a>
					}
				>
					<Dropdown>
						<DropdownTrigger>
							<Button variant="secondary" class="profile-selector-button">
								<Users size={16} class="profile-selector-icon" />
								<span class="profile-selector-label">{buttonLabel()}</span>
								<Chevron facing="down" size={14} />
							</Button>
						</DropdownTrigger>
						<DropdownMenu>
							<For each={profileList()}>
								{profile => (
									<DropdownItem active={currentSlug() === profile.slug} onClick={() => handleSelect(profile.slug)}>
										<Show when={currentSlug() === profile.slug}>
											<Check size={14} />
										</Show>
										{profile.name}
									</DropdownItem>
								)}
							</For>
							<DropdownDivider />
							<DropdownItem onClick={handleManageProfiles}>
								<Plus size={14} />
								Manage Profiles
							</DropdownItem>
						</DropdownMenu>
					</Dropdown>
				</Show>
			</Show>
		</Show>
	);
}
