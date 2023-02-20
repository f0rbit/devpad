export default function GenericButton({ children, style, title, onClick }: { children: React.ReactNode; style?: string; title?: string; onClick?: () => void }) {
	return (
		<button
			className={"rounded-md border-1 border-green-300 hover:border-green-200 hover:bg-green-400 transition-all duration-300 px-4 py-1 text-green-400 hover:text-green-50 " + style}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}
