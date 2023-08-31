
export default function layout({ children }: { children: React.ReactNode }) {
    return <div className="w-full flex flex-col flex-nowrap h-full">
        <div className="h-max w-full flex flex-row gap-2 items-center py-2 px-4 border-b-1 border-borders-primary justify-between">
            <div className="text-base-text-subtlish text-xl font-semibold">Settings</div>
            <div className="text-base-text-dark text-sm">Modify key characteristics of the project</div>
        </div>
        <div className="h-full overflow-x-auto" style={{ width: "calc(100vw - 18rem)" }}>
            {children}
        </div>
    </div>;
}
