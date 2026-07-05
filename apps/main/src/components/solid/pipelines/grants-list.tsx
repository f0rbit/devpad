import { AUTO_APPROVE_USER } from "@devpad/core/services/pipelines/grants";
import { getBrowserClient } from "@devpad/core/ui/client";
import type { PipelineGrant } from "@devpad/schema";
import { Badge, Button, Empty } from "@f0rbit/ui";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";

type GrantsListProps = {
	grants: PipelineGrant[];
	user_id: string;
};

const format_date = (dateString: string | null) => {
	if (!dateString) return null;
	return new Date(dateString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const is_pending = (grant: PipelineGrant) => grant.granted_at === null;
const is_auto_approved = (grant: PipelineGrant) => grant.granted_by === AUTO_APPROVE_USER;

export default function GrantsList(props: GrantsListProps) {
	const [grants, setGrants] = createSignal<PipelineGrant[]>(props.grants);
	const [loading, setLoading] = createSignal<string | null>(null);
	const [error, setError] = createSignal<string | null>(null);

	const handleApprove = async (grant: PipelineGrant) => {
		setLoading(grant.id);
		setError(null);
		const client = getBrowserClient();
		const result = await client.pipelines.grants.approve(grant.id, props.user_id);
		if (!result.ok) {
			setError(result.error.message);
		} else {
			setGrants((prev) =>
				prev.map((g) =>
					g.id === grant.id ? { ...g, granted_at: new Date().toISOString(), granted_by: props.user_id } : g,
				),
			);
		}
		setLoading(null);
	};

	const handleDeny = async (grant: PipelineGrant) => {
		setLoading(grant.id);
		setError(null);
		const client = getBrowserClient();
		const result = await client.pipelines.grants.deny(grant.id, props.user_id);
		if (!result.ok) {
			setError(result.error.message);
		} else {
			setGrants((prev) => prev.filter((g) => g.id !== grant.id));
		}
		setLoading(null);
	};

	const group_grants = (): { package_id: string; stages: { stage_name: string; grants: PipelineGrant[] }[] }[] => {
		const packages: { package_id: string; stages: { stage_name: string; grants: PipelineGrant[] }[] }[] = [];
		for (const grant of grants()) {
			let pkg = packages.find((p) => p.package_id === grant.package_id);
			if (!pkg) {
				pkg = { package_id: grant.package_id, stages: [] };
				packages.push(pkg);
			}
			let stage = pkg.stages.find((s) => s.stage_name === grant.stage_name);
			if (!stage) {
				stage = { stage_name: grant.stage_name, grants: [] };
				pkg.stages.push(stage);
			}
			stage.grants.push(grant);
		}
		return packages;
	};

	return (
		<div class="stack stack-sm">
			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Show when={grants().length === 0} fallback={<div />}>
				<Empty title="No grants" description="No grants have been requested yet." />
			</Show>

			<For each={group_grants()}>
				{(pkg) => (
					<div class="stack stack-md" style={{ "border-bottom": "1px solid var(--border)", "padding-bottom": "1rem" }}>
						<h3 style={{ margin: "0 0 0.5rem 0", opacity: 0.8 }}>{pkg.package_id}</h3>
						<For each={pkg.stages}>
							{(stage) => (
								<div class="stack stack-sm">
									<h4 style={{ margin: "0 0 0.5rem 0", opacity: 0.7, "font-size": "0.9rem" }}>
										Stage: {stage.stage_name}
									</h4>
									<For each={stage.grants}>
										{(grant) => (
											<div
												class="interactive-row"
												style={{
													display: "flex",
													"flex-direction": "column",
													gap: "0.5rem",
													padding: "0.75rem",
													"border-radius": "var(--radius)",
													border: "1px solid var(--border)",
													"background-color": is_pending(grant) ? "var(--bg-secondary)" : "transparent",
												}}
											>
												<div
													style={{
														display: "flex",
														"justify-content": "space-between",
														"align-items": "flex-start",
														gap: "0.5rem",
													}}
												>
													<div class="stack stack-xs">
														<div
															style={{ display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" }}
														>
															<span style={{ "font-family": "monospace", "font-size": "0.85rem", opacity: 0.8 }}>
																{grant.scope}
															</span>
															<Show when={is_pending(grant)}>
																<Badge variant="warning">pending</Badge>
															</Show>
															<Show when={!is_pending(grant) && is_auto_approved(grant)}>
																<Badge variant="success">auto-approved</Badge>
															</Show>
															<Show when={!is_pending(grant) && !is_auto_approved(grant)}>
																<Badge variant="default">approved</Badge>
															</Show>
														</div>
														<Show when={!is_pending(grant) && grant.granted_at}>
															<span style={{ "font-size": "0.85rem", opacity: 0.6 }}>
																Granted {format_date(grant.granted_at)}
															</span>
														</Show>
													</div>

													<Show when={is_pending(grant)}>
														<div style={{ display: "flex", gap: "0.5rem" }}>
															<Button
																size="sm"
																variant="primary"
																disabled={loading() === grant.id}
																onClick={() => {
																	void handleApprove(grant);
																}}
															>
																<Check size={14} />
																Approve
															</Button>
															<Button
																size="sm"
																variant="secondary"
																disabled={loading() === grant.id}
																onClick={() => {
																	void handleDeny(grant);
																}}
															>
																<X size={14} />
																Deny
															</Button>
														</div>
													</Show>
												</div>
											</div>
										)}
									</For>
								</div>
							)}
						</For>
					</div>
				)}
			</For>
		</div>
	);
}
