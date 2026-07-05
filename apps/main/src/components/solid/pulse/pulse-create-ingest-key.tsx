import { getBrowserClient } from "@devpad/core/ui/client";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@f0rbit/ui";
import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import Plus from "lucide-solid/icons/plus";
import { createSignal, Show } from "solid-js";
import { track } from "@/lib/pulse";

type PulseCreateIngestKeyProps = {
	projectId: string;
};

export default function PulseCreateIngestKey(props: PulseCreateIngestKeyProps) {
	const [loading, setLoading] = createSignal(false);
	const [createdKey, setCreatedKey] = createSignal<string | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [copied, setCopied] = createSignal(false);

	const handleCreate = async () => {
		setLoading(true);
		setError(null);
		const apiClient = getBrowserClient();
		const result = await apiClient.pulse.keys.create({
			project_id: props.projectId,
			name: "default",
		});
		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}
		setCreatedKey(result.value.plaintext);
		track("pulse_ingest_key_created", { project_id: props.projectId });
		setLoading(false);
	};

	const handleCopy = () => {
		const key = createdKey();
		if (!key) return;
		void navigator.clipboard.writeText(key);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div class="stack stack-sm">
			<Button
				onClick={() => {
					void handleCreate();
				}}
				disabled={loading()}
				data-testid="pulse-create-key"
			>
				<Plus size={16} /> {loading() ? "creating..." : "Create ingest key"}
			</Button>
			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Modal open={!!createdKey()} onClose={() => setCreatedKey(null)}>
				<ModalHeader>
					<ModalTitle>Ingest key created</ModalTitle>
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
					<Button
						onClick={() => {
							setCreatedKey(null);
							window.location.reload();
						}}
					>
						done
					</Button>
				</ModalFooter>
			</Modal>
		</div>
	);
}
