import ProjectSidebar from "@/components/Projects/ProjectSidebar";

export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-row flex-nowrap h-full">
        <div className="w-72 border-r-borders-primary border-r-1">
            <ProjectSidebar />
        </div>    
        <div className="w-full">
            {children}
        </div>
    </div>;
}
