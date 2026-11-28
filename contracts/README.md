# Cross-repo contract fixtures

JSON fixtures for each HTTP/RPC boundary between devpad and its
separate-repo consumers (vault, chamber CI). Every fixture is backed by
a Zod schema in `packages/schema/src/contracts/` and exercised by
`packages/schema/src/contracts/contracts.test.ts`: everything under
`valid/` must parse, everything under `invalid/` must fail, and every
contract has at least one fixture on each side.

| Directory                  | Boundary                                                                       | Schema module (source of truth)                             |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `grants-check`             | vault → orchestrator `PipelinesGrantsEndpoint.check(caller, scope)`            | `packages/schema/src/contracts/grants-check.ts`             |
| `github-dispatch`          | orchestrator → vault `GitHubVault.dispatch_workflow(input, identity)`          | `packages/schema/src/contracts/github-dispatch.ts`          |
| `external-events`          | chamber CI → orchestrator `POST /runs/:id/events`                              | `packages/schema/src/contracts/external-events.ts`          |
| `oidc-exchange`            | chamber CI → orchestrator `POST /auth/github-oidc`                             | `packages/schema/src/contracts/oidc-exchange.ts`            |
| `cloudflare-observability` | orchestrator → vault `CloudflareVault.observability_query(input, identity)`    | `packages/schema/src/contracts/cloudflare-observability.ts` |
| `session-introspection`    | devpad main worker → orchestrator `PipelinesSessionEndpoint.introspect(token)` | `packages/schema/src/contracts/session-introspection.ts`    |

## Fixture naming

Files are `<key>.<description>.json`; `key` selects the schema through
`contracts_registry` in `packages/schema/src/contracts/index.ts`:

- `grants-check`: `caller` (the whole `{ caller, scope }` call),
  `response` (`{ granted, reason? }`), `result` (the corpus `Result`
  envelope), `error` (`invalid_caller | store_error`).
- `github-dispatch`: `input` (`{ repo, workflow, ref, inputs }`),
  `identity` (`{ package_id, environment }`), `result` (the
  `ok/value`/`ok/error` envelope, errors being the `GitHubVaultError`
  union).
- `external-events`: `request` (`webhook_event_body` with `payload.sha`
  required), `response` (`{ event_id, duplicated, tick }`), `error`
  (generic wire error envelope).
- `oidc-exchange`: `request` (`{ jwt, package_id?, requested_scope? }`),
  `response` (`ok:true` session or `ok:false` wire error).
- `cloudflare-observability`: `input` (`{ script, since }`; `script` is
  the fixed allowlist `devpad-unified | devpad-unified-preview |
devpad-pipelines`, `since` an ISO datetime no more than 24h old),
  `identity` (`{ package_id, environment }`), `output` (`{ script,
since, exception_count, samples ≤5 }`), `error` (the `CloudflareVault`
  error union: `identity_missing | grant_denied | grant_check_failed |
invalid_input | upstream_error{cause}`), `result` (the `ok/value`/
  `ok/error` envelope). Grant scope: `cloudflare:observability:read`.
  **Consumer: vault** (its `CloudflareVault` adapter).
- `session-introspection`: `input` (`{ token }`), `result`
  (`{ active: true, sub, scope[], package_ids[], trust_policy_id,
expires_at }` or `{ active: false, reason }`). **Consumer: the devpad
  main worker** (`PIPELINES_SESSIONS` binding → `introspect`).

The 24h window of `cloudflare-observability/input` depends on the clock,
so its fixtures are validated at the fixed clock
`observability_fixture_now` (`2026-11-28T12:00:00Z`) exported from
`contracts/cloudflare-observability.ts`; consumers replaying them must
inject the same `now`, not the wall clock. Runtime validation uses
`cloudflare_observability_query_input_at(now)`.

The test fails on any fixture whose `key` has no registered schema, so a
new fixture file only takes effect once its schema is registered.

## Historical failures encoded as `invalid` fixtures

- `grants-check/invalid/caller.package-field.json` — vault #14: the
  caller keyed by `package` instead of `package_id`. The strict schema
  rejects the unknown key AND reports the missing `package_id` field.
- `*/invalid/*.environment-literal.json` — `"prod"` is never a valid
  environment: `CALLER_ENV` resolves to exactly `staging` or
  `production`.
- `external-events/invalid/request.payload-missing-sha.json` — the #155
  incident class: without `payload.sha` the DO refuses to advance the
  run, stranding it in `deploying`.
- `github-dispatch/invalid/input.workflow-extension.json` — a workflow
  file without `.yml`/`.yaml` can never dispatch.

## How consumers use this directory

Consumer repos (vault, chamber) do NOT import devpad's TypeScript.
Their CI fetches fixtures at a pinned devpad commit:

```
https://raw.githubusercontent.com/f0rbit/devpad/<pinned-sha>/contracts/<contract>/<side>/<file>.json
```

and validates its own runtime traffic against the same shapes (schemas
re-declared in the consumer repo — vault's structural types, chamber's
client-side mirrors).

Two rules keep the boundary honest:

1. **Bumping the pin is a deliberate PR in the consumer.** The consumer
   diff must show the fixture change and why.
2. **A devpad change to a contract schema must change the fixtures in
   the same PR**, and the PR body must call it out (e.g. `contracts:
external-events now requires payload.environment`). Consumers then
   pick up the change by bumping their pin — a schema change without a
   fixture change is a broken contract, and the fixture test in
   `contracts.test.ts` plus review enforces the pairing.

Scope additions to `oidc_session_scopes` are also contract changes (the
granted-scope enum pins the current session-scope list).
