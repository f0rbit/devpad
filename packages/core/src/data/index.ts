// Data layer exports
export * from "./interfaces.js";

import * as KeysService from "../auth/keys.js";
import * as ActionsService from "../services/action.js";
import * as GithubService from "../services/github.js";
// For now, we'll export the services directly
// TODO: Implement proper adapters after full restructuring
import * as ProjectsService from "../services/projects.js";
import * as TagsService from "../services/tags.js";
import * as TasksService from "../services/tasks.js";

export { ProjectsService, TasksService, TagsService, KeysService, ActionsService, GithubService };

// Factory function for future adapter selection
export function createDataAdapter(type: "database" | "api-client" = "database") {
	if (type === "database") {
		// Return direct service access for now
		return {
			projects: ProjectsService,
			tasks: TasksService,
			tags: TagsService,
			auth: KeysService,
			actions: ActionsService,
			github: GithubService,
		};
	}
	throw new Error("API client adapter not implemented yet");
}
