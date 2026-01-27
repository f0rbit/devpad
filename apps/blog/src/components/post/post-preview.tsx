import { Spinner } from "@f0rbit/ui";
import { Show, createEffect, createSignal } from "solid-js";
import { markdown } from "../../lib/markdown";

type Props = {
	content: string;
	format: "md" | "adoc";
};

const PostPreview = (props: Props) => {
	const [html, setHtml] = createSignal("");
	const [loading, setLoading] = createSignal(true);

	createEffect(async () => {
		setLoading(true);
		if (props.format === "md") {
			const rendered = await markdown.render(props.content);
			setHtml(rendered);
		} else {
			setHtml(`<p><em>Asciidoc preview not yet supported</em></p><pre>${escapeHtml(props.content)}</pre>`);
		}
		setLoading(false);
	});

	return (
		<div class="post-preview">
			<Show when={!loading()} fallback={<Spinner size="sm" />}>
				<div class="prose" innerHTML={html()} />
			</Show>
		</div>
	);
};

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

export default PostPreview;
