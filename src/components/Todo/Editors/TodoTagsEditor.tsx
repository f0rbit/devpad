import { TODO_Tags } from "@prisma/client";
import { Edit2, Save, TimerReset, Trash2, Undo2 } from "lucide-react";

const TodoTagEditCard = ({ tag }: { tag: TODO_Tags }) => {
	// add controls for editing the tag
    const controlClass = "text-neutral-400 hover:text-pad-purple-200";
	return (
		<div className="edit-todo flex flex-row gap-2">
			<div className="flex gap-2">
				<input type="text" defaultValue={tag.title} />
				<input
					type="color"
					name="colour"
					id="colour"
					className="w-16"
					defaultValue={tag.colour}
				/>
			</div>
            <div className="flex gap-2">
                <button title="Cancel Changes" className={controlClass}>
                    <Undo2 />
                </button>
                <button title="Save Changes" className={controlClass}>
                    <Save />
                </button>
                <button title="Delete Tag" className={controlClass}>
                    <Trash2 />
                </button>
            </div>
		</div>
	);
};

export const TodoTagsEditor = ({ tags }: { tags: TODO_Tags[] }) => {
	return (
		<>
			<div>Edit Tags</div>
			<div>
				{tags.map((tag) => (
					<TodoTagEditCard tag={tag} />
				))}
			</div>
		</>
	);
};
