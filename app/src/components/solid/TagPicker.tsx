/* solid-js component to pick a selection of tags. it should store the list in the data-attribute of the container, so we can access it from other js scripts. input should be a input element with a datalist of tags with the name and value of the id. the user can input a tag that isn't within the list, and this would have the id of null but pass through the name and a random colour that is generated for it. upon saving the item, these new tags are then inserted into the db & saved. the "new" tags should have some sort of bright green outline on the badge. */

import { For, createSignal, onMount } from "solid-js";
import type { UpsertTag } from "../../server/types";
import type { Tag } from "../../server/tags";
import X from "lucide-solid/icons/x";
import Plus from "lucide-solid/icons/plus";
import { TagBadge } from "./TagEditor";

export function TagSelect({ tags, onSelect }: { tags: Tag[], onSelect: (tag: Tag | null) => void }) {
  // use a select element
  function select(id: string) {
    const found = tags.find((t) => t.id === id) ?? null;
    onSelect(found);
  }

  return (
    <select onChange={(e) => select(e.target.value)} style="min-width: 6rem">
      <option value="">-</option>
      {tags.map((tag) => (
        <option value={tag.id}>
          {tag.title}
        </option>
      ))}
    </select>
  );
}




export function TagPicker({ currentTags, availableTags, owner_id }: { currentTags: UpsertTag[], availableTags: Tag[], owner_id: string }) {
  const [tags, setTags] = createSignal(currentTags);
  let input!: HTMLInputElement;
  let container!: HTMLDivElement;

  // this function allows the astro <script> tag to access the tags
  onMount(() => {
    // @ts-ignore
    window.get_tags = () => tags();
  });

  function add() {
    const value = input.value.trim();
    if (value.length == 0 || value == "") return;
    // check to see if we have selected an option from the input datalist
    const selected = value ? input.list!.querySelector(`option[value="${value}"]`) : null;
    if (selected) {
      const sel_id = selected.getAttribute("data-id");
      if (sel_id) {
        // if we have, add it to the list
        const found = availableTags.find((t) => t.id === sel_id);
        if (found) {
          addTag(found as UpsertTag);
          return;
        }
      }
    }
    // if we haven't check to see if we have one with the same name
    const existing = availableTags.find((t) => t.title === value);
    console.log("existing", existing);
    if (existing) {
      // if we do, add it to the list
      addTag(existing as UpsertTag);
    } else {
      // if we don't, add a new tag
      addTag({ title: input.value, id: undefined, color: "#" + Math.floor(Math.random() * 16777215).toString(16), deleted: false, owner_id });
    }
  }

  function addTag(id: UpsertTag) {
    setTags([...tags(), id]);
    input.value = "";
    input.focus();

    console.log(tags());
  }



  function removeTag(tag: UpsertTag) {
    if (tag.id == null) {
      // filter by name
      setTags(tags().filter((t) => t.title !== tag.title));
    } else {
      setTags(tags().filter((t) => t.id !== tag.id));
    }
  }

  return (
    <div ref={container} class="flex-row">
      <input type="text" list="tags" ref={input} onKeyPress={(e) => { if (e.key === "Enter") add(); }} />
      <datalist id="tags">
        {availableTags.map((tag) => (
          <option data-id={tag.id} value={tag.title}>{tag.title}</option>
        ))}
      </datalist>
      <a href="#" onClick={add}><Plus /></a>
      <div class="flex-row" style="flex-wrap: wrap;">
        <For each={tags()}>
          {(tag) => (
            <TagBadge name={() => tag.title} colour={() => tag.color ?? null} onRemove={() => removeTag(tag)} />
          )}
        </For>
      </div>
    </div>
  );
}
