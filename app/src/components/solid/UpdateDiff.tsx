import { For, createSignal } from "solid-js";
import type { UpdateAction, UpdateData } from "../../server/types";
import type { Task } from "../../server/tasks";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronDown from "lucide-solid/icons/chevron-down";

interface Props {
  items: UpdateData[];
  tasks: Record<string, Task>; //key is codebase_tasks.id
}

const ACTIONS = {
  SAME: ["CONFIRM", "UNLINK"],
  MOVE: ["CONFIRM", "UNLINK"],
  UPDATE: ["CONFIRM", "UNLINK"],
  NEW: ["CREATE", "IGNORE"],
  DELETE: ["DELETE", "UNLINK"],
} as const;

export function UpdateDiffList({ items, tasks }: Props) {
  const _items = JSON.parse(JSON.stringify(items)) as UpdateData[];
  // append .task to each item if found within tasks map
  const mapped_items = _items.map((item) => {
    const task = tasks[item.id];
    if (task) {
      item.task = task;
    }
    return item;
  });

  // split into same and other. 
  const { same = [], others = [] } = Object.groupBy(mapped_items, (u) =>
    u.type === "SAME" || u.type === "MOVE" ? "same" : "others",
  );

  return (
    <div class="flex-col diff-list">
      {same.length > 0 && (
        <details class="boxed">
          <summary class="flex-row" style="justify-content: center">
            <ChevronUp class="up-arrow" />
            <ChevronDown class="down-arrow" />
            <span>{same.length} tasks were the same</span>
          </summary>
          <br />
          <div class="flex-col">
            {same.map((item) => (
              <UpdateDiff update={item} />
            ))}
          </div>
        </details>
      )}
      {others.length > 0 && others.map((item) => <UpdateDiff update={item} />)}
    </div>
  );
}

export function UpdateDiff({ update }: { update: UpdateData & { task?: Task } }) {
  const available_actions = ACTIONS[update.type];
  const [action, setAction] = createSignal<UpdateAction>(available_actions[0]);
  const { data } = update;

  const title: string | null = update?.task?.task?.title ?? null;

  // format <path>:<line>
  let path = "unknown:?";
  if (data.new?.file) {
    path = data.new.file;
    if (data.new.line) {
      path += ":" + data.new.line;
    }
  } else if (data.old?.file) {
    path = data.old.file;
    if (data.old.line) {
      path += ":" + data.old.line;
    }
  }

  const build_context = (context: string[]) => {
    if (!context) return null;
    const min_whitespace = context.reduce((acc, line) => {
      if (line.trim() === "") return acc;
      const whitespace = line.match(/^\s*/);
      if (whitespace) {
        return Math.min(acc, whitespace[0].length);
      }
      return acc;
    }, Infinity);

    return context.map((line) => line.slice(min_whitespace)).join("\n");
  };

  let old_context = null;
  let new_context = null;

  if (data.new?.context) {
    new_context = build_context(data.new.context);
  }
  if (data.old?.context) {
    old_context = build_context(data.old.context);
  }

  /** @note had to set these to 'any' to avoid type error on <Code /> lang attribute */
  let old_filetype = "" as any;
  let new_filetype = "" as any;
  if (data.new?.file) {
    const parts = data.new.file.split(".");
    new_filetype = parts[parts.length - 1];
  }
  if (data.old?.file) {
    const parts = data.old.file.split(".");
    old_filetype = parts[parts.length - 1];
  }

  return (
    <div class="flex-col" style="gap: 2px;">
      <h5 class="flex-row">
        {
          /** @idea paid users could "generate" title using AI, could have automatic generation as option */
        }
        <span>{update.type}</span>
        <span> - </span>
        {
          title ? (
            <span>{title}</span>
          ) : (
            <input type="text" placeholder="Enter title" style="width: 50ch" />
          )
        }
      </h5>
      <div class="flex-row">
        <span>{update.tag}</span> - <code>{path}</code>
      </div>
      <div style="padding-left: 0ch; gap: 3px;" class="flex-col">
        {
          data.old && (
            <div class="item old">
              <code>{data.old.text}</code>
            </div>
          )
        }
        {
          data.new && (
            <div class="item new">
              <code>{data.new.text}</code>
            </div>
          )
        }
      </div>
      <div style="position: relative; padding-top: 2px">
        <Context old_context={old_context} new_context={new_context} />
        <div class="button-container flex-row">
          <For each={available_actions}>
            {(label) => (
              <>
                <input
                  type="radio"
                  name={update.id}
                  id={`${update.id}-${label}`}
                  style="display: none"
                  checked={label === action()}
                  onChange={() => {
                    setAction(label)
                  }}
                />
                <label class="label-modal" for={`${update.id}-${label}`}>
                  {label.toLowerCase()}
                </label>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function Context({ old_context, new_context }: { old_context: string | null, new_context: string | null }) {
  const [open, setOpen] = createSignal(false);
  if (!old_context && !new_context) return <></>;


  return (
    <div class="flex-col">
      <div style="width: max-content" class="flex-row label-modal" onClick={() => setOpen(!open())}>
        <ChevronUp style={{ display: open() ? "none" : "unset" }} />
        <ChevronDown style={{ display: open() ? "unset" : "none" }} />
        <span>Context</span>
      </div>
      <div style={{ "margin-top": "5px", "display": open() ? "grid" : "none" }}>
        {old_context && (
          <pre class="astro-code old">{old_context}</pre>
        )}
        {old_context && new_context && <div style="height: 5px" />}
        {new_context && (
          <pre class="astro-code new">{new_context}</pre>
        )}
      </div>
    </div>
  )
}
