import { type Connection, connections } from "@/utils/api";
import { format } from "@/utils/formatters";
import { Button } from "@f0rbit/ui";
import { RefreshCw, Trash2 } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import PlatformIcon from "./PlatformIcon";

type Props = {
	connection: Connection;
	onRefresh: () => void;
	onDelete: () => void;
};

export default function ConnectionCard(props: Props) {
	const [deleting, setDeleting] = createSignal(false);
	const [refreshing, setRefreshing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleDelete = async () => {
		if (!confirm("Are you sure you want to remove this connection?")) return;

		setDeleting(true);
		setError(null);

		const result = await connections.delete(props.connection.account_id);

		if (result.ok === false) {
			setError(result.error.message);
			setDeleting(false);
			return;
		}

		props.onDelete();
	};

	const handleRefresh = async () => {
		setRefreshing(true);
		setError(null);

		const result = await connections.refresh(props.connection.account_id);

		if (result.ok === false) {
			setError(result.error.message);
		}

		setRefreshing(false);
		props.onRefresh();
	};

	return (
		<div class={`card platform-${props.connection.platform}`}>
			<div class="flex-row justify-between">
				<div class="flex-row" style={{ gap: "12px" }}>
					<PlatformIcon platform={props.connection.platform} />
					<div class="flex-col" style={{ gap: "2px" }}>
						<h6>{format.platform(props.connection.platform)}</h6>
						<span class="tertiary text-sm">{props.connection.platform_username ?? "Connected"}</span>
					</div>
				</div>
				<div class="flex-row icons">
					<Button icon variant="ghost" label="Refresh data" onClick={handleRefresh} disabled={refreshing()}>
						<RefreshCw size={18} class={refreshing() ? "spinner" : ""} />
					</Button>
					<Button icon variant="ghost" label="Remove connection" onClick={handleDelete} disabled={deleting()}>
						<Trash2 size={18} />
					</Button>
				</div>
			</div>

			<Show when={props.connection.last_fetched_at} keyed>
				{lastFetched => <small class="tertiary text-xs">Last synced: {format.relative(lastFetched)}</small>}
			</Show>

			<Show when={error()}>
				<small class="error-icon">{error()}</small>
			</Show>
		</div>
	);
}
