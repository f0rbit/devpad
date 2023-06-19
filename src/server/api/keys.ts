"use server";
import { getErrorMessage } from "src/utils/backend";
import { getCurrentUser } from "src/utils/session";
import { randomBytes } from "crypto";

export async function getAPIKeys() {
	// do stuff here
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: null, error: "Not logged in!" };
	try {
		const keys = await prisma?.aPIKey.findMany({ where: { owner_id: user.id } });
		if (!keys) return { data: [], error: null };
		return { data: keys, error: null };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}

function getKey(size = 32, format: BufferEncoding = 'hex') {
	return randomBytes(size).toString(format);
}

export async function generateAPIKey({ user_id }: { user_id: string }) {
	const key = getKey();
	const result = await prisma?.aPIKey.create({ data: { owner_id: user_id, hash: key } });
	if (!result) return { data: null, error: "Something went wrong" };
	return { data: result, error: null };
}