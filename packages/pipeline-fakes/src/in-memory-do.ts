/**
 * @module pipeline-fakes/in-memory-do
 *
 * Pure TypeScript fake for the Cloudflare Durable Object runtime
 * surface used by the orchestrator. Lets us test the DO + Hono routes
 * end-to-end without spinning up miniflare or
 * `@cloudflare/vitest-pool-workers`.
 *
 * The fake only implements the slice the orchestrator touches:
 *
 * - `ctx.storage.{get, put, delete, list}` over a single `Map`
 * - `ctx.storage.{getAlarm, setAlarm, deleteAlarm}` over a single
 *   nullable timestamp
 * - `id.toString() / id.equals(other)`
 * - `manualFireAlarm()` test helper — clears the alarm and invokes
 *   the supplied `alarm()` callback
 *
 * The DO under test calls `ctx.storage.setAlarm(ms)` but the runtime
 * never actually fires; tests advance time by calling `manualFireAlarm`.
 */

export type DurableObjectIdFake = {
	toString(): string;
	equals(other: DurableObjectIdFake): boolean;
};

const make_id = (name: string): DurableObjectIdFake => ({
	toString: () => name,
	equals: (other) => other.toString() === name,
});

export type StorageFake = {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<boolean>;
	list<T = unknown>(): Promise<Map<string, T>>;
	getAlarm(): Promise<number | null>;
	setAlarm(scheduled_time: number): Promise<void>;
	deleteAlarm(): Promise<void>;
};

export class InMemoryDurableObjectState {
	readonly id: DurableObjectIdFake;
	readonly storage: StorageFake;
	private readonly kv: Map<string, unknown> = new Map();
	private alarm_at_ms: number | null = null;
	private alarm_handler: (() => Promise<void>) | null = null;

	constructor(name: string) {
		this.id = make_id(name);
		this.storage = {
			get: async <T = unknown>(key: string): Promise<T | undefined> => this.kv.get(key) as T | undefined,
			put: async (key, value) => {
				this.kv.set(key, value);
			},
			delete: async (key: string): Promise<boolean> => this.kv.delete(key),
			list: async <T = unknown>(): Promise<Map<string, T>> => new Map(this.kv) as Map<string, T>,
			getAlarm: async () => this.alarm_at_ms,
			setAlarm: async (ms) => {
				this.alarm_at_ms = ms;
			},
			deleteAlarm: async () => {
				this.alarm_at_ms = null;
			},
		};
	}

	registerAlarmHandler(handler: () => Promise<void>): void {
		this.alarm_handler = handler;
	}

	async manualFireAlarm(): Promise<void> {
		if (this.alarm_handler === null) return;
		this.alarm_at_ms = null;
		await this.alarm_handler();
	}

	get alarm_ms(): number | null {
		return this.alarm_at_ms;
	}
}

export type DurableObjectFetcher = {
	fetch(request: Request): Promise<Response>;
	manualFireAlarm(): Promise<void>;
	readonly id: DurableObjectIdFake;
};

/**
 * In-memory replacement for `DurableObjectNamespace`. The factory
 * builds a fresh DO instance the first time `get(id)` is called for a
 * given name.
 */
export class InMemoryDurableObjectNamespace<TEnv> {
	private readonly instances = new Map<string, DurableObjectFetcher>();

	constructor(
		private readonly env: TEnv,
		private readonly factory: (
			ctx: InMemoryDurableObjectState,
			env: TEnv,
		) => { fetch: (req: Request) => Promise<Response>; alarm: () => Promise<void> },
	) {}

	idFromName(name: string): DurableObjectIdFake {
		return make_id(name);
	}

	newUniqueId(): DurableObjectIdFake {
		return make_id(`unique_${crypto.randomUUID()}`);
	}

	get(id: DurableObjectIdFake): DurableObjectFetcher {
		const key = id.toString();
		const existing = this.instances.get(key);
		if (existing !== undefined) return existing;
		const ctx = new InMemoryDurableObjectState(key);
		const instance = this.factory(ctx, this.env);
		ctx.registerAlarmHandler(() => instance.alarm());
		const fetcher: DurableObjectFetcher = {
			fetch: (req) => instance.fetch(req),
			manualFireAlarm: () => ctx.manualFireAlarm(),
			id,
		};
		this.instances.set(key, fetcher);
		return fetcher;
	}
}
