import { onMount } from "solid-js";
import { setProjectContext } from "@/utils/project-context";

export function ProjectContextSetter(props: { id: string; name: string }) {
	onMount(() => setProjectContext({ id: props.id, name: props.name }));
	return null;
}
