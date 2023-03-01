export default function VersionIndicator({ version, className }: { version: string; className?: string }) {
	return (
		<div className={"w-max origin-left scale-75 rounded-md border-1 border-accent-btn-primary px-2 " + className}>
			<div className="font-mono text-sm text-accent-btn-primary">{version}</div>
		</div>
	);
}