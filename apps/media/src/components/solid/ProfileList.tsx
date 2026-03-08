import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Empty, FormField, Input } from "@f0rbit/ui";
import { Check, Copy, Eye, Pencil, Plus, Trash2 } from "lucide-solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { isServer } from "solid-js/web";
import { apiUrls, getClient } from "@/utils/client";
import { ErrorDisplay, Loading } from "./ResourceState";

type ProfileFilter = {
	id: string;
	account_id: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

type Profile = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	filters?: ProfileFilter[];
};

const fetchProfiles = async (): Promise<Profile[]> => {
	if (isServer) return [];
	const result = await getClient().media.profiles.list();
	if (!result.ok) {
		console.error("[ProfileList] Failed to fetch profiles:", result.error);
		throw new Error(result.error.message);
	}
	return result.value as Profile[];
};

const createProfile = async (data: { slug: string; name: string; description?: string }): Promise<Profile> => {
	const result = await getClient().media.profiles.create(data);
	if (!result.ok) throw new Error(result.error.message);
	return result.value as Profile;
};

const deleteProfile = async (id: string): Promise<void> => {
	const result = await getClient().media.profiles.delete(id);
	if (!result.ok) throw new Error(result.error.message);
};

const updateProfile = async (id: string, data: { slug?: string; name?: string; description?: string | null }): Promise<Profile> => {
	const result = await getClient().media.profiles.update(id, data);
	if (!result.ok) throw new Error(result.error.message);
	return result.value as Profile;
};

export type ProfileSummary = Profile;

type ProfileListProps = {
	initialProfiles?: ProfileSummary[];
};

// Read profile slug from URL
const getSlugFromUrl = () => {
	if (isServer) return null;
	return new URLSearchParams(window.location.search).get("profile");
};

export default function ProfileList(props: ProfileListProps) {
	const [fetchTrigger, setFetchTrigger] = createSignal(0);

	const [profiles, { refetch }] = createResource(
		() => {
			const trigger = fetchTrigger();
			// Skip initial fetch if we have SSR data
			if (trigger === 0 && props.initialProfiles && props.initialProfiles.length > 0) {
				return null;
			}
			return trigger;
		},
		fetchProfiles,
		{ initialValue: props.initialProfiles ?? [] }
	);
	const currentSlug = () => getSlugFromUrl();
	const [editingProfile, setEditingProfile] = createSignal<Profile | null>(null);
	const [showCreateForm, setShowCreateForm] = createSignal(false);
	const [copiedSlug, setCopiedSlug] = createSignal<string | null>(null);

	const getApiEndpoint = (slug: string): string => `${apiUrls.profiles(`/${slug}/timeline`)}`;

	const handleCopy = async (slug: string) => {
		const endpoint = getApiEndpoint(slug);
		await navigator.clipboard.writeText(endpoint);
		setCopiedSlug(slug);
		setTimeout(() => setCopiedSlug(null), 2000);
	};

	const handleDelete = async (profile: Profile) => {
		if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return;
		await deleteProfile(profile.id);
		refetch();
	};

	const handleViewTimeline = (slug: string) => {
		window.location.href = `/timeline?profile=${encodeURIComponent(slug)}`;
	};

	return (
		<div class="stack stack-lg">
			<div class="row row-between" style={{ gap: "4px" }}>
				<h6 class="text-muted font-medium">Your Profiles</h6>
				<Button size="sm" onClick={() => setShowCreateForm(true)}>
					<span class="row row-sm">
						<Plus size={16} />
						Create Profile
					</span>
				</Button>
			</div>

			<Show when={showCreateForm()}>
				<CreateProfileForm
					onSuccess={newProfile => {
						setShowCreateForm(false);
						// Reload page to refresh SSR components (ProfileSelector in header)
						// Navigate to the new profile
						window.location.href = `/connections?profile=${encodeURIComponent(newProfile.slug)}`;
					}}
					onCancel={() => setShowCreateForm(false)}
				/>
			</Show>

			<Show when={profiles.loading}>
				<Loading message="Loading profiles..." />
			</Show>

			<Show when={profiles.error}>
				<ErrorDisplay prefix="Failed to load profiles" message={profiles.error.message} />
			</Show>

			<Show when={!profiles.loading && !profiles.error && profiles()?.length === 0}>
				<Empty title="No profiles yet" description="Create a profile to share a curated timeline with specific platforms visible." />
			</Show>

			<Show when={!profiles.loading && !profiles.error && (profiles()?.length ?? 0) > 0}>
				<For each={profiles()}>
					{profile => (
						<Show
							when={editingProfile()?.id === profile.id}
							fallback={
								<ProfileCard
									profile={profile}
									isCurrent={currentSlug() === profile.slug}
									onView={() => handleViewTimeline(profile.slug)}
									onEdit={() => setEditingProfile(profile)}
									onDelete={() => handleDelete(profile)}
									onCopy={() => handleCopy(profile.slug)}
									copied={copiedSlug() === profile.slug}
								/>
							}
						>
							<EditProfileForm
								profile={profile}
								onSuccess={() => {
									setEditingProfile(null);
									refetch();
								}}
								onCancel={() => setEditingProfile(null)}
							/>
						</Show>
					)}
				</For>
			</Show>
		</div>
	);
}

type ProfileCardProps = {
	profile: Profile;
	isCurrent: boolean;
	onView: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onCopy: () => void;
	copied: boolean;
};

function ProfileCard(props: ProfileCardProps) {
	const endpoint = apiUrls.profiles(`/${props.profile.slug}/timeline`);

	return (
		<Card class={props.isCurrent ? "card-active" : ""}>
			<CardHeader class="row row-between items-start" style={{ gap: "4px" }}>
				<div class="stack stack-sm" style={{ gap: "2px" }}>
					<div class="row items-center">
						<CardTitle>{props.profile.name}</CardTitle>
						<Show when={props.isCurrent}>
							<Badge variant="success">Currently Viewing</Badge>
						</Show>
					</div>
					<CardDescription>/{props.profile.slug}</CardDescription>
				</div>
				<div class="row row-sm">
					<Button icon variant="ghost" label="View timeline" onClick={props.onView}>
						<Eye size={16} />
					</Button>
					<Button icon variant="ghost" label="Edit profile" onClick={props.onEdit}>
						<Pencil size={16} />
					</Button>
					<Button icon variant="ghost" label="Delete profile" onClick={props.onDelete}>
						<Trash2 size={16} />
					</Button>
				</div>
			</CardHeader>

			<Show when={props.profile.description}>
				<CardContent>
					<p class="tertiary text-sm">{props.profile.description}</p>
				</CardContent>
			</Show>

			<CardFooter class="row items-center">
				<code class="text-xs font-mono truncate" style={{ flex: "1", padding: "4px 8px", background: "var(--bg-alt)", "border-radius": "4px", border: "1px solid var(--border)" }}>
					{endpoint}
				</code>
				<Button icon variant="ghost" label={props.copied ? "Copied!" : "Copy endpoint"} onClick={props.onCopy}>
					<Show when={props.copied} fallback={<Copy size={16} />}>
						<Check size={16} style={{ color: "var(--success-fg)" }} />
					</Show>
				</Button>
			</CardFooter>
		</Card>
	);
}

type CreateProfileFormProps = {
	onSuccess: (profile: Profile) => void;
	onCancel: () => void;
};

function CreateProfileForm(props: CreateProfileFormProps) {
	const [name, setName] = createSignal("");
	const [slug, setSlug] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	const handleNameChange = (value: string) => {
		setName(value);
		const generatedSlug = value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		setSlug(generatedSlug);
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!name().trim() || !slug().trim()) {
			setError("Name and slug are required");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			const newProfile = await createProfile({
				name: name().trim(),
				slug: slug().trim(),
				description: description().trim() || undefined,
			});
			props.onSuccess(newProfile);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create profile");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Card>
			<form onSubmit={handleSubmit}>
				<CardHeader>
					<CardTitle>Create New Profile</CardTitle>
				</CardHeader>

				<CardContent class="stack stack-sm" style={{ gap: "12px" }}>
					<FormField label="Name" id="create-profile-name">
						<Input id="create-profile-name" value={name()} onInput={e => handleNameChange(e.currentTarget.value)} placeholder="My Public Timeline" />
					</FormField>

					<FormField label="Slug (URL path)" id="create-profile-slug">
						<Input id="create-profile-slug" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
					</FormField>

					<FormField label="Description (optional)" id="create-profile-description">
						<Input id="create-profile-description" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
					</FormField>

					<Show when={error()}>
						<p class="text-sm" style={{ color: "var(--error-fg)" }}>
							{error()}
						</p>
					</Show>
				</CardContent>

				<CardFooter class="row row-end">
					<Button variant="secondary" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" loading={submitting()}>
						Create Profile
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

type EditProfileFormProps = {
	profile: Profile;
	onSuccess: () => void;
	onCancel: () => void;
};

function EditProfileForm(props: EditProfileFormProps) {
	const [name, setName] = createSignal(props.profile.name);
	const [slug, setSlug] = createSignal(props.profile.slug);
	const [description, setDescription] = createSignal(props.profile.description ?? "");
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!name().trim() || !slug().trim()) {
			setError("Name and slug are required");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			await updateProfile(props.profile.id, {
				name: name().trim(),
				slug: slug().trim(),
				description: description().trim() || null,
			});
			props.onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update profile");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Card>
			<form onSubmit={handleSubmit}>
				<CardHeader>
					<CardTitle>Edit Profile</CardTitle>
				</CardHeader>

				<CardContent class="stack stack-sm" style={{ gap: "12px" }}>
					<FormField label="Name" id="edit-profile-name">
						<Input id="edit-profile-name" value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="My Public Timeline" />
					</FormField>

					<FormField label="Slug (URL path)" id="edit-profile-slug">
						<Input id="edit-profile-slug" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
					</FormField>

					<FormField label="Description (optional)" id="edit-profile-description">
						<Input id="edit-profile-description" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
					</FormField>

					<Show when={error()}>
						<p class="text-sm" style={{ color: "var(--error-fg)" }}>
							{error()}
						</p>
					</Show>
				</CardContent>

				<CardFooter class="row row-end">
					<Button variant="secondary" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" loading={submitting()}>
						Save Changes
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
