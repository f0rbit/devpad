import { Badge, Empty, Input, Select } from "@f0rbit/ui";
import type { PulseEventRow } from "@devpad/api";
import { createMemo, createSignal, For, Show } from "solid-js";

type PulseLogsProps = {
	projectId: string;
	projectSlug: string;
	logs: PulseEventRow[] | null;
	error?: string | null;
};

const LEVELS = ["all", "fatal", "error", "warn", "info", "debug", "trace"] as const;

const fmtTime = (ts: number): string => {
	if (!Number.isFinite(ts)) return "";
	return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

// `properties.message` is the convention pulse's own subscription channels
// read for `name=log` events — `properties` itself is free-form JSON, not
// part of pulse's typed contract.
const logMessage = (log: PulseEventRow): string => {
	const message = log.properties?.message;
	return typeof message === "string" ? message : `log #${String(log.id)}`;
};

export default function PulseLogs(props: PulseLogsProps) {
	const [search, setSearch] = createSignal("");
	const [level, setLevel] = createSignal<string>("all");

	const filtered = createMemo(() => {
		const all = props.logs ?? [];
		const q = search().toLowerCase().trim();
		const lv = level();
		return all.filter((log) => {
			if (lv !== "all" && (log.level ?? "").toLowerCase() !== lv) return false;
			if (!q) return true;
			const hay = `${logMessage(log)} ${log.url ?? ""}`.toLowerCase();
			return hay.includes(q);
		});
	});

	return (
		<div class="stack stack-md">
			<Show when={props.error}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{props.error}
				</p>
			</Show>

			<div class="row" style={{ gap: "0.5rem", "flex-wrap": "wrap" }}>
				<Input
					placeholder="search logs…"
					value={search()}
					onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)}
					style={{ "min-width": "220px", flex: 1 }}
				/>
				<Select value={level()} onChange={(e: Event) => setLevel((e.currentTarget as HTMLSelectElement).value)}>
					<For each={LEVELS}>{(lv) => <option value={lv}>{lv}</option>}</For>
				</Select>
			</div>

			<Show
				when={filtered().length > 0}
				fallback={
					<Empty
						title="No logs"
						description={
							(props.logs ?? []).length === 0
								? "No log events recorded for this range."
								: "No logs match the current filter."
						}
					/>
				}
			>
				<div
					class="stack stack-xs"
					data-testid="pulse-logs-list"
					style={{ "font-family": "var(--font-mono, monospace)", "font-size": "0.8rem" }}
				>
					<For each={filtered()}>
						{(log) => (
							<div
								class="row"
								style={{
									"align-items": "baseline",
									gap: "0.5rem",
									padding: "0.25rem 0",
									"border-bottom": "1px solid var(--border)",
								}}
							>
								<span class="text-faint" style={{ "min-width": "70px" }}>
									{fmtTime(log.ts)}
								</span>
								<Badge variant={levelVariant(log.level)}>{log.level ?? "info"}</Badge>
								<span style={{ flex: 1, "white-space": "pre-wrap", "word-break": "break-word" }}>{logMessage(log)}</span>
								<Show when={log.url}>
									<span class="text-faint">{log.url}</span>
								</Show>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
