import { TaskTags } from "@prisma/client";
import { Check, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { trpc } from "src/utils/trpc";

const controlClass = "text-neutral-400 hover:text-pad-purple-200 hover:scale-110 duration-300";

type TodoTagEditCardProps = {
	tag: TaskTags;
	createTag: any;
	updateTag: any;
	deleteTag: any;
};

const TodoTagEditCard = ({ tag, createTag, updateTag, deleteTag }: TodoTagEditCardProps) => {
	const [isChanged, setChanged] = useState(false);
	const [title, setTitle] = useState(tag.title);
	const [colour, setColour] = useState(tag.colour);

	const created = tag.id == "null" || tag.owner_id == "null";

	const commitChanges = () => {
		if (created) {
			// create new tag
			createTag({ title, colour });
		} else {
			// update tag
			updateTag(tag.id, { title, colour });
		}
		setChanged(false);
	};

	const resetValues = () => {
		setTitle(tag.title);
		setColour(tag.colour);
		setChanged(false);
	};
	// add controls for editing the tag

	return (
		<div className="styled-input flex flex-row gap-2">
			<div className="flex gap-2">
				<input
					type="text"
					value={title}
					onChange={(e) => {
						setTitle(e.target.value);
						setChanged(true);
					}}
					className="font-mono"
				/>
				<input
					type="color"
					name="colour"
					id="colour"
					className="w-16"
					value={colour}
					onChange={(e) => {
						setColour(e.target.value);
						setChanged(true);
					}}
				/>
			</div>
			<div className="flex gap-2">
				<CancelChangesButton created={created} isChanged={isChanged} resetValues={resetValues} />
				<SaveChangesButton created={created} commitChanges={commitChanges} />
				<DeleteTagButton created={created} onClick={() => deleteTag(tag.id)} />
			</div>
		</div>
	);
};

const SaveChangesButton = ({ created, commitChanges }: { created: boolean; commitChanges: any }) => {
	return (
		<button title={created ? "Save" : "Save Changes"} className={controlClass + " text-green-200"} onClick={commitChanges}>
			{created ? <Check /> : <Save />}
		</button>
	);
};

const DeleteTagButton = ({ created, onClick }: { created: boolean; onClick: () => void }) => {
	return (
		<button title={created ? "Cancel" : "Delete Tag"} className={controlClass + " text-red-200"} onClick={onClick}>
			{created ? <X /> : <Trash2 />}
		</button>
	);
};

const CancelChangesButton = ({ created, isChanged, resetValues }: { created: boolean; isChanged: boolean; resetValues: any }) => {
	return (
		<button
			title="Cancel Changes"
			className={controlClass + (isChanged && !created ? " cursor-pointer opacity-100" : " cursor-default opacity-0")}
			onClick={() => {
				if (!created) resetValues();
			}}
		>
			<Undo2 />
		</button>
	);
};

export const TodoTagsEditor = ({ initial_tags, set_tags }: { initial_tags: TaskTags[]; set_tags: any }) => {
	const [tags, setTags] = useState(initial_tags);
	const create_tag = trpc.tags.createTag.useMutation();
	const delete_tag = trpc.tags.deleteTag.useMutation();
	const update_tag = trpc.tags.updateTag.useMutation();

	const createNewTag = () => {
		// create a new tag
		setTags([
			...tags,
			{
				id: "null",
				owner_id: "null",
				title: "New Tag",
				colour: "#000000"
			}
		]);
	};

	const createTag = async ({ title, colour }: { title: string; colour: string }) => {
		// create a new tag
		create_tag.mutate(
			{ title, colour },
			{
				onSuccess: (data) => {
					const oldTags = tags.filter((tag) => tag.id != "null");
					if (data) {
						const newTags = [...oldTags, data];
						setTags(newTags);
						set_tags(newTags);
					}
				}
			}
		);
	};

	const deleteTag = async (id: string) => {
		// delete a tag from the db
		delete_tag.mutate(
			{ id },
			{
				onSuccess: (data) => {
					if (data) {
						// delete a tag from ui
						const oldTags = tags.filter((tag) => tag.id != id);
						setTags(oldTags);
						set_tags(oldTags);
					}
				}
			}
		);
	};

	const updateTag = async (id: string, { title, colour }: { title: string; colour: string }) => {
		// update a tag
		update_tag.mutate(
			{ id, title, colour },
			{
				onSuccess: (data) => {
					if (data) {
						// update a tag from ui
						const oldTags = tags.filter((tag) => tag.id != id);
						const newTags = [...oldTags, data];
						setTags(newTags);
						set_tags(newTags);
					}
				}
			}
		);
	};

	return (
		<div style={{ maxHeight: "calc(60vh)" }} className="scrollbar-hide overflow-y-auto overflow-x-hidden">
			<div className="relative mb-4 text-center text-xl font-bold">
				Edit Tags
				<div className={"absolute right-1 top-0.5 " + (tags.find((tag) => tag.owner_id == "null") && "hidden")}>
					<button className={controlClass} title="Create New Tag" onClick={() => createNewTag()}>
						<Plus />
					</button>
				</div>
			</div>
			<div className="flex flex-col gap-2 p-1">
				{tags.map((tag, index) => (
					<TodoTagEditCard key={index} tag={tag} createTag={createTag} updateTag={updateTag} deleteTag={deleteTag} />
				))}
			</div>
		</div>
	);
};
