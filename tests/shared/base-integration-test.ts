import { afterAll, beforeAll } from "bun:test";
import type ApiClient from "@devpad/api";
import { getSharedApiClient } from "../integration/setup";
import { CleanupManager } from "./cleanup-manager";

export type IntegrationContext = {
	client: ApiClient;
	cleanup: CleanupManager;
};

export function setupIntegration(): IntegrationContext {
	const ctx: IntegrationContext = {
		client: null as unknown as ApiClient,
		cleanup: null as unknown as CleanupManager,
	};

	beforeAll(async () => {
		ctx.client = await getSharedApiClient();
		ctx.cleanup = new CleanupManager(ctx.client);
	});

	afterAll(async () => {
		await ctx.cleanup.cleanupAll();
	});

	return ctx;
}
