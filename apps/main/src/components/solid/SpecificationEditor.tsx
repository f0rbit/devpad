// SpecificationEditor.jsx

import Github from "lucide-solid/icons/github";
import Pencil from "lucide-solid/icons/pencil";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Save from "lucide-solid/icons/save";
import X from "lucide-solid/icons/x";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { createEffect, createSignal } from "solid-js";
import { LoadingIndicator, type LoadingState } from "@/components/solid/LoadingIndicator";
import { getApiClient } from "@/utils/api-client";

interface Props {
	project_id: string;
	initial: string;
	has_github: boolean;
}

const SpecificationEditor = ({ project_id, initial, has_github }: Props) => {
	const [current, setCurrent] = createSignal(initial);
	const [isEditing, setIsEditing] = createSignal(false);
	const [markdown, setMarkdown] = createSignal(initial);
	const [parsedMarkdown, setParsedMarkdown] = createSignal("");
	const [error, setError] = createSignal("");
	const [fetching, setFetching] = createSignal<LoadingState>("idle");
	const [saving, setSaving] = createSignal<LoadingState>("idle");

	const fetchSpecification = async () => {
		setError("");
		setSaving("idle");
		setFetching("loading");
		try {
			const apiClient = getApiClient();
			const result = await apiClient.projects.specification(project_id);
			if (!result.ok) throw new Error(result.error.message);
			setMarkdown(result.value ?? "");
			setFetching("success");
			setTimeout(() => {
				setFetching("idle");
			}, 1500);
		} catch (err) {
			setError((err as Error).message);
			setFetching("error");
		}
	};

	const save = async () => {
		setError("");
		setSaving("loading");
		setFetching("idle");
		try {
			const apiClient = getApiClient();
			// Use the new clean update interface - much simpler!
			await apiClient.projects.update(project_id, {
				specification: markdown(),
			});
			setSaving("success");
			setCurrent(markdown());
			setTimeout(() => {
				setSaving("idle");
			}, 1500);
		} catch (err) {
			setError((err as Error).message);
			setSaving("error");
		}
	};

	const resetMarkdown = () => {
		setError("");
		setSaving("idle");
		setFetching("idle");
		setMarkdown(current());
	};

	const exitEditing = () => {
		setError("");
		resetMarkdown();
		setIsEditing(false);
	};

	const parseMarkdown = async (md: string) => {
		try {
			const processed = await remark().use(remarkHtml).process(md);
			setParsedMarkdown(processed.toString());
		} catch (err) {
			setError((err as Error).message);
		}
	};

	// Parse markdown when editing is turned off
	createEffect(() => {
		if (!isEditing()) {
			parseMarkdown(markdown());
		}
	}, isEditing);

	return (
		<div class="specification-editor">
			{isEditing() ? (
				<>
					<div class="controls">
						<a role="button" onClick={save}>
							<LoadingIndicator state={saving} idle={<Save />} />
							save
						</a>
						{has_github && (
							<a role="button" onClick={fetchSpecification}>
								<LoadingIndicator state={fetching} idle={<Github />} />
								fetch
							</a>
						)}
						<a role="button" onClick={resetMarkdown}>
							<RotateCcw />
							reset
						</a>
						<div style={{ flex: 1 }} />
						<a role="button" onClick={exitEditing}>
							<X style="margin-right: -3px;" />
							<span>exit</span>
						</a>
					</div>
					{error() && <p class="error-icon">{error()}</p>}
					<textarea value={markdown()} rows={50} onInput={e => setMarkdown(e.target.value)} style={{ width: "100%", "font-family": "monospace", "font-size": "medium" }} />
				</>
			) : (
				<>
					<a role="button" class="edit icons" onClick={() => setIsEditing(true)}>
						<Pencil />
						edit
					</a>
					<div innerHTML={parsedMarkdown()} />
				</>
			)}
		</div>
	);
};

export default SpecificationEditor;
