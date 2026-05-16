import { getBrowserClient } from "@devpad/core/ui/client";
import { Button } from "@f0rbit/ui";
import { createSignal, Show } from "solid-js";

interface RollbackButtonProps {
	run_id: string;
}

export default function RollbackButton(props: RollbackButtonProps) {
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [show_confirmation, setShowConfirmation] = createSignal(false);

	const handle_rollback = async () => {
		setLoading(true);
		setError(null);

		const client = getBrowserClient();
		const result = await client.pipelines.rollback(props.run_id);

		if (!result.ok) {
			setError(result.error.message ?? "Rollback failed");
		} else {
			// Refresh page or update UI
			window.location.reload();
		}

		setLoading(false);
		setShowConfirmation(false);
	};

	return (
		<div>
			<Show
				when={!show_confirmation()}
				fallback={
					<div
						class="card card-flat stack stack-sm"
						style={{
							padding: "var(--space-md)",
							"background-color": "color-mix(in srgb, var(--error) 10%, transparent)",
							border: "1px solid var(--error)",
						}}
					>
						<p style={{ margin: "0 0 var(--space-sm) 0", "font-size": "0.9rem" }}>
							Are you sure you want to roll back this deployment? This will revert to the previous version.
						</p>
						<div class="row" style={{ gap: "var(--space-sm)" }}>
							<Button
								variant="destructive"
								onClick={handle_rollback}
								disabled={loading()}
								style={{ "font-size": "0.9rem" }}
							>
								{loading() ? "Rolling back..." : "Confirm rollback"}
							</Button>
							<Button
								variant="secondary"
								onClick={() => setShowConfirmation(false)}
								disabled={loading()}
								style={{ "font-size": "0.9rem" }}
							>
								Cancel
							</Button>
						</div>
						<Show when={error()}>
							<p style={{ margin: "0", "font-size": "0.85rem", color: "var(--error)" }}>
								{error()}
							</p>
						</Show>
					</div>
				}
			>
				<Button
					variant="secondary"
					onClick={() => setShowConfirmation(true)}
					disabled={loading()}
					style={{ "font-size": "0.9rem" }}
				>
					Rollback
				</Button>
			</Show>
		</div>
	);
}
