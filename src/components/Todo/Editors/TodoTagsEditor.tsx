import { TODO_Tags } from "@prisma/client";
import { Edit2, Save, TimerReset, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";

const TodoTagEditCard = ({ tag }: { tag: TODO_Tags }) => {
	const [isChanged, setChanged] = useState(false);
	const [title, setTitle] = useState(tag.title);
	const [colour, setColour] = useState(tag.colour);

	const resetValues = () => {
		setTitle(tag.title);
		setColour(tag.colour);
		setChanged(false);
	}
	// add controls for editing the tag
	const controlClass =
		"text-neutral-400 hover:text-pad-purple-200 hover:scale-110 duration-300";
	return (
		<div className="edit-todo flex flex-row gap-2">
			<div className="flex gap-2">
				<input
					type="text"
					value={title}
					onChange={(e) => {
						setTitle(e.target.value)
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
				<button
					title="Cancel Changes"
					className={
						controlClass +
						(isChanged ? " opacity-100" : " opacity-0")
					}
					onClick={resetValues}
				>
					<Undo2 />
				</button>
				<button
					title="Save Changes"
					className={controlClass + " text-green-200"}
				>
					<Save />
				</button>
				<button
					title="Delete Tag"
					className={controlClass + " text-red-200"}
				>
					<Trash2 />
				</button>
			</div>
		</div>
	);
};

export const TodoTagsEditor = ({ tags }: { tags: TODO_Tags[] }) => {
	return (
		<div style={{ maxHeight: "calc(60vh)" }} className="overflow-y-auto overflow-x-hidden scrollbar-hide">
			<div className="text-center font-bold mb-4 text-xl">Edit Tags</div>
			<div className="flex flex-col gap-2">
				{tags.map((tag) => (
					<TodoTagEditCard tag={tag} />
				))}
			</div>
		</div>
	);
};
