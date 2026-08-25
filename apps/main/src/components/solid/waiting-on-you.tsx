import { getBrowserClient } from "@devpad/core/ui/client";
import type { ReviewItem, ReviewItemKind } from "@devpad/api";
import { Badge, Button } from "@f0rbit/ui";
import { createSignal, For, Show } from "solid-js";

export type WaitingOnYouProps = {
	items: ReviewItem[];
};

const KIND_LABEL: Record<ReviewItemKind, string> = {
	signoff: "sign-off",
	annotation: "blocking thread",
	pipeline_gate: "pipeline gate",
	scan_diff: "scan diff",
};

/**
 * Task B2.4 — "Waiting on you": the human's latency-critical sign-off queue,
 * sourced from the A4.6 `reviews/pending` aggregate (one typed shape across
 * every "needs a human" source). Integration atop /todo, never a page —
 * empty state renders NOTHING, not a zero-state card, per the locked
 * page-vs-integrate decision.
 */
export function WaitingOnYou(props: WaitingOnYouProps) {
	const [items, setItems] = createSignal(props.items);
	const [deciding, setDeciding] = createSignal<string | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	const remove = (subject_id: string) => setItems((prev) => prev.filter((i) => i.subject_id !== subject_id));

	const decide = async (item: ReviewItem, decision: "approved" | "changes_requested") => {
		setDeciding(item.subject_id);
		setError(null);
		const result = await getBrowserClient().signoffs.decide(item.subject_id, { decision });
		setDeciding(null);
		if (!result.ok) {
			setError(`Couldn't decide "${item.title}": ${result.error.message}`);
			return;
		}
		remove(item.subject_id);
	};

	return (
		<Show when={items().length > 0}>
			<section class="waiting-on-you" data-testid="waiting-on-you">
				<div class="row row-sm waiting-on-you-head">
					<h2>waiting on you</h2>
					<Badge variant="warning">{items().length}</Badge>
				</div>
				<Show when={error()}>
					<p class="waiting-on-you-error">{error()}</p>
				</Show>
				<div class="waiting-on-you-cards">
					<For each={items()}>
						{(item) => (
							<div class="waiting-card" data-testid="waiting-card" data-kind={item.kind}>
								<div class="waiting-card-head">
									<span class="outline-chip">{KIND_LABEL[item.kind]}</span>
									<span class="waiting-card-title">{item.title}</span>
								</div>
								<div class="waiting-card-actions">
									<Show
										when={item.kind === "signoff"}
										fallback={
											<a href={item.path} class="waiting-card-link">
												Open →
											</a>
										}
									>
										<Button
											variant="primary"
											size="sm"
											disabled={deciding() === item.subject_id}
											onClick={() => void decide(item, "approved")}
										>
											Approve
										</Button>
										<Button
											variant="ghost"
											size="sm"
											disabled={deciding() === item.subject_id}
											onClick={() => void decide(item, "changes_requested")}
										>
											Request changes
										</Button>
										<a href={item.path} class="waiting-card-link">
											view →
										</a>
									</Show>
								</div>
							</div>
						)}
					</For>
				</div>
			</section>
		</Show>
	);
}
