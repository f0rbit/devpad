import Check from "lucide-solid/icons/check";
import Loader2 from "lucide-solid/icons/loader-2";
import X from "lucide-solid/icons/x";
import { Show } from "solid-js";
import type { UpdateState } from "@/utils/optimistic-updates";

interface OptimisticStatusProps {
	state: UpdateState;
	size?: "sm" | "md" | "lg";
	className?: string;
}

/**
 * Visual indicator for optimistic update states
 * Shows spinner for loading, checkmark for success, X for error
 */
export function OptimisticStatus(props: OptimisticStatusProps) {
	const size = () => props.size || "md";
	const sizeClasses = () => {
		switch (size()) {
			case "sm":
				return "w-3 h-3";
			case "lg":
				return "w-6 h-6";
			default:
				return "w-4 h-4";
		}
	};

	return (
		<div class={`inline-flex items-center justify-center ${props.className || ""}`}>
			<Show when={props.state === "loading"}>
				<Loader2 class={`${sizeClasses()} animate-spin text-blue-500`} />
			</Show>

			<Show when={props.state === "success"}>
				<Check class={`${sizeClasses()} text-green-500`} />
			</Show>

			<Show when={props.state === "error"}>
				<X class={`${sizeClasses()} text-red-500`} />
			</Show>
		</div>
	);
}

interface OptimisticButtonProps {
	state: UpdateState;
	children?: any;
	onClick?: () => void;
	disabled?: boolean;
	variant?: "primary" | "secondary" | "ghost";
	size?: "sm" | "md" | "lg";
	className?: string;
}

/**
 * Button component with built-in optimistic update status
 */
export function OptimisticButton(props: OptimisticButtonProps) {
	const variant = () => props.variant || "primary";
	const size = () => props.size || "md";

	const baseClasses = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";

	const variantClasses = () => {
		switch (variant()) {
			case "secondary":
				return "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500";
			case "ghost":
				return "text-gray-700 hover:bg-gray-100 focus:ring-gray-500";
			default:
				return "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500";
		}
	};

	const sizeClasses = () => {
		switch (size()) {
			case "sm":
				return "px-2 py-1 text-sm";
			case "lg":
				return "px-6 py-3 text-lg";
			default:
				return "px-4 py-2";
		}
	};

	const isDisabled = () => props.disabled || props.state === "loading";
	const showStatus = () => props.state !== "idle";

	return (
		<button
			onClick={props.onClick}
			disabled={isDisabled()}
			class={`
				${baseClasses} 
				${variantClasses()} 
				${sizeClasses()}
				${isDisabled() ? "opacity-50 cursor-not-allowed" : ""}
				${props.className || ""}
			`}
		>
			<Show when={showStatus()}>
				<OptimisticStatus state={props.state} size={size() === "sm" ? "sm" : "md"} />
			</Show>
			{props.children}
		</button>
	);
}

interface OptimisticFieldProps {
	state: UpdateState;
	error?: string | null;
	children: any;
	className?: string;
}

/**
 * Wrapper for form fields with optimistic update status
 */
export function OptimisticField(props: OptimisticFieldProps) {
	return (
		<div class={`relative ${props.className || ""}`}>
			{props.children}

			<Show when={props.state !== "idle"}>
				<div class="absolute right-2 top-1/2 transform -translate-y-1/2">
					<OptimisticStatus state={props.state} size="sm" />
				</div>
			</Show>

			<Show when={props.state === "error" && props.error}>
				<div class="mt-1 text-sm text-red-600">{props.error}</div>
			</Show>
		</div>
	);
}
