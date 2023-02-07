import ProjectSidebar from "@/components/Projects/ProjectSidebar";

export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-row flex-nowrap h-full">
        <ProjectSidebar />
        <div className="w-full">
            {children}
        </div>
    </div>;
}
