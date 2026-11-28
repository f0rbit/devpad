import { z } from "zod";
import { log } from "@/lib/pulse";

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
		const raw_json: unknown = JSON.parse(raw);
		const result = ProjectContextSchema.safeParse(raw_json);
		return result.success ? result.data : null;
	} catch (error) {
		log.warning("project context in sessionStorage was not valid JSON", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export function clearProjectContext(): void {
	if (typeof window === "undefined") return;
	sessionStorage.removeItem(STORAGE_KEY);
}
