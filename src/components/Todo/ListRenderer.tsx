import { CreateItemOptions, FetchedProject, FetchedTask, getModuleData, Module, TaskPriority } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Tag } from "lucide-react";
import { Dispatch, SetStateAction, useContext, useState } from "react";
import { TodoContext } from "src/pages/todo";
import { trpc } from "src/utils/trpc";
import GenericButton from "../common/GenericButton";
import PrimaryButton from "../common/PrimaryButton";
import GenericModal from "../GenericModal";
import TodoCreateForm from "./Editors/TodoCreateForm";
import { TodoTagsEditor } from "./Editors/TodoTagsEditor";
import { LayoutIcon, TODO_LAYOUT } from "./ListLayout";
import TodoCard from "./TodoCard";

const ListRenderer = () => {
	const { items, setItems } = useContext(TodoContext);
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [editTagsModalOpen, setEditTagsModalOpen] = useState(false);
	const create_task = trpc.tasks.createTask.useMutation();
	const [layout, setLayout] = useState(TODO_LAYOUT.LIST);

	if (!items) {
		return <div>Loading...</div>;
	}

	async function createTask(task: CreateItemOptions) {
		const response = await create_task.mutateAsync({ item: task });
		if (!response || response.error) {
			/** @todo error handling */
		} else if (response.data) {
			setItems([...items, response.data]);
		} else {
			/** @todo handle invalid data response */
		}
	}

	const setItem = (item: FetchedTask) => {
		const otherItems = items.filter((i) => i.id !== item.id);
		setItems([...otherItems, item]);
	};

	return (
		<TodoContext.Consumer>
			{({ selectedSection, searchQuery, tags, setTags, items, setItems, projects }) => {
				return (
					<>
						<div style={{ maxHeight: "calc(100vh - 65px)" }} className="scrollbar-hide h-full w-full overflow-auto border-l-1 border-gray-300 dark:border-borders-primary">
							<div className="w-full p-4">
								<div className="mb-4 rounded-md p-2 font-bold">
									<div className="flex flex-row items-center gap-4">
										<div className="text-3xl font-bold capitalize text-base-text-dark dark:text-base-text-secondary">{selectedSection + " Items"}</div>
										<div className="ml-auto flex flex-row gap-4">
											<CreateButton onClick={() => setCreateModalOpen(true)} />
											<LayoutSelectors setLayout={setLayout} />
											<TagEditButton onClick={() => setEditTagsModalOpen(true)} />
										</div>
									</div>
								</div>
								<RenderTasks data={getSortedData(items, selectedSection, searchQuery, projects)} layout={layout} setItem={setItem} tags={tags} />
							</div>
						</div>
						<div className="fixed bottom-2 right-2 md:bottom-4 md:right-4">
							{/* This is the create todo item form */}
							<div className="absolute">
								<GenericModal open={createModalOpen} setOpen={setCreateModalOpen}>
									<TodoCreateForm createItem={createTask} setOpen={setCreateModalOpen} />
								</GenericModal>
							</div>
						</div>
						{/* This is the edit tags form */}
						<div className="absolute">
							<GenericModal open={editTagsModalOpen} setOpen={setEditTagsModalOpen}>
								<TodoTagsEditor initial_tags={tags} set_tags={setTags} />
							</GenericModal>
						</div>
					</>
				);
			}}
		</TodoContext.Consumer>
	);
};

export default ListRenderer;

const RenderTasks = ({ data, layout, setItem, tags }: { data: FetchedTask[]; layout: TODO_LAYOUT; setItem: (item: FetchedTask) => void; tags: TaskTags[] | undefined }) => {
	const renderData = (data: FetchedTask[]) => {
		if (data.length <= 0) {
			return <div className="text-center text-base-text-subtle">No items found</div>;
		}
		return data.map((item) => <TodoCard key={item.id} initial_item={item} layout={layout} set_item={setItem} tags={tags} />);
	};

	switch (layout) {
		case TODO_LAYOUT.LIST:
			return <div className="flex flex-col gap-2">{renderData(data)}</div>;
		case TODO_LAYOUT.GRID:
			return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ">{renderData(data)}</div>;
		default:
			return <></>;
	}
};

const LayoutSelectors = ({ setLayout }: { setLayout: Dispatch<SetStateAction<TODO_LAYOUT>> }) => {
	return (
		<div className="flex flex-row items-center gap-2">
			{Object.values(TODO_LAYOUT).map((layout_type) => (
				<GenericButton key={layout_type} onClick={() => setLayout(layout_type)}>
					<LayoutIcon layout={layout_type} />
				</GenericButton>
			))}
		</div>
	);
};

const TagEditButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<GenericButton onClick={onClick} style="flex flex-nowrap items-center justify-center gap-2 align-middle text-sm ">
			<Tag className="p-0.5" />
			Edit
		</GenericButton>
	);
};

const CreateButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<PrimaryButton style="" onClick={onClick}>
			Create
		</PrimaryButton>
	);
};

function getSortedData(data: FetchedTask[], selectedSection: string, searchQuery: string, projects: FetchedProject[]): FetchedTask[] {
	// remove all deleted
	const sorted = data.filter((item) => item.visibility != TASK_VISIBILITY.DELETED);
	switch (selectedSection) {
		case "current":
			// get all the items with a progress of "IN_PROGRESS"
			return sorted.filter((item) => item.progress == TASK_PROGRESS.IN_PROGRESS);
		case "recent":
			return sorted.sort((a, b) => {
				return a.updated_at > b.updated_at ? -1 : 1;
			});
		case "search":
			// get the searchQuery from TODO_CONTEXT
			return sorted.filter((item) => {
				// combine fields into one string
				const fields = [item.title].join(" ");
				// check if the searchQuery is in the fields
				return fields.toLowerCase().includes(searchQuery.toLowerCase());
			});
		case "upcoming":
			// first filter out all that took place in the past
			return sorted
				.filter((item) => {
					const end = getModuleData(item, Module.END_DATE);
					if (!end) return false;
					return new Date(end["date"]).getTime() > new Date().getTime();
				})
				.sort((a, b) => {
					const a_end = getModuleData(a, Module.END_DATE);
					const b_end = getModuleData(b, Module.END_DATE);
					if (!a_end || !b_end) return 0;
					return new Date(a_end["date"]) > new Date(b_end["date"]) ? 1 : -1;
				});
		case "urgent":
			// filter out all that aren't urgent priority
			return sorted.filter((item) => {
				// extract priority from modules
				const priority = getModuleData(item, Module.PRIORITY);
				if (!priority || !priority["priority"]) return false;
				return priority["priority"] == TaskPriority.URGENT;
			});
		case "todo":
			// filter out all completed tasks
			// sort by end date
			// don't show tasks who's start date hasnt been yet
			return sorted
				.filter((item) => {
					const start = getModuleData(item, Module.START_DATE);
					if (!start) return true;
					return new Date(start["date"]).getTime() < new Date().getTime();
				})
				.filter((item) => {
					return item.progress != TASK_PROGRESS.COMPLETED;
				})
				.sort((a, b) => {
					const a_end = getModuleData(a, Module.END_DATE);
					const b_end = getModuleData(b, Module.END_DATE);
					const bad_a_end = !a_end || !a_end["date"];
					const bad_b_end = !b_end || !b_end["date"];
					if (bad_a_end && bad_b_end) return a.updated_at < b.updated_at ? -1 : 1;
					if (bad_a_end) return 1;
					if (bad_b_end) return -1;
					return new Date(a_end["date"]) > new Date(b_end["date"]) ? 1 : -1;
				});
		default:
			if (selectedSection.startsWith("tags/")) {
				const tag = selectedSection.split("/")[1];
				if (!tag) return [];
				return sorted.filter((item) => {
					// get titles of tags
					const tags = item.tags?.map((tag) => tag.title.toLowerCase());
					return tags.includes(tag);
				});
			} else if (selectedSection.startsWith("projects/")) {
				const project_id = selectedSection.split("/")[1];
				if (!project_id) return [];
				const project = projects.find((project) => project.project_id == project_id);
				return sorted.filter((item) => project?.goals.find((goal) => goal.id == item.project_goal_id));
				// return sorted.filter((item) => {
				// 	return item.project_id === project_id;
				// });
			}
			return sorted;
	}
}
