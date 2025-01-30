import { For } from "solid-js";
import type { Project } from "../../server/projects";
import type { Task } from "../../server/tasks";

import CalendarClock from "lucide-solid/icons/calendar-clock";
import type { UpsertTag } from "../../server/types";
import CalendarX2 from "lucide-solid/icons/calendar-x-2";
import Calendar from "lucide-solid/icons/calendar";
import Square from "lucide-solid/icons/square";
import SquareDot from "lucide-solid/icons/square-dot";
import SquareCheck from "lucide-solid/icons/square-check";
import Circle from "lucide-solid/icons/circle";
import CircleDot from "lucide-solid/icons/circle-dot";
import CircleCheck from "lucide-solid/icons/circle-check";
import { TagBadge } from "./TagEditor";
import Link from "lucide-solid/icons/link";

interface Props {
  task: Task;
  project: Project | null;
  user_tags: UpsertTag[];
  update: (task_id: string, data: any) => void;
  draw_project: boolean;
}

export const TaskCard = (props: Props) => {
  const { task: fetched_task, project, user_tags } = props;
  const { task, tags } = fetched_task;

  if (!task) {
    return <div>Task not found</div>;
  }

  const project_name = project?.name ?? null;
  let priority_class = task.priority == "MEDIUM" ? "priority-medium" : task.priority == "HIGH" ? "priority-high" : "priority-low";
  if (task.priority == "LOW" && task.end_time == null) priority_class = "priority-none";

  const tag_list = tags.map((tag_id) => {
    return user_tags.find((tag) => tag.id === tag_id) ?? null;
  }).filter(Boolean) as UpsertTag[];

  const Clock = () => {
    const end_time = task.end_time;
    if (!end_time) return <Calendar />;
    const past_due = new Date(end_time) < new Date();
    if (past_due) return <CalendarX2 />;
    return <CalendarClock />;
  }

  const progress = async () => {
    const current_progress = task.progress;
    if (current_progress == "COMPLETED") return; // can't progress from completed
    let new_progress: "IN_PROGRESS" | "COMPLETED" = current_progress == "UNSTARTED" ? "IN_PROGRESS" : "COMPLETED";
    const response = await fetch(`/api/todo/upsert`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: task.id,
        progress: new_progress,
        owner_id: task.owner_id,
      }),
    });
    if (!response.ok) {
      console.error(await response.text());
      return;
    } else {
      props.update(task.id, { progress: new_progress });
    }
  }

  const has_linked = !!fetched_task.codebase_tasks;

  return (
    <div class="flex-col" style={{ "gap": "3px", height: "100%" }}>
      <div>
        <span class="progress-icon">
          <TaskProgress progress={task.progress} onClick={progress} type="box" />
        </span>
        <span>
          <a href={`/todo/${task.id}`} class="task-title">{task.title}</a>
        </span>
      </div>
      {task.summary && <p class="task-summary">{task.summary}</p>}
      <div style={{ height: "100%" }} />
      <div class="flex-col" style={{ "font-size": "small", gap: "6px" }}>
        {tag_list.length > 0 && <span class="flex-row">
          <For each={tag_list}>
            {(tag) => tag.render && <TagBadge name={() => tag.title} colour={() => tag.color ?? null} />}
          </For>
        </span>}
        <span class={`flex-row ${priority_class}`}>
          {has_linked && <div style="display: flex;" title="This task is linked to a codebase"><Link /></div>}
          <Clock />
          <DueDate date={task.end_time} />
          {(project_name && props.draw_project) && <a href={`/project/${project_name}/tasks`}><span style={{ "font-size": "small", color: "var(--text-tertiary)" }}>{" - "}{project_name}</span></a>}
        </span>
      </div>
    </div>
  );
};


const DueDate = ({ date }: { date: string | null }) => {
  // if no date, return <span>No due date</span>
  // otherwise, if within 1 hour say "x minutes"
  // if within 2 days say "x hours"
  // if within 2 weeks say "x days"
  // otherwise say "November 1, 2024"
  // use Intl.DateTimeFormat to format date
  if (!date) return <span>No due date</span>;
  const now = new Date();
  const due = new Date(date);

  const past = now.getTime() > due.getTime();
  const diff = Math.abs(due.getTime() - now.getTime());
  const diffSeconds = diff / 1000;
  const diffMinutes = diffSeconds / 60;
  const diffHours = diffMinutes / 60;
  const diffDays = diffHours / 24;

  // if time is less than 0, show "due {span} ago"
  let span = null;
  if (diffMinutes < 60) span = <span>{Math.round(diffMinutes)} minutes</span>;
  if (diffHours < 48) span = <span>{Math.round(diffHours)} hours</span>;
  if (diffDays < 14) span = <span>{Math.round(diffDays)} days</span>;

  if (span) {
    if (past) return <span>{span} ago</span>;
    return span;
  }


  const options = { month: "long", day: "numeric" } as const;
  return (
    <>
      <span>{new Intl.DateTimeFormat("en-US", options).format(due)}</span>
      <span>, {due.getFullYear()}</span>
    </>
  );
}

export function TaskProgress({ progress, onClick, type }: { progress: Task['task']['progress'], onClick: () => void, type: "box" | "circle" }) {
  // TODO: completed items don't need <a> or onclick
  switch (type) {
    case "box": {
      if (progress == "UNSTARTED") return <a role="button" onClick={onClick}><Square /></a>;
      if (progress == "IN_PROGRESS") return <a role="button" onClick={onClick}><SquareDot /></a>;
      if (progress == "COMPLETED") return <div class="priority-low"><SquareCheck /></div>;
    }
    case "circle": {
      if (progress == "UNSTARTED") return <a role="button" onClick={onClick}><Circle /></a>;
      if (progress == "IN_PROGRESS") return <a role="button" onClick={onClick}><CircleDot /></a>;
      if (progress == "COMPLETED") return <div class="priority-low"><CircleCheck /></div>;
    }
  }

  throw new Error(`Invalid task progress type: ${type}`);
}

