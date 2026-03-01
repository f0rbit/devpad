import { getBrowserClient } from "@devpad/core/ui/client";
import type { ApiKey } from "@devpad/schema";
import { Badge, Button, Empty, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@f0rbit/ui";
import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import Key from "lucide-solid/icons/key";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, For, Show } from "solid-js";

interface ApiKeyManagerProps {
	keys: ApiKey[];
}

const formatDate = (dateString?: string | null) => {
	if (!dateString) return null;
	return new Date(dateString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
};

export default function ApiKeyManager(props: ApiKeyManagerProps) {
	const [keys, setKeys] = createSignal<ApiKey[]>(props.keys);
	const [showCreate, setShowCreate] = createSignal(false);
	const [newKeyName, setNewKeyName] = createSignal("");
	const [createdKey, setCreatedKey] = createSignal<string | null>(null);
	const [deleteTarget, setDeleteTarget] = createSignal<ApiKey | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [copied, setCopied] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleCreate = async () => {
		setLoading(true);
		setError(null);
		const apiClient = getBrowserClient();
		const result = await apiClient.auth.keys.create(newKeyName() || undefined);
		if (!result.ok) {
			setError(result.error.message ?? "Failed to create key");
			setLoading(false);
			return;
		}
		setCreatedKey(result.value.key.raw_key);
		const listResult = await apiClient.auth.keys.list();
		if (listResult.ok) {
			setKeys(listResult.value);
		}
		setNewKeyName("");
		setLoading(false);
	};

	const handleDelete = async () => {
		setLoading(true);
		setError(null);
		const apiClient = getBrowserClient();
		const result = await apiClient.auth.keys.revoke(deleteTarget()!.id);
		if (result.ok) {
			setKeys(prev => prev.filter(k => k.id !== deleteTarget()!.id));
			setDeleteTarget(null);
		} else {
			setError(result.error.message ?? "Failed to delete key");
		}
		setLoading(false);
	};

	const handleCopy = () => {
		navigator.clipboard.writeText(createdKey()!);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleCloseCreated = () => {
		setCreatedKey(null);
		setShowCreate(false);
	};

	return (
		<div class="stack-sm">
			<div class="row-between" style={{ "align-items": "center" }}>
				<h3 style={{ margin: "0" }}>api keys</h3>
				<Button size="sm" onClick={() => setShowCreate(true)}>
					<Plus size={14} /> create key
				</Button>
			</div>

			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Show when={keys().length > 0} fallback={<Empty title="No API keys" description="Create an API key to access the devpad API." />}>
				<div class="stack-sm">
					<For each={keys()}>
						{key => (
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
									<Key size={14} class="text-faint" />
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
										<Trash2 size={14} />
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
					<FormField label="Name (optional)">
						<Input placeholder="e.g. CI pipeline, local dev" value={newKeyName()} onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setNewKeyName(e.currentTarget.value)} />
					</FormField>
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
					<Button onClick={handleCreate} disabled={loading()}>
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
								<Check size={14} /> copied
							</>
						) : (
							<>
								<Copy size={14} /> copy
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
						Are you sure you want to delete <strong>{deleteTarget()?.name || "this key"}</strong>? Any applications using this key will lose access.
					</p>
				</ModalBody>
				<ModalFooter>
					<Button variant="ghost" onClick={() => setDeleteTarget(null)}>
						cancel
					</Button>
					<Button variant="danger" onClick={handleDelete} disabled={loading()}>
						{loading() ? "deleting..." : "delete"}
					</Button>
				</ModalFooter>
			</Modal>
		</div>
	);
}
