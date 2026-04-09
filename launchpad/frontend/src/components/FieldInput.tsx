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
        // Multi-select: checkboxes
        // Legacy handling: string value → treat as single-element array
        const selected = Array.isArray(value)
          ? value as string[]
          : (typeof value === "string" && value ? [value] : []);
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(field.options || []).map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter(s => s !== opt);
                    onChange(next);
                  }}
                  disabled={readOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      {
        // Single-select: radio buttons
        // Legacy handling: array value → use first element
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : "")
          : strVal;
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(field.options || []).map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                <input
                  type="radio"
                  name={field.name}
                  value={opt}
                  checked={radioValue === opt}
                  onChange={() => onChange(opt)}
                  disabled={readOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
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
