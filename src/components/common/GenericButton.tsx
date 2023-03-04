export default function GenericButton({ children, style, title, onClick }: { children: React.ReactNode; style?: string; title?: string; onClick?: () => void }) {
	return (
		<button
			className={
				"rounded-md border-1 border-gray-300 bg-gray-100 px-4 py-1 text-base-text-subtle transition-all duration-300 hover:bg-white hover:text-base-text-dark dark:border-borders-secondary dark:bg-none dark:text-base-text-subtlish dark:hover:bg-base-accent-secondary dark:hover:text-base-text-secondary " +
				style
			}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}
