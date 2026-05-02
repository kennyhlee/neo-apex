// admindash/frontend/src/components/CsvMappingStep.tsx
import { useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ColumnMapping } from '../types/bulkAdd.ts';
import { SKIP_FIELD } from '../types/bulkAdd.ts';
import { autoMatchColumns, unmappedRequiredFields } from '../utils/csvMapping.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './CsvMappingStep.css';

interface Props {
  headers: string[];
  modelDef: ModelDefinition;
  onApply: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

export default function CsvMappingStep({ headers, modelDef, onApply, onCancel }: Props) {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoMatchColumns(headers, modelDef));

  const allFields: ModelFieldDefinition[] = useMemo(
    () => [...modelDef.base_fields, ...modelDef.custom_fields],
    [modelDef],
  );

  const missing = unmappedRequiredFields(mapping, modelDef);
  const canApply = missing.length === 0;

  const setColumn = (idx: number, value: string) => {
    setMapping((prev) => ({ ...prev, [idx]: value }));
  };

  return (
    <div className="csv-mapping-step">
      <h2>{t('bulkAdd.mapping.title')}</h2>
      <p className="csv-mapping-step__subtitle">{t('bulkAdd.mapping.subtitle')}</p>

      {missing.length > 0 && (
        <div className="csv-mapping-step__error">
          {t('bulkAdd.mapping.missingRequired').replace('{fields}', missing.join(', '))}
        </div>
      )}

      <div className="csv-mapping-step__grid">
        <div className="csv-mapping-step__head">
          <span>{t('bulkAdd.mapping.csvHeader')}</span>
          <span>{t('bulkAdd.mapping.modelField')}</span>
        </div>
        {headers.map((h, i) => (
          <div key={i} className="csv-mapping-step__row">
            <code className="csv-mapping-step__header">{h}</code>
            <select
              value={mapping[i] ?? SKIP_FIELD}
              onChange={(e) => setColumn(i, e.target.value)}
            >
              <option value={SKIP_FIELD}>{t('bulkAdd.mapping.skip')}</option>
              {allFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}{f.required ? ' *' : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="csv-mapping-step__actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          type="button"
          className="csv-mapping-step__apply"
          disabled={!canApply}
          onClick={() => onApply(mapping)}
        >
          {t('bulkAdd.mapping.apply')}
        </button>
      </div>
    </div>
  );
}
