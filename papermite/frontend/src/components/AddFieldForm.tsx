import { useState } from "react";

interface Props {
  onAdd: (fieldName: string, value: string, defaultVal?: string) => void;
}

export default function AddFieldForm({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [defaultVal, setDefaultVal] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const trimmedDefault = defaultVal.trim();
    onAdd(name.trim(), value, trimmedDefault === "" ? undefined : trimmedDefault);
    setName("");
    setValue("");
    setDefaultVal("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="btn btn--sm add-field-btn"
        onClick={() => setOpen(true)}
      >
        + Add custom field
      </button>
    );
  }

  return (
    <form className="add-field-form" onSubmit={handleSubmit}>
      <input
        className="input"
        placeholder="field_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        style={{ fontFamily: "var(--font-sans)", fontSize: "14px" }}
      />
      <input
        className="input"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <input
        className="input"
        placeholder="default (optional)"
        value={defaultVal}
        onChange={(e) => setDefaultVal(e.target.value)}
      />
      <button className="btn btn--primary btn--sm" type="submit">
        Add
      </button>
      <button
        className="btn btn--sm"
        type="button"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </form>
  );
}
