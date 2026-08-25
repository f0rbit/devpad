import X from "lucide-solid/icons/x";
import { onMount, type JSX } from "solid-js";

export type LensShellProps = {
	title: string;
	onClose: () => void;
	/** Extra controls rendered in the header, right of the title (depth toggle, etc). */
	headerExtra?: JSX.Element;
	/** Any key not already handled by the shell (Escape) — the shell always stops propagation first. */
	onKey?: (e: KeyboardEvent) => void;
	children: JSX.Element;
};

/**
 * Shared chrome for the ephemeral B2 lenses (graph/milestone) — an
 * Esc-dismissable, full-screen overlay that is NEVER a route (no
 * pushState). Mounting/unmounting is the only state change; the back
 * button can never land "inside" a lens because nothing was ever pushed.
 */
export function LensShell(props: LensShellProps) {
	let rootRef: HTMLDivElement | undefined;

	onMount(() => rootRef?.focus());

	const onKeyDown = (e: KeyboardEvent) => {
		// Stops every key here — the outline's own onKeyDown lives on an
		// ancestor element and must never also react to j/k/space/etc while a
		// lens has focus.
		e.stopPropagation();
		if (e.key === "Escape") {
			props.onClose();
			return;
		}
		props.onKey?.(e);
	};

	return (
		<div
			ref={rootRef}
			class="lens-overlay"
			data-testid="lens-overlay"
			role="dialog"
			aria-modal="true"
			aria-label={props.title}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			<div class="lens-header">
				<h2 class="lens-title">{props.title}</h2>
				<div class="lens-header-extra">{props.headerExtra}</div>
				<button type="button" class="lens-close" onClick={props.onClose} aria-label="Close lens (Esc)">
					<X size={16} />
				</button>
			</div>
			<div class="lens-body">{props.children}</div>
		</div>
	);
}
