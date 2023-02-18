export default function DeleteButton({ children, style, title, onClick }: { children: React.ReactNode; style?: string; title?: string; onClick?: () => void }) {
	return (
		<button
			// className={"rounded-md border-1 border-accent-btn-primary px-4 py-1 text-accent-btn-primary transition-all duration-300 hover:border-accent-btn-primary-hover hover:bg-accent-btn-primary hover:text-base-text-primary " + style}
			className={"rounded-md border-1 border-red-400 px-4 py-1 font-semibold text-red-400 transition-all duration-500 hover:border-red-300 hover:bg-red-400 hover:text-red-100 " + style}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}
