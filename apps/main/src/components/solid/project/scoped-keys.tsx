import { getBrowserClient } from "@devpad/core/ui/client";
import type { ApiKey } from "@devpad/schema";
import { Button, Input } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";

export type ScopedKeysProps = { projectId: string };

/**
 * Task B3.4 — per-project API key issuance. `GET /keys` has no project
 * filter of its own (returns the caller's full key list, project-scoped or
 * not), so this panel filters client-side to `project_id === props.projectId`.
 *
 * `revealedKey` is intentionally a SEPARATE signal from the key list — it
 * holds the raw key returned exactly once by `create()` and is cleared the
 * moment the user dismisses it (never re-derivable from the list, which
 * only ever carries the hash).
 */
export default function ScopedKeys(props: ScopedKeysProps) {
	const client = getBrowserClient();
	const [keys, setKeys] = createSignal<ApiKey[]>([]);
	const [name, setName] = createSignal("");
	const [revealedKey, setRevealedKey] = createSignal<string | null>(null);
	const [creating, setCreating] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [confirmingRevoke, setConfirmingRevoke] = createSignal<string | null>(null);

	async function load(): Promise<void> {
		const result = await client.auth.keys.list();
		if (result.ok) setKeys(result.value.filter((k) => k.project_id === props.projectId));
	}
	onMount(() => void load());

	async function create(): Promise<void> {
		const trimmed = name().trim();
		setCreating(true);
		setError(null);
		const result = await client.auth.keys.create({ name: trimmed || undefined, project_id: props.projectId });
		setCreating(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		setRevealedKey(result.value.key.raw_key);
		setName("");
		await load();
	}

	/** Craft fast-follow #13d (taste/IA critic) — revoking is destructive and irreversible (the key stops working immediately), so a bare one-click link isn't enough; a second inline "confirm?" click is the smallest step that still catches a stray click. */
	async function revoke(id: string): Promise<void> {
		setError(null);
		const result = await client.auth.keys.revoke(id);
		setConfirmingRevoke(null);
		if (!result.ok) {
			setError(`Couldn't revoke the key: ${result.error.message}`);
			return;
		}
		await load();
	}

	return (
		<div class="scoped-keys" data-testid="scoped-keys">
			<Show when={revealedKey()}>
				{(key) => (
					<div class="scoped-key-reveal" data-testid="scoped-key-reveal">
						<p class="text-sm">
							New key (shown once — copy it now): <code data-testid="scoped-key-raw">{key()}</code>
						</p>
						<Button
							size="sm"
							data-testid="scoped-key-reveal-done"
							onClick={() => {
								setRevealedKey(null);
							}}
						>
							Done
						</Button>
					</div>
				)}
			</Show>

			<div class="row row-sm scoped-key-create">
				<Input
					placeholder="Key name (optional)"
					value={name()}
					onInput={(e) => {
						setName(e.currentTarget.value);
					}}
				/>
				<Button
					data-testid="scoped-key-create"
					disabled={creating()}
					onClick={() => {
						void create();
					}}
				>
					Create key
				</Button>
			</div>
			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--error-fg)" }}>
					{error()}
				</p>
			</Show>

			<Show when={keys().length > 0} fallback={<p class="text-sm text-faint">No project-scoped keys yet.</p>}>
				<ul class="list" data-testid="scoped-key-list">
					<For each={keys()}>
						{(key) => (
							<li class="scoped-key-item" data-testid="scoped-key-item" data-key-id={key.id}>
								<span>{key.name ?? "(unnamed)"}</span>
								<span class="text-xs text-faint">{key.enabled ? "enabled" : "disabled"}</span>
								<Show
									when={confirmingRevoke() === key.id}
									fallback={
										<button
											type="button"
											class="thread-action-link"
											data-testid="scoped-key-revoke"
											onClick={() => {
												setConfirmingRevoke(key.id);
											}}
										>
											revoke
										</button>
									}
								>
									<span class="scoped-key-revoke-confirm">
										<button
											type="button"
											class="thread-action-link"
											data-testid="scoped-key-revoke-confirm"
											onClick={() => {
												void revoke(key.id);
											}}
										>
											confirm?
										</button>
										<button
											type="button"
											class="thread-action-link"
											onClick={() => {
												setConfirmingRevoke(null);
											}}
										>
											cancel
										</button>
									</span>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</Show>
		</div>
	);
}
