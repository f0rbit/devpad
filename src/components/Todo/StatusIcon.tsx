import { TODO_STATUS } from "@prisma/client";
import { CheckSquare, MoreHorizontal, Square } from "lucide-react";

const StatusIcon = ({ status }: { status: TODO_STATUS }) => {
    switch (status) {
        case TODO_STATUS.COMPLETED:
            return <CheckSquare className="w-5" />;
        case TODO_STATUS.IN_PROGRESS:
            return (
                <div className="relative w-5">
                    <Square className="relative w-full" />
                    <MoreHorizontal className="absolute scale-75 top-0 w-5" />
                </div>
            );
        case TODO_STATUS.UNSTARTED:
            return <Square className="w-5"/>;
    }
};


export default StatusIcon;