import { FetchedTask, Module } from "@/types/page-link";
import { Plus, Trash } from "lucide-react";
import { Dispatch, SetStateAction, useState } from "react";
import { getDefaultModuleData } from "src/utils/backend";
import ModuleIcon from "../Todo/ModuleIcon";

export default function TaskEditor({ task: initial_task }: { task: FetchedTask }) {
    const [task, setTask] = useState(initial_task);

    return <div className="max-h-[60vh] scrollbar-hide overflow-y-auto text-base-text-primary">
        <div className="styled-input flex flex-row w-[56rem] max-w-[85wvw] h-full">
            <div className="w-full basis-3/4">
                <div>Title</div>
                <div>Summary</div>
                <div>Tags</div>
                <div>Description</div>
                <div>Start Date</div>
                <div>End Date</div>
                <div>Progress</div>
                <div>Visibility</div>
                <div>Priority</div>
            </div>
            <div className="w-full basis-1/4">
                <RightSidebar task={task} setTask={setTask} />
            </div>
        </div>
        <div>
            <button>Delete</button>
            <button>Cancel</button>
            <button>Save</button>
        </div>
    </div>
}

enum RIGHT_MODE {
    MODULES = "MODULES",
    TAGS = "TAGS"
}

function RightSidebar({ task, setTask } : { task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>}) {
    const [mode, setMode] = useState(RIGHT_MODE.MODULES);

    function ModeButton({ mode: this_mode }: { mode: RIGHT_MODE }) {
        return <button onClick={() => setMode(this_mode)} className={"p-0.5 border-b-1 w-full capitalize font-semibold " + (mode == this_mode ? "border-accent-btn-primary hover:border-accent-btn-primary-hover" : "border-borders-secondary hover:border-borders-tertiary") }>{this_mode.toLowerCase()}</button>
    }

    return <div className="flex flex-col gap-2">
        <div className="flex flex-row justify-evenly gap-2">
            {Object.values(RIGHT_MODE).map((mode, index) => <ModeButton mode={mode} key={index} />)}
        </div>
        <div>
            {mode === RIGHT_MODE.MODULES ? <ModuleSelector task={task} setTask={setTask} /> : <TagsSelector />}
        </div>
    </div>
}

function ModuleSelector({ task, setTask } : { task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>}) {
    return <div className="flex flex-col gap-1">
        {Object.values(Module).map((module, index) => <ModuleButton task={task} setTask={setTask} key={index} module={module} />)}
    </div>
}

function ModuleButton({ task, setTask, module } : { task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>, module: Module}) {
    const selected = task.modules.find((task_module) => task_module.type == module);

    function remove() {
        // remove this module from the task

    }

    function add() {
        // add the module to the task with the default values
        // we can't just add the module to the task because we need the id of the module
        
        
    }

    return <div className={`relative group flex flex-row gap-2 border-1 rounded-md border-borders-primary  px-2 py-1 ${(selected) ? "bg-base-accent-primary" : "hover:bg-base-accent-secondary"}`}>
        <ModuleIcon module={module} className="w-5" />
        <div className="capitalize">{module.replaceAll("_", " ")}</div>
        <button className="absolute right-2 group-hover:flex hidden">
            {selected ? <Trash className="w-4 hover:text-red-300" onClick={remove}/> : <Plus className="w-4 hover:text-green-200" onClick={add} />}
        </button>
    </div>
}

function TagsSelector() {
    return <div>
        <div>Tags Selector</div>
    </div>
}