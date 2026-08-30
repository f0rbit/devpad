import type { Task, TaskLink } from "@devpad/schema";

/**
 * Deterministic ~500-task stress fixture — shared by the spatial-index unit
 * test (P2.4) and the P2.5 e2e culling/perf checks. A random tree (each task
 * parents onto an earlier-generated task) gives dagre a realistic branching
 * shape rather than a straight line or a single fan-out.
 */

export const SYNTHETIC_TASK_COUNT = 500;

// mulberry32 — small, dependency-free, deterministic for a fixed seed.
function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SEED = 0x5eed_0001;
const CREATED_AT = "2026-01-01T00:00:00.000Z";

const kind_for = (index: number): Task["kind"] => (index % 47 === 0 ? "milestone" : index % 31 === 0 ? "goal" : "task");
const progress_for = (index: number): Task["progress"] => (index % 3 === 0 ? "COMPLETED" : index % 3 === 1 ? "IN_PROGRESS" : "UNSTARTED");

export function build_synthetic_graph(count: number = SYNTHETIC_TASK_COUNT): { readonly tasks: readonly Task[]; readonly links: readonly TaskLink[] } {
	const random = mulberry32(SEED);

	const tasks: Task[] = Array.from({ length: count }, (_, index) => {
		const parent_index = index === 0 ? null : Math.floor(random() * index);
		return {
			id: `synthetic-${index}`,
			title: `Synthetic task ${index}`,
			kind: kind_for(index),
			progress: progress_for(index),
			visibility: "PRIVATE",
			priority: "LOW",
			completion_policy: "manual",
			project_id: "synthetic-project",
			owner_id: "synthetic-owner",
			created_at: CREATED_AT,
			updated_at: CREATED_AT,
			goal_id: null,
			description: null,
			start_time: null,
			end_time: null,
			summary: null,
			codebase_task_id: null,
			parent_id: parent_index === null ? null : `synthetic-${parent_index}`,
			rank: "",
			rev: 0,
			completed_via: null,
			claimed_by: null,
			claimed_at: null,
			stage: null,
		} as Task;
	});

	const links: TaskLink[] = tasks
		.filter((task): task is Task & { parent_id: string } => task.parent_id !== null)
		.map(task => ({
			id: `${task.parent_id}->${task.id}`,
			src_id: task.parent_id,
			dst_id: task.id,
			kind: "relates_to",
			ref: null,
			note: null,
			created_at: CREATED_AT,
			updated_at: CREATED_AT,
		}) as TaskLink);

	return { tasks, links };
}
