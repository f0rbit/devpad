# HANDOFF — devpad v2.4 (graph-based task rework) — closed

> Closed 2026-08-29. Plan: `.plans/v2.4.html` (all phases complete; B3 proof artifacts are committed under `.plans/screenshots/`).
> Session memory mirror: `~/.claude/projects/-Users-tom-dev-devpad/memory/{ripple-redesign-decisions,v24-arc-a-status}.md`
> Ideation doc (decisions locked): https://claude.ai/code/artifact/c5cef146-c650-4111-ba4a-683437b1bda7
> Approved UI mock (UX contract): https://claude.ai/code/artifact/4124b30c-b077-46d8-bcef-a6f337139ab9 (local copy: session scratchpad `ripple-outline-mock.html`)

## Where things stand

**Shipped to `main` (all squash-merged, verifier full-gate passed each):**

| Phase | What | PR / merge |
|---|---|---|
| A1 | Graph primitives: `parent_id`+guards, `task_link`, `rank`, `rev`, READY, claim, batch apply, agent verbs | #138 → `4726cbe7` |
| A2 | Bubbling engine: `task_event` outbox, CompletionEngine (guarded-UPDATE cascade), rollup cache, sweeper, seeded property suite | #139 → `ba112590` |
| A3 | Automation spine: scoped API keys, hook registry + `hook_delivery` DLQ, `devpad-hooks` queues (created in CF), executors (webhook/pipeline/vault), GitHub App inbound receiver, retention | #140 → `02c4f33b` + vault #9 → `63e02ae2` |
| A4 | Docs backend: corpus doc store w/ sanitize-on-push, markers-in-doc annotation engine, signoff table + human-only approval nodes, interface-report classifier, stage enum, reviews-pending | #141 → `8331c11b` |
| A5 | Milestone/goal fold: idempotent backfill (migration 0021), service-level compat projections (legacy test suite unchanged = the proof), `admin verify-fold`, scanner tree-placement proposals | #142 → `d5f333ac` |
| B1 | Outline UI + IA consolidation (work/docs tabs, net −1, redirects), zoom-into-node, connections rail, `/tree` rollups + `/ancestors` | #143 (incl. critic-fix commits) |
| B2 | Graph/milestone lenses, ripple choreography, edge-summary chips, "Waiting on you" atop /todo, sibling reorder, rail in-place travel | #144 → `475f29e9` (incl. critic-fix commits) |
| B3 | Review surface: DocViewer, annotations, signoffs, checkpoint cards, SDLC stepper, scoped keys, hook-delivery DLQ | #145 → `862e1410` |

**Production**: release **v2.5.0** published 2026-08-29 → [Deploy Production run 33241628467](https://github.com/f0rbit/devpad/actions/runs/33241628467) green → production smoke green: `/` 200 HTML, `/health` 200 JSON (`{"status":"ok"}`), `/todo` 200 HTML. The deploy was code-only; no schema migrations were introduced by the UI arc.

## In flight RIGHT NOW

Nothing. PR #145 shipped as squash commit `862e1410`; the B3 critic blockers and fast-follows landed in `ec177c98`, `4b5db1f4`, `7f465893`, and `201b7052`. The verifier committed the twelve screenshot artifacts and confirmed them visually in both themes.

The two B3 AGENTS.md lessons are now recorded: `@f0rbit/ui` Button `primary` is an empty class modifier, not a filled style; `instanceof HTMLElement` across an iframe boundary always fails (cross-realm) — use null checks.

## Close-out status

1. **Done — Mode V verifier on #145**: full gate, touched E2E suites, 57-error Astro baseline check, critic spot-checks, proof-artifact capture, squash merge, and production smoke completed.
2. **Done — release the UI arc**: `v2.5.0` published; Deploy Production run 33241628467 completed green; `/`, `/health`, and `/todo` each returned 200 with sane content.
3. **Unchanged — hooks go-live ops (user, whenever)**: GitHub App create+install + `GITHUB_WEBHOOK_SECRET`; PAT → vault Secrets Store `GITHUB_RELEASES_TOKEN` + deploy vault with `WIRE_GITHUB_RELEASES=true` + seed `pipeline_grant` rows per repo; wire devpad `VAULT_GITHUB` service binding (`entrypoint = "GitHubVault"`); set `PIPELINES_API_BASE`/`PIPELINES_TOKEN`. Until then the automation spine is deployed-but-dormant (by design).
4. **Done — plan close-out**: header and B3 badges are done, B3 proof links to committed screenshots and manifest, and devpad task `task_33109c9a-f59a-4a97-a0b6-8f6a4daa3154` is done.

## Tracked follow-ups (devpad tracker, project `devpad`)

- `task_be8de253…` — ripple: defer compaction while a bubble chain is in flight (B2 critic #12; choreography-only)
- `task_bcfc83b0…` — apps/main `astro check` baseline drift (57 pre-existing errors; documented, not fixed)
- `task_8d114f90…` — mobile site-header collision at 360px (pre-existing, distinct from the B3 doc-viewer blocker)
- (closed this arc: `task_04427077…` CSS-exfil — fixed in #145)

## Known open caveats (all documented in AGENTS.md)

- D1 `run_atomic` runs un-transacted; the sweeper repairs the **completion cascade only** — a crash between state write and `task_event` write for other event kinds can silently lose a hook firing.
- Pipeline executor omits `version_set_id` → orchestrator call fails as a clean 400 (disclosed, unfixed).
- devpad exposes only the `gate` verb; `smoke`/`check`/`deploy`/`ship` are absent (`~/.claude/tools/ship` is the sanctioned fallback; its preflight now probes `gh api user` and names rate-limit vs auth correctly).
- GitHub API budget (5,000/hr, shared across all agents) is the pipeline's recurring bottleneck — batch `gh` calls, orchestrator owns rate-limit waits.
- `reconcile_docs_css` has a pre-existing test-order flake in full-directory runs (~1/4 observed; reproduced on a clean stash); the targeted suite is green.
- Playwright retries do not reseed between attempts; mutation-driven E2E specs can observe state left by a failed first attempt.

## How to resume (one line)

The v2.4 arc is closed. Future work continues from the tracked follow-ups and the hooks go-live operations prerequisite; conventions remain in `~/dev/devpad/AGENTS.md` and the plan's phase-b3 section.

## Canvas home arc (P2–P4) — closed 2026-08-30

**Shipped**: PR [#148](https://github.com/f0rbit/devpad/pull/148) squash-merged to `main` at `f2bfe35d` (26 feature commits + one ship-verification fix-forward commit `63b99cfc`). CI green (`bun run gate` scoped checks, `bun run e2e:ci`), staging deploy (`Deploy Staging` run 33295216753) green, migration `0022_project_view_state` applied cleanly via CI's `wrangler d1 migrations apply` step (no `duplicate column name` retry-failure — the never-hand-apply rule held).

**What shipped**: full-viewport dagre-laid-out project canvas as the project home at `/project/:id` (4-level semantic zoom, viewport culling, drag-to-pin view-state, lazy node projections, semantic travel), IA absorption (8 tabs → 6, `overview`/`work`/`canvas` all 301-redirect to the same route), mobile UA-sniffed straight to the outline (no canvas JS shipped), a visible canvas↔list toggle with cookie memory, emoji-chip retirement, and a critic-fix pass (HUD toggle, LOD chrome, edge chips, fit inset). Full detail + the mock-parity table live in `AGENTS.md`'s Canvas section.

**Verifier fix-forward** (`63b99cfc`, on top of the coder's 26 commits): `bun run gate`'s eslint pass surfaced 21 real errors confined to this branch's own new canvas files — numeric template-literal interpolations (`restrict-template-expressions`), `as Task`/`as TaskLink` casts that were silently hiding four missing required fields (`created_by`/`modified_by`/`protected`/`deleted`, caught only once the casts were replaced with typed consts and `astro check` regressed from 57→61), and a few forbidden void-returning arrow shorthands. All fixed; `astro check` is back to the documented 57-error baseline. Also cleared pre-existing `oxfmt` drift in `AGENTS.md` and `canvas-projections.spec.ts` (whitespace/table reflow only, confirmed unrelated to this branch via `git stash`).

**Staging smoke**: `/`, `/health` (`{"status":"ok"}`), `/todo` all 200. `/project/<id>` and `/v1/projects/:id/view-state` return 401 (auth-gated, not 500) for an unauthenticated request against a real staging project id (`project_3f0035e0-8530-4542-a087-75a11a419ac3`) — consistent with the v2.5.0 close-out's precedent of not driving authed pages in a headless smoke pass. The CI `Apply D1 migrations` step itself completing green is the authoritative migration-applied evidence (a re-run would hard-fail with `duplicate column name` if the row hadn't been written).

**Not done — no production release cut**: staging is green; a `v2.6.0` (or similar) production tag was intentionally NOT cut per the brief's Mode V instructions ("report readiness instead"). Whoever cuts it next should re-run the production smoke triad (`/`, `/health`, `/todo`) plus, if reachable with an authed session, an actual `/project/:id` canvas render check — this pass could only prove the route doesn't 500, not that it renders correctly, since it's auth-gated and no session was available.

**devpad tracker discrepancy**: the brief named `task_0b0d0010`/`task_8a4c8a75`/`task_dba50404` as the phase tasks to reference/close. None of the 352 tasks in the tracker (across all projects, not just `-p devpad`) match those ids or contain "canvas" in title/description — `devpad tasks get task_dba50404` returns "Resource not found". Nothing was marked done; this needs the planner/orchestrator to either locate the real task ids or create them retroactively for this arc.

**Follow-ups carried forward** (unchanged from before this arc, plus one new item):
- `task_5a33dfc5…` — repo-wide ESLint warning backlog (~5,520 warnings, 0 errors as of this arc); confirmed none are in this branch's own new files.
- `task_8d114f90…` — mobile 360px header collision: actually fixed this arc via `globals.css`'s `.unified-header__row1` gaining `flex-wrap: wrap` (platform-wide file, no build step) — close this task out.
- Per-task pulse metric binding (`tracks_metric` link's `ref` column) — real backend work, deferred, not a UI gap; tracked only in the AGENTS.md parity table, no devpad task exists for it yet.
- Directional edge indicators, graph lens panel, toast notifications, ripple/bubbling choreography on the canvas, and the mock's `j/k/space/o/g` keyboard verbs remain mocked-only per the parity table — no devpad task exists for these either; worth a planning pass if they're still wanted.
