import { CreateItemOptions, FetchedProject, FetchedTask, getModuleData, Module, TaskPriority } from "@/types/page-link";
import { TaskTags, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Tag } from "lucide-react";
import { Dispatch, SetStateAction, useContext, useState } from "react";
import { TodoContext } from "src/pages/todo";
import { trpc } from "src/utils/trpc";
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
			setItems([...items, response.data ]);
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
						<div style={{maxHeight: "calc(100vh - 65px)"}}className="scrollbar-hide h-full w-full overflow-auto border-l-1 border-borders-primary">
							<div className="w-full p-4">
								<div className="mb-4 rounded-md p-2 font-bold">
									<div className="flex flex-row items-center gap-4">
										<div className="text-3xl font-bold text-base-text-secondary capitalize">{selectedSection + " Items"}</div>
										{/* <div>Layout: {layout}</div> */}
										<div className="ml-auto flex flex-row gap-4">
											<LayoutSelectors setLayout={setLayout} />
											<TagEditButton onClick={() => setEditTagsModalOpen(true)} />
										</div>
									</div>
								</div>
								<RenderTasks data={getSortedData(items, selectedSection, searchQuery, projects)} layout={layout} setItem={setItem} tags={tags} />
							</div>
						</div>
						<div className="fixed bottom-2 right-2 md:bottom-4 md:right-4">
							<CreateButton onClick={() => setCreateModalOpen(true)} />
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
			return <div className="text-base-text-subtle text-center">No items found</div>;
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
				<button key={layout_type} onClick={() => setLayout(layout_type)} className="rounded-md bg-gray-300 px-3 py-1 text-gray-500 dark:bg-base-accent-secondary dark:hover:bg-base-accent-tertiary duration-500 transition-colors dark:text-base-text-subtlish border-1 border-borders-secondary">
					<LayoutIcon layout={layout_type} />
				</button>
			))}
		</div>
	);
};

const TagEditButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<button onClick={onClick} className="flex flex-nowrap items-center justify-center gap-2 rounded-md bg-gray-300 px-3 py-1 align-middle text-sm text-gray-500 dark:bg-base-accent-secondary dark:hover:bg-base-accent-tertiary duration-500 transition-colors dark:text-base-text-subtlish border-1 border-borders-secondary">
			<Tag className="p-0.5" />
			Edit
		</button>
	);
};

const CreateButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<button
			className={`origin-bottom rounded-md border-1 border-accent-btn-primary-hover bg-accent-btn-primary px-6 py-2 text-xl font-bold text-white transition-all duration-500 hover:bg-accent-btn-primary-hover`}
			onClick={(e) => {
				e.preventDefault();
				onClick();
			}}
		>
			Create
		</button>
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
