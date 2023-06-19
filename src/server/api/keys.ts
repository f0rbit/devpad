import { getErrorMessage } from "src/utils/backend";
import { getCurrentUser } from "src/utils/session";

export async function getAPIKeys() {
	// do stuff here
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const keys = await prisma?.aPIKey.findMany({ where: { id: user.id } });
		if (!keys) return { data: [], error: null };
		return { data: keys, error: ""};
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}
