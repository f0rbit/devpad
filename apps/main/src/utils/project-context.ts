const STORAGE_KEY = "devpad_project_context";

interface ProjectContext {
	id: string;
	name: string;
}

export function setProjectContext(project: ProjectContext): void {
	if (typeof window === "undefined") return;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function getProjectContext(): ProjectContext | null {
	if (typeof window === "undefined") return null;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function clearProjectContext(): void {
	if (typeof window === "undefined") return;
	sessionStorage.removeItem(STORAGE_KEY);
}
