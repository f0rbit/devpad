import { getBrowserClient } from "@devpad/core/ui/client";
import type { PipelineAnalysisTemplate } from "@devpad/schema";
import { Button, Empty } from "@f0rbit/ui";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { createSignal, For, Show } from "solid-js";
import AnalysisTemplateEditor from "./AnalysisTemplateEditor";

interface AnalysisTemplateListProps {
	templates: PipelineAnalysisTemplate[];
	owner_id: string;
}

const threshold_line_count = (raw: unknown): number => {
	const text = typeof raw === "string" ? raw : String(raw ?? "");
	return text
		.split("\n")
		.map(l => l.trim())
		.filter(l => l.length > 0 && !l.startsWith("#")).length;
};

export default function AnalysisTemplateList(props: AnalysisTemplateListProps) {
	const [templates, setTemplates] = createSignal<PipelineAnalysisTemplate[]>(props.templates);
	const [editorOpen, setEditorOpen] = createSignal(false);
	const [editorMode, setEditorMode] = createSignal<"create" | "edit">("create");
	const [editTarget, setEditTarget] = createSignal<PipelineAnalysisTemplate | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [deletingId, setDeletingId] = createSignal<string | null>(null);

	const openCreate = () => {
		setEditTarget(null);
		setEditorMode("create");
		setEditorOpen(true);
	};

	const openEdit = (t: PipelineAnalysisTemplate) => {
		setEditTarget(t);
		setEditorMode("edit");
		setEditorOpen(true);
	};

	const handleSaved = (saved: PipelineAnalysisTemplate) => {
		setTemplates(prev => {
			const idx = prev.findIndex(t => t.id === saved.id);
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = saved;
				return next;
			}
			return [...prev, saved];
		});
		setEditorOpen(false);
	};

	const handleDelete = async (t: PipelineAnalysisTemplate) => {
		setDeletingId(t.id);
		setError(null);
		const client = getBrowserClient();
		const result = await client.pipelines.analysis_templates.delete(t.id, { owner_id: props.owner_id });
		if (!result.ok) {
			setError(result.error.message ?? "Failed to delete template");
		} else {
			setTemplates(prev => prev.filter(x => x.id !== t.id));
		}
		setDeletingId(null);
	};

	return (
		<div class="stack stack-sm">
			<div class="row row-between" style={{ "align-items": "center" }}>
				<h3 style={{ margin: "0" }}>analysis templates</h3>
				<Button size="sm" onClick={openCreate} data-testid="analysis-template-create">
					<Plus size={16} /> new template
				</Button>
			</div>

			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Show
				when={templates().length > 0}
				fallback={<Empty title="No analysis templates" description="Analysis gates need a template to evaluate metrics. Create one to gate stage transitions on pulse-driven verdicts." />}
			>
				<div class="stack stack-sm" data-testid="analysis-template-table">
					<div
						class="row"
						style={{
							display: "grid",
							"grid-template-columns": "2fr 1fr 1fr auto",
							gap: "0.75rem",
							padding: "0.5rem 0.75rem",
							"font-size": "var(--text-xs)",
							color: "var(--fg-faint)",
							"text-transform": "uppercase",
							"letter-spacing": "0.05em",
						}}
					>
						<span>name</span>
						<span>window</span>
						<span>thresholds</span>
						<span />
					</div>
					<For each={templates()}>
						{t => (
							<div
								class="interactive-row"
								style={{
									display: "grid",
									"grid-template-columns": "2fr 1fr 1fr auto",
									gap: "0.75rem",
									"align-items": "center",
									padding: "0.75rem",
									border: "1px solid var(--border)",
									"border-radius": "var(--radius, 4px)",
								}}
								data-testid="analysis-template-row"
							>
								<span style={{ "font-family": "var(--font-mono, monospace)", "font-size": "0.9rem" }}>{t.name}</span>
								<span class="text-sm text-faint">{t.window_ms}ms</span>
								<span class="text-sm text-faint">{threshold_line_count(t.threshold_dsl)} rule(s)</span>
								<div style={{ display: "flex", gap: "0.5rem" }}>
									<Button size="sm" variant="ghost" onClick={() => openEdit(t)} data-testid="analysis-template-edit">
										<Pencil size={14} /> edit
									</Button>
									<Button size="sm" variant="ghost" disabled={deletingId() === t.id} onClick={() => handleDelete(t)} data-testid="analysis-template-delete">
										<Trash2 size={14} /> {deletingId() === t.id ? "deleting..." : "delete"}
									</Button>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>

			<AnalysisTemplateEditor
				open={editorOpen()}
				mode={editorMode()}
				template={editTarget()}
				owner_id={props.owner_id}
				onClose={() => setEditorOpen(false)}
				onSaved={handleSaved}
			/>
		</div>
	);
}
