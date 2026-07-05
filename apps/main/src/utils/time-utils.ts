/**
 * Format a date as relative time string (e.g. "2h ago")
 */
export function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diff_ms = now.getTime() - date.getTime();
	const diff_sec = diff_ms / 1000;
	const diff_min = diff_sec / 60;
	const diff_hour = diff_min / 60;
	const diff_day = diff_hour / 24;

	if (diff_sec < 60) {
		const sec = Math.round(diff_sec);
		return sec === 1 ? "1s ago" : `${String(sec)}s ago`;
	}
	if (diff_min < 60) {
		const min = Math.round(diff_min);
		return min === 1 ? "1m ago" : `${String(min)}m ago`;
	}
	if (diff_hour < 24) {
		const hour = Math.round(diff_hour);
		return hour === 1 ? "1h ago" : `${String(hour)}h ago`;
	}
	if (diff_day < 7) {
		const day = Math.round(diff_day);
		return day === 1 ? "1d ago" : `${String(day)}d ago`;
	}

	const week = Math.round(diff_day / 7);
	return week === 1 ? "1w ago" : `${String(week)}w ago`;
}
