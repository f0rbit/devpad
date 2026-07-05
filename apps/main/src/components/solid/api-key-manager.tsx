import { getBrowserClient } from "@devpad/core/ui/client";
import type { ApiKey } from "@devpad/schema";
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
import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import Key from "lucide-solid/icons/key";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, For, Show } from "solid-js";
import { track } from "@/lib/pulse";

type ApiKeyManagerProps = {
	keys: ApiKey[];
};

const formatDate = (dateString?: string | null) => {
	if (!dateString) return null;
	return new Date(dateString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
};

type ApiKeyScope = "devpad" | "blog" | "media" | "pulse" | "all";

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string }[] = [
	{ value: "all", label: "all — full access (default)" },
	{ value: "devpad", label: "devpad — projects, tasks, milestones, goals" },
	{ value: "pulse", label: "pulse — analytics proxy + admin" },
	{ value: "blog", label: "blog — blog content + drafts" },
	{ value: "media", label: "media — timeline + platform connections" },
];

export default function ApiKeyManager(props: ApiKeyManagerProps) {
	const [keys, setKeys] = createSignal<ApiKey[]>(props.keys);
	const [showCreate, setShowCreate] = createSignal(false);
	const [newKeyName, setNewKeyName] = createSignal("");
	const [newKeyScope, setNewKeyScope] = createSignal<ApiKeyScope>("all");
	const [createdKey, setCreatedKey] = createSignal<string | null>(null);
	const [deleteTarget, setDeleteTarget] = createSignal<ApiKey | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [copied, setCopied] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleCreate = async () => {
		setLoading(true);
		setError(null);
		const apiClient = getBrowserClient();
		const result = await apiClient.auth.keys.create({
			name: newKeyName() || undefined,
			scope: newKeyScope(),
		});
		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}
		setCreatedKey(result.value.key.raw_key);
		track("api_key_created", { scope: newKeyScope() });
		const listResult = await apiClient.auth.keys.list();
		if (listResult.ok) {
			setKeys(listResult.value);
		}
		setNewKeyName("");
		setNewKeyScope("all");
		setLoading(false);
	};

	const handleDelete = async () => {
		const target = deleteTarget();
		if (!target) return;
		setLoading(true);
		setError(null);
		const apiClient = getBrowserClient();
		const result = await apiClient.auth.keys.revoke(target.id);
		if (result.ok) {
			setKeys((prev) => prev.filter((k) => k.id !== target.id));
			setDeleteTarget(null);
			track("api_key_revoked");
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const handleCopy = () => {
		const key = createdKey();
		if (!key) return;
		void navigator.clipboard.writeText(key);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleCloseCreated = () => {
		setCreatedKey(null);
		setShowCreate(false);
	};

	return (
		<div class="stack stack-sm">
			<div class="row row-between" style={{ "align-items": "center" }}>
				<h3 style={{ margin: "0" }}>api keys</h3>
				<Button size="sm" onClick={() => setShowCreate(true)}>
					<Plus size={16} /> create key
				</Button>
			</div>

			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Show
				when={keys().length > 0}
				fallback={<Empty title="No API keys" description="Create an API key to access the devpad API." />}
			>
				<div class="stack stack-sm">
					<For each={keys()}>
						{(key) => (
							<div
								class="interactive-row"
								style={{
									display: "flex",
									"align-items": "center",
									"justify-content": "space-between",
									gap: "0.5rem",
								}}
							>
								<div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
									<Key size={16} class="text-faint" />
									<span class={key.name ? "text-sm" : "text-sm text-faint"}>{key.name || "Unnamed key"}</span>
									<Badge variant="info">{key.scope}</Badge>
								</div>
								<div style={{ display: "flex", "align-items": "center", gap: "0.75rem" }}>
									<span class="text-xs text-faint">{formatDate(key.created_at)}</span>
									<Show when={key.last_used_at}>
										<span class="text-xs text-muted">used {formatDate(key.last_used_at)}</span>
									</Show>
									<button
										type="button"
										onClick={() => setDeleteTarget(key)}
										style={{
											background: "none",
											border: "none",
											cursor: "pointer",
											padding: "4px",
											color: "var(--fg-faint)",
										}}
										title="Delete key"
									>
										<Trash2 size={16} />
									</button>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>

			<Modal
				open={showCreate() && !createdKey()}
				onClose={() => {
					setShowCreate(false);
					setNewKeyName("");
					setError(null);
				}}
			>
				<ModalHeader>
					<ModalTitle>Create API Key</ModalTitle>
				</ModalHeader>
				<ModalBody>
					<div class="stack stack-sm">
						<FormField label="Name (optional)">
							<Input
								placeholder="e.g. CI pipeline, local dev"
								value={newKeyName()}
								onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setNewKeyName(e.currentTarget.value)}
							/>
						</FormField>
						<FormField label="Scope" description="What this key can do. Defaults to 'all'.">
							<select
								value={newKeyScope()}
								onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
									setNewKeyScope(e.currentTarget.value as ApiKeyScope)
								}
								style={{
									width: "100%",
									padding: "0.5rem 0.625rem",
									"font-size": "var(--text-sm)",
									background: "var(--bg-alt)",
									color: "var(--fg)",
									border: "1px solid var(--border)",
									"border-radius": "var(--radius, 4px)",
								}}
							>
								<For each={SCOPE_OPTIONS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
							</select>
						</FormField>
					</div>
				</ModalBody>
				<ModalFooter>
					<Button
						variant="ghost"
						onClick={() => {
							setShowCreate(false);
							setNewKeyName("");
							setError(null);
						}}
					>
						cancel
					</Button>
					<Button
						onClick={() => {
							void handleCreate();
						}}
						disabled={loading()}
					>
						{loading() ? "creating..." : "create"}
					</Button>
				</ModalFooter>
			</Modal>

			<Modal open={!!createdKey()} onClose={handleCloseCreated}>
				<ModalHeader>
					<ModalTitle>Key Created</ModalTitle>
				</ModalHeader>
				<ModalBody>
					<p class="text-sm" style={{ margin: "0 0 0.75rem 0", color: "var(--item-red)" }}>
						Copy this key now. It won't be shown again.
					</p>
					<code
						style={{
							display: "block",
							padding: "0.75rem",
							background: "var(--bg-alt)",
							"border-radius": "4px",
							"font-size": "var(--text-sm)",
							"word-break": "break-all",
							"user-select": "all",
						}}
					>
						{createdKey()}
					</code>
				</ModalBody>
				<ModalFooter>
					<Button variant="ghost" onClick={handleCopy}>
						{copied() ? (
							<>
								<Check size={16} /> copied
							</>
						) : (
							<>
								<Copy size={16} /> copy
							</>
						)}
					</Button>
					<Button onClick={handleCloseCreated}>done</Button>
				</ModalFooter>
			</Modal>

			<Modal open={!!deleteTarget()} onClose={() => setDeleteTarget(null)}>
				<ModalHeader>
					<ModalTitle>Delete API Key</ModalTitle>
				</ModalHeader>
				<ModalBody>
					<p class="text-sm" style={{ margin: "0" }}>
						Are you sure you want to delete <strong>{deleteTarget()?.name || "this key"}</strong>? Any applications
						using this key will lose access.
					</p>
				</ModalBody>
				<ModalFooter>
					<Button variant="ghost" onClick={() => setDeleteTarget(null)}>
						cancel
					</Button>
					<Button
						variant="danger"
						onClick={() => {
							void handleDelete();
						}}
						disabled={loading()}
					>
						{loading() ? "deleting..." : "delete"}
					</Button>
				</ModalFooter>
			</Modal>
		</div>
	);
}
