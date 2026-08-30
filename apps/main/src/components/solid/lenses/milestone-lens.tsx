import { getBrowserClient } from "@devpad/core/ui/client";
import type { MilestoneLensRow } from "@devpad/api";
import type { Task } from "@devpad/schema";
import Link2 from "lucide-solid/icons/link-2";
import { createSignal, For, onMount, Show } from "solid-js";
import { Ring } from "../outline/ring";
import { LensShell } from "./lens-shell";

export type MilestoneLensProps = {
	projectId: string;
	onClose: () => void;
	/** Zooms the OUTLINE to a milestone or one of its descendants, and closes the lens. */
	onZoom: (id: string) => void;
};

const dotClass = (progress: Task["progress"]): string =>
	`outline-dot${progress === "IN_PROGRESS" ? " outline-dot-doing" : progress === "COMPLETED" ? " outline-dot-done" : ""}`;

/**
 * Task B2.2 — the milestone lens: Dagster-style collapsed phase cards,
 * ordered by rank (server-provided, same order the fold-era `after_id`
 * list used), each with a real rollup ring + stale/blocked badges from the
 * SAME `edge_summary`/`rollups` fields the outline's own rows use — no
 * client re-derivation. Replaces the deleted goals page's job as a lens,
 * not a destination.
 *
 * v2.4 (B2 critic carry-over) — `load()` now makes ONE batched call
 * (`milestones.lens`) instead of N `tasks.tree()` calls; the sequencing
 * arrow between adjacent cards renders only when a real `blocks` edge
 * connects them (never rank adjacency); each card shows its
 * `completion_policy`; and each expanded child shows the same done/doing
 * status dot the outline's own rows use.
 */
export default function MilestoneLens(props: MilestoneLensProps) {
	const [rows, setRows] = createSignal<MilestoneLensRow[]>([]);
	const [blocks, setBlocks] = createSignal<{ src_id: string; dst_id: string }[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

	onMount(() => void load());

	async function load(): Promise<void> {
		setLoading(true);
		const client = getBrowserClient();
		const result = await client.milestones.lens(props.projectId, 2);
		if (!result.ok) {
			setRows([]);
			setBlocks([]);
			setLoading(false);
			return;
		}
		setRows(result.value.rows);
		setBlocks(result.value.blocks);
		setLoading(false);
	}

	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const goto = (id: string) => {
		props.onZoom(id);
		props.onClose();
	};

	/** A real `blocks` edge FROM `from_id` TO `to_id` — never rank adjacency. */
	const blocksNext = (from_id: string, to_id: string) =>
		blocks().some((e) => e.src_id === from_id && e.dst_id === to_id);

	return (
		<LensShell title="Milestone lens" onClose={props.onClose}>
			<div class="lens-milestones">
				<Show when={!loading()} fallback={<p class="lens-graph-status">Loading milestones…</p>}>
					<Show when={rows().length > 0} fallback={<p class="lens-graph-status">No milestones yet.</p>}>
						<div class="lens-milestone-track">
							<For each={rows()}>
								{(row, i) => (
									<>
										<Show when={i() > 0 && blocksNext(rows()[i() - 1]?.milestone.id ?? "", row.milestone.id)}>
											<span class="lens-milestone-arrow" aria-hidden="true" title="blocks">
												→
											</span>
										</Show>
										<div class="lens-milestone-card" data-testid="lens-milestone-card" data-task-id={row.milestone.id}>
											<button
												type="button"
												class="lens-milestone-head"
												onClick={() => {
													goto(row.milestone.id);
												}}
											>
												<Ring
													rollup={row.rollup}
													size={26}
													auto={row.completion_policy === "auto_children"}
													rippling={false}
												/>
												<span class="lens-milestone-title">{row.milestone.name}</span>
											</button>
											<div class="lens-milestone-meta">
												<Show when={row.milestone.target_time}>
													{(target) => <span class="outline-chip">due {new Date(target()).toLocaleDateString()}</span>}
												</Show>
												<Show when={row.completion_policy === "auto_children"}>
													<span
														class="outline-chip outline-chip-auto"
														title="completion_policy: auto_children — completes when all children are done"
													>
														auto ⚙
													</span>
												</Show>
												<Show when={row.edge?.stale}>
													<span class="outline-chip outline-chip-stale">stale</span>
												</Show>
												<Show when={(row.edge?.blocked_count ?? 0) > 0}>
													<span class="outline-chip outline-chip-blocked">
														<Link2 size={10} /> {row.edge?.blocked_count}
													</span>
												</Show>
												<Show when={(row.rollup?.subtree_total ?? 0) > 0}>
													<span class="outline-chip">
														{row.rollup?.subtree_done}/{row.rollup?.subtree_total} done
													</span>
												</Show>
											</div>
											<Show when={row.descendants.length > 0}>
												<button
													type="button"
													class="lens-milestone-expand"
													onClick={() => {
														toggle(row.milestone.id);
													}}
												>
													{expanded().has(row.milestone.id) ? "collapse" : `expand (${String(row.descendants.length)})`}
												</button>
												<Show when={expanded().has(row.milestone.id)}>
													<ul class="lens-milestone-children">
														<For each={row.descendants}>
															{(child) => (
																<li>
																	<button
																		type="button"
																		class="lens-milestone-child"
																		onClick={() => {
																			goto(child.id);
																		}}
																	>
																		<span class={dotClass(child.progress)} />
																		{child.title}
																	</button>
																</li>
															)}
														</For>
													</ul>
												</Show>
											</Show>
										</div>
									</>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>
		</LensShell>
	);
}
