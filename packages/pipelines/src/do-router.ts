/**
 * @module pipelines/do-router
 *
 * Thin abstraction over the Cloudflare `DurableObjectNamespace` so
 * tests can swap in {@link InMemoryDurableObjectNamespace} without
 * the routes caring.
 *
 * Returns a `Fetcher`-like object — `fetch(request)`.
 */

export type DoStub = {
	fetch(request: Request): Promise<Response>;
};

export type DoRouter = {
	get(run_id: string): DoStub;
};

/**
 * Production router. Wraps the real `DurableObjectNamespace`. The
 * `unknown` type sidesteps the workers-types vs. test-types friction;
 * the production wiring passes the actual namespace through and the
 * test wiring passes the in-memory fake.
 */
export const make_cf_router = (namespace: {
	idFromName(name: string): unknown;
	get(id: unknown): { fetch(request: Request): Promise<Response> };
}): DoRouter => ({
	get(run_id) {
		const id = namespace.idFromName(run_id);
		const stub = namespace.get(id);
		return {
			fetch: (req) => stub.fetch(req),
		};
	},
});
