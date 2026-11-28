/**
 * Cross-repo contract schemas + the fixture registry they are tested
 * against. See `contracts/README.md` (repo root) for how consumers
 * (vault, chamber) pin and consume the fixtures.
 */
import type { z } from "zod";
import {
	cloudflare_observability_identity,
	cloudflare_observability_output,
	cloudflare_observability_query_input,
	cloudflare_observability_result,
	cloudflare_vault_error,
} from "./cloudflare-observability.js";
import { external_event_error, external_event_request, external_event_response } from "./external-events.js";
import { dispatch_call_input, dispatch_identity, github_dispatch_result } from "./github-dispatch.js";
import { grant_check_call, grant_check_error, grant_check_result, grant_check_response } from "./grants-check.js";
import { oidc_exchange_request, oidc_exchange_response } from "./oidc-exchange.js";
import { session_introspection_input, session_introspection_result } from "./session-introspection.js";

export * from "./cloudflare-observability.js";
export * from "./external-events.js";
export * from "./github-dispatch.js";
export * from "./grants-check.js";
export * from "./oidc-exchange.js";
export * from "./session-introspection.js";
export * from "./wire.js";

/**
 * Fixture registry: files under `contracts/<contract>/<side>/<key>.<description>.json`
 * validate against `registry[contract][key]`. `side` is `valid` (must
 * parse) or `invalid` (must fail).
 */
export const contracts_registry: Record<string, Partial<Record<string, z.ZodTypeAny>>> = {
	"grants-check": {
		caller: grant_check_call,
		response: grant_check_response,
		result: grant_check_result,
		error: grant_check_error,
	},
	"github-dispatch": {
		input: dispatch_call_input,
		identity: dispatch_identity,
		result: github_dispatch_result,
	},
	"external-events": {
		request: external_event_request,
		response: external_event_response,
		error: external_event_error,
	},
	"oidc-exchange": {
		request: oidc_exchange_request,
		response: oidc_exchange_response,
	},
	"cloudflare-observability": {
		input: cloudflare_observability_query_input,
		identity: cloudflare_observability_identity,
		output: cloudflare_observability_output,
		error: cloudflare_vault_error,
		result: cloudflare_observability_result,
	},
	"session-introspection": {
		input: session_introspection_input,
		result: session_introspection_result,
	},
};
