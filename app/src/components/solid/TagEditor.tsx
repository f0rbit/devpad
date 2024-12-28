import { For, createSignal } from "solid-js";
import type { Tag } from "../../server/tags";
import Plus from "lucide-solid/icons/plus";

/* solid-js component that takes a list of tags and gives create, update, and delete options to the user. */

type UpsertTag = {
  id: string | null;
  title: string;
  color: string;
};


export function TagEditor({ tags }: { tags: Tag[] }) {
  const [currentTags, setCurrentTags] = createSignal<UpsertTag[]>(tags as UpsertTag[]);
  const [creating, setCreating] = createSignal(false);

  function upsert(tag: UpsertTag) {
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
    const new_tags = currentTags().filter((t) => t.id !== id);
    setCurrentTags(new_tags);
  }

  function create() {
    setCreating(true);
  }


  return (
    <div class="flex-col" style="gap: 5px;">
      {currentTags().length == 0 && creating() == false ? <p>you haven't created any tags yet</p> : null}
      <For each={currentTags()}>
        {(tag) => <TagLine tag={tag} upsert={upsert} remove={remove} />}
      </For>
      {creating() ? <TagLine tag={null} upsert={upsert} remove={remove} /> : <a href="#" onClick={create} class="flex-row" style="margin-top: 10px" >
        <Plus />
        add
      </a>}
    </div>
  );
}


function TagLine({ tag, upsert, remove }: { tag: UpsertTag | null, upsert: (tag: UpsertTag) => void, remove: (id: string) => void }) {
  const is_new = !tag || tag.id == "";
  const [editing, setEditing] = createSignal(is_new);
  const [title, setTitle] = createSignal(tag?.title ?? "");
  const [color, setColor] = createSignal(tag?.color ?? "#000000");

  function save() {
    if (is_new) {
      upsert({ id: "", title: title(), color: color() });
    } else {
      upsert({ ...tag, title: title(), color: color() });
    }
    setEditing(false);
  }

  return (
    <div class="flex-row">
      <input type="text" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
      <input type="color" value={color()} onInput={(e) => setColor(e.currentTarget.value)} />
      {editing() ? (
        <div class="flex-row">
          <a href="#" onClick={save}>{is_new ? "create" : "save"}</a>
          {tag?.id && <a href="#" onClick={() => remove(tag.id!)}>remove</a>}
        </div>
      ) : (
        <div>
          <a href="#" onClick={() => setEditing(true)}>edit</a>
        </div>
      )}

    </div>
  );

}
