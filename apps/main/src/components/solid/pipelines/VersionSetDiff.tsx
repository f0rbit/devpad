interface VersionSetDiffProps {
	current: Record<string, any>;
	previous?: Record<string, any>;
}

export default function VersionSetDiff(props: VersionSetDiffProps) {
	const format_json = (obj: Record<string, any>, indent = 0): string => {
		const str = JSON.stringify(obj, null, 2);
		return str;
	};

	const current_json = format_json(props.current);
	const previous_json = props.previous ? format_json(props.previous) : null;

	// Simple side-by-side or unified diff
	if (!previous_json) {
		return (
			<div class="card card-flat">
				<pre
					style={{
						margin: "0",
						padding: "var(--space-md)",
						"background-color": "var(--bg-alt)",
						"overflow-x": "auto",
						"font-size": "0.85rem",
						"line-height": "1.5",
						color: "var(--fg-subtle)",
					}}
				>
					{current_json}
				</pre>
			</div>
		);
	}

	const current_lines = current_json.split("\n");
	const previous_lines = previous_json.split("\n");

	return (
		<div class="card card-flat">
			<div
				style={{
					display: "grid",
					"grid-template-columns": "1fr 1fr",
					gap: "var(--space-sm)",
					padding: "var(--space-md)",
					"background-color": "var(--bg-alt)",
				}}
			>
				<div>
					<div
						style={{
							"font-weight": "500",
							"font-size": "0.85rem",
							color: "var(--fg-muted)",
							"margin-bottom": "var(--space-xs)",
						}}
					>
						previous
					</div>
					<pre
						style={{
							margin: "0",
							"overflow-x": "auto",
							"font-size": "0.8rem",
							"line-height": "1.4",
							color: "var(--fg-subtle)",
							"background-color": "var(--bg)",
							padding: "var(--space-sm)",
							"border-radius": "var(--radius-sm)",
						}}
					>
						{previous_lines.slice(0, 50).join("\n")}
						{previous_lines.length > 50 && "\n..."}
					</pre>
				</div>
				<div>
					<div
						style={{
							"font-weight": "500",
							"font-size": "0.85rem",
							color: "var(--fg-muted)",
							"margin-bottom": "var(--space-xs)",
						}}
					>
						current
					</div>
					<pre
						style={{
							margin: "0",
							"overflow-x": "auto",
							"font-size": "0.8rem",
							"line-height": "1.4",
							color: "var(--fg-subtle)",
							"background-color": "var(--bg)",
							padding: "var(--space-sm)",
							"border-radius": "var(--radius-sm)",
						}}
					>
						{current_lines.slice(0, 50).join("\n")}
						{current_lines.length > 50 && "\n..."}
					</pre>
				</div>
			</div>
		</div>
	);
}
