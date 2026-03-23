import { useState } from "react";

interface Props {
  onAdd: (fieldName: string, value: string) => void;
}

export default function AddFieldForm({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim(), value);
    setName("");
    setValue("");
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
        style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
      />
      <input
        className="input"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
