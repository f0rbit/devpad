import ProjectSidebar from "@/components/Projects/ProjectSidebar";

export default function layout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-full w-full flex-row flex-nowrap">
			<ProjectSidebar />
			<div className="w-full">{children}</div>
		</div>
	);
}
