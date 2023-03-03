import AcceptButton from "../AcceptButton";

export default function ProgressIndicator({ progress, onFinish }: { progress: number; onFinish?: () => void }) {
	// progress is a value from 0 - 1
	// returns a button where the border is filled up clockwise based on the progress
	if (onFinish && progress >= 1) {
		return (
			<AcceptButton title="Mark as Finished" onClick={onFinish}>
				Finish
			</AcceptButton>
		);
	}
	const radius = 10;
	const width = 3;
	const size = radius + 5;
	const circumference = 2 * Math.PI * radius;
	return (
		<div x-data="scrollProgress" className="flex items-center justify-center gap-1 rounded-md border-1 border-borders-secondary px-4 py-[1px]">
			<svg style={{ width: size * 2 + "px", height: size * 2 + "px" }}>
				<circle className="text-base-text-subtle" strokeWidth={width} stroke="currentColor" fill="transparent" r={radius} cx={size} cy={size} />
				<circle
					className="text-green-300"
					strokeWidth={width}
					strokeDasharray={circumference}
					//   stroke-dashoffset="circumference - percent / 100 * circumference"
					strokeDashoffset={circumference - progress * circumference}
					strokeLinecap="round"
					stroke="currentColor"
					fill="transparent"
					r={radius}
					cx={size}
					cy={size}
				/>
			</svg>

			<span className={"text-sm " + (progress > 0 ? "text-green-300" : "text-base-text-subtlish")}>{Math.floor(progress * 100)}%</span>
		</div>
	);
}
