import type { EntityResult, FieldMapping, FieldType } from "../types/models";
import FieldRow from "./FieldRow";
import AddFieldForm from "./AddFieldForm";
import "./EntityCard.css";

interface Props {
  entity: EntityResult;
  index: number;
  onUpdate: (index: number, entity: EntityResult) => void;
}

const TYPE_COLORS: Record<string, string> = {
  TENANT: "#378ADD",
  PROGRAM: "#639922",
  STUDENT: "#EF9F27",
  FAMILY: "#D4537E",
  CONTACT: "#3B6D11",
  ENROLLMENT: "#993556",
  REGAPP: "#854F0B",
  ATTENDANCE: "#639922",
};

export default function EntityCard({ entity, index, onUpdate }: Props) {
  const color = TYPE_COLORS[entity.entity_type] || "var(--text-secondary)";

  const handleFieldUpdate = (fieldName: string, value: unknown) => {
    const updated = { ...entity };
    updated.entity = { ...updated.entity, [fieldName]: value };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName ? { ...m, value } : m
    );
    onUpdate(index, updated);
  };

  const handleRequiredToggle = (fieldName: string, required: boolean) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName ? { ...m, required } : m
    );
    onUpdate(index, updated);
  };

  const handleTypeChange = (fieldName: string, field_type: FieldType) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName
        ? {
            ...m,
            field_type,
            default: undefined,
            // Reset selection-specific fields when switching away
            ...(field_type !== "selection" ? { options: undefined, multiple: undefined } : {}),
            // Init selection defaults when switching to selection
            ...(field_type === "selection" && !m.options ? { options: [], multiple: false } : {}),
          }
        : m
    );
    onUpdate(index, updated);
  };

  const handleOptionsChange = (fieldName: string, options: string[], multiple: boolean) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) => {
      if (m.field_name !== fieldName) return m;
      const multipleChanged = m.multiple !== multiple;
      return {
        ...m,
        options,
        multiple,
        ...(multipleChanged ? { default: undefined } : {}),
      };
    });
    onUpdate(index, updated);
  };

  const handleDefaultChange = (fieldName: string, value: unknown) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName ? { ...m, default: value } : m
    );
    onUpdate(index, updated);
  };

  const handleFieldNameChange = (
    oldName: string,
    newName: string
  ): { ok: true } | { ok: false; error: string } => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "Name cannot be empty" };
    }
    if (trimmed === oldName) {
      return { ok: true };
    }
    const collision = entity.field_mappings.some(
      (m) => m.field_name !== oldName && m.field_name === trimmed
    );
    if (collision) {
      return {
        ok: false,
        error: `"${trimmed}" is already used by another field`,
      };
    }

    const newMappings = entity.field_mappings.map((m) =>
      m.field_name === oldName ? { ...m, field_name: trimmed } : m
    );

    const newEntity: Record<string, unknown> = { ...entity.entity };
    if (Object.prototype.hasOwnProperty.call(newEntity, oldName)) {
      newEntity[trimmed] = newEntity[oldName];
      delete newEntity[oldName];
    }

    const cf = newEntity.custom_fields;
    if (
      cf &&
      typeof cf === "object" &&
      Object.prototype.hasOwnProperty.call(cf, oldName)
    ) {
      const cfClone = { ...(cf as Record<string, unknown>) };
      cfClone[trimmed] = cfClone[oldName];
      delete cfClone[oldName];
      newEntity.custom_fields = cfClone;
    }

    onUpdate(index, {
      ...entity,
      entity: newEntity,
      field_mappings: newMappings,
    });
    return { ok: true };
  };

  const handleFieldDelete = (fieldName: string) => {
    const updated = { ...entity };
    const newEntity = { ...updated.entity };
    delete newEntity[fieldName];
    if (
      newEntity.custom_fields &&
      typeof newEntity.custom_fields === "object"
    ) {
      const cf = { ...(newEntity.custom_fields as Record<string, unknown>) };
      delete cf[fieldName];
      newEntity.custom_fields = cf;
    }
    updated.entity = newEntity;
    updated.field_mappings = updated.field_mappings.filter(
      (m) => m.field_name !== fieldName
    );
    onUpdate(index, updated);
  };

  const handleAddField = (fieldName: string, value: string, defaultVal?: string) => {
    const updated = { ...entity };
    updated.entity = { ...updated.entity, [fieldName]: value };
    const cf = {
      ...((updated.entity.custom_fields as Record<string, unknown>) || {}),
      [fieldName]: value,
    };
    updated.entity.custom_fields = cf;
    updated.field_mappings = [
      ...updated.field_mappings,
      {
        field_name: fieldName,
        value,
        source: "custom_field" as const,
        required: false,
        field_type: "str" as const,
        ...(defaultVal !== undefined ? { default: defaultVal } : {}),
      },
    ];
    onUpdate(index, updated);
  };

  return (
    <div
      className="entity-card card"
      style={{
        animationDelay: `${index * 60}ms`,
        "--entity-color": color,
      } as React.CSSProperties}
    >
      <div className="entity-card__header">
        <div
          className="entity-card__type-bar"
          style={{ background: color }}
        />
        <span className="entity-card__type">{entity.entity_type}</span>
        <span className="entity-card__count">
          {entity.field_mappings.length} fields
        </span>
      </div>
      <div className="entity-card__body">
        <table className="entity-card__table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Default</th>
              <th>Data Type</th>
              <th>Source</th>
              <th>Required</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...entity.field_mappings].sort((a, b) => {
              if (a.source === b.source) return 0;
              return a.source === "base_model" ? -1 : 1;
            }).map((mapping: FieldMapping) => (
              <FieldRow
                key={mapping.field_name}
                fieldName={mapping.field_name}
                value={mapping.value}
                source={mapping.source}
                required={mapping.required}
                fieldType={mapping.field_type}
                options={mapping.options}
                multiple={mapping.multiple}
                defaultVal={mapping.default}
                onUpdate={handleFieldUpdate}
                onRequiredToggle={handleRequiredToggle}
                onTypeChange={handleTypeChange}
                onOptionsChange={handleOptionsChange}
                onDefaultChange={handleDefaultChange}
                onFieldNameChange={
                  mapping.source === "custom_field"
                    ? handleFieldNameChange
                    : undefined
                }
                onDelete={
                  mapping.source === "custom_field"
                    ? () => handleFieldDelete(mapping.field_name)
                    : undefined
                }
              />
            ))}
          </tbody>
        </table>
        <div className="entity-card__footer">
          <AddFieldForm onAdd={handleAddField} />
        </div>
      </div>
    </div>
  );
}
