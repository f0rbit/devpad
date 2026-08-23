import { Badge, Empty } from "@f0rbit/ui";
import type { PulseErrorIssue } from "@devpad/api";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For, Show } from "solid-js";

type PulseErrorsProps = {
	projectId: string;
	projectSlug: string;
	issues: PulseErrorIssue[] | null;
	error?: string | null;
};

const fmtTime = (v: number | undefined): string => {
	if (v == null || !Number.isFinite(v)) return "—";
	return new Date(v).toLocaleString();
};

const levelVariant = (level?: string | null): "error" | "warning" | "info" | "default" => {
	switch ((level ?? "").toLowerCase()) {
		case "fatal":
		case "error":
			return "error";
		case "warn":
		case "warning":
			return "warning";
		case "info":
			return "info";
		default:
			return "default";
	}
};

// `sample.properties` is free-form JSON reported by the pulse SDK's caller —
// not part of pulse's typed contract. `exception.message` / `exception.type`
// (flat dotted keys) and a nested `exception.stacktrace` are the conventions
// pulse's own Discord channel formatter reads, so we mirror those here.
const exceptionMessage = (properties: Record<string, unknown> | null): string => {
	const message = properties?.["exception.message"];
	if (typeof message === "string") return message;
	const type = properties?.["exception.type"];
	return typeof type === "string" ? type : "(no message)";
};

const exceptionType = (properties: Record<string, unknown> | null): string | undefined => {
	const type = properties?.["exception.type"];
	return typeof type === "string" ? type : undefined;
};

const exceptionStacktrace = (properties: Record<string, unknown> | null): string | undefined => {
	const exception = properties?.exception as Record<string, unknown> | undefined;
	const stacktrace = exception?.stacktrace;
	return typeof stacktrace === "string" ? stacktrace : undefined;
};

export default function PulseErrors(props: PulseErrorsProps) {
	const [expanded, setExpanded] = createSignal<string | null>(null);

	const issues = () => props.issues ?? [];

	const toggle = (fingerprint: string) => setExpanded((prev) => (prev === fingerprint ? null : fingerprint));

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
						{(issue) => {
							const isOpen = () => expanded() === issue.fingerprint;
							const stacktrace = () => exceptionStacktrace(issue.sample.properties);
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
									onClick={() => toggle(issue.fingerprint)}
								>
									<div class="row row-between" style={{ "align-items": "center", gap: "0.5rem" }}>
										<div class="row" style={{ "align-items": "center", gap: "0.5rem", "min-width": 0, flex: 1 }}>
											<Badge variant={levelVariant(issue.sample.level)}>{issue.sample.level ?? "error"}</Badge>
											<span
												class="text-sm"
												style={{
													"font-weight": 500,
													"white-space": "nowrap",
													overflow: "hidden",
													"text-overflow": "ellipsis",
												}}
											>
												{exceptionType(issue.sample.properties) ?? "Error"}: {exceptionMessage(issue.sample.properties)}
											</span>
										</div>
										<div class="row" style={{ "align-items": "center", gap: "0.5rem", "flex-shrink": 0 }}>
											<span class="text-sm text-faint">{issue.count} ×</span>
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
												<Show when={issue.sample.url}>
													<span class="text-faint">url: {issue.sample.url}</span>
												</Show>
											</div>
											<Show when={stacktrace()}>
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
													{stacktrace()}
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
