import { Badge, Empty, Input, Select } from "@f0rbit/ui";
import { createMemo, createSignal, For, Show } from "solid-js";

interface LogEntry {
	id?: string;
	ts?: number | string;
	level?: string;
	message?: string;
	name?: string;
	route?: string;
	metadata?: Record<string, unknown>;
}

interface PulseLogsProps {
	projectId: string;
	projectSlug: string;
	logs: LogEntry[] | null;
	error?: string | null;
}

const LEVELS = ["all", "fatal", "error", "warn", "info", "debug", "trace"] as const;

const fmtTime = (v: number | string | undefined): string => {
	if (v == null) return "";
	const n = typeof v === "number" ? v : Date.parse(v);
	if (!Number.isFinite(n)) return "";
	return new Date(n).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

export default function PulseLogs(props: PulseLogsProps) {
	const [search, setSearch] = createSignal("");
	const [level, setLevel] = createSignal<string>("all");

	const filtered = createMemo(() => {
		const all = props.logs ?? [];
		const q = search().toLowerCase().trim();
		const lv = level();
		return all.filter(log => {
			if (lv !== "all" && (log.level ?? "").toLowerCase() !== lv) return false;
			if (!q) return true;
			const hay = `${log.message ?? ""} ${log.name ?? ""} ${log.route ?? ""}`.toLowerCase();
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
				<Input placeholder="search logs…" value={search()} onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)} style={{ "min-width": "220px", flex: 1 }} />
				<Select value={level()} onChange={(e: Event) => setLevel((e.currentTarget as HTMLSelectElement).value)}>
					<For each={LEVELS as readonly string[]}>{lv => <option value={lv}>{lv}</option>}</For>
				</Select>
			</div>

			<Show when={filtered().length > 0} fallback={<Empty title="No logs" description={(props.logs ?? []).length === 0 ? "No log events recorded for this range." : "No logs match the current filter."} />}>
				<div class="stack stack-xs" data-testid="pulse-logs-list" style={{ "font-family": "var(--font-mono, monospace)", "font-size": "0.8rem" }}>
					<For each={filtered()}>
						{(log, idx) => (
							<div class="row" style={{ "align-items": "baseline", gap: "0.5rem", padding: "0.25rem 0", "border-bottom": "1px solid var(--border)" }}>
								<span class="text-faint" style={{ "min-width": "70px" }}>{fmtTime(log.ts)}</span>
								<Badge variant={levelVariant(log.level) as any}>{log.level ?? "info"}</Badge>
								<span style={{ flex: 1, "white-space": "pre-wrap", "word-break": "break-word" }}>{log.message ?? log.name ?? `log #${idx() + 1}`}</span>
								<Show when={log.route}>
									<span class="text-faint">{log.route}</span>
								</Show>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
