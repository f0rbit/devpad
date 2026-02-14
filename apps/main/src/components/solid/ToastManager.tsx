import AlertCircle from "lucide-solid/icons/alert-circle";
import CheckCircle from "lucide-solid/icons/check-circle";
import Info from "lucide-solid/icons/info";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
	id: string;
	type: ToastType;
	title: string;
	message?: string;
	duration?: number;
	persistent?: boolean;
}

// Global toast state
const [toasts, setToasts] = createSignal<Toast[]>([]);

// Global toast manager
export const toastManager = {
	show: (toast: Omit<Toast, "id">) => {
		const id = crypto.randomUUID();
		const newToast: Toast = {
			id,
			duration: 5000,
			...toast,
		};

		setToasts(prev => [...prev, newToast]);

		// Auto-remove after duration (if not persistent)
		if (!newToast.persistent && newToast.duration) {
			setTimeout(() => {
				toastManager.dismiss(id);
			}, newToast.duration);
		}

		return id;
	},

	success: (title: string, message?: string, options?: Partial<Toast>) => {
		return toastManager.show({
			type: "success",
			title,
			message,
			...options,
		});
	},

	error: (title: string, message?: string, options?: Partial<Toast>) => {
		return toastManager.show({
			type: "error",
			title,
			message,
			duration: 7000, // Errors stay longer by default
			...options,
		});
	},

	info: (title: string, message?: string, options?: Partial<Toast>) => {
		return toastManager.show({
			type: "info",
			title,
			message,
			...options,
		});
	},

	warning: (title: string, message?: string, options?: Partial<Toast>) => {
		return toastManager.show({
			type: "warning",
			title,
			message,
			...options,
		});
	},

	dismiss: (id: string) => {
		setToasts(prev => prev.filter(toast => toast.id !== id));
	},

	dismissAll: () => {
		setToasts([]);
	},
};

interface ToastItemProps {
	toast: Toast;
	onDismiss: (id: string) => void;
}

function ToastItem(props: ToastItemProps) {
	const typeConfig = () => {
		switch (props.toast.type) {
			case "success":
				return {
					icon: CheckCircle,
					bgColor: "bg-green-50",
					borderColor: "border-green-200",
					iconColor: "text-green-400",
					titleColor: "text-green-800",
					messageColor: "text-green-700",
				};
			case "error":
				return {
					icon: AlertCircle,
					bgColor: "bg-red-50",
					borderColor: "border-red-200",
					iconColor: "text-red-400",
					titleColor: "text-red-800",
					messageColor: "text-red-700",
				};
			case "warning":
				return {
					icon: AlertCircle,
					bgColor: "bg-yellow-50",
					borderColor: "border-yellow-200",
					iconColor: "text-yellow-400",
					titleColor: "text-yellow-800",
					messageColor: "text-yellow-700",
				};
			case "info":
			default:
				return {
					icon: Info,
					bgColor: "bg-blue-50",
					borderColor: "border-blue-200",
					iconColor: "text-blue-400",
					titleColor: "text-blue-800",
					messageColor: "text-blue-700",
				};
		}
	};

	const config = typeConfig();
	const IconComponent = config.icon;

	return (
		<div
			class={`
			${config.bgColor} ${config.borderColor}
			border rounded-lg p-4 shadow-md max-w-sm w-full
			animate-in slide-in-from-right-full fade-in duration-300
		`}
		>
			<div class="flex">
				<div class="flex-shrink-0">
					<IconComponent class={`h-5 w-5 ${config.iconColor}`} />
				</div>
				<div class="ml-3 flex-1">
					<p class={`text-sm font-medium ${config.titleColor}`}>{props.toast.title}</p>
					<Show when={props.toast.message}>
						<p class={`mt-1 text-sm ${config.messageColor}`}>{props.toast.message}</p>
					</Show>
				</div>
				<div class="ml-4 flex flex-shrink-0">
					<button
						class={`
							inline-flex rounded-md ${config.bgColor} ${config.titleColor}
							hover:${config.messageColor} focus:outline-none focus:ring-2 
							focus:ring-offset-2 focus:ring-offset-green-50 focus:ring-green-600
						`}
						onClick={() => props.onDismiss(props.toast.id)}
					>
						<span class="sr-only">Close</span>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Toast notification container - should be placed once at the root of your app
 */
export function ToastContainer() {
	return (
		<div aria-live="assertive" class="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-50">
			<div class="w-full flex flex-col items-center space-y-4 sm:items-end">
				<For each={toasts()}>
					{toast => (
						<div class="pointer-events-auto">
							<ToastItem toast={toast} onDismiss={toastManager.dismiss} />
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
