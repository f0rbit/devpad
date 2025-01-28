// SpecificationEditor.jsx
import { createSignal } from "solid-js";

interface Props {
  project_id: string;
  initial: string;
}

const SpecificationEditor = ({ project_id, initial }: Props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [markdown, setMarkdown] = createSignal(initial);
  const [preview, setPreview] = createSignal(false);
  const [error, setError] = createSignal("");

  const fetchSpecification = async () => {
    try {
      const response = await fetch(`/api/fetch_spec?project_id=${project_id}`);
      if (!response.ok) throw new Error("Failed to fetch specification");
      const readme = await response.text();
      setMarkdown(readme);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resetMarkdown = () => {
    setMarkdown(initial);
  };

  return (
    <div>
      <div style={{ "display": "flex", "justify-content": "space-between" }}>
        <button onClick={() => setIsEditing(!isEditing())}>
          {isEditing() ? "Preview" : "Edit"}
        </button>
        <button onClick={fetchSpecification}>Fetch</button>
        <button onClick={resetMarkdown}>Reset</button>
      </div>
      {isEditing() ? (
        <textarea
          value={markdown()}
          onInput={(e) => setMarkdown(e.target.value)}
          rows="10"
          style={{ width: "100%" }}
        />
      ) : (
        <div>
          {error() && <p style={{ color: "red" }}>{error()}</p>}
          <div innerHTML={markdown()} />
        </div>
      )}
    </div>
  );
};

export default SpecificationEditor;

