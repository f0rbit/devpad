
export default function layout({ children }: { children: React.ReactNode }) {
	return <div className="w-full flex flex-col flex-nowrap h-full">
        <div className="h-max w-full flex flex-row gap-2 items-center py-2 px-4 border-b-1 border-borders-primary justify-between">
            <div className="text-base-text-subtlish text-xl font-semibold">Goals</div>
            <div className="text-base-text-dark text-sm">Goals are a collection of tasks that should indicate a new milestone when completed</div>
        </div>
        <div className="w-full h-full">
            {children}
        </div>
    </div>;
}
