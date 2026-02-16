export function DevpadFooter(props: { text?: string }) {
	return (
		<footer>
			<p>{props.text ?? "\u00A9 2025 devpad"}</p>
		</footer>
	);
}
