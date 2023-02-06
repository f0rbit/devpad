import { createProjectGoal } from "@/server/api/projects";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

export default async function create_project_goal(req: NextApiRequest, res: NextApiResponse) {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { data, error } = await createProjectGoal(JSON.parse(req.body), session);
		res.send({
			data,
			error
		});
	} else {
		res.send({
			error: "You must be signed in to access this route."
		});
	}
};

