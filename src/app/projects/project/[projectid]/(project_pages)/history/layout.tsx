import React from "react";

export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-col flex-nowrap h-full">
        <div className="h-max w-full flex flex-row gap-2 items-center py-2 px-4 border-b-1 border-borders-primary justify-between">
            <div className="text-base-text-subtlish text-xl font-semibold">History</div>
            <div className="text-base-text-dark text-sm">A comprehensive view of the history of your project</div>
        </div>
        <div className="h-max overflow-y-auto" style={{maxHeight: "calc(100vh - 110px)"}}>
            {children}
        </div>
    </div>;
}
