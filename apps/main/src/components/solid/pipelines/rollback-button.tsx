import { getBrowserClient } from "@devpad/core/ui/client";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@f0rbit/ui";
import { createSignal, Show } from "solid-js";

type RollbackButtonProps = {
	run_id: string;
	/** Set on external (#155) packages: rollback re-dispatches the previous successful commit's production deploy via CI. */
	external?: { repo: string; workflow: string } | null;
};

export default function RollbackButton(props: RollbackButtonProps) {
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [show_confirmation, setShowConfirmation] = createSignal(false);

	const close_confirmation = () => {
		if (loading()) return;
		setShowConfirmation(false);
	};

	const handle_rollback = async () => {
		setLoading(true);
		setError(null);

		const client = getBrowserClient();
		const result = await client.pipelines.rollback(props.run_id);

		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}

		// Refresh page or update UI
		window.location.reload();
	};

	return (
		<div>
			<Button
				variant="secondary"
				onClick={() => {
					setShowConfirmation(true);
				}}
				disabled={loading()}
				style={{ "font-size": "0.9rem" }}
			>
				Rollback
			</Button>
			<Modal open={show_confirmation()} onClose={close_confirmation}>
				<ModalHeader>
					<ModalTitle>Confirm rollback</ModalTitle>
				</ModalHeader>
				<ModalBody>
					<Show
						when={props.external}
						fallback={
							<p style={{ margin: "0 0 var(--space-sm) 0", "font-size": "0.9rem" }}>
								Are you sure you want to roll back this deployment? This will revert to the previous version.
							</p>
						}
					>
						{(ext) => (
							<div class="stack stack-sm">
								<p style={{ margin: "0", "font-size": "0.9rem" }}>
									Are you sure you want to roll back this deployment? Rollback re-dispatches the production deploy of
									the previous successful commit's SHA via{" "}
									<code style={{ "font-family": "monospace" }}>{ext().repo}</code>'s GitHub workflow (
									<code style={{ "font-family": "monospace" }}>{ext().workflow}</code>).
								</p>
								<p
									data-testid="rollback-migrations-note"
									style={{ margin: "0", "font-size": "0.85rem", color: "var(--warning, var(--item-yellow))" }}
								>
									Note: rollback does not reverse D1/database migrations.
								</p>
							</div>
						)}
					</Show>
					<Show when={error()}>
						<p style={{ margin: "0.5rem 0 0 0", "font-size": "0.85rem", color: "var(--error)" }}>{error()}</p>
					</Show>
				</ModalBody>
				<ModalFooter>
					<Button
						variant="ghost"
						onClick={() => {
							close_confirmation();
						}}
						disabled={loading()}
					>
						Cancel
					</Button>
					<Button
						variant="danger"
						onClick={() => {
							void handle_rollback();
						}}
						disabled={loading()}
						loading={loading()}
					>
						Confirm rollback
					</Button>
				</ModalFooter>
			</Modal>
		</div>
	);
}
