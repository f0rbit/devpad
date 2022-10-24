// todo tag

import { TODO_Tags } from "@prisma/client";
import { newShade } from "src/utils/colours";

const TodoTag = ({ tag }: { tag: TODO_Tags }) => {
    const { title, colour } = tag;
    const bg_colour = newShade(colour, -5);
    return (
        <div className="flex flex-row items-center">
            <div style={{borderColor: bg_colour, backgroundColor: colour}} className={` rounded-lg px-2 border-2 py-0 shadow text-xs`}>{title}</div>
        </div>
    );
};

export default TodoTag;
