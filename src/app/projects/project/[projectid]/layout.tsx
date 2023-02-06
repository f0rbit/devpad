import ProjectSidebar from "@/components/Projects/ProjectSidebar";

export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-row flex-nowrap h-full">
        <div className="min-w-[18rem] max-w-[18rem] border-r-borders-primary border-r-1">
            <ProjectSidebar />
        </div>    
        <div className="w-full">
            {children}
        </div>
    </div>;
}
