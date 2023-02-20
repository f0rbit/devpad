export default function GenericButton({ children, style, title, onClick }: { children: React.ReactNode; style?: string; title?: string; onClick?: () => void }) {
	return (
		<button
			className={"rounded-md border-1 border-borders-secondary hover:bg-base-accent-secondary transition-all duration-300 px-4 py-1 text-base-text-subtlish hover:text-base-text-secondary " + style}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}
