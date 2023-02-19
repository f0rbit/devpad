import { createTask, deleteTask } from "@/server/api/tasks";
import { getServerAuthSession } from "@/server/common/get-server-auth-session";
import { NextApiRequest, NextApiResponse } from "next";

const create_task = async (req: NextApiRequest, res: NextApiResponse) => {
	const session = await getServerAuthSession({ req, res });
    if (!session) {
        res.send({ error: "You must be signed in to access this route." });
        return;
    }
    const { success, error } = await deleteTask(JSON.parse(req.body).id, session);
    res.send({ success, error });
};

export default create_task;
