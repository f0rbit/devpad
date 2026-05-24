# directory-bundle

Pipeline-managed Cloudflare Worker, scaffolded by `devpad pipelines init`.

## Quick start

```sh
bun install
bun dev
```

The default route exposes `/health` and `/version`. Add your own handlers
in `src/index.ts`.

## Deployment

Promotion is owned by the devpad pipelines orchestrator. To trigger a
run:

```sh
devpad pipelines run directory-bundle
```

To approve a gated stage:

```sh
devpad pipelines approve <run-id> <stage>
```

Read `AGENTS.md` for the full operating manual.
