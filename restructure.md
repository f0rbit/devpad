# project structure & testing strategy

this document describes the structure of the devpad monorepo and how to run tests that mimic deployment both locally and against the beta environment.

---

## project structure

```
devpad/
├── package.json                # workspace root
├── packages/
│   ├── schema/                 # single source of truth for data
│   │   ├── package.json       # "@devpad/schema"
│   │   ├── src/
│   │   │   ├── database/      # drizzle schema definitions
│   │   │   ├── validation/    # zod schemas for api contracts
│   │   │   └── types/         # typescript type exports
│   │   └── migrations/        # database migrations
│   │
│   ├── app/                   # astro ssr app (frontend + api)
│   │   ├── package.json       # "@devpad/app" 
│   │   ├── astro.config.mjs
│   │   ├── src/
│   │   │   ├── pages/api/     # astro api routes
│   │   │   ├── components/    # frontend components
│   │   │   └── server/        # server-side business logic
│   │   └── database/          # db connection utilities
│   │
│   ├── api/                   # standalone api client
│   │   ├── package.json       # "@devpad/api" (publishable)
│   │   └── src/
│   │       ├── clients/
│   │       └── utils/
│   │
│   └── cli/                   # cli tool
│       ├── package.json       # "@devpad/cli"
│       └── src/
│
├── infra/                     # infrastructure-as-code
│   ├── terraform/             # cloudflare pages + domain bindings
│   └── workflows/             # github actions workflows
│
├── tests/
│   ├── integration/           # e2e tests (api, cli, ui)
│   ├── helpers/               # test utils (server startup, db reset, env helpers)
│   └── playwright/            # browser-level tests (optional)
│
└── apps/                      # deployment configurations
    ├── web/                   # production web deployment
    └── docker/                # docker configurations
```

### package dependencies & architecture

the structure maintains clean dependency flow:

- `schema` - foundation package with database schema, validation, and types
- `app` - depends on `schema`, provides astro ssr app with api routes
- `api` - depends on `schema`, provides standalone client library (publishable to npm)
- `cli` - depends on `api` and `schema`, provides command line interface

key benefits:
- no circular dependencies
- api client can be published independently 
- schema as single source of truth eliminates type duplication
- astro app remains the server (no artificial separation)

---

## environments

we maintain three environments:

* **local (developer machine / ci)**
  runs astro locally on `http://localhost:4321`. uses a local db (sqlite or dockerized postgres).
  integration tests run against this environment during development and in ci before deployment.

* **beta (staging)**
  hosted at `https://beta.devpad.tools`.
  deployed automatically from pushes to `main`.
  used for pre-release validation.

* **production**
  hosted at `https://devpad.tools`.
  promoted only on github releases.

---

## testing strategy

### 1. integration tests

* tests live in `tests/integration/`.
* they never mock — they hit the real api, db, and cli.
* target url is chosen via env variable:

```ts
// tests/helpers/client.ts
export const BASE_URL =
  process.env.TEST_ENV === "beta"
    ? "https://beta.devpad.tools"
    : "http://localhost:4321";
```

run locally against dev server:

```sh
TEST_ENV=local bun test tests/integration
```

run against beta deployment:

```sh
TEST_ENV=beta bun test tests/integration
```

### 2. cli tests

the cli respects `API_URL` so tests can be redirected:

```ts
// packages/cli/src/config.ts
export const API_URL = process.env.API_URL ?? "http://localhost:4321";
```

example test:

```ts
import { test, expect } from "bun:test";
import { $ } from "bun";

test("cli push works end-to-end", async () => {
  const out = await $`API_URL=${process.env.API_URL} bun run packages/cli push --title "cli note"`;
  expect(out.stdout.toString()).toContain("Created:");
});
```

### 3. database reset

* local tests should reset db state before each run.
* options:
  * sqlite: drop and recreate file.
  * postgres: run `TRUNCATE` on all tables or re-apply drizzle migrations.

### 4. browser-level tests (optional)

* if testing frontend interactions, use playwright (`tests/playwright/`).
* same env rules apply (`TEST_ENV=local` vs `TEST_ENV=beta`).

---

## deployment flow

1. **push to `main` → beta deploy**
   * github action builds app, runs tests locally.
   * if local tests pass, deploy to cloudflare pages preview environment (`beta.devpad.tools`).
   * run the same tests against `beta.devpad.tools` after deploy.

2. **github release → production deploy**
   * on release tag, ci builds and deploys to cloudflare pages production (`devpad.tools`).
   * optionally rerun integration tests against production after deploy.

---

## infrastructure-as-code (terraform)

we manage pages and domain bindings with terraform:

```hcl
resource "cloudflare_pages_project" "devpad" {
  account_id        = var.cloudflare_account_id
  name              = "devpad-tools"
  production_branch = "main"
  build_config {
    build_command   = "bun run build"
    destination_dir = "dist"
  }
}

resource "cloudflare_pages_domain" "prod" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.devpad.name
  domain       = "devpad.tools"
}

resource "cloudflare_pages_domain" "beta" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.devpad.name
  domain       = "beta.devpad.tools"
}
```

---

## migration from current structure

the current structure has these issues that the new structure addresses:

1. **circular dependencies**: api client imports from main app server code, requiring complex typescript project references
2. **mixed concerns**: database schema, server logic, and frontend code all mixed together
3. **build complexity**: multiple disconnected build processes without workspace coordination

migration steps:

1. **create packages/schema**
   - move `app/database/schema.ts` to `packages/schema/src/database/`
   - move validation schemas from `app/src/server/types.ts` to `packages/schema/src/validation/`
   - export all types from `packages/schema/src/types/`

2. **move current app to packages/app** 
   - move current `app/` contents to `packages/app/`
   - update imports to use `@devpad/schema`
   - remove api client from within app

3. **move api client to packages/api**
   - move `app/api/` to `packages/api/`
   - update imports to use `@devpad/schema` instead of server imports
   - remove typescript project references

4. **move cli to packages/cli**
   - move `cli/` to `packages/cli/`
   - update to use `@devpad/api` client

5. **setup workspace**
   - create root `package.json` with workspace configuration
   - add build orchestration with turbo or similar

---

## edge cases & gotchas

* **port conflicts**: ensure local astro dev server is on a consistent port (e.g. `4321`).
* **beta drift**: beta always reflects `main`, so make sure integration tests don't leave db in a broken state (use idempotent data or clean up after).
* **test db vs prod db**:
  * local tests → isolated db.
  * beta → shared db. use unique test data identifiers (`test_${uuid}`) to avoid collisions.
* **cli vs api versions**: always use `@devpad/api` package to ensure consistency between cli, frontend, and api schemas.
* **terraform drift**: always run `terraform plan` in ci to catch manual changes in cloudflare dashboard.

---

with this setup:

* you develop & test locally on a realistic environment.
* the same integration tests run against beta.devpad.tools post-deploy.
* releases are promoted cleanly to production.
* infra stays consistent via terraform.
* packages have clear boundaries and can be developed independently.
* api client can be published to npm without any astro dependencies.

---

✅ With this setup:

* You **develop & test locally** on a realistic environment.
* The **same integration tests** run against **beta.devpad.tools** post-deploy.
* Releases are promoted cleanly to **production**.
* Infra stays consistent via **Terraform**.

---