import { goal } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";

/**
 * `task.goal_id` carries a FK to the frozen pre-fold `goal` table, but goals
 * created after the v2.4 fold only exist as `kind:"goal"` task rows (the
 * graph link is `parent_id`). Writing such an id into the column violates
 * the FK on D1, so the column is written only when the legacy row exists.
 */
export const legacy_goal_id = async (db: Database, goal_id: string | null | undefined): Promise<string | null> => {
	if (goal_id == null || goal_id === "") return null;
	const rows = await db.select({ id: goal.id }).from(goal).where(eq(goal.id, goal_id)).limit(1);
	return rows.length > 0 ? goal_id : null;
};
