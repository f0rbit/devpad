import { getCurrentUser } from "src/utils/session";

export async function ProjectsProvider({ children }: { children: React.ReactNode }) {
	const user = await getCurrentUser();
    
    if (!user) return <div>Loading...</div>;

    const projects = await prisma?.project.findMany({
        where: {
            owner_id: user.id,
        },
    });

    console.log(projects);

	return children as JSX.Element;
}