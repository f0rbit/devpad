import { FetchedTask, Module } from "@/types/page-link";
import { TaskTags } from "@prisma/client";
import { Plus, Trash } from "lucide-react";
import { Dispatch, SetStateAction, useState } from "react";
import { getDefaultModuleData } from "src/utils/backend";
import { newShade } from "src/utils/colours";
import ModuleIcon from "../Todo/ModuleIcon";
import DeleteButton from "./DeleteButton";
import GenericButton from "./GenericButton";
import PrimaryButton from "./PrimaryButton";

export default function TaskEditor({ task: initial_task, tags }: { task: FetchedTask, tags: TaskTags[] }) {
    const [task, setTask] = useState(initial_task);
    console.log(task);

    return <div className="max-h-[60vh] scrollbar-hide overflow-y-auto text-base-text-primary">
        <div className="styled-input flex flex-row w-[56rem] max-w-[85wvw] h-full gap-2">
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
                <RightSidebar task={task} setTask={setTask} tags={tags}/>
            </div>
        </div>
        <div className="flex flex-row gap-2 font-semibold justify-center">
            <DeleteButton>Delete</DeleteButton>
            <GenericButton>Cancel</GenericButton>
            <PrimaryButton>Save</PrimaryButton>
        </div>
    </div>
}

enum RIGHT_MODE {
    MODULES = "MODULES",
    TAGS = "TAGS"
}

function RightSidebar({ task, setTask, tags } : { task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>, tags: TaskTags[] }) {
    const [mode, setMode] = useState(RIGHT_MODE.MODULES);

    function ModeButton({ mode: this_mode }: { mode: RIGHT_MODE }) {
        return <button onClick={() => setMode(this_mode)} className={"p-0.5 border-b-1 w-full capitalize font-semibold " + (mode == this_mode ? "border-accent-btn-primary hover:border-accent-btn-primary-hover" : "border-borders-secondary hover:border-borders-tertiary") }>{this_mode.toLowerCase()}</button>
    }

    return <div className="flex flex-col gap-2">
        <div className="flex flex-row justify-evenly gap-2">
            {Object.values(RIGHT_MODE).map((mode, index) => <ModeButton mode={mode} key={index} />)}
        </div>
        <div>
            {mode === RIGHT_MODE.MODULES ? <ModuleSelector task={task} setTask={setTask} /> : <TagsSelector tags={tags} task={task} setTask={setTask} />}
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
        setTask({ ...task, modules: task.modules.filter((task_module) => task_module.type != module) });
    }

    function add() {
        // add the module to the task with the default values
        setTask({ ...task, modules: [...task.modules, {
            data: getDefaultModuleData(module),
            task_id: task.id,
            type: module,
            updated: new Date()
        }] });
    }

    return <div className={`relative group flex flex-row gap-2 border-1 rounded-md border-borders-primary  px-2 py-1 ${(selected) ? "bg-base-accent-primary" : "hover:bg-base-accent-secondary"}`}>
        <ModuleIcon module={module} className="w-5" />
        <div className="capitalize">{module.replaceAll("_", " ")}</div>
        <button className="absolute right-2 group-hover:flex hidden">
            {selected ? <Trash className="w-4 hover:text-red-300" onClick={remove}/> : <Plus className="w-4 hover:text-green-200" onClick={add} />}
        </button>
    </div>
}

function TagsSelector({ tags, task, setTask } : { tags: TaskTags[], task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>}) {
    return <div className="flex flex-col gap-1">
        {tags.map((tag, index) => <TagButton key={index} tag={tag} task={task} setTask={setTask} />)}
    </div>
}

function TagButton({ tag, task, setTask } : { tag: TaskTags, task: FetchedTask, setTask: Dispatch<SetStateAction<FetchedTask>>}) {
    const selected = task.tags.find((task_tag) => task_tag.id == tag.id);

	const colourStyle = { borderColor: newShade(tag.colour, 5), backgroundColor: tag.colour, color: newShade(tag.colour, 75) };
    
    function remove() {
        // remove this tag from the task
        setTask({ ...task, tags: task.tags.filter((task_tag) => task_tag.id != tag.id) });
    }

    function add() {
        // add the tag to the task
        setTask({ ...task, tags: [...task.tags, tag] });
    }

    return <div style={{
        borderColor: colourStyle.borderColor,
        backgroundColor: selected && colourStyle.backgroundColor,
        color: selected && colourStyle.color
    }} className={`relative group flex flex-row gap-2 text-sm items-center border-1 rounded-md border-borders-primary  px-2 py-1 ${(selected) ? "bg-base-accent-primary" : "hover:bg-base-accent-secondary"}`}>
        <div className="capitalize">{tag.title}</div>
        <button className="absolute right-2 group-hover:flex hidden">
            {selected ? <Trash className="w-4 hover:text-red-300" onClick={remove}/> : <Plus className="w-4 hover:text-green-200" onClick={add} />}
        </button>
    </div>
}
