import { createProject } from "@/server/api/projects";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const restricted = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });

	if (session) {
		const { data, error } = await createProject(JSON.parse(req.body), session);
		res.send({
			project_id: data,
			error
		});
	} else {
		res.send({
			error: "You must be signed in to access this route."
		});
	}
};

export default restricted;
