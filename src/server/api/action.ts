import { Prisma } from "@prisma/client";
import { getErrorMessage } from "src/utils/backend";
import { logger } from "src/utils/loggers";

export async function getHistory(user_id: string, filter: Prisma.JsonFilter | undefined) {
	if (!user_id) return { data: [], error: "You must declare a valid user_id." };
	try {
		const actions = await prisma?.action.findMany({
			where: {
				owner_id: user_id,
				data: filter
			},
			orderBy: { created_at: "desc" }
		});
		if (!actions) return { data: [], error: "No actions found." };
		return { data: actions, error: "" };
	} catch (err) {
		return { data: [], error: getErrorMessage(err) };
	}
}

export async function createAction(data: Prisma.ActionUncheckedCreateInput) {
	logger.info(`[${data.owner_id}] Action => ${data.type} ${data.description}`, {data});
    return await prisma?.action.create({ data });
}