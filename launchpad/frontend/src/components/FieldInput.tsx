import type { FieldDefinition } from "../types/models";

interface Props {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}

export default function FieldInput({ field, value, onChange, readOnly }: Props) {
  const strVal = value != null ? String(value) : "";

  switch (field.type) {
    case "bool":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} disabled={readOnly} />
          {field.name.replace(/_/g, " ")}
        </label>
      );
    case "selection":
      if (field.multiple) {
        const selected = Array.isArray(value) ? value as string[] : [];
        return (
          <select multiple value={selected} onChange={e => {
            const opts = Array.from(e.target.selectedOptions, o => o.value);
            onChange(opts);
          }} disabled={readOnly} className="auth-input" style={{ minHeight: 80 }}>
            {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }
      return (
        <select value={strVal} onChange={e => onChange(e.target.value)} disabled={readOnly} className="auth-input">
          <option value="">Select...</option>
          {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "number":
      return <input type="number" value={strVal} onChange={e => onChange(e.target.value ? Number(e.target.value) : "")} readOnly={readOnly} className="auth-input" />;
    case "date":
    case "datetime":
      return <input type={field.type === "datetime" ? "datetime-local" : "date"} value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" />;
    case "email":
      return <input type="email" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name.replace(/_/g, " ")}`} />;
    case "phone":
      return <input type="tel" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name.replace(/_/g, " ")}`} />;
    default:
      return <input type="text" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name.replace(/_/g, " ")}`} />;
  }
}
