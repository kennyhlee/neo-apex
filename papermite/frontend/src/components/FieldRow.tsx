import { useEffect, useState } from "react";
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
  defaultVal?: unknown;
  onUpdate: (fieldName: string, value: unknown) => void;
  onRequiredToggle: (fieldName: string, required: boolean) => void;
  onTypeChange: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange: (fieldName: string, options: string[], multiple: boolean) => void;
  onDefaultChange?: (fieldName: string, value: unknown) => void;
  onFieldNameChange?: (
    oldName: string,
    newName: string
  ) => { ok: true } | { ok: false; error: string };
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
  defaultVal,
  onUpdate,
  onRequiredToggle,
  onTypeChange,
  onOptionsChange,
  onDefaultChange,
  onFieldNameChange,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(toEditString(value));
  const [showOptions, setShowOptions] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(fieldName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingDefault, setEditingDefault] = useState(false);
  const [editDefault, setEditDefault] = useState(toEditString(defaultVal));

  useEffect(() => {
    if (nameError === null) return;
    const t = setTimeout(() => setNameError(null), 3000);
    return () => clearTimeout(t);
  }, [nameError]);

  const handleSave = () => {
    onUpdate(fieldName, editValue);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setEditing(false);
  };

  const handleNameSave = () => {
    const trimmed = editName.trim();
    if (trimmed === fieldName) {
      setEditingName(false);
      setEditName(fieldName);
      return;
    }
    if (!onFieldNameChange) {
      setEditingName(false);
      setEditName(fieldName);
      return;
    }
    const result = onFieldNameChange(fieldName, trimmed);
    if (result.ok) {
      setEditingName(false);
    } else {
      setNameError(result.error);
      setEditingName(false);
      setEditName(fieldName);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSave();
    }
    if (e.key === "Escape") {
      setEditingName(false);
      setEditName(fieldName);
    }
  };

  const handleDefaultSave = () => {
    if (!onDefaultChange) {
      setEditingDefault(false);
      setEditDefault(toEditString(defaultVal));
      return;
    }
    const trimmed = editDefault.trim();
    const next = trimmed === "" ? undefined : trimmed;
    onDefaultChange(fieldName, next);
    setEditingDefault(false);
  };

  const handleDefaultKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleDefaultSave();
    }
    if (e.key === "Escape") {
      setEditingDefault(false);
      setEditDefault(toEditString(defaultVal));
    }
  };

  const handleDefaultSelectionSingle = (newValue: string) => {
    if (!onDefaultChange) return;
    onDefaultChange(fieldName, newValue === "" ? undefined : newValue);
  };

  const handleDefaultSelectionMulti = (option: string, checked: boolean) => {
    if (!onDefaultChange) return;
    const current = Array.isArray(defaultVal)
      ? defaultVal.filter((s): s is string => typeof s === "string")
      : [];
    const next = checked
      ? [...current, option]
      : current.filter((s) => s !== option);
    onDefaultChange(fieldName, next.length === 0 ? undefined : next);
  };

  const handleDefaultBool = (checked: boolean) => {
    if (!onDefaultChange) return;
    onDefaultChange(fieldName, checked);
  };

  const displayValue = toEditString(value) || "—";

  const isBase = source === "base_model";

  return (
    <>
      <tr className="field-row">
        <td className="field-row__name">
          {isBase ? (
            <code>{fieldName}</code>
          ) : editingName ? (
            <input
              className="input field-row__input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__name-display"
              onClick={() => {
                setEditName(fieldName);
                setEditingName(true);
              }}
              title="Click to edit"
            >
              {fieldName}
            </span>
          )}
          {nameError && (
            <div className="field-row__name-error" role="alert">
              {nameError}
            </div>
          )}
        </td>
        <td className="field-row__value" data-testid="field-row-value">
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
        <td className="field-row__default" data-testid="field-row-default">
          {fieldType === "selection" && (options?.length ?? 0) > 0 ? (
            multiple ? (
              (() => {
                const selected = Array.isArray(defaultVal)
                  ? defaultVal.filter((s): s is string => typeof s === "string")
                  : [];
                return (options ?? []).map((opt) => (
                  <label key={opt} className="field-row__default-multi-label">
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={(e) => handleDefaultSelectionMulti(opt, e.target.checked)}
                    />
                    {opt}
                  </label>
                ));
              })()
            ) : (
              <select
                className="input field-row__input"
                value={typeof defaultVal === "string" ? defaultVal : ""}
                onChange={(e) => handleDefaultSelectionSingle(e.target.value)}
              >
                <option value="">— none —</option>
                {(options ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )
          ) : fieldType === "bool" ? (
            <input
              type="checkbox"
              checked={Boolean(defaultVal)}
              onChange={(e) => handleDefaultBool(e.target.checked)}
            />
          ) : editingDefault ? (
            <input
              className="input field-row__input"
              value={editDefault}
              onChange={(e) => setEditDefault(e.target.value)}
              onBlur={handleDefaultSave}
              onKeyDown={handleDefaultKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__default-display"
              onClick={() => {
                setEditDefault(toEditString(defaultVal));
                setEditingDefault(true);
              }}
              title="Click to edit default"
            >
              {toEditString(defaultVal) || "—"}
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
          <td colSpan={7}>
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
