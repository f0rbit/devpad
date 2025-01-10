import { For } from "solid-js";
import type { Project } from "../../server/projects";
import type { Task } from "../../server/tasks";

import CalendarClock from "lucide-solid/icons/calendar-clock";
import { TagBadge } from "./TagPicker";
import type { UpsertTag } from "../../server/types";
import CalendarX2 from "lucide-solid/icons/calendar-x-2";
import Calendar from "lucide-solid/icons/calendar";
import Square from "lucide-solid/icons/square";
import SquareDot from "lucide-solid/icons/square-dot";
import SquareCheck from "lucide-solid/icons/square-check";
import Circle from "lucide-solid/icons/circle";
import CircleDot from "lucide-solid/icons/circle-dot";
import CircleCheck from "lucide-solid/icons/circle-check";

interface Props {
  task: Task;
  project: Project;
  from: string;
  user_tags: UpsertTag[];
}

export const TaskCard = (props: Props) => {
  const { task: fetched_task, project, from, user_tags } = props;
  const { task, tags } = fetched_task;

  if (!task) {
    return <div>Task not found</div>;
  }

  const project_name = project?.name || "No project";
  const priority_class = `priority-${task.priority?.toLowerCase() ?? "low"}`;

  const tag_list = tags.map((tag_id) => {
    return user_tags.find((tag) => tag.id === tag_id) ?? null;
  }).filter(Boolean) as UpsertTag[];

  const Clock = () => {
    if (!task.end_time) return <Calendar />;
    const past_due = new Date(task.end_time) < new Date();
    if (past_due) return <CalendarX2 />;
    return <CalendarClock />;
  }

  return (
    <div class="flex-col" style={{ "gap": "3px", height: "100%" }}>
      <div>
        <span class="progress-icon">
          <TaskProgress progress={task.progress} onClick={() => {
            console.log("clicked");
            // TODO: increment progress
          }} type="circle" />
        </span>
        <span>
          <a href={`/todo/${task.id}?from=${from}`} class="task-title">{task.title}</a>
        </span>
      </div>
      {task.summary && <p>{task.summary}</p>}
      <div style={{ height: "100%" }} />
      <div class={`flex-col ${priority_class}`} style={{ "font-size": "small", gap: "6px" }}>
        {tag_list.length > 0 && <span class="flex-row">
          <For each={tag_list}>
            {(tag) => <TagBadge tag={tag} />}
          </For>
        </span>}
        <span class="flex-row">
          <Clock />
          <DueDate date={task.end_time} />
          {project_name && <span style={{ "font-size": "small", color: "var(--text-tertiary)" }}>{" - "}{project_name}</span>}
        </span>
      </div>
    </div>
  );
};


const FormattedDate = ({ date }: { date: string | null }) => {
  if (!date) return <span>No date</span>;
  // format like November 1, 2024
  // use Intl.DateTimeFormat to format date
  // return as <span class='date'>November 1</span><span class='year'>, 2024</span>
  const options = { month: "long", day: "numeric" } as const;

  return (
    <>
      <span class="date">{new Intl.DateTimeFormat("en-US", options).format(new Date(date))}</span>
      <span class="year">, {new Date(date).getFullYear()}</span>
    </>
  );
}

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
  // TODO: completed items don't need an onclick?
  switch (type) {
    case "box": {
      if (progress == "UNSTARTED") return <a role="button" onClick={onClick}><Square /></a>;
      if (progress == "IN_PROGRESS") return <a role="button" onClick={onClick}><SquareDot /></a>;
      if (progress == "COMPLETED") return <a role="button" onClick={onClick}><SquareCheck /></a>;
    }
    case "circle": {
      if (progress == "UNSTARTED") return <a role="button" onClick={onClick}><Circle /></a>;
      if (progress == "IN_PROGRESS") return <a role="button" onClick={onClick}><CircleDot /></a>;
      if (progress == "COMPLETED") return <a role="button" onClick={onClick}><CircleCheck /></a>;
    }
  }

  throw new Error(`Invalid task progress type: ${type}`);
}

