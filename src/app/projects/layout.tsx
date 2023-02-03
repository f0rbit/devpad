import ProjectsBar from "@/components/Projects/ProjectsBar";

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full min-h-screen w-screen flex-row pr-4">
			<div className="flex w-full flex-col bg-green-300">
				<div className="h-max bg-teal-300">
					<ProjectsBar title={"Home"} />
				</div>
                <section>
                    {children}
                </section>
			</div>
		</div>
	);
}
