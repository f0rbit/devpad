import { Badge, Empty } from "@f0rbit/ui";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For, Show } from "solid-js";

interface ErrorIssue {
	id?: string;
	fingerprint?: string;
	message?: string;
	type?: string;
	count?: number;
	first_seen?: number | string;
	last_seen?: number | string;
	level?: string;
	route?: string;
	sample?: { stack?: string; metadata?: Record<string, unknown>; ts?: number };
}

interface PulseErrorsProps {
	projectId: string;
	projectSlug: string;
	issues: ErrorIssue[] | null;
	error?: string | null;
}

const fmtTime = (v: number | string | undefined): string => {
	if (v == null) return "—";
	const n = typeof v === "number" ? v : Date.parse(v);
	if (!Number.isFinite(n)) return "—";
	return new Date(n).toLocaleString();
};

const levelVariant = (level?: string): "danger" | "warning" | "info" | "neutral" => {
	switch ((level ?? "").toLowerCase()) {
		case "fatal":
		case "error":
			return "danger";
		case "warn":
		case "warning":
			return "warning";
		case "info":
			return "info";
		default:
			return "neutral";
	}
};

export default function PulseErrors(props: PulseErrorsProps) {
	const [expanded, setExpanded] = createSignal<string | null>(null);

	const issues = () => props.issues ?? [];

	const toggle = (id: string) => setExpanded((prev) => (prev === id ? null : id));

	const keyFor = (issue: ErrorIssue, idx: number) => issue.id ?? issue.fingerprint ?? `issue-${idx}`;

	return (
		<div class="stack stack-md">
			<Show when={props.error}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{props.error}
				</p>
			</Show>

			<Show
				when={issues().length > 0}
				fallback={
					<Empty
						title="No errors recorded"
						description="When errors are reported by the pulse SDK, grouped issues will appear here."
					/>
				}
			>
				<div class="stack stack-sm" data-testid="pulse-errors-list">
					<For each={issues()}>
						{(issue, idx) => {
							const id = keyFor(issue, idx());
							const isOpen = () => expanded() === id;
							return (
								<div
									class="interactive-row"
									style={{
										display: "flex",
										"flex-direction": "column",
										gap: "0.5rem",
										padding: "0.75rem 1rem",
										border: "1px solid var(--border)",
										"border-radius": "var(--radius, 4px)",
										cursor: "pointer",
									}}
									onClick={() => toggle(id)}
								>
									<div class="row row-between" style={{ "align-items": "center", gap: "0.5rem" }}>
										<div class="row" style={{ "align-items": "center", gap: "0.5rem", "min-width": 0, flex: 1 }}>
											<Badge variant={levelVariant(issue.level) as any}>{issue.level ?? "error"}</Badge>
											<span
												class="text-sm"
												style={{
													"font-weight": 500,
													"white-space": "nowrap",
													overflow: "hidden",
													"text-overflow": "ellipsis",
												}}
											>
												{issue.type ?? "Error"}: {issue.message ?? "(no message)"}
											</span>
										</div>
										<div class="row" style={{ "align-items": "center", gap: "0.5rem", "flex-shrink": 0 }}>
											<span class="text-sm text-faint">{issue.count ?? 1} ×</span>
											<ChevronRight
												size={14}
												style={{ transform: isOpen() ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
											/>
										</div>
									</div>
									<Show when={isOpen()}>
										<div class="stack stack-xs text-sm" style={{ "padding-left": "0.25rem" }}>
											<div class="row" style={{ gap: "1rem", "flex-wrap": "wrap" }}>
												<span class="text-faint">first: {fmtTime(issue.first_seen)}</span>
												<span class="text-faint">last: {fmtTime(issue.last_seen)}</span>
												<Show when={issue.route}>
													<span class="text-faint">route: {issue.route}</span>
												</Show>
											</div>
											<Show when={issue.sample?.stack}>
												<pre
													style={{
														margin: 0,
														padding: "0.5rem",
														background: "var(--bg-subtle, #1a1a1a)",
														"border-radius": "var(--radius, 4px)",
														"font-size": "0.8rem",
														overflow: "auto",
														"max-height": "240px",
													}}
												>
													{issue.sample!.stack}
												</pre>
											</Show>
										</div>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</div>
	);
}
