import { updateProject } from "@/server/api/projects";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const update_project = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });
    if (!session) {
        res.send({ error: "You must be signed in to access this route." });
        return;
    }
    const { data, error } = await updateProject(JSON.parse(req.body), session);
    res.send({ data, error });
};

export default update_project;
