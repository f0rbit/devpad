import CenteredContainer from "@/components/CenteredContainer";
import ProjectsBar from "@/components/Projects/ProjectsBar";

export default async function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full min-h-screen w-screen flex-row">
			<div className="flex w-full flex-col bg-base-bg-primary">
				<div className="h-max border-b-1 border-b-borders-primary">
					<ProjectsBar />
				</div>
                <div className="h-full">
                    {children}
                </div>
			</div>
		</div>
	);
}
