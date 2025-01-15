import { For, createSignal } from "solid-js";
import type { Tag } from "../../server/tags";
import Plus from "lucide-solid/icons/plus";
import { TAG_COLOURS, type TagColor, type UpsertTag } from "../../server/types";
import Save from "lucide-solid/icons/save";
import Check from "lucide-solid/icons/check";
import Trash from "lucide-solid/icons/trash";
import PencilLine from "lucide-solid/icons/pencil-line";

/* solid-js component that takes a list of tags and gives create, update, and delete options to the user. */

type TagProp = UpsertTag;


export function TagEditor({ tags, owner_id }: { tags: Tag[], owner_id: string }) {
  const [currentTags, setCurrentTags] = createSignal(tags as TagProp[]);
  const [creating, setCreating] = createSignal(false);

  function upsert(tag: TagProp) {
    console.log("upsert", tag);
    if (tag.id && tag.id != "") {
      const new_tags = currentTags().map((t) => {
        if (t.id === tag.id) {
          return tag;
        } else {
          return t;
        }
      });
      setCurrentTags(new_tags);
    } else {
      tag.id = crypto.randomUUID();
      setCurrentTags([...currentTags(), tag]);
      setCreating(false);
    }
  }

  function remove(id: string) {
    // set 'deleted' to true
    const new_tags = currentTags().map((t) => {
      if (t.id === id) {
        return { ...t, deleted: true };
      } else {
        return t;
      }
    });
    setCurrentTags(new_tags);
  }

  function create() {
    setCreating(true);
  }

  async function save() {
    if (creating()) return;
    const values = currentTags().map((t) => ({ ...t, owner_id }));
    // make patch request to /todo/save_tags
    const response = await fetch("/api/todo/save_tags", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
    });
    if (response.ok) {
      const result = await response.json();
      console.log("result", result);
      window.location.reload();
    } else {
      const msg = await response.text();
      console.error(response.statusText, msg);
    }
  }


  return (
    <div class="flex-col" style="gap: 5px;">
      {currentTags().length == 0 && creating() == false ? <p>you haven't created any tags yet</p> : null}
      <For each={currentTags()}>
        {(tag) => tag.deleted == false && <TagLine tag={tag} upsert={upsert} remove={remove} owner_id={owner_id} />}
      </For>
      {creating() ? <TagLine tag={null} upsert={upsert} remove={remove} owner_id={owner_id} /> : <a href="#" onClick={create} class="flex-row" style="margin-top: 10px" >
        <Plus />
        add
      </a>}
      <a href="#" onClick={save} class="flex-row" style="margin-top: 10px" >
        <Save />
        save
      </a>

    </div>
  );
}


function TagLine({ tag, upsert, remove, owner_id }: { tag: TagProp | null, upsert: (tag: TagProp) => void, remove: (id: string) => void, owner_id: string }) {
  const is_new = !tag || tag.id == "";
  const [editing, setEditing] = createSignal(is_new);
  const [title, setTitle] = createSignal(tag?.title ?? "");
  const [color, setColor] = createSignal<TagColor | null>(tag?.color ?? null);

  function save() {
    if (is_new) {
      upsert({ title: title(), color: color(), deleted: false, owner_id: owner_id });
    } else {
      upsert({ ...tag, title: title(), color: color() });
    }
    setEditing(false);
  }

  return (
    <div class="flex-row">
      <input type="text" value={title()} disabled={!editing()} onInput={(e) => setTitle(e.currentTarget.value)} />
      <TagColourPicker value={color()} disabled={!editing()} onChange={(col: TagColor) => setColor(col)} />
      {editing() ? (
        <div class="icons">
          <a href="#" onClick={save} title={is_new ? "Create Tag" : "Save Tag"}><Check /></a>
          {tag?.id && <a href="#" title="Remove Tag" onClick={() => remove(tag.id!)}><Trash /></a>}
        </div>
      ) : (
        <div class="icons">
          <a href="#" onClick={() => setEditing(true)} title="Edit Tag">
            <PencilLine />
          </a>
        </div>
      )}

    </div>
  );
}

// COLOUR PICKER




function TagColourPicker({ value, disabled, onChange }: { value: TagColor | null, disabled: boolean, onChange: (value: TagColor) => void }) {
  const valid = !value || Object.keys(TAG_COLOURS).includes(value);
  if (!valid) value = "red";

  return (
    <div>
      <h2>Select a Tag Color</h2>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "10px" }}>
        <For each={Object.entries(TAG_COLOURS)}>
          {([name, { colour, text, border }]) => (
            <button
              style={{
                background: colour,
                color: text,
                border: `2px solid ${border}`,
                padding: "10px",
                "border-radius": "5px",
                cursor: "pointer",
                "min-width": "50px",
                "text-align": "center",
                "font-size": "14px",
              }}
              onClick={() => onChange(name as TagColor)}
            >
              {name}
            </button>
          )}
        </For>
      </div>
      {value && (
        <div style={{ "margin-top": "20px" }}>
          <h3>Selected Color:</h3>
          <p>
            <strong>{value}</strong>
          </p>
          <p>
            <span
              style={{
                display: "inline-block",
                background: TAG_COLOURS[value].colour,
                color: TAG_COLOURS[value].text,
                border: `2px solid ${TAG_COLOURS[value].border}`,
                padding: "5px 10px",
                "border-radius": "5px",
              }}
            >
              Preview
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
