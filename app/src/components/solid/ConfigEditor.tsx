import { createSignal, For, Index } from "solid-js";
import { z } from "zod";

const ConfigSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string(),
      match: z.array(z.string()),
    })
  ),
  ignore: z.array(z.string().regex(/^[^]*$/, "Invalid path")),
});

type Config = z.infer<typeof ConfigSchema>;

/** @todo make prettier using tailwind & lucide icons */

const TodoScannerConfig = () => {
    /** @todo change this from any - has to represent the nested signal for matches */
  const [tags, setTags] = createSignal<any>([]);
  const [ignorePaths, setIgnorePaths] = createSignal<Config["ignore"]>([]);
  const [tagError, setTagError] = createSignal("");
  const [pathError, setPathError] = createSignal("");

  const addTag = () => {
    const [matches, setMatches] = createSignal<string[]>([]);
    setTags((prev) => {
      const updatedTags = [...prev, { name: "", matches, setMatches }];
      setMatches([]);
      return updatedTags;
    });
  };

 const updateTag = (index: number, field: "name" | "match", value: any) => {
    setTags((prev) => {
        const updatedTags = [...prev];
        updatedTags[index][field] = value;
        return updatedTags;
      });
        validateTags(tags());
};

  const removeTag = (index: number) => {
    const updatedTags = [...tags()];
    updatedTags.splice(index, 1);
    setTags(updatedTags);
    validateTags(updatedTags);
  };

  const addMatch = (index: number) => {
    const updatedTags = [...tags()];
    updatedTags[index].setMatches([...updatedTags[index].matches(), ""]);
    setTags(updatedTags);
  };

  const removeMatch = (tagIndex: number, matchIndex: number) => {
    const updatedTags = [...tags()];
    updatedTags[tagIndex].match.splice(matchIndex, 1);
    setTags(updatedTags);
    validateTags(updatedTags);
  };

  const validateTags = (tags: any) => {
    const tagNames = new Set();
    const allMatches = new Set();
    for (const tag of tags) {
      if (tagNames.has(tag.name)) {
        setTagError(`Tag name "${tag.name}" must be unique.`);
        return false;
      }
      tagNames.add(tag.name);
      const matches = typeof tag.matches === "function" ? tag.matches() : tag.match;
      for (const match of matches) {
        if (allMatches.has(match)) {
          setTagError(`Match "${match}" must be unique across tags.`);
          return false;
        }
        allMatches.add(match);
      }
    }
    setTagError("");
    return true;
  };

  const addIgnorePath = () => {
    setIgnorePaths([...ignorePaths(), ""]);
  };

  const updateIgnorePath = (index: number, value: string) => {
    const updatedPaths = [...ignorePaths()];
    updatedPaths[index] = value;
    setIgnorePaths(updatedPaths);
    validateIgnorePaths(updatedPaths);
  };

  const removeIgnorePath = (index: number) => {
    const updatedPaths = [...ignorePaths()];
    updatedPaths.splice(index, 1);
    setIgnorePaths(updatedPaths);
    validateIgnorePaths(updatedPaths);
  };

  const validateIgnorePaths = (paths: Config["ignore"], t = tags()) => {
        console.log({ tags: t, ignore: paths });
    try {
      ConfigSchema.parse({ tags: t, ignore: paths });
      setPathError("");
      return true;
    } catch (e: any) {
      setPathError(e.errors[0]?.message || "Invalid ignore paths.");
      return false;
    }
  };

  const exportConfig = () => {
    const mapped_tags = tags().map((tag) => ({ name: tag.name, match: tag.matches() }));
    if (!validateTags(mapped_tags) || !validateIgnorePaths(ignorePaths(), mapped_tags)) {
      alert("Please resolve validation errors before exporting.");
      return;
    }
    // remove tags.setMatches & convert tags.matches() to tag.match as string[]
    const config = { tags: mapped_tags, ignore: ignorePaths() };
    console.log("Exported Config:", JSON.stringify(config, null, 2))
  };


  return (
    <div>
      <h2>Todo Scanner Config</h2>

      <div>
        <h3>Tags</h3>
        <Index each={tags()}>
          {(tag, index) => (
            <div>
              <input
                type="text"
                placeholder="Tag Name"
                value={tag().name}
                onInput={(e) => updateTag(index, "name", e.target.value)}
              />
              <For each={tag().matches()}>
  {(match, matchIndex) => (
    <div>
      <input
        type="text"
        placeholder="Match Pattern"
        value={match}
        onChange={(e) =>
          setTags((prev) => {
            const updatedTags = [...prev];
            updatedTags[index].setMatches([
              ...updatedTags[index].matches().slice(0, matchIndex()),
              e.target.value,
              ...updatedTags[index].matches().slice(matchIndex() + 1),
            ]);
            return updatedTags;
          })
        }
      />
      <button onClick={() => removeMatch(index, matchIndex())}>
        Remove Match
      </button>
    </div>
  )}
</For>
              <button onClick={() => addMatch(index)}>Add Match</button>
              <button onClick={() => removeTag(index)}>Remove Tag</button>
            </div>
          )}
        </Index>
        <button onClick={addTag}>Add Tag</button>
        {tagError() && <p style={{ color: "red" }}>{tagError()}</p>}
      </div>

      <div>
        <h3>Ignore Paths</h3>
        <For each={ignorePaths()}>
          {(path, index) => (
            <div>
              <input
                type="text"
                placeholder="Ignore Path"
                value={path}
                onChange={(e) => updateIgnorePath(index(), e.target.value)}
              />
              <button onClick={() => removeIgnorePath(index())}>
                Remove Path
              </button>
            </div>
          )}
        </For>
        <button onClick={addIgnorePath}>Add Ignore Path</button>
        {pathError() && <p style={{ color: "red" }}>{pathError()}</p>}
      </div>

      <button onClick={exportConfig}>Export Config</button>
    </div>
  );
};

export default TodoScannerConfig;

