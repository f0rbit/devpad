import { onMount } from "solid-js";
import { setProjectContext } from "@/utils/project-context";
import { track } from "@/lib/pulse";

export function ProjectContextSetter(props: { id: string; name: string }) {
	onMount(() => {
		setProjectContext({ id: props.id, name: props.name });
		track("project_context_set", { project_id: props.id });
	});
	return null;
}
