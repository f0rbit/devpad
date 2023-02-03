import ProjectSidebar from "@/components/Projects/ProjectSidebar";
import { Sidebar } from "lucide-react";

export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-row flex-nowrap h-full gap-4">
        <div className="w-72 border-r-[#5c5c65] border-r-1">
            <ProjectSidebar />
        </div>    
        <div className="w-full">
            {children}
        </div>
    </div>;
}
