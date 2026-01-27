const date = (dateStr: string): string => {
	const d = new Date(dateStr);
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
};

const time = (dateStr: string): string => {
	const d = new Date(dateStr);
	return d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
};

const relative = (dateStr: string): string => {
	const d = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffSecs = Math.floor(diffMs / 1000);
	const diffMins = Math.floor(diffSecs / 60);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffSecs < 60) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return date(dateStr);
};

const platform = (p: string): string => {
	const names: Record<string, string> = {
		github: "GitHub",
		bluesky: "Bluesky",
		youtube: "YouTube",
		devpad: "Devpad",
		reddit: "Reddit",
		twitter: "Twitter/X",
	};
	return names[p] ?? p;
};

export const format = { date, time, relative, platform };
