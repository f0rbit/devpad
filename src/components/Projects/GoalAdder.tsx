"use client"

import { ProjectGoal } from "@prisma/client";
import { Plus } from "lucide-react";
import { useState } from "react";
import CenteredContainer from "../CenteredContainer";
import GoalCard from "./GoalCard";

export default function GoalAdder({ project_id, addGoal}: { project_id: string, addGoal: (goal: ProjectGoal) => void}) {
    const [isEditing, setIsEditing] = useState(false);

    if (isEditing) {
        return <GoalCard goal={null} project_id={project_id} cancel={() => setIsEditing(false)} create={(goal) => {
            setIsEditing(false);
            addGoal(goal);
        }} />
    } else {
        return <div className="w-96 flex items-center justify-center text-base-text-dark">
                <button onClick={() => setIsEditing(true)}><Plus /></button>
        </div>
    }
} 