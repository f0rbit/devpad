import { Checkbox, Collapsible } from "@f0rbit/ui";
import { run_task } from "@/lib/run-task";
import { useSettings } from "./use-settings";

type TwitterSettingsData = {
	include_retweets?: boolean;
	include_replies?: boolean;
	hide_sensitive?: boolean;
};

type Props = {
	accountId: string;
	settings: TwitterSettingsData | null;
	onUpdate: () => void;
};

export default function TwitterSettings(props: Props) {
	const { updating, updateSetting } = useSettings(props.accountId, props.onUpdate);

	const includeRetweets = () => props.settings?.include_retweets ?? true;
	const includeReplies = () => props.settings?.include_replies ?? false;
	const hideSensitive = () => props.settings?.hide_sensitive ?? false;

	const toggle = (key: keyof TwitterSettingsData, current: boolean) =>
		updateSetting<TwitterSettingsData>(key, !current, props.settings);

	return (
		<Collapsible trigger={<span class="settings-title tertiary text-sm font-medium">Twitter/X Settings</span>}>
			<div class="settings-content">
				<div class="filter-toggles">
					<Checkbox
						checked={includeRetweets()}
						onChange={() => {
							run_task(toggle("include_retweets", includeRetweets()), { component: "twitter-settings" });
						}}
						label="Include retweets in timeline"
						disabled={updating()}
					/>
					<Checkbox
						checked={includeReplies()}
						onChange={() => {
							run_task(toggle("include_replies", includeReplies()), { component: "twitter-settings" });
						}}
						label="Include replies in timeline"
						disabled={updating()}
					/>
					<Checkbox
						checked={hideSensitive()}
						onChange={() => {
							run_task(toggle("hide_sensitive", hideSensitive()), { component: "twitter-settings" });
						}}
						label="Hide sensitive content"
						disabled={updating()}
					/>
				</div>
				<p class="muted text-xs" style={{ "margin-top": "8px" }}>
					Note: Changes apply on next data refresh.
				</p>
			</div>
		</Collapsible>
	);
}
