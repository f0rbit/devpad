import { TASK_VISIBILITY } from "@prisma/client";
import { Lock, Unlock, EyeOff, Archive, FileEdit } from "lucide-react";

const VisiblityIcon = ({ visibility }: { visibility: TASK_VISIBILITY }) => {
	switch (visibility) {
		case TASK_VISIBILITY.PRIVATE:
			return <Lock />;
		case TASK_VISIBILITY.PUBLIC:
			return <Unlock />;
		case TASK_VISIBILITY.HIDDEN:
			return <EyeOff />;
		case TASK_VISIBILITY.ARCHIVED:
			return <Archive />;
		case TASK_VISIBILITY.DRAFT:
			return <FileEdit />;
	}
	return <></>;
};

export default VisiblityIcon;
