import { describe, expect, test } from "bun:test";
import { ProjectsClient } from "../../../src/clients/projects";
import { ApiClient } from "../../../src/utils/request";

describe("ProjectsClient unit tests", () => {
	test("should construct with ApiClient", () => {
		const api_client = new ApiClient({
			base_url: "https://api.example.com",
			api_key: "valid-api-key-123456",
		});

		const projects_client = new ProjectsClient(api_client);
		expect(projects_client).toBeInstanceOf(ProjectsClient);
	});
});
