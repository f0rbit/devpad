/**
 * Live pulse roundtrip check for the orchestrator's pulse wiring (#158).
 *
 * Posts ONE uniquely-tagged event to pulse's real ingest route and reads
 * it back through the real query route, proving the routes + credentials
 * actually work (analysis gates fail open when they don't, which hides
 * the breakage in normal operation).
 *
 * Env (all four required):
 *   PULSE_URL        — pulse base URL, e.g. https://pulse-api.dev-818.workers.dev
 *   PULSE_PROJECT_ID — pulse project receiving the event
 *   PULSE_INGEST_KEY — pk_* ingest key (X-Pulse-Key header on POST /e)
 *   PULSE_READ_KEY   — devpad API key (scope "pulse") for the Bearer-auth
 *                      query route (GET /events/:project_id)
 *
 * Key values are NEVER printed — only shape/redacted echoes.
 *
 * Run: `bun run pipelines:pulse-check` (root package.json script).
 * Exit 0 = roundtrip verified; exit 1 = event not found back in time.
 */

import { try_catch_async } from "@f0rbit/corpus";
import { pulse_events_page_schema, read_json_body, type PulseEventRow } from "../src/providers/pulse";

const ROUNDTRIP_EVENT_KIND = "pipelines_pulse_roundtrip_check";
const REDACT_PREFIX = 4;

const redact = (value: string): string => `${value.slice(0, REDACT_PREFIX)}…(${String(value.length)} chars)`;

const env_value = (name: string): string | undefined => {
	const value = process.env[name];
	return value === undefined || value === "" ? undefined : value;
};

type CheckEnv = {
	url: string;
	project_id: string;
	ingest_key: string;
	read_key: string;
};

const read_check_env = (): CheckEnv | undefined => {
	const url = env_value("PULSE_URL");
	const project_id = env_value("PULSE_PROJECT_ID");
	const ingest_key = env_value("PULSE_INGEST_KEY");
	const read_key = env_value("PULSE_READ_KEY");
	if (url === undefined || project_id === undefined || ingest_key === undefined || read_key === undefined)
		return undefined;
	return { url, project_id, ingest_key, read_key };
};

const report_env = (env: CheckEnv): void => {
	console.log(`pulse url:        ${env.url}`);
	console.log(`pulse project_id: ${env.project_id}`);
	console.log(`PULSE_INGEST_KEY: ${redact(env.ingest_key)}`);
	console.log(`PULSE_READ_KEY:   ${redact(env.read_key)}`);
};

const post_roundtrip_event = async (env: CheckEnv, nonce: string): Promise<Response | undefined> => {
	const result = await try_catch_async(
		() =>
			fetch(`${env.url}/e`, {
				method: "POST",
				headers: { "content-type": "application/json", "X-Pulse-Key": env.ingest_key },
				body: JSON.stringify({
					project_id: env.project_id,
					events: [
						{
							name: "event",
							properties: {
								name: ROUNDTRIP_EVENT_KIND,
								package: "devpad-pipelines",
								environment: "check",
								version_id: nonce,
								nonce,
							},
						},
					],
				}),
			}),
		(cause) => String(cause),
	);
	if (!result.ok) {
		console.error(`POST /e failed: ${result.error}`);
		return undefined;
	}
	return result.value;
};

const read_back = async (env: CheckEnv, ts_from: number): Promise<PulseEventRow[] | undefined> => {
	const result = await try_catch_async(
		() =>
			fetch(`${env.url}/events/${env.project_id}?ts_from=${String(ts_from)}&limit=100`, {
				method: "GET",
				headers: { authorization: `Bearer ${env.read_key}` },
			}),
		(cause) => String(cause),
	);
	if (!result.ok) {
		console.error(`GET /events failed: ${result.error}`);
		return undefined;
	}
	if (result.value.status === 401 || result.value.status === 403) {
		console.error(`GET /events returned ${String(result.value.status)} — read key invalid or lacks pulse scope`);
		return undefined;
	}
	const body = await try_catch_async(
		() => read_json_body(result.value),
		(cause) => String(cause),
	);
	if (!body.ok) {
		console.error(`GET /events returned non-json: ${body.error}`);
		return undefined;
	}
	const decoded = pulse_events_page_schema.safeParse(body.value);
	if (!decoded.success) {
		console.error(
			`GET /events response failed schema validation: ${decoded.error.issues.at(0)?.message ?? decoded.error.message}`,
		);
		return undefined;
	}
	return decoded.data.events;
};

const find_nonce = (rows: PulseEventRow[] | undefined, nonce: string): boolean =>
	(rows ?? []).some((row) => {
		const props = typeof row.properties === "object" && row.properties !== null ? row.properties : undefined;
		return props?.nonce === nonce;
	});

const main = async (): Promise<number> => {
	const env = read_check_env();
	if (env === undefined) {
		console.error(
			"usage: PULSE_URL, PULSE_PROJECT_ID, PULSE_INGEST_KEY, PULSE_READ_KEY env vars required (key values never printed)",
		);
		return 2;
	}
	report_env(env);

	const nonce = crypto.randomUUID();
	const started_ms = Date.now();
	const post = await post_roundtrip_event(env, nonce);
	if (post === undefined) return 1;
	if (post.status >= 400) {
		console.error(`POST /e returned ${String(post.status)} — ingest broken`);
		return 1;
	}
	console.log(`POST /e → ${String(post.status)}`);

	// Single bounded wait + at most two reads — no tight loop.
	const wait_ms = 2_000;
	const first_window_ms = started_ms - 60_000;
	await new Promise((resolve) => setTimeout(resolve, wait_ms));
	if (find_nonce(await read_back(env, first_window_ms), nonce)) {
		console.log("roundtrip verified: emitted event readable back via GET /events");
		return 0;
	}
	await new Promise((resolve) => setTimeout(resolve, wait_ms));
	if (find_nonce(await read_back(env, first_window_ms), nonce)) {
		console.log("roundtrip verified on second read: emitted event readable back via GET /events");
		return 0;
	}
	console.error("roundtrip FAILED: emitted event never readable back — check ingest key project, read key scope");
	return 1;
};

process.exit(await main());
