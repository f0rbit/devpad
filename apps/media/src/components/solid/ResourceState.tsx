import { Spinner } from "@f0rbit/ui";
import { type JSX, Show } from "solid-js";

type LoadingProps = {
	message?: string;
	size?: "sm" | "md" | "lg";
	children?: JSX.Element;
};

export function Loading(props: LoadingProps) {
	return (
		<div class="loading-state">
			{props.children ?? <Spinner size={props.size ?? "md"} />}
			<Show when={props.message}>
				<p class="tertiary">{props.message}</p>
			</Show>
		</div>
	);
}

type ErrorDisplayProps = {
	message: string;
	prefix?: string;
	class?: string;
};

export function ErrorDisplay(props: ErrorDisplayProps) {
	const text = () => (props.prefix ? `${props.prefix}: ${props.message}` : props.message);
	return <p class={`error-icon ${props.class ?? ""}`}>{text()}</p>;
}

type Resource<T> = {
	(): T | undefined;
	loading: boolean;
	error: Error | undefined;
};

type ResourceStateProps<T> = {
	resource: Resource<T>;
	loadingMessage?: string;
	errorPrefix?: string;
	loadingFallback?: JSX.Element;
	children: (data: NonNullable<T>) => JSX.Element;
};

export function ResourceState<T>(props: ResourceStateProps<T>) {
	return (
		<>
			<Show when={props.resource.loading}>{props.loadingFallback ?? <Loading message={props.loadingMessage} />}</Show>

			<Show when={props.resource.error}>{err => <ErrorDisplay prefix={props.errorPrefix ?? "Failed to load"} message={err().message} />}</Show>

			<Show when={!props.resource.loading && !props.resource.error && props.resource()} keyed>
				{data => props.children(data as NonNullable<T>)}
			</Show>
		</>
	);
}

type AsyncStateProps<T> = {
	loading: boolean;
	error: Error | undefined;
	data: T | undefined;
	loadingMessage?: string;
	errorPrefix?: string;
	loadingFallback?: JSX.Element;
	children: (data: T) => JSX.Element;
};

export function AsyncState<T>(props: AsyncStateProps<T>) {
	return (
		<>
			<Show when={props.loading}>{props.loadingFallback ?? <Loading message={props.loadingMessage} />}</Show>

			<Show when={props.error}>{err => <ErrorDisplay prefix={props.errorPrefix ?? "Failed to load"} message={err().message} />}</Show>

			<Show when={!props.loading && !props.error && props.data} keyed>
				{data => props.children(data)}
			</Show>
		</>
	);
}
