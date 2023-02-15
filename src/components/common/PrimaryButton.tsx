export default function PrimaryButton({ children, style, title, onClick }: { children: React.ReactNode; style?: string; title?: string; onClick?: () => void }) {
	return (
		<button
			className={"rounded-md border-1 border-accent-btn-primary px-4 py-1 text-accent-btn-primary transition-all duration-300 hover:border-accent-btn-primary-hover hover:bg-accent-btn-primary hover:text-base-text-primary " + style}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}
