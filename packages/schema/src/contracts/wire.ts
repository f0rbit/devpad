import { z } from "zod";

/**
 * Shared wire-envelope fragments for the HTTP contracts. The
 * orchestrator's envelope contract (Phase 13.E) is
 * `{ ok: true, value }` / `{ ok: false, error: { code, message? } }` —
 * the discriminator is `code`, never `kind`.
 */
export const wire_error = z.object({
	ok: z.literal(false),
	error: z
		.object({
			code: z.string().min(1),
			message: z.string().optional(),
		})
		.passthrough(),
});

export type WireError = z.infer<typeof wire_error>;
