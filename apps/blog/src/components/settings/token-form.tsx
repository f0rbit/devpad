import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, Textarea } from "@f0rbit/ui";
import { type Component, Show, createSignal } from "solid-js";
import { form } from "../../lib/form-utils";

interface TokenFormProps {
	isOpen: boolean;
	onSubmit: (data: { name: string; note?: string }) => Promise<{ key: string }>;
	onClose: () => void;
}

const TokenForm: Component<TokenFormProps> = props => {
	const [name, setName] = createSignal("");
	const [note, setNote] = createSignal("");
	const [generatedKey, setGeneratedKey] = createSignal<string | null>(null);
	const formState = form.create();

	const reset = () => {
		setName("");
		setNote("");
		setGeneratedKey(null);
		formState.setError(null);
	};

	const handleClose = () => {
		reset();
		props.onClose();
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const trimmedName = name().trim();
		if (!trimmedName) return;

		const result = await formState.handleSubmit(() =>
			props.onSubmit({
				name: trimmedName,
				note: note().trim() || undefined,
			})
		);
		if (result) setGeneratedKey(result.key);
	};

	const copyToClipboard = async () => {
		const key = generatedKey();
		if (key) {
			await navigator.clipboard.writeText(key);
		}
	};

	return (
		<Modal open={props.isOpen} onClose={handleClose}>
			<ModalHeader>
				<ModalTitle>New API Token</ModalTitle>
			</ModalHeader>
			<Show
				when={!generatedKey()}
				fallback={
					<>
						<ModalBody>
							<div class="modal-form">
								<div class="form-success">
									<p class="text-sm font-medium">Token created successfully!</p>
								</div>
								<div class="form-row">
									<label>API Key (copy now - shown only once)</label>
									<div class="row" style={{ gap: "8px" }}>
										<input type="text" value={generatedKey() ?? ""} readonly class="mono flex-1" />
										<Button variant="secondary" onClick={copyToClipboard}>
											Copy
										</Button>
									</div>
								</div>
								<p class="text-xs text-muted">This key will not be shown again. Please copy it now and store it securely.</p>
							</div>
						</ModalBody>
						<ModalFooter>
							<Button variant="primary" onClick={handleClose}>
								Done
							</Button>
						</ModalFooter>
					</>
				}
			>
				<ModalBody>
					<form onSubmit={handleSubmit} class="modal-form">
						<Show when={formState.error()}>
							<div class="form-error">
								<p class="text-sm">{formState.error()}</p>
							</div>
						</Show>
						<div class="form-row">
							<label for="token-name">
								Name <span class="required">*</span>
							</label>
							<Input value={name()} onInput={setName} placeholder="Token name" disabled={formState.submitting()} />
						</div>
						<div class="form-row">
							<label for="token-note">Note (optional)</label>
							<Textarea value={note()} onInput={setNote} placeholder="What is this token for?" rows={3} disabled={formState.submitting()} />
						</div>
					</form>
				</ModalBody>
				<ModalFooter>
					<Button variant="secondary" onClick={handleClose} disabled={formState.submitting()}>
						Cancel
					</Button>
					<Button type="submit" variant="primary" disabled={formState.submitting() || !name().trim()}>
						{formState.submitting() ? "Creating..." : "Create Token"}
					</Button>
				</ModalFooter>
			</Show>
		</Modal>
	);
};

export default TokenForm;
