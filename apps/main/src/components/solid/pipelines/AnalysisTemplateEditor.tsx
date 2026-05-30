import { getBrowserClient } from "@devpad/core/ui/client";
import type { PipelineAnalysisTemplate } from "@devpad/schema";
import { Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle } from "@f0rbit/ui";
import { createEffect, createSignal, Show } from "solid-js";

interface AnalysisTemplateEditorProps {
	open: boolean;
	mode: "create" | "edit";
	template: PipelineAnalysisTemplate | null;
	owner_id: string;
	onClose: () => void;
	onSaved: (saved: PipelineAnalysisTemplate) => void;
}

const threshold_dsl_string = (raw: unknown): string => (typeof raw === "string" ? raw : String(raw ?? ""));

export default function AnalysisTemplateEditor(props: AnalysisTemplateEditorProps) {
	const [name, setName] = createSignal("");
	const [thresholdDsl, setThresholdDsl] = createSignal("");
	const [windowMs, setWindowMs] = createSignal<number>(600_000);
	const [loading, setLoading] = createSignal(false);
	const [thresholdError, setThresholdError] = createSignal<string | null>(null);
	const [generalError, setGeneralError] = createSignal<string | null>(null);

	createEffect(() => {
		if (props.open) {
			const t = props.template;
			setName(t?.name ?? "");
			setThresholdDsl(threshold_dsl_string(t?.threshold_dsl));
			setWindowMs(t?.window_ms ?? 600_000);
			setThresholdError(null);
			setGeneralError(null);
		}
	});

	const handleSave = async () => {
		setLoading(true);
		setThresholdError(null);
		setGeneralError(null);
		const client = getBrowserClient();

		const saved_optimistic_name = name();

		if (props.mode === "create") {
			const result = await client.pipelines.analysis_templates.create({
				owner_id: props.owner_id,
				name: saved_optimistic_name,
				threshold_dsl: thresholdDsl(),
				window_ms: windowMs(),
			});
			if (!result.ok) {
				const err = result.error as { code?: string; field?: string; message?: string };
				if (err.code === "validation_error" && err.field === "threshold_dsl") {
					setThresholdError(err.message ?? "Invalid threshold DSL");
				} else {
					setGeneralError(err.message ?? "Failed to create template");
				}
				setLoading(false);
				return;
			}
			props.onSaved(result.value);
			setLoading(false);
			return;
		}

		const t = props.template;
		if (!t) {
			setGeneralError("missing template reference");
			setLoading(false);
			return;
		}
		const result = await client.pipelines.analysis_templates.update(t.id, {
			owner_id: props.owner_id,
			name: saved_optimistic_name,
			threshold_dsl: thresholdDsl(),
			window_ms: windowMs(),
		});
		if (!result.ok) {
			const err = result.error as { code?: string; field?: string; message?: string };
			if (err.code === "validation_error" && err.field === "threshold_dsl") {
				setThresholdError(err.message ?? "Invalid threshold DSL");
			} else {
				setGeneralError(err.message ?? "Failed to update template");
			}
			setLoading(false);
			return;
		}
		props.onSaved(result.value);
		setLoading(false);
	};

	return (
		<Modal open={props.open} onClose={props.onClose}>
			<ModalHeader>
				<ModalTitle>{props.mode === "create" ? "Create analysis template" : "Edit analysis template"}</ModalTitle>
			</ModalHeader>
			<ModalBody>
				<div class="stack stack-sm">
					<Show when={generalError()}>
						<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
							{generalError()}
						</p>
					</Show>

					<FormField label="Name">
						<Input placeholder="e.g. default-analysis" value={name()} onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => setName(e.currentTarget.value)} />
					</FormField>

					<FormField label="Threshold DSL" description="One rule per line. Format: metric OP value [: pending]. OPs: > < >= <= =.">
						<textarea
							value={thresholdDsl()}
							onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) => setThresholdDsl(e.currentTarget.value)}
							rows={12}
							style={{
								width: "100%",
								padding: "0.5rem 0.625rem",
								"font-family": "var(--font-mono, monospace)",
								"font-size": "var(--text-sm)",
								background: "var(--bg-alt)",
								color: "var(--fg)",
								border: thresholdError() ? "1px solid var(--item-red)" : "1px solid var(--border)",
								"border-radius": "var(--radius, 4px)",
								resize: "vertical",
							}}
						/>
						<Show when={thresholdError()}>
							<p class="text-sm" style={{ color: "var(--item-red)", margin: "0.25rem 0 0 0" }} data-testid="threshold-error">
								{thresholdError()}
							</p>
						</Show>
					</FormField>

					<FormField label="Window (ms)" description="Analysis window size. Default: 600000 (10 min).">
						<Input
							type="number"
							value={String(windowMs())}
							onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => {
								const n = Number.parseInt(e.currentTarget.value, 10);
								if (Number.isInteger(n) && n > 0) setWindowMs(n);
							}}
						/>
					</FormField>
				</div>
			</ModalBody>
			<ModalFooter>
				<Button variant="ghost" onClick={props.onClose}>
					cancel
				</Button>
				<Button onClick={handleSave} disabled={loading() || name().trim() === "" || thresholdDsl().trim() === ""}>
					{loading() ? "saving..." : props.mode === "create" ? "create" : "save"}
				</Button>
			</ModalFooter>
		</Modal>
	);
}
