import { FormField, Input } from "@f0rbit/ui";
import { createSignal, Show } from "solid-js";
import { getClient } from "@/utils/client";
import { format } from "@/utils/formatters";

export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

type PlatformConfig = {
	tokenLabel: string;
	tokenPlaceholder: string;
	usernameLabel: string;
	usernamePlaceholder: string;
	helpText: string;
};

type Props = {
	platform: Platform;
	profileId: string;
	onSuccess: () => void;
};

type ManualSetupPlatform = "bluesky" | "youtube" | "devpad";

const PLATFORM_CONFIG: Record<ManualSetupPlatform, PlatformConfig> = {
	bluesky: {
		tokenLabel: "App Password",
		tokenPlaceholder: "xxxx-xxxx-xxxx-xxxx",
		usernameLabel: "Handle",
		usernamePlaceholder: "user.bsky.social",
		helpText: "Create an app password in Settings > App Passwords",
	},
	youtube: {
		tokenLabel: "API Key",
		tokenPlaceholder: "AIzaSy...",
		usernameLabel: "Channel ID",
		usernamePlaceholder: "UC...",
		helpText: "Get an API key from console.developers.google.com",
	},
	devpad: {
		tokenLabel: "API Token",
		tokenPlaceholder: "dp_...",
		usernameLabel: "Username",
		usernamePlaceholder: "your-username",
		helpText: "Generate a token in your Devpad settings",
	},
};

export default function PlatformSetupForm(props: Props) {
	const config = () => PLATFORM_CONFIG[props.platform as ManualSetupPlatform];

	const [token, setToken] = createSignal("");
	const [username, setUsername] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);

		const result = await getClient().media.connections.create({
			platform: props.platform,
			access_token: token(),
			platform_username: username() || undefined,
			profile_id: props.profileId,
		});

		if (!result.ok) {
			setError(result.error.message);
			setSubmitting(false);
			return;
		}

		setSubmitting(false);
		props.onSuccess();
	};

	return (
		<form onSubmit={handleSubmit} class="setup-form">
			<FormField label={config().tokenLabel} id="platform-token" required>
				<Input id="platform-token" type="password" value={token()} onInput={e => setToken(e.currentTarget.value)} placeholder={config().tokenPlaceholder} />
			</FormField>
			<FormField label={`${config().usernameLabel} (optional)`} id="platform-username" description={config().helpText}>
				<Input id="platform-username" value={username()} onInput={e => setUsername(e.currentTarget.value)} placeholder={config().usernamePlaceholder} />
			</FormField>
			<Show when={error()}>
				<p class="error-icon text-sm">{error()}</p>
			</Show>
			<button type="submit" disabled={submitting() || !token()}>
				{submitting() ? "Connecting..." : `Connect ${format.platform(props.platform)}`}
			</button>
		</form>
	);
}
