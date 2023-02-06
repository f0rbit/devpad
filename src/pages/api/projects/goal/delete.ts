import { deleteProjectGoal } from "@/server/api/projects";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

export default async function delete_project_goal(req: NextApiRequest, res: NextApiResponse) {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { success, error } = await deleteProjectGoal(JSON.parse(req.body)?.goal_id, session);
		res.send({
			success,
			error
		});
	} else {
		res.send({
			error: "You must be signed in to access this route."
		});
	}
};

