import { Checkbox } from "@f0rbit/ui";
import { createSignal } from "solid-js";
import { getClient } from "@/utils/client";

type Props = {
	accountId: string;
	settings: { include_replies?: boolean; include_reposts?: boolean } | null;
	onUpdate: () => void;
};

export default function BlueskySettings(props: Props) {
	const [updating, setUpdating] = createSignal(false);

	const includeReplies = () => props.settings?.include_replies ?? true;
	const includeReposts = () => props.settings?.include_reposts ?? false;

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
			<h6 class="settings-title tertiary text-sm font-medium">Content Filters</h6>
			<div class="filter-toggles">
				<Checkbox checked={true} onChange={() => {}} label="Include my posts" disabled />
				<Checkbox checked={includeReplies()} onChange={() => updateSetting("include_replies", !includeReplies())} label="Include replies" disabled={updating()} />
				<Checkbox checked={includeReposts()} onChange={() => updateSetting("include_reposts", !includeReposts())} label="Include reposts" disabled={updating()} />
			</div>
		</div>
	);
}
