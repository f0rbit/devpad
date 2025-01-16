import { For, createEffect, createSignal, type Accessor } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import { TAG_COLOURS, type Tag, type TagColor, type UpsertTag } from "../../server/types";
import Save from "lucide-solid/icons/save";
import Check from "lucide-solid/icons/check";
import Trash from "lucide-solid/icons/trash";
import PencilLine from "lucide-solid/icons/pencil-line";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";

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
  const [render, setRender] = createSignal(tag?.render ?? true);

  function save() {
    if (is_new) {
      upsert({ title: title(), color: color(), deleted: false, owner_id: owner_id, render: render() });
    } else {
      upsert({ ...tag, title: title(), color: color(), render: render() });
    }
    setEditing(false);
  }


  return (
    <div class="flex-row" style="align-items: unset;">
      <input type="text" value={title()} disabled={!editing()} onInput={(e) => setTitle(e.currentTarget.value)} />
      <TagColourPicker value={color} enabled={editing} onChange={(col) => setColor(col)} />
      <div
        style={{
          "background": "var(--input-background)",
          "border": "1px solid var(--input-border)",
          "padding": "5px",
          "border-radius": "5px",
          "color": "var(--input-text)",
          "font-size": "small",
        }}
        title="Toggle whether this tag should be rendered in the task list">
        <input type="checkbox" checked={render()} onInput={(e) => setRender(e.currentTarget.checked)} />
      </div>
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

function TagColourPicker({
  value,
  enabled,
  onChange,
}: {
  value: Accessor<TagColor | null>;
  enabled: Accessor<boolean>;
  onChange: (value: TagColor | null) => void;
}) {
  const [isOpen, setIsOpen] = createSignal(false);

  createEffect(() => {
    console.log("value", value());
  }, [value()]);

  function togglePopup() {
    if (enabled()) {
      setIsOpen(!isOpen());
    }
  }

  return (
    <div style="position: relative; display: inline-block;">
      {/* Display Current Selected Color */}
      <button
        style={{
          "background": "var(--input-background)",
          "border": "1px solid var(--input-border)",
          "padding": "5px",
          "border-radius": "5px",
          "font-size": "14px",
          "cursor": enabled() ? "pointer" : "text",
          "display": "flex",
          "align-items": "center",
          "gap": "5px",
          "color": "var(--input-text)",
        }}
        onClick={togglePopup}
        disabled={enabled() == false}
      >
        {value() ? <TagBadge colour={value} name={() => value() ?? "None"} /> : <span style="color: var(--text-secondary); font-size: small; height: 21px; line-height: 21px;">Select Colour</span>}
        {isOpen() ? <ChevronUp /> : <ChevronDown />}
      </button>

      {/* Popup List */}
      {isOpen() && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            background: "var(--input-background)",
            border: "1px solid var(--input-border)",
            "border-radius": "5px",
            "box-shadow": "0 2px 5px rgba(0, 0, 0, 0.2)",
            padding: "5px",
            "flex-wrap": "wrap",
            "z-index": 1000,
            display: "grid",
            "grid-template-columns": "1fr 1fr 1fr",
            gap: "5px",
          }}
        >
          <For each={Object.keys(TAG_COLOURS) as TagColor[]}>
            {(name) => (
              <button onClick={() => onChange(name)} class="button-reset">
                <TagBadge name={() => name} colour={() => name} />
              </button>
            )}
          </For>
          <button onClick={() => onChange(null)} class="button-reset">
            <TagBadge name={() => "None"} colour={() => null} />
          </button>
        </div>
      )}
    </div>
  );
}

export function TagBadge({ name, colour, onRemove }: { name: Accessor<string>, colour: Accessor<TagColor | null>, onRemove?: () => void }) {
  return (
    <div
      style={{
        "background": colour() ? TAG_COLOURS[colour()!].colour : "none",
        "color": colour() ? TAG_COLOURS[colour()!].text : "var(--text-secondary)",
        "border": `1px solid ${colour() ? TAG_COLOURS[colour()!].border : "var(--input-border)"}`,
      }}
      class="tag-badge"
    >
      {name()}
      {onRemove &&
        <div onClick={onRemove} class="flex-row">
          <X size={16} />
        </div>}
    </div>
  );
}

