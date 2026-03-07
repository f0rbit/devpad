import Bot from "lucide-solid/icons/bot";
import { Show } from "solid-js";

type ProvenanceState = "created-and-modified" | "created" | "modified";

interface AiProvenanceProps {
	created_by?: "user" | "api" | null;
	modified_by?: "user" | "api" | null;
	size?: number;
}

export function AiProvenance(props: AiProvenanceProps) {
	const show = () => props.created_by === "api" || props.modified_by === "api";

	const state = (): ProvenanceState => {
		const created = props.created_by === "api";
		const modified = props.modified_by === "api";
		if (created && modified) return "created-and-modified";
		if (created) return "created";
		return "modified";
	};

	const label = () => {
		switch (state()) {
			case "created-and-modified":
				return "created & modified by AI";
			case "created":
				return "created by AI";
			case "modified":
				return "modified by AI";
		}
	};

	return (
		<Show when={show()}>
			<span class={`ai-provenance ai-provenance--${state()}`} title={label()}>
				<Bot size={props.size ?? 14} />
			</span>
		</Show>
	);
}
