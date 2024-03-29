// todo tag

import { TaskTags } from "@prisma/client";
import { newShade } from "src/utils/colours";

const TodoTag = ({ tag }: { tag: TaskTags }) => {
	const { title, colour } = tag;
	const colourStyle = { borderColor: newShade(colour, 5), backgroundColor: colour, color: newShade(colour, 75) };
	
	return (
		<div className="flex flex-row items-center">
			<div style={colourStyle} className={`rounded-lg border-2 px-2 py-0 text-xs shadow`}>
				{title}
			</div>
		</div>
	);
};

export default TodoTag;
