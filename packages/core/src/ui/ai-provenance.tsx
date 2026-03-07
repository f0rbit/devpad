import Bot from "lucide-solid/icons/bot";
import { Show } from "solid-js";

interface AiProvenanceProps {
	created_by?: "user" | "api" | null;
	modified_by?: "user" | "api" | null;
	size?: number;
}

export function AiProvenance(props: AiProvenanceProps) {
	const show = () => props.created_by === "api" || props.modified_by === "api";

	const label = () => {
		const created = props.created_by === "api";
		const modified = props.modified_by === "api";
		if (created && modified) return "created & modified by AI";
		if (created) return "created by AI";
		return "modified by AI";
	};

	return (
		<Show when={show()}>
			<span class="ai-provenance" title={label()}>
				<Bot size={props.size ?? 14} />
			</span>
		</Show>
	);
}
