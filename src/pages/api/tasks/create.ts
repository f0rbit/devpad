import { createProject } from "@/server/api/projects";
import { createTask } from "@/server/api/tasks";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const create_task = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });
    if (!session) {
        res.send({ error: "You must be signed in to access this route." });
        return;
    }
    const { data, error } = await createTask(JSON.parse(req.body), session);
    res.send({ data, error });
};

export default create_task;
