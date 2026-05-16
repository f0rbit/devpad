/**
 * Alchemy IaC config for the pipelines Worker.
 *
 * Phase 1 leaves this as a declarative shell that mirrors
 * wrangler.jsonc — actual provisioning (D1, R2 secrets, the vault
 * service binding on the vault account) happens during Phase 2's
 * cross-repo deploy work. We export the resource shape now so the
 * Phase 2 deploy script can import it and apply.
 */

export const pipelinesWorker = {
	name: "devpad-pipelines",
	main: "src/index.ts",
	compatibility_date: "2026-05-01",
	compatibility_flags: ["nodejs_compat"],
	bindings: {
		DB: { type: "d1", database_name: "devpad-unified-db", database_id: "43bc9f1b-70a9-4844-b3c6-9c95e14bacbf" },
		CORPUS_BUCKET: { type: "r2", bucket_name: "devpad-corpus" },
		ANTHROPIC: { type: "service", service: "vault" },
		PULSE: { type: "service", service: "pulse" },
		PIPELINE_RUNS: { type: "durable_object", class_name: "PipelineRunDO" },
	},
	migrations: [{ tag: "v1", new_sqlite_classes: ["PipelineRunDO"] }],
} as const;

export type PipelinesWorker = typeof pipelinesWorker;
