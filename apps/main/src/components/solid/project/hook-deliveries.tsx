import { getBrowserClient } from "@devpad/core/ui/client";
import type { PublicHook } from "@devpad/api";
import type { HookDelivery, HookDeliveryStatus } from "@devpad/schema";
import { Badge, Select } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";

export type HookDeliveriesProps = { projectId: string };

const STATUS_OPTIONS: (HookDeliveryStatus | "all")[] = [
	"failed_permanent",
	"all",
	"pending",
	"delivered",
	"failed_transient",
];

/**
 * Task B3.4 — read-only delivery ledger + enable/disable toggle. Full hook
 * CRUD (trigger/action editing) stays out of scope (CLI/API is the editor);
 * this panel never calls `hooks.upsert`. Defaults the status filter to
 * `failed_permanent` — the visible DLQ, per the plan's "surfaced
 * prominently" — rather than a generic "all" default.
 */
export default function HookDeliveries(props: HookDeliveriesProps) {
	const client = getBrowserClient();
	const [hooks, setHooks] = createSignal<PublicHook[]>([]);
	const [deliveriesByHook, setDeliveriesByHook] = createSignal<Record<string, HookDelivery[]>>({});
	const [statusFilter, setStatusFilter] = createSignal<HookDeliveryStatus | "all">("failed_permanent");

	async function loadDeliveries(hookList: PublicHook[], status: HookDeliveryStatus | "all"): Promise<void> {
		const entries = await Promise.all(
			hookList.map(async (hook) => {
				const result = await client.hooks.deliveries(hook.id, status === "all" ? undefined : status);
				return [hook.id, result.ok ? result.value : []] as const;
			}),
		);
		setDeliveriesByHook(Object.fromEntries(entries));
	}

	async function load(): Promise<void> {
		const result = await client.hooks.list(props.projectId);
		if (!result.ok) return;
		setHooks(result.value);
		await loadDeliveries(result.value, statusFilter());
	}
	onMount(() => void load());

	async function changeFilter(status: HookDeliveryStatus | "all"): Promise<void> {
		setStatusFilter(status);
		await loadDeliveries(hooks(), status);
	}

	async function toggle(hook: PublicHook): Promise<void> {
		const result = await client.hooks.setEnabled(hook.id, !hook.enabled);
		if (result.ok) setHooks((prev) => prev.map((h) => (h.id === hook.id ? result.value : h)));
	}

	return (
		<div class="hook-deliveries" data-testid="hook-deliveries">
			<div class="row row-sm">
				<label class="text-sm" for="hook-delivery-status-filter">
					Status
				</label>
				<Select
					id="hook-delivery-status-filter"
					data-testid="hook-delivery-status-filter"
					value={statusFilter()}
					onChange={(e) => {
						void changeFilter(e.currentTarget.value as HookDeliveryStatus | "all");
					}}
				>
					<For each={STATUS_OPTIONS}>{(status) => <option value={status}>{status}</option>}</For>
				</Select>
			</div>

			<Show when={hooks().length === 0}>
				<p class="text-sm text-faint">No hooks configured for this project yet.</p>
			</Show>

			<For each={hooks()}>
				{(hook) => (
					<div class="hook-delivery-group" data-testid="hook-group" data-hook-id={hook.id}>
						<div class="row row-sm hook-delivery-head">
							<span class="text-sm">{hook.trigger.kinds.join(", ")}</span>
							<Badge variant={hook.enabled ? "success" : "default"}>{hook.enabled ? "enabled" : "disabled"}</Badge>
							<button
								type="button"
								class="thread-action-link"
								data-testid="hook-toggle-enabled"
								onClick={() => {
									void toggle(hook);
								}}
							>
								{hook.enabled ? "disable" : "enable"}
							</button>
						</div>
						<ul class="list">
							<For each={deliveriesByHook()[hook.id] ?? []}>
								{(delivery) => (
									<li
										class={`hook-delivery-item${delivery.status === "failed_permanent" ? " hook-delivery-item-dlq" : ""}`}
										data-testid="hook-delivery-item"
										data-status={delivery.status}
									>
										<span class="outline-chip">{delivery.status}</span>
										<span class="text-xs text-faint">{delivery.event_id}</span>
										<Show when={delivery.last_error}>
											<span class="text-xs" style={{ color: "var(--error-fg)" }}>
												{delivery.last_error}
											</span>
										</Show>
									</li>
								)}
							</For>
							<Show when={(deliveriesByHook()[hook.id] ?? []).length === 0}>
								<li class="text-sm text-faint">No deliveries for this filter.</li>
							</Show>
						</ul>
					</div>
				)}
			</For>
		</div>
	);
}
