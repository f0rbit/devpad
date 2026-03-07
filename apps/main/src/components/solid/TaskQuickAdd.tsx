import { getBrowserClient } from "@devpad/core/ui/client";
import type { TaskWithDetails } from "@devpad/schema";
import Loader from "lucide-solid/icons/loader";
import Plus from "lucide-solid/icons/plus";
import { createSignal, Show } from "solid-js";

interface Props {
	project_id: string;
	user_id: string;
	onCreated: (task: TaskWithDetails) => void;
}

export function TaskQuickAdd({ project_id, user_id, onCreated }: Props) {
	const [title, setTitle] = createSignal("");
	const [priority, setPriority] = createSignal<"LOW" | "MEDIUM" | "HIGH">("LOW");
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");

	const handleSubmit = async () => {
		const trimmed = title().trim();
		if (!trimmed || loading()) return;

		setLoading(true);
		setError("");

		const client = getBrowserClient();
		const result = await client.tasks.upsert({
			owner_id: user_id,
			title: trimmed,
			project_id,
			priority: priority(),
		});

		setLoading(false);

		if (!result.ok) {
			setError(result.error.message);
			return;
		}

		setTitle("");
		setPriority("LOW");
		onCreated(result.value);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<div class="row" style={{ padding: "6px 0", "border-bottom": "1px solid var(--border)", "margin-bottom": "9px" }}>
			<input type="text" class="input" style={{ flex: 1 }} placeholder="Add task..." value={title()} onInput={e => setTitle(e.target.value)} onKeyDown={handleKeyDown} disabled={loading()} />
			<select class="select" style={{ width: "auto", "min-width": "80px" }} value={priority()} onChange={e => setPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH")} disabled={loading()}>
				<option value="LOW">LOW</option>
				<option value="MEDIUM">MEDIUM</option>
				<option value="HIGH">HIGH</option>
			</select>
			<button type="button" class="btn btn-ghost btn-icon btn-sm" onClick={handleSubmit} disabled={loading()}>
				<Show when={loading()} fallback={<Plus style={{ width: "1.1rem", height: "1.1rem" }} />}>
					<Loader class="animate-spin" style={{ width: "1.1rem", height: "1.1rem" }} />
				</Show>
			</button>
			<Show when={error()}>
				<span style={{ color: "var(--error-fg)", "font-size": "smaller" }}>{error()}</span>
			</Show>
		</div>
	);
}
