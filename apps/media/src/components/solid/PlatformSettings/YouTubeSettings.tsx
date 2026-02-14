import { Checkbox } from "@f0rbit/ui";
import { createSignal, Show } from "solid-js";
import { getClient } from "@/utils/client";

type Props = {
	accountId: string;
	settings: { include_watch_history?: boolean; include_liked?: boolean; channel_name?: string } | null;
	onUpdate: () => void;
};

export default function YouTubeSettings(props: Props) {
	const [updating, setUpdating] = createSignal(false);

	const includeWatchHistory = () => props.settings?.include_watch_history ?? true;
	const includeLiked = () => props.settings?.include_liked ?? false;

	const updateSetting = async (key: string, value: boolean) => {
		setUpdating(true);
		await getClient().media.connections.settings.update(props.accountId, {
			...props.settings,
			[key]: value,
		});
		setUpdating(false);
		props.onUpdate();
	};

	return (
		<div class="settings-section">
			<h6 class="settings-title tertiary text-sm font-medium">Channel Settings</h6>
			<Show when={props.settings?.channel_name}>
				<p class="muted text-sm">Channel: {props.settings?.channel_name}</p>
			</Show>
			<div class="filter-toggles">
				<Checkbox checked={includeWatchHistory()} onChange={() => updateSetting("include_watch_history", !includeWatchHistory())} label="Include watch history" disabled={updating()} />
				<Checkbox checked={includeLiked()} onChange={() => updateSetting("include_liked", !includeLiked())} label="Include liked videos" disabled={updating()} />
			</div>
		</div>
	);
}
