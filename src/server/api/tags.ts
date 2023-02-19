import { TaskTags } from "@prisma/client";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";

export async function getUserTags(session: Session): Promise<{ data: TaskTags[]; error: string }> {
	if (!session?.user?.id) return { data: [], error: "You must be signed in to create a project." };
	try {
		const tags = await prisma?.taskTags.findMany({ where: { owner_id: session?.user?.id } });
		if (!tags) return { data: [], error: "No tags found!" };
		return { data: tags, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}
