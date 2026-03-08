import { Button } from "@f0rbit/ui";
import { RefreshCw, Trash2 } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { getClient } from "@/utils/client";
import { format } from "@/utils/formatters";
import type { Connection } from "@/utils/types";
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

		const result = await getClient().media.connections.delete(props.connection.account_id);

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

		const result = await getClient().media.connections.refresh(props.connection.account_id);

		if (result.ok === false) {
			setError(result.error.message);
		}

		setRefreshing(false);
		props.onRefresh();
	};

	return (
		<div class={`card platform-${props.connection.platform}`}>
			<div class="row row-between" style={{ gap: "4px" }}>
				<div class="row" style={{ gap: "12px" }}>
					<PlatformIcon platform={props.connection.platform} />
					<div class="stack stack-sm" style={{ gap: "2px" }}>
						<h6>{format.platform(props.connection.platform)}</h6>
						<span class="tertiary text-sm">{props.connection.platform_username ?? "Connected"}</span>
					</div>
				</div>
				<div class="row row-sm">
					<Button icon variant="ghost" label="Refresh data" onClick={handleRefresh} disabled={refreshing()}>
						<RefreshCw size={16} class={refreshing() ? "animate-spin" : ""} />
					</Button>
					<Button icon variant="ghost" label="Remove connection" onClick={handleDelete} disabled={deleting()}>
						<Trash2 size={16} />
					</Button>
				</div>
			</div>

			<Show when={props.connection.last_fetched_at} keyed>
				{lastFetched => <small class="tertiary text-xs">Last synced: {format.relative(lastFetched)}</small>}
			</Show>

			<Show when={error()}>
				<small style={{ color: "var(--error-fg)" }}>{error()}</small>
			</Show>
		</div>
	);
}
