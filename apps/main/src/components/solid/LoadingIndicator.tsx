import Check from "lucide-solid/icons/check";
import Loader from "lucide-solid/icons/loader";
import X from "lucide-solid/icons/x";
import type { Accessor, JSX } from "solid-js";

export type LoadingState = "idle" | "loading" | "success" | "error";

export function LoadingIndicator({ state, idle }: { state: Accessor<LoadingState>; idle: JSX.Element }) {
	return (
		<>
			{state() === "loading" && <Loader class="animate-spin" />}
			{state() === "success" && <Check style={{ color: "var(--success-fg)" }} />}
			{state() === "error" && <X style={{ color: "var(--error-fg)" }} />}
			{state() !== "loading" && state() !== "success" && state() !== "error" && idle}
		</>
	);
}
