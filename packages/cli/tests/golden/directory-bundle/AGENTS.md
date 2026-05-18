# directory-bundle

Pipeline-managed Cloudflare Worker. The deployment lifecycle is owned by
the devpad pipelines orchestrator — this repo's `pipeline.ts` declares
how runs roll out, but **does not deploy directly**.

## Hard rules

- **Don't deploy manually.** No `wrangler deploy`, no `wrangler versions
  deploy`. The orchestrator promotes between stages based on
  `pipeline.ts`. Use `devpad pipelines run directory-bundle` to trigger
  a run; use `devpad pipelines approve <run-id> <stage>` if a transition
  needs human gating.
- **All Anthropic calls go through `env.ANTHROPIC`.** This Worker holds
  no Anthropic API key. The vault Worker (separate Cloudflare account,
  separate repo at `~/dev/vault`) is the only system that does. Direct
  `fetch('https://api.anthropic.com/...')` calls will be rejected at
  build time by the lint rule and at runtime by network egress.
- **All observability goes through `env.PULSE`.** Don't `console.log`
  for anything you'd want to query later — emit a structured pulse event
  instead.
- **Grants registry is the source of truth.** Adding a scope to
  `grants.ts` does NOT auto-approve it. Run `devpad pipelines run` and
  watch the grants UI for the approval prompt.

## Layout

```
directory-bundle/
├── src/
│   ├── index.ts       # WorkerEntrypoint with /health and /version
│   └── env.ts         # Typed bindings (ANTHROPIC, PULSE)
├── infra.ts           # Alchemy declaration — Worker + service bindings
├── pipeline.ts        # Rollout + gate overrides via extendTemplate
├── grants.ts          # Upstream scopes per stage
├── wrangler.jsonc     # Wrangler-local dev only; CI uses infra.ts
├── e2e/               # Playwright tests against the live Worker URL
└── .github/workflows/ # CI: build → upload artifacts → start pipeline run
```

## Local dev

```sh
bun install
bun dev               # wrangler dev on :8787
bun test              # bun test
bun e2e               # playwright against http://127.0.0.1:8787
```

## CI flow (set up by `.github/workflows/deploy.yml`)

1. `bun install`, typecheck, unit tests
2. `bun build` → bundle to `dist/`
3. Upload bundle + `d1-plan.json` + `env.json` + `infra-plan.json` +
   `grants.json` to corpus (version-set manifest)
4. `wrangler versions upload` records a version ID against the manifest
5. POST to the orchestrator's `/runs` endpoint with the manifest ID

Promotion past staging is the orchestrator's job, not the YAML's.

## Rollout

This scaffold defaulted to `gradual` rollout, gated by `auto`
on every transition. Edit `pipeline.ts` to override per-stage —
`extendTemplate` returns a typed `Result`, so a typo in a stage name or
transition key is a compile error rather than a silent no-op.
