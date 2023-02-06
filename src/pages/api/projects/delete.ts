import { deleteProject } from "@/server/api/projects";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next/types";

export default async function deleteOwnProject(req: NextApiRequest, res: NextApiResponse) {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { success, error } = await deleteProject(JSON.parse(req.body)?.project_id, session);
		res.send({
			success: success,
			error
		});
	} else {
		res.send({
            success: false,
			error: "You must be signed in to access this route."
		});
	}
};