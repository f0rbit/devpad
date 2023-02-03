import CenteredContainer from "@/components/CenteredContainer";
import ProjectsBar from "@/components/Projects/ProjectsBar";

export default async function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full min-h-screen w-screen flex-row">
			<div className="flex w-full flex-col bg-[#2d2d30]">
				<div className="h-max border-b-1 border-b-[#5c5c65]">
					<ProjectsBar />
				</div>
                <div style={{minHeight: "calc(100vh - 16rem)"}}>
					<CenteredContainer>
                    	{children}
					</CenteredContainer>
                </div>
			</div>
		</div>
	);
}
