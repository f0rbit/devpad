import type { Component } from "solid-js";

const DevpadConnection: Component = () => {
	return (
		<div class="devpad-connection">
			<p class="text-sm">
				<span style={{ color: "oklch(from var(--item-green) 0.6 0.2 h)" }}>●</span> Connected via DevPad login
			</p>
			<p class="text-sm text-muted" style={{ "margin-top": "8px" }}>
				Your DevPad projects are available in the post editor.
			</p>
		</div>
	);
};

export default DevpadConnection;
