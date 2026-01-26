import { describe, expect, it } from "bun:test";
import worker from "../index.js";

const request = (path: string, options?: RequestInit) => new Request(`http://localhost${path}`, options);

describe("health endpoint", () => {
	it("returns ok status", async () => {
		const response = await worker.fetch(request("/health"), {} as never, {} as never);
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body).toEqual({ status: "ok" });
	});
});

describe("routing", () => {
	it("returns 404 for unknown POST routes", async () => {
		const response = await worker.fetch(request("/nonexistent", { method: "POST" }), {} as never, {} as never);
		expect(response.status).toBe(404);
		const body = await response.json();
		expect(body).toEqual({ error: "not found" });
	});

	it("returns placeholder for devpad root", async () => {
		const response = await worker.fetch(request("/"), {} as never, {} as never);
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body).toHaveProperty("app", "devpad");
	});
});
