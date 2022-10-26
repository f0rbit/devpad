import { TODO_VISBILITY } from "@prisma/client";
import { Lock, Unlock, EyeOff, Archive, FileEdit } from "lucide-react";

const VisiblityIcon = ({ visibility }: { visibility: TODO_VISBILITY }) => {
    switch (visibility) {
        case TODO_VISBILITY.PRIVATE:
            return <Lock />;
        case TODO_VISBILITY.PUBLIC:
            return <Unlock />;
        case TODO_VISBILITY.HIDDEN:
            return <EyeOff />;
        case TODO_VISBILITY.ARCHIVED:
            return <Archive />;
        case TODO_VISBILITY.DRAFT:
            return <FileEdit />;
    }
    return <></>;
};

export default VisiblityIcon;
