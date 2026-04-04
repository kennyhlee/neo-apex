import { useState, useEffect } from "react";
import type { EntityModelDefinition, FieldDefinition } from "../types/models";
import FieldInput from "./FieldInput";

interface Props {
  model: EntityModelDefinition;
  initialData: Record<string, unknown>;
  readOnly?: boolean;
  immutableFields?: string[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
}

export default function DynamicEntityForm({ model, initialData, readOnly, immutableFields = [], onSave }: Props) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setData(initialData); }, [initialData]);

  const allFields: FieldDefinition[] = [...(model.base_fields || []), ...(model.custom_fields || [])];

  const handleChange = (fieldName: string, value: unknown) => {
    setData(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try { await onSave(data); } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {allFields.map(field => (
        <div key={field.name} className="auth-field">
          <label className="auth-label">
            {field.name.replace(/_/g, " ")}
            {field.required && <span style={{ color: "var(--danger)" }}> *</span>}
          </label>
          {immutableFields.includes(field.name) ? (
            <div style={{ padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", fontSize: 15 }}>
              {String(data[field.name] || "")}
            </div>
          ) : (
            <FieldInput field={field} value={data[field.name]} onChange={val => handleChange(field.name, val)} readOnly={readOnly} />
          )}
        </div>
      ))}
      {error && <div className="auth-error">{error}</div>}
      {!readOnly && (
        <button type="submit" className="auth-submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      )}
    </form>
  );
}
