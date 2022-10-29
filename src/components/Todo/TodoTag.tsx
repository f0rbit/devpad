// todo tag

import { TaskTags } from "@prisma/client";
import { newShade } from "src/utils/colours";

const TodoTag = ({ tag }: { tag: TaskTags }) => {
	const { title, colour } = tag;
	const bg_colour = newShade(colour, -5);
	return (
		<div className="flex flex-row items-center">
			<div
				style={{ borderColor: bg_colour, backgroundColor: colour }}
				className={` rounded-lg border-2 px-2 py-0 text-xs shadow`}
			>
				{title}
			</div>
		</div>
	);
};

export default TodoTag;
