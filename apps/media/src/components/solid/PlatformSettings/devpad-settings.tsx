import { Checkbox } from "@f0rbit/ui";
import { createSignal } from "solid-js";
import { run_task } from "@/lib/run-task";
import { getClient } from "@/utils/client";

type Props = {
	accountId: string;
	settings: { hidden_projects?: string[]; all_projects?: boolean } | null;
	onUpdate: () => void;
};

export default function DevpadSettings(props: Props) {
	const [updating, setUpdating] = createSignal(false);

	const allProjects = () => props.settings?.all_projects ?? true;

	const updateSetting = async (key: string, value: boolean) => {
		setUpdating(true);
		const result = await getClient().media.connections.settings.update(props.accountId, {
			...props.settings,
			[key]: value,
		});
		setUpdating(false);
		if (!result.ok) {
			console.error("[DevpadSettings] Failed to update setting:", result.error);
			return;
		}
		props.onUpdate();
	};

	return (
		<div class="settings-section">
			<h6 class="settings-title tertiary text-sm font-medium">Project Filters</h6>
			<div class="filter-toggles">
				<Checkbox
					checked={allProjects()}
					onChange={() => {
						run_task(updateSetting("all_projects", !allProjects()), { component: "devpad-settings" });
					}}
					label="Include all projects"
					disabled={updating()}
				/>
			</div>
			<p class="muted text-xs">Project-level filtering coming soon.</p>
		</div>
	);
}
