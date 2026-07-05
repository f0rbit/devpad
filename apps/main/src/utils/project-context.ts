import { z } from "zod";

const STORAGE_KEY = "devpad_project_context";

const ProjectContextSchema = z.object({
	id: z.string(),
	name: z.string(),
});

type ProjectContext = z.infer<typeof ProjectContextSchema>;

export function setProjectContext(project: ProjectContext): void {
	if (typeof window === "undefined") return;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function getProjectContext(): ProjectContext | null {
	if (typeof window === "undefined") return null;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		const result = ProjectContextSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export function clearProjectContext(): void {
	if (typeof window === "undefined") return;
	sessionStorage.removeItem(STORAGE_KEY);
}
