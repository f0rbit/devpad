import { getBrowserClient } from "@devpad/core/ui/client";
import {
	Badge,
	Button,
	Empty,
	FormField,
	Input,
	Modal,
	ModalBody,
	ModalFooter,
	ModalHeader,
	ModalTitle,
} from "@f0rbit/ui";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, For, Show } from "solid-js";

type Subscription = {
	id: string;
	name?: string;
	channel?: { kind?: string; webhook_url?: string } | null;
	filter?: Record<string, unknown> | null;
	cooldown_seconds?: number | null;
	created_at?: number | string;
};

type PulseSubscriptionsProps = {
	projectId: string;
	projectSlug: string;
	subscriptions: Subscription[];
	error?: string | null;
};

const LEVELS = ["any", "fatal", "error", "warn", "info"] as const;

export default function PulseSubscriptions(props: PulseSubscriptionsProps) {
	const [subs, setSubs] = createSignal<Subscription[]>(props.subscriptions);
	const [showCreate, setShowCreate] = createSignal(false);
	const [deleteTarget, setDeleteTarget] = createSignal<Subscription | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const [name, setName] = createSignal("");
	const [webhookUrl, setWebhookUrl] = createSignal("");
	const [minLevel, setMinLevel] = createSignal<string>("error");
	const [cooldown, setCooldown] = createSignal("60");

	const resetForm = () => {
		setName("");
		setWebhookUrl("");
		setMinLevel("error");
		setCooldown("60");
		setError(null);
	};

	const refresh = async () => {
		const client = getBrowserClient();
		const result = await client.pulse.subs.list({ project_id: props.projectId });
		if (result.ok) setSubs(result.value as Subscription[]);
	};

	const handleCreate = async () => {
		setLoading(true);
		setError(null);
		const url = webhookUrl().trim();
		if (!url) {
			setError("Webhook URL required");
			setLoading(false);
			return;
		}
		const client = getBrowserClient();
		const filter: Record<string, unknown> = minLevel() !== "any" ? { min_level: minLevel() } : {};
		const result = await client.pulse.subs.create({
			project_id: props.projectId,
			name: name().trim() || "discord-notifications",
			filter,
			channel: { kind: "discord", webhook_url: url },
			cooldown_seconds: Number(cooldown()) || 60,
		});
		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}
		await refresh();
		resetForm();
		setShowCreate(false);
		setLoading(false);
	};

	const handleDelete = async () => {
		const target = deleteTarget();
		if (!target) return;
		setLoading(true);
		setError(null);
		const client = getBrowserClient();
		const result = await client.pulse.subs.delete(target.id);
		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}
		setSubs((prev) => prev.filter((s) => s.id !== target.id));
		setDeleteTarget(null);
		setLoading(false);
	};

	return (
		<div class="stack stack-sm">
			<Show when={props.error && subs().length === 0}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{props.error}
				</p>
			</Show>

			<div class="row row-between" style={{ "align-items": "center" }}>
				<h3 style={{ margin: 0 }}>subscriptions</h3>
				<Button size="sm" onClick={() => setShowCreate(true)} data-testid="pulse-sub-create">
					<Plus size={16} /> create
				</Button>
			</div>

			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{error()}
				</p>
			</Show>

			<Show
				when={subs().length > 0}
				fallback={
					<Empty
						title="No subscriptions"
						description="Create a discord subscription to receive notifications about errors and events."
					/>
				}
			>
				<div class="stack stack-sm" data-testid="pulse-subs-list">
					<For each={subs()}>
						{(sub) => (
							<div
								class="row row-between"
								style={{
									"align-items": "center",
									gap: "0.5rem",
									padding: "0.75rem 1rem",
									border: "1px solid var(--border)",
									"border-radius": "var(--radius, 4px)",
								}}
							>
								<div class="stack stack-xs" style={{ "min-width": 0, flex: 1 }}>
									<div class="row" style={{ "align-items": "center", gap: "0.5rem" }}>
										<span style={{ "font-weight": 500 }}>{sub.name ?? "(unnamed)"}</span>
										<Badge variant="info">{sub.channel?.kind ?? "discord"}</Badge>
									</div>
									<Show when={sub.channel?.webhook_url}>
										<span
											class="text-sm text-faint"
											style={{
												"font-family": "var(--font-mono, monospace)",
												overflow: "hidden",
												"text-overflow": "ellipsis",
												"white-space": "nowrap",
											}}
										>
											{sub.channel?.webhook_url}
										</span>
									</Show>
								</div>
								<Button
									size="sm"
									variant="danger"
									onClick={() => setDeleteTarget(sub)}
									data-testid={`pulse-sub-delete-${sub.id}`}
								>
									<Trash2 size={14} />
								</Button>
							</div>
						)}
					</For>
				</div>
			</Show>

			<Show when={showCreate()}>
				<Modal
					open
					onClose={() => {
						setShowCreate(false);
						resetForm();
					}}
				>
					<ModalHeader>
						<ModalTitle>new subscription</ModalTitle>
					</ModalHeader>
					<ModalBody>
						<div class="stack stack-sm">
							<FormField label="name">
								<Input
									value={name()}
									onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)}
									placeholder="discord-notifications"
								/>
							</FormField>
							<FormField label="discord webhook url">
								<Input
									value={webhookUrl()}
									onInput={(e: Event) => setWebhookUrl((e.currentTarget as HTMLInputElement).value)}
									placeholder="https://discord.com/api/webhooks/…"
									data-testid="pulse-sub-webhook"
								/>
							</FormField>
							<FormField label="min level">
								<select
									value={minLevel()}
									onChange={(e: Event) => setMinLevel((e.currentTarget as HTMLSelectElement).value)}
								>
									<For each={LEVELS}>{(lv) => <option value={lv}>{lv}</option>}</For>
								</select>
							</FormField>
							<FormField label="cooldown (seconds)">
								<Input
									type="number"
									value={cooldown()}
									onInput={(e: Event) => setCooldown((e.currentTarget as HTMLInputElement).value)}
								/>
							</FormField>
						</div>
					</ModalBody>
					<ModalFooter>
						<Button
							variant="secondary"
							onClick={() => {
								setShowCreate(false);
								resetForm();
							}}
							disabled={loading()}
						>
							cancel
						</Button>
						<Button
							onClick={() => {
								void handleCreate();
							}}
							disabled={loading()}
							data-testid="pulse-sub-submit"
						>
							{loading() ? "creating…" : "create"}
						</Button>
					</ModalFooter>
				</Modal>
			</Show>

			<Show when={deleteTarget()}>
				<Modal open onClose={() => setDeleteTarget(null)}>
					<ModalHeader>
						<ModalTitle>delete subscription</ModalTitle>
					</ModalHeader>
					<ModalBody>
						<p>
							Delete <strong>{deleteTarget()?.name ?? "this subscription"}</strong>? Notifications will stop
							immediately.
						</p>
					</ModalBody>
					<ModalFooter>
						<Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={loading()}>
							cancel
						</Button>
						<Button
							variant="danger"
							onClick={() => {
								void handleDelete();
							}}
							disabled={loading()}
						>
							{loading() ? "deleting…" : "delete"}
						</Button>
					</ModalFooter>
				</Modal>
			</Show>
		</div>
	);
}
