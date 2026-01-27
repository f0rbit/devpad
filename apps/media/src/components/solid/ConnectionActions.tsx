import { connections } from "@/utils/api";
import { Button } from "@f0rbit/ui";
import { Pause, Play, RefreshCw, Trash2 } from "lucide-solid";
import { Show, createSignal } from "solid-js";

type Props = {
	accountId: string;
	isActive: boolean;
	state: "active" | "inactive";
	onAction: () => void;
};

export default function ConnectionActions(props: Props) {
	const [refreshing, setRefreshing] = createSignal(false);
	const [toggling, setToggling] = createSignal(false);
	const [deleting, setDeleting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleRefresh = async () => {
		setRefreshing(true);
		setError(null);
		const result = await connections.refresh(props.accountId);
		setRefreshing(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	const handleToggle = async () => {
		setToggling(true);
		setError(null);
		const result = await connections.update(props.accountId, { is_active: !props.isActive });
		setToggling(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	const handleDelete = async () => {
		if (!confirm("Remove this connection? This cannot be undone.")) return;
		setDeleting(true);
		setError(null);
		const result = await connections.delete(props.accountId);
		setDeleting(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	return (
		<>
			<div class="flex-row icons">
				<Show when={props.state === "active"}>
					<Button icon variant="ghost" label="Refresh data" onClick={handleRefresh} disabled={refreshing()}>
						<RefreshCw size={18} class={refreshing() ? "spinner" : ""} />
					</Button>
					<Button icon variant="ghost" label="Pause syncing" onClick={handleToggle} disabled={toggling()}>
						<Pause size={18} />
					</Button>
				</Show>
				<Show when={props.state === "inactive"}>
					<Button icon variant="ghost" label="Resume syncing" onClick={handleToggle} disabled={toggling()}>
						<Play size={18} />
					</Button>
				</Show>
				<Button icon variant="ghost" label="Remove connection" onClick={handleDelete} disabled={deleting()}>
					<Trash2 size={18} />
				</Button>
			</div>
			<Show when={error()}>
				<small class="error-text">{error()}</small>
			</Show>
		</>
	);
}
