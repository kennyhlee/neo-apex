import { useState } from "react";
import { FIELD_TYPES } from "../types/models";
import type { FieldType } from "../types/models";

interface Props {
  fieldName: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  fieldType: FieldType;
  options?: string[];
  multiple?: boolean;
  onUpdate: (fieldName: string, value: unknown) => void;
  onRequiredToggle: (fieldName: string, required: boolean) => void;
  onTypeChange: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange: (fieldName: string, options: string[], multiple: boolean) => void;
  onDelete?: () => void;
}

function toEditString(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function OptionsEditor({
  options,
  multiple,
  onChange,
}: {
  options: string[];
  multiple: boolean;
  onChange: (options: string[], multiple: boolean) => void;
}) {
  const [newOption, setNewOption] = useState("");

  const handleAdd = () => {
    const trimmed = newOption.trim();
    if (trimmed && !options.includes(trimmed)) {
      onChange([...options, trimmed], multiple);
      setNewOption("");
    }
  };

  const handleRemove = (opt: string) => {
    onChange(options.filter((o) => o !== opt), multiple);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="options-editor">
      <div className="options-editor__header">
        <label className="options-editor__multiple">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => onChange(options, e.target.checked)}
          />
          <span>Allow multiple</span>
        </label>
      </div>
      {options.length > 0 && (
        <div className="options-editor__list">
          {options.map((opt) => (
            <span key={opt} className="options-editor__tag">
              {opt}
              <button
                className="options-editor__tag-remove"
                onClick={() => handleRemove(opt)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="options-editor__add">
        <input
          className="input options-editor__input"
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add option..."
        />
        <button className="btn btn--sm" onClick={handleAdd} disabled={!newOption.trim()}>
          +
        </button>
      </div>
    </div>
  );
}

export default function FieldRow({
  fieldName,
  value,
  source,
  required,
  fieldType,
  options,
  multiple,
  onUpdate,
  onRequiredToggle,
  onTypeChange,
  onOptionsChange,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(toEditString(value));
  const [showOptions, setShowOptions] = useState(false);

  const handleSave = () => {
    onUpdate(fieldName, editValue);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
  };

  const displayValue = toEditString(value) || "—";

  const isBase = source === "base_model";

  return (
    <>
      <tr className="field-row">
        <td className="field-row__name">
          <code>{fieldName}</code>
        </td>
        <td className="field-row__value">
          {fieldType === "selection" && (options?.length ?? 0) > 0 ? (
            multiple ? (
              (() => {
                const selected = Array.isArray(value)
                  ? value.filter((s): s is string => typeof s === "string")
                  : typeof value === "string" && value !== ""
                    ? [value]
                    : [];
                return (
                  <div className="field-row__multi-edit">
                    {(options ?? []).map((opt) => (
                      <label key={opt} className="field-row__multi-edit-label">
                        <input
                          type="checkbox"
                          checked={selected.includes(opt)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selected, opt]
                              : selected.filter((s) => s !== opt);
                            onUpdate(fieldName, next);
                          }}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                );
              })()
            ) : (
              (() => {
                const currentValue =
                  typeof value === "string"
                    ? value
                    : Array.isArray(value) && typeof value[0] === "string"
                      ? value[0]
                      : "";
                return (
                  <select
                    className="input field-row__input"
                    value={currentValue}
                    onChange={(e) => onUpdate(fieldName, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {(options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                );
              })()
            )
          ) : editing ? (
            <input
              className="input field-row__input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__display"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {displayValue}
            </span>
          )}
        </td>
        <td className="field-row__data-type">
          <div className="field-row__type-wrapper">
            {isBase ? (
              <span className="field-row__type-locked">{fieldType}</span>
            ) : (
              <select
                className="field-row__type-select"
                value={fieldType}
                onChange={(e) => onTypeChange(fieldName, e.target.value as FieldType)}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            {fieldType === "selection" && (
              <button
                className="btn btn--sm field-row__options-btn"
                onClick={() => setShowOptions(!showOptions)}
                title="Edit options"
              >
                {options?.length ?? 0} opts
              </button>
            )}
          </div>
        </td>
        <td className="field-row__type">
          <span className={`badge ${isBase ? "badge--base" : "badge--custom"}`}>
            {isBase ? "base" : "custom"}
          </span>
        </td>
        <td className="field-row__required">
          <label className={`field-row__toggle ${isBase ? "field-row__toggle--locked" : ""}`} title={isBase ? "Base fields are always required" : required ? "Required" : "Optional"}>
            <input
              type="checkbox"
              checked={required}
              disabled={isBase}
              onChange={(e) => onRequiredToggle(fieldName, e.target.checked)}
            />
            <span className="field-row__toggle-track">
              <span className="field-row__toggle-thumb" />
            </span>
          </label>
        </td>
        <td className="field-row__actions">
          {!isBase && onDelete && (
            <button
              className="btn btn--danger btn--sm"
              onClick={onDelete}
              title="Remove field"
            >
              &times;
            </button>
          )}
        </td>
      </tr>
      {showOptions && fieldType === "selection" && (
        <tr className="field-row__options-row">
          <td colSpan={6}>
            <OptionsEditor
              options={options ?? []}
              multiple={multiple ?? false}
              onChange={(opts, mult) => onOptionsChange(fieldName, opts, mult)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
