import { describe, expect, test } from "bun:test";
import { run_task, type RunTaskLogger } from "./run-task";

type RecordedError = { message: string; err: unknown; attrs?: Record<string, unknown> };

const make_logger = (): { log: RunTaskLogger; errors: RecordedError[] } => {
	const errors: RecordedError[] = [];
	return {
		errors,
		log: (message, err, attrs) => {
			errors.push({ message, err, attrs });
		},
	};
};

const flush_tasks = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

describe("run_task", () => {
	test("rejected promise reports exactly one log.error with the component attr", async () => {
		const { log, errors } = make_logger();
		const cause = new Error("boom");

		run_task(Promise.reject(cause), { component: "api-key-manager", action: "copy", log });
		await flush_tasks();

		expect(errors).toHaveLength(1);
		expect(errors[0]?.err).toBe(cause);
		expect(errors[0]?.message).toContain("api-key-manager");
		expect(errors[0]?.message).toContain("copy");
		expect(errors[0]?.attrs?.component).toBe("api-key-manager");
		expect(errors[0]?.attrs?.action).toBe("copy");
	});

	test("resolved promise produces no log calls", async () => {
		const { log, errors } = make_logger();

		run_task(Promise.resolve("ok"), { component: "task-quick-add", log });
		await flush_tasks();

		expect(errors).toHaveLength(0);
	});

	test("message omits the action segment when no action is given", async () => {
		const { log, errors } = make_logger();

		run_task(Promise.reject(new Error("boom")), { component: "outline", log });
		await flush_tasks();

		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toBe("outline task failed");
		expect(errors[0]?.attrs?.action).toBeUndefined();
	});
});
