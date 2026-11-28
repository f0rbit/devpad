/**
 * Orchestrator deploy verb (`bun run deploy:orchestrator`).
 *
 * The orchestrator's Alchemy state lives in the MAIN checkout's .alchemy/
 * (gitignored, per-machine). Deploys must never run from a linked worktree
 * without copying that state back — recent hand-rolled deploys did exactly
 * that and the main state froze at 2026-05-17, re-creating Secrets on every
 * deploy. This script wraps the whole flow so the mistake is impossible:
 * preflight, detached temp worktree at --ref, state copy-in, schema build,
 * alchemy deploy (teed to a log file), state copy-back with a backup of the
 * previous state (last 3 kept), and post-deploy verification against the
 * Cloudflare API + the live worker.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const ACCOUNT_ID = "81874bc21b868deba3276f551acde354";
const WORKER_URL = "https://devpad-pipelines.dev-818.workers.dev";
const REQUIRED_SECRETS = ["CF_API_TOKEN", "PIPELINES_TOKEN", "OIDC_SESSION_SIGNING_KEY"];
const REQUIRED_BINDINGS = [
	"CF_API_TOKEN",
	"PIPELINES_TOKEN",
	"OIDC_SESSION_SIGNING_KEY",
	"OIDC_EXPECTED_AUDIENCE",
	"GITHUB",
	"DB",
	"CORPUS_BUCKET",
	"PIPELINE_RUNS",
];

const fail = (message: string): never => {
	throw new Error(message);
};

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

type CmdResult = { ok: boolean; out: string };

const run = (cmd: string[], opts: { cwd?: string } = {}): CmdResult => {
	const proc = Bun.spawnSync(cmd, {
		cwd: opts.cwd,
		env: { ...process.env, NO_COLOR: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	return { ok: proc.exitCode === 0, out: `${proc.stdout.toString()}${proc.stderr.toString()}`.trim() };
};

const git = (args: string[], cwd: string): string => {
	const res = run(["git", ...args], { cwd });
	if (!res.ok) fail(`git ${args[0]} failed: ${res.out}`);
	return res.out;
};

const main_checkout_root = (): string => {
	const cwd = process.cwd();
	const toplevel = git(["rev-parse", "--show-toplevel"], cwd);
	const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
	if (basename(common) === ".git") return dirname(common);
	return toplevel;
};

const parse_env = (path: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
		if (quoted && value.length >= 2) value = value.slice(1, -1);
		out[key] = value;
	}
	return out;
};

type Preflight = { root: string; env_path: string; state_dir: string; env: Record<string, string> };

const preflight = (root: string): Preflight => {
	const env_path = join(root, ".env");
	if (!existsSync(env_path)) fail(`preflight: missing ${env_path}`);
	const env = parse_env(env_path);
	const missing = REQUIRED_SECRETS.filter((key) => !(key in env) || env[key].length === 0);
	if (missing.length > 0) fail(`preflight: ${env_path} has empty/missing values for: ${missing.join(", ")}`);
	const state_dir = join(root, ".alchemy", "devpad-pipelines", "production");
	if (!existsSync(state_dir)) {
		fail(
			`preflight: no Alchemy state at ${state_dir} — refusing to deploy (deploying with no state re-creates/adopts every resource)`,
		);
	}
	if (!existsSync(join(root, "packages", "pipelines", "infra.ts"))) {
		fail(`preflight: ${root} does not look like the devpad repo (packages/pipelines/infra.ts missing)`);
	}
	return { root, env_path, state_dir, env };
};

const resolve_ref = (root: string, ref: string, fetch_first: boolean): string => {
	if (fetch_first) {
		const fetched = run(["git", "fetch", "--quiet", "origin"], { cwd: root });
		if (!fetched.ok) console.error(`warning: git fetch failed (continuing with locally known refs): ${fetched.out}`);
	}
	return git(["rev-parse", "--verify", `${ref}^{commit}`], root);
};

const parse_args = (argv: string[]): { ref: string; dry_run: boolean } => {
	let ref = "origin/main";
	let dry_run = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") dry_run = true;
		else if (arg === "--ref") ref = argv[++i] ?? fail("--ref requires a value");
		else if (arg.startsWith("--ref=")) ref = arg.slice("--ref=".length);
		else fail(`unknown argument: ${arg}`);
	}
	return { ref, dry_run };
};

const prune_backups = (root: string, keep = 3): void => {
	const backups = readdirSync(root)
		.filter((name) => name.startsWith(".alchemy.bak-"))
		.toSorted();
	for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
		rmSync(join(root, name), { recursive: true, force: true });
	}
};

const build_in_worktree = (worktree: string): void => {
	const install = run(["bun", "install", "--frozen-lockfile"], { cwd: worktree });
	if (!install.ok) fail(`bun install failed:\n${install.out}`);
	const schema = run(["bun", "run", "--filter=@devpad/schema", "build"], { cwd: worktree });
	if (!schema.ok) fail(`@devpad/schema build failed:\n${schema.out}`);
};

const deploy = async (worktree: string, env_path: string, log_path: string): Promise<number> => {
	const proc = Bun.spawn(
		[
			"bunx",
			"alchemy",
			"deploy",
			"./packages/pipelines/infra.ts",
			"--stage",
			"production",
			"--env-file",
			env_path,
			"--profile",
			"default",
		],
		{
			cwd: worktree,
			env: { ...process.env, ALCHEMY_CI_STATE_STORE_CHECK: "false" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const writer = Bun.file(log_path).writer();
	const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			const text = decoder.decode(chunk, { stream: true });
			process.stdout.write(text);
			void writer.write(text);
		}
	};
	await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]);
	void writer.end();
	await proc.exited;
	console.log(`deploy log: ${log_path}`);
	return proc.exitCode;
};

const sync_state_back = (worktree: string, root: string): void => {
	const from = join(worktree, ".alchemy");
	if (!existsSync(from)) {
		console.log("no worktree state to sync back (deploy failed before the copy-in step); main .alchemy untouched");
		return;
	}
	const backup = join(root, `.alchemy.bak-${stamp()}`);
	renameSync(join(root, ".alchemy"), backup);
	try {
		cpSync(from, join(root, ".alchemy"), { recursive: true });
	} catch (error) {
		fail(
			`state copy-back FAILED (previous state backed up at ${backup}; worktree KEPT at ${worktree} — it holds the only copy of the new state): ${String(error)}`,
		);
	}
	prune_backups(root);
	console.log(`state synced back from worktree; previous state backed up at ${backup}`);
};

const cleanup_worktree = (worktree: string, root: string): void => {
	const removed = run(["git", "worktree", "remove", "--force", worktree], { cwd: root });
	if (!removed.ok) console.error(`warning: git worktree remove failed: ${removed.out}`);
	rmSync(dirname(worktree), { recursive: true, force: true });
};

const status_of = async (url: string, init?: RequestInit): Promise<number | null> => {
	try {
		const res = await fetch(url, init);
		return res.status;
	} catch (error) {
		console.error(
			`[deploy-orchestrator] probe failed for ${url}:`,
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
};

const fetch_bound_names = async (token: string): Promise<Set<string> | null> => {
	const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/devpad-pipelines/settings`;
	try {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) return null;
		const raw: unknown = await res.json();
		const body = raw as { result?: { bindings?: Array<{ name?: string }> } | null };
		const names = (body.result?.bindings ?? [])
			.map((binding) => binding.name)
			.filter((name): name is string => typeof name === "string");
		return new Set(names);
	} catch (error) {
		console.error(
			"[deploy-orchestrator] bindings settings fetch failed:",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
};

type Check = { label: string; passed: boolean; detail?: string };

const verify = async (env: Record<string, string>): Promise<Check[]> => {
	const checks: Check[] = [];
	const bound = await fetch_bound_names(env.CF_API_TOKEN);
	if (bound === null) {
		checks.push({
			label: "Cloudflare bindings",
			passed: false,
			detail: "settings API unreachable or rejected the token",
		});
	} else {
		for (const name of REQUIRED_BINDINGS) {
			checks.push({ label: `binding ${name}`, passed: bound.has(name) });
		}
	}
	const cancel = await status_of(`${WORKER_URL}/runs/x/cancel`, { method: "POST" });
	checks.push({
		label: "unauthenticated POST /runs/x/cancel -> 401",
		passed: cancel === 401,
		detail: cancel === null ? "unreachable" : `got ${String(cancel)}`,
	});
	const health = await status_of(`${WORKER_URL}/health`);
	checks.push({
		label: "GET /health -> 200",
		passed: health === 200,
		detail: health === null ? "unreachable" : `got ${String(health)}`,
	});
	return checks;
};

const print_checks = (checks: Check[]): number => {
	for (const check of checks) {
		console.log(`${check.passed ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
	}
	return checks.filter((check) => !check.passed).length;
};

const print_plan = (pre: Preflight, ref: string, sha: string): void => {
	console.log("dry run — plan (nothing executed):");
	console.log(`  main checkout root : ${pre.root}`);
	console.log(`  .env               : ${pre.env_path} (required secrets present; values never printed)`);
	console.log(`  Alchemy state      : ${pre.state_dir}`);
	console.log(`  ref                : ${ref} -> ${sha}`);
	console.log("  steps:");
	console.log("    1. git worktree add --detach <os-tmp>/deploy-orchestrator-*/wt <sha>");
	console.log("    2. cp -R <main>/.alchemy <worktree>/.alchemy");
	console.log("    3. bun install --frozen-lockfile (worktree)");
	console.log("    4. bun run --filter=@devpad/schema build (worktree)");
	console.log("    5. bunx alchemy deploy ./packages/pipelines/infra.ts --stage production");
	console.log(`       --env-file ${pre.env_path} --profile default (ALCHEMY_CI_STATE_STORE_CHECK=false)`);
	console.log("    6. ALWAYS: backup main .alchemy -> .alchemy.bak-<timestamp> (keep last 3),");
	console.log("       copy worktree .alchemy back over it (success or failure)");
	console.log("    7. git worktree remove --force");
	console.log(
		`    8. verify: ${String(REQUIRED_BINDINGS.length)} bindings + POST /runs/x/cancel 401 + GET /health 200`,
	);
};

const main = async (): Promise<void> => {
	const { ref, dry_run } = parse_args(process.argv.slice(2));
	const root = main_checkout_root();
	const pre = preflight(root);
	const sha = resolve_ref(root, ref, !dry_run);

	if (dry_run) {
		print_plan(pre, ref, sha);
		return;
	}

	console.log(`deploying devpad-pipelines @ ${sha} (state from ${pre.root}/.alchemy)`);
	const worktree = join(mkdtempSync(join(tmpdir(), "deploy-orchestrator-")), "wt");

	let deploy_exit = -1;
	try {
		git(["worktree", "add", "--detach", worktree, sha], root);
		cpSync(join(root, ".alchemy"), join(worktree, ".alchemy"), { recursive: true });
		build_in_worktree(worktree);
		deploy_exit = await deploy(worktree, pre.env_path, join(tmpdir(), `deploy-orchestrator-${stamp()}.log`));
	} finally {
		sync_state_back(worktree, root);
		cleanup_worktree(worktree, root);
	}

	if (deploy_exit !== 0)
		fail(`alchemy deploy exited ${String(deploy_exit)} (state was still synced back — see the deploy log above)`);

	const checks = await verify(pre.env);
	const failed = print_checks(checks);
	if (failed > 0) {
		console.error(`verification FAILED for ${String(failed)} check(s) — deployed sha ${sha}`);
		process.exitCode = 1;
		return;
	}
	console.log(`deploy verified — devpad-pipelines @ ${sha}`);
};

main().catch((error: unknown) => {
	console.error(`deploy-orchestrator: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
