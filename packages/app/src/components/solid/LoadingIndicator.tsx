import Loader from "lucide-solid/icons/loader";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import type { Accessor, JSX } from "solid-js";

export type LoadingState = "idle" | "loading" | "success" | "error";

export function LoadingIndicator({ state, idle }: { state: Accessor<LoadingState>; idle: JSX.Element }) {
	return (
		<>
			{state() === "loading" && <Loader class="spinner" />}
			{state() === "success" && <Check class="success-icon" />}
			{state() === "error" && <X class="error-icon" />}
			{state() !== "loading" && state() !== "success" && state() !== "error" && idle}
		</>
	);
}
