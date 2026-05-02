// admindash/frontend/src/utils/csvMapping.ts
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import type { ColumnMapping } from '../types/bulkAdd.ts';
import { SKIP_FIELD } from '../types/bulkAdd.ts';

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function autoMatchColumns(headers: string[], modelDef: ModelDefinition): ColumnMapping {
  const allFields: ModelFieldDefinition[] = [
    ...modelDef.base_fields,
    ...modelDef.custom_fields,
  ];
  const fieldByNorm = new Map<string, string>();
  for (const f of allFields) fieldByNorm.set(normalize(f.name), f.name);

  const mapping: ColumnMapping = {};
  for (let i = 0; i < headers.length; i++) {
    const norm = normalize(headers[i]);
    const matched = fieldByNorm.get(norm);
    mapping[i] = matched ?? SKIP_FIELD;
  }
  return mapping;
}

export function unmappedRequiredFields(mapping: ColumnMapping, modelDef: ModelDefinition): string[] {
  const mappedNames = new Set(Object.values(mapping).filter((n) => n !== SKIP_FIELD));
  return modelDef.base_fields
    .filter((f) => f.required && !mappedNames.has(f.name))
    .map((f) => f.name);
}

export function applyMapping(
  rows: Record<string, string>[],
  headers: string[],
  mapping: ColumnMapping,
  modelDef: ModelDefinition,
): Record<string, unknown>[] {
  const fieldDefByName = new Map<string, ModelFieldDefinition>();
  for (const f of [...modelDef.base_fields, ...modelDef.custom_fields]) {
    fieldDefByName.set(f.name, f);
  }

  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const target = mapping[i];
      if (target == null || target === SKIP_FIELD) continue;
      const raw = row[headers[i]] ?? '';
      const def = fieldDefByName.get(target);
      if (def?.type === 'selection' && def.multiple) {
        out[target] = raw
          .split(';')
          .map((t) => t.trim())
          .filter((t) => t !== '');
      } else {
        out[target] = raw;
      }
    }
    return out;
  });
}
