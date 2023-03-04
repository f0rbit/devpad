import { FetchedTask, LoadedTask, Module, TaskPriority } from "@/types/page-link";
import { TaskModule, TaskTags } from "@prisma/client";
import { BoxSelect, Eye, Plus, Tags, Trash, Type } from "lucide-react";
import { Dispatch, SetStateAction, useState } from "react";
import { getDefaultModuleData } from "src/utils/backend";
import { newShade } from "src/utils/colours";
import { dateToDateTime } from "src/utils/dates";
import DescriptionParser from "../Todo/Description/DescriptionParser";
import ModuleIcon from "../Todo/ModuleIcon";
import TodoTag from "../Todo/TodoTag";
import DeleteButton from "./DeleteButton";
import GenericButton from "./GenericButton";
import PrimaryButton from "./PrimaryButton";
import PrioritySelector from "./tasks/PrioritySelector";
import ProgressSelector from "./tasks/ProgressSelector";
import VisibilitySelector from "./tasks/VisibilitySelector";
import DatePicker from "react-datepicker";

type TaskEditorProps = {
	task: FetchedTask;
	tags: TaskTags[] | undefined;
	deleteTask: (task: FetchedTask) => void;
	saveTask: (task: FetchedTask) => void;
	close: () => void;
};

export default function TaskEditor({ task: initial_task, tags, deleteTask, saveTask, close }: TaskEditorProps) {
	const [task, setTask] = useState(initial_task);

	const getModules = (module: Module): TaskModule[] => {
		if (!task) return [];
		return task.modules?.filter((m: TaskModule) => m.type === module);
	};

	function setModuleData(module: Module, data: any) {
		const modules = task.modules;
		const index = modules.findIndex((m) => m.type == module);
		const task_module: TaskModule = {
			type: module,
			data,
			task_id: task.id,
			updated: new Date()
		};
		if (index == -1) {
			modules.push(task_module);
		} else {
			modules[index] = task_module;
		}
		setTask({ ...task, modules });
	}

	return (
		<div className="scrollbar-hide max-h-[60vh] overflow-y-auto text-base-text-dark dark:text-base-text-primary">
			<div className="styled-input flex h-full w-[56rem] max-w-[85wvw] flex-row gap-2">
				<div className="flex w-full basis-3/4 flex-col gap-1 py-1">
					<div className="inline-flex w-full items-center gap-2">
						<Type />
						<input type="text" className="w-full rounded-md text-xl" placeholder="Title" defaultValue={task?.title} name="title" id="title" onChange={(e) => setTask({ ...task, title: e.target.value })} />
					</div>
					{getModules(Module.SUMMARY).map((module, index) => (
						<ItemSummary module={module} key={index} setModuleData={setModuleData} />
					))}
					<TagObjects tags={task.tags} />
					{getModules(Module.DESCRIPTION).map((module, index) => (
						<ItemDescription module={module} key={index} setModuleData={setModuleData} />
					))}
					<div className="inline-flex w-full flex-wrap items-center gap-x-2 md:flex-nowrap">
						{getModules(Module.START_DATE).map((module, index) => (
							<ItemStartDate module={module} key={index} setModuleData={setModuleData} />
						))}
						{getModules(Module.END_DATE).map((module, index) => (
							<ItemEndDate module={module} key={index} setModuleData={setModuleData} />
						))}
					</div>
					<div className="inline-flex w-full items-center gap-2">
						<Eye />
						<div className="w-full text-base-text-subtle">
							<VisibilitySelector select={(visibility) => setTask({ ...task, visibility })} selected={task.visibility} />
						</div>
					</div>
					<div className="inline-flex w-full items-center gap-2">
						<BoxSelect />
						<div className="w-full text-base-text-subtle">
							<ProgressSelector select={(progress) => setTask({ ...task, progress })} selected={task.progress} />
						</div>
					</div>
					{getModules(Module.PRIORITY).map((module, index) => (
						<ItemPriority module={module} key={index} setModuleData={setModuleData} />
					))}
				</div>
				<div className="w-full basis-1/4">
					<RightSidebar task={task} setTask={setTask} tags={tags} />
				</div>
			</div>
			<div className="flex flex-row justify-center gap-2 font-semibold">
				<DeleteButton
					onClick={() => {
						deleteTask(task);
						close();
					}}
				>
					Delete
				</DeleteButton>
				<GenericButton onClick={() => close()}>Cancel</GenericButton>
				<PrimaryButton
					onClick={() => {
						saveTask(task);
						close();
					}}
				>
					Save
				</PrimaryButton>
			</div>
		</div>
	);
}

const ItemPriority = ({ module, setModuleData }: { module: TaskModule; setModuleData: (module: Module, data: any) => void }) => {
	const data = module.data as { priority: TaskPriority };
	const { priority } = data;

	return (
		<div className="flex w-full flex-row items-center gap-2 align-middle">
			<ModuleIcon module={module.type as Module} />
			<PrioritySelector select={(priority) => setModuleData(module.type as Module, { priority })} selected={priority} />
		</div>
	);
};

const ItemEndDate = ({ module, setModuleData }: { module: TaskModule; setModuleData: (module: Module, data: any) => void }) => {
	const data = module.data as { date: string };
	const { date } = data;
	const value = dateToDateTime(new Date(date));
	return (
		<div className="inline-flex w-full items-center gap-2" title="End Time">
			<ModuleIcon module={module.type as Module} />
			<DatePicker wrapperClassName="devpad-date" className="scrollbar-hide" showTimeSelect selected={date ? new Date(date) : null} onChange={(date) => setModuleData(Module.END_DATE, { date })} timeFormat="h:mm aa" dateFormat={"MMMM d, yyyy h:mm aa"} />
		</div>
	);
};

const ItemStartDate = ({ module, setModuleData }: { module: TaskModule; setModuleData: (module: Module, data: any) => void }) => {
	const data = module.data as { date: string };
	const { date } = data;
	const value = dateToDateTime(new Date(date));
	return (
		<div className="inline-flex w-full items-center gap-2" title="Start Time">
			<ModuleIcon module={module.type as Module} />
			<DatePicker wrapperClassName="devpad-date" className="scrollbar-hide" showTimeSelect selected={date ? new Date(date) : null} onChange={(date) => setModuleData(Module.START_DATE, { date })} timeFormat="h:mm aa" dateFormat={"MMMM d, yyyy h:mm aa"} />
		</div>
	);
};

const ItemDescription = ({ module, setModuleData }: { module: TaskModule; setModuleData: (module: Module, data: any) => void }) => {
	const [editing, setEditing] = useState(false);

	const data = module.data as { description: any };
	// module should be of type Description
	return (
		<div className="relative inline-flex min-h-[6rem] w-full gap-2">
			<ModuleIcon module={module.type as Module} />
			{editing ? (
				<textarea
					className="scrollbar-hide w-full rounded-md font-mono"
					placeholder="Description"
					defaultValue={data?.description[0]?.markdown?.text ?? ""}
					name="description"
					onChange={(e) => setModuleData(module.type as Module, { description: [{ markdown: { text: e.target.value } }] })}
				/>
			) : (
				<div className="h-full w-full rounded-md border-1 border-borders-primary px-3">
					<DescriptionParser description={data.description} />
					<div className="absolute bottom-0 right-0">
						<GenericButton style="m-1" onClick={() => setEditing(!editing)}>
							{editing ? "Done" : "Edit"}
						</GenericButton>
					</div>
				</div>
			)}
		</div>
	);
};

const TagObjects = ({ tags }: { tags: TaskTags[] | undefined }) => {
	if (!tags || tags.length <= 0) return <></>;
	return (
		<div className="inline-flex w-full items-center gap-2 pl-0.5">
			<Tags />
			<div className="inline-flex w-full items-center gap-2">
				{tags.map((tag, index) => (
					<TodoTag tag={tag} key={index} />
				))}
			</div>
		</div>
	);
};

const ItemSummary = ({ module, setModuleData }: { module: TaskModule; setModuleData: (module: Module, data: any) => void }) => {
	const data = module.data as { summary: string };

	// module should be of type Summary
	return (
		<div className="inline-flex w-full items-center gap-2">
			<ModuleIcon module={module.type as Module} />
			<input className="w-full rounded-md" placeholder="Summary" defaultValue={data.summary ?? ""} name="summary" onChange={(e) => setModuleData(module.type as Module, { summary: e.target.value })} />
		</div>
	);
};

enum RIGHT_MODE {
	MODULES = "MODULES",
	TAGS = "TAGS"
}

function RightSidebar({ task, setTask, tags }: { task: FetchedTask; setTask: Dispatch<SetStateAction<FetchedTask>>; tags: TaskTags[] | undefined }) {
	const [mode, setMode] = useState(RIGHT_MODE.MODULES);

	function ModeButton({ mode: this_mode }: { mode: RIGHT_MODE }) {
		return (
			<button
				onClick={() => setMode(this_mode)}
				className={
					"w-full border-b-1 p-0.5 font-semibold capitalize " + (mode == this_mode ? "border-accent-btn-primary hover:border-accent-btn-primary-hover" : "border-gray-300 hover:border-gray-500 dark:border-borders-secondary dark:hover:border-borders-tertiary")
				}
			>
				{this_mode.toLowerCase()}
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row justify-evenly gap-2">
				{Object.values(RIGHT_MODE).map((mode, index) => (
					<ModeButton mode={mode} key={index} />
				))}
			</div>
			<div>{mode === RIGHT_MODE.MODULES ? <ModuleSelector task={task} setTask={setTask} /> : <TagsSelector tags={tags} task={task} setTask={setTask} />}</div>
		</div>
	);
}

function ModuleSelector({ task, setTask }: { task: FetchedTask; setTask: Dispatch<SetStateAction<FetchedTask>> }) {
	return (
		<div className="flex flex-col gap-1">
			{Object.values(Module).map((module, index) => (
				<ModuleButton task={task} setTask={setTask} key={index} module={module} />
			))}
		</div>
	);
}

function ModuleButton({ task, setTask, module }: { task: FetchedTask; setTask: Dispatch<SetStateAction<FetchedTask>>; module: Module }) {
	const selected = task.modules.find((task_module) => task_module.type == module);

	function remove() {
		// remove this module from the task
		setTask({ ...task, modules: task.modules.filter((task_module) => task_module.type != module) });
	}

	function add() {
		// add the module to the task with the default values
		setTask({
			...task,
			modules: [
				...task.modules,
				{
					data: getDefaultModuleData(module),
					task_id: task.id,
					type: module,
					updated: new Date()
				}
			]
		});
	}

	return (
		<div className={`group relative flex flex-row gap-2 rounded-md border-1 border-gray-300 px-2  py-1 dark:border-borders-primary ${selected ? "bg-white dark:bg-base-accent-primary" : "hover:bg-gray-50 dark:hover:bg-base-accent-secondary"}`}>
			<ModuleIcon module={module} className="w-5" />
			<div className="capitalize">{module.replaceAll("_", " ")}</div>
			<button className="absolute right-2 hidden group-hover:flex">{selected ? <Trash className="w-4 hover:text-red-300" onClick={remove} /> : <Plus className="w-4 hover:text-green-200" onClick={add} />}</button>
		</div>
	);
}

function TagsSelector({ tags, task, setTask }: { tags: TaskTags[] | undefined; task: FetchedTask; setTask: Dispatch<SetStateAction<FetchedTask>> }) {
	return (
		<div className="flex flex-col gap-1">
			{tags?.map((tag, index) => (
				<TagButton key={index} tag={tag} task={task} setTask={setTask} />
			))}
		</div>
	);
}

function TagButton({ tag, task, setTask }: { tag: TaskTags; task: FetchedTask; setTask: Dispatch<SetStateAction<FetchedTask>> }) {
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

	return (
		<div
			style={{
				borderColor: colourStyle.borderColor,
				backgroundColor: selected && colourStyle.backgroundColor,
				color: selected && colourStyle.color
			}}
			className={`group relative flex flex-row items-center gap-2 rounded-md border-1 border-gray-300 px-2 py-1  text-sm dark:border-borders-primary ${selected ? "bg-white dark:bg-base-accent-primary" : "hover:bg-gray-50 dark:hover:bg-base-accent-secondary"}`}
		>
			<div className="capitalize">{tag.title}</div>
			<button className="absolute right-2 hidden group-hover:flex">{selected ? <Trash className="w-4 hover:text-red-300" onClick={remove} /> : <Plus className="w-4 hover:text-green-200" onClick={add} />}</button>
		</div>
	);
}
