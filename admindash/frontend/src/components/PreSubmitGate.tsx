// admindash/frontend/src/components/PreSubmitGate.tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { DuplicateMatch, ModelDefinition } from '../types/models.ts';
import { validateRowAgainstModel } from '../utils/validateField.ts';
import {
  bulkCheckDuplicates,
  type DupCheckOutcome,
} from '../api/bulkAddOrchestrators.ts';
import './PreSubmitGate.css';

export type DuplicateChoice = 'skip' | 'save_anyway';

export interface GateConfirmation {
  rowIdsToCreate: string[];
  duplicateChoices: Record<string, DuplicateChoice>;
}

interface Props {
  rows: BulkRow[];
  modelDef: ModelDefinition;
  tenantId: string;
  onCancel: () => void;
  onConfirm: (c: GateConfirmation) => void;
  onCancelAndEdit: (rowId: string) => void;
}

interface RowBuckets {
  ready: BulkRow[];
  missing: { row: BulkRow; errors: Record<string, string> }[];
  duplicates: { row: BulkRow; matches: DuplicateMatch[] }[];
  skipped: { row: BulkRow; missingFields: string[] }[];
  failed: { row: BulkRow; error: string }[];
}

export default function PreSubmitGate({
  rows, modelDef, tenantId, onCancel, onConfirm, onCancelAndEdit,
}: Props) {
  const { t } = useTranslation();
  const [outcomes, setOutcomes] = useState<DupCheckOutcome[] | null>(null);
  const [duplicateChoices, setDuplicateChoices] = useState<Record<string, DuplicateChoice>>({});

  const validationBuckets = useMemo(() => {
    const ready: BulkRow[] = [];
    const missing: { row: BulkRow; errors: Record<string, string> }[] = [];
    for (const r of rows) {
      const errs = validateRowAgainstModel(r.values, modelDef);
      if (Object.keys(errs).length > 0) missing.push({ row: r, errors: errs });
      else ready.push(r);
    }
    return { ready, missing };
  }, [rows, modelDef]);

  useEffect(() => {
    let cancelled = false;
    void bulkCheckDuplicates({ tenantId, rows: validationBuckets.ready })
      .then((res) => { if (!cancelled) setOutcomes(res); });
    return () => { cancelled = true; };
  }, [tenantId, validationBuckets.ready]);

  const buckets: RowBuckets | null = useMemo(() => {
    if (outcomes == null) return null;
    const byRowId = new Map(outcomes.map((o) => [o.rowId, o]));
    const ready: BulkRow[] = [];
    const duplicates: { row: BulkRow; matches: DuplicateMatch[] }[] = [];
    const skipped: { row: BulkRow; missingFields: string[] }[] = [];
    const failed: { row: BulkRow; error: string }[] = [];
    for (const row of validationBuckets.ready) {
      const out = byRowId.get(row.id);
      if (!out) { ready.push(row); continue; }
      switch (out.kind) {
        case 'eligible_clean': ready.push(row); break;
        case 'eligible_match': duplicates.push({ row, matches: out.matches }); break;
        case 'skipped':
          // Row is created by default; the 'skipped' bucket is informational
          // (missing dup-check fields means we couldn't run the duplicate check,
          // not that the row failed validation).
          ready.push(row);
          skipped.push({ row, missingFields: out.missingFields });
          break;
        case 'failed': failed.push({ row, error: out.error }); break;
      }
    }
    return { ready, missing: validationBuckets.missing, duplicates, skipped, failed };
  }, [outcomes, validationBuckets]);

  const rowIdsToCreate = useMemo(() => {
    if (buckets == null) return [];
    const out = new Set<string>(buckets.ready.map((r) => r.id));
    for (const d of buckets.duplicates) {
      const choice = duplicateChoices[d.row.id] ?? 'skip';
      if (choice === 'save_anyway') out.add(d.row.id);
    }
    return [...out];
  }, [buckets, duplicateChoices]);

  if (buckets == null) {
    return (
      <div className="pre-submit-gate-overlay">
        <div className="pre-submit-gate"><p>{t('bulkAdd.gate.checking')}</p></div>
      </div>
    );
  }

  return (
    <div className="pre-submit-gate-overlay">
      <div className="pre-submit-gate">
        <header>
          <h2>{t('bulkAdd.gate.title')}</h2>
          <button onClick={onCancel} className="pre-submit-gate__close" aria-label={t('common.close')}>&times;</button>
        </header>

        <Section
          label={t('bulkAdd.gate.ready')}
          count={buckets.ready.length}
          tone="ready"
        />
        <Section
          label={t('bulkAdd.gate.missing')}
          count={buckets.missing.length}
          tone="warn"
          renderBody={() => (
            <ul>
              {buckets.missing.map(({ row, errors }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {Object.keys(errors).join(', ')}
                  <button onClick={() => onCancelAndEdit(row.id)}>{t('bulkAdd.gate.edit')}</button>
                </li>
              ))}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.duplicates')}
          count={buckets.duplicates.length}
          tone="warn"
          renderBody={() => (
            <ul>
              {buckets.duplicates.map(({ row, matches }) => {
                const choice = duplicateChoices[row.id] ?? 'skip';
                return (
                  <li key={row.id}>
                    <div>
                      <strong>{String(row.values.first_name ?? '')} {String(row.values.last_name ?? '')}</strong>
                      {' — matches '}{matches.length}{' existing'}
                    </div>
                    <div className="pre-submit-gate__choices">
                      <label>
                        <input
                          type="radio"
                          checked={choice === 'skip'}
                          onChange={() => setDuplicateChoices((p) => ({ ...p, [row.id]: 'skip' }))}
                        /> {t('bulkAdd.gate.choiceSkip')}
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={choice === 'save_anyway'}
                          onChange={() => setDuplicateChoices((p) => ({ ...p, [row.id]: 'save_anyway' }))}
                        /> {t('bulkAdd.gate.choiceSaveAnyway')}
                      </label>
                      <button onClick={() => onCancelAndEdit(row.id)}>{t('bulkAdd.gate.choiceEdit')}</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.skipped')}
          count={buckets.skipped.length}
          tone="info"
          renderBody={() => (
            <ul>
              {buckets.skipped.map(({ row, missingFields }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {t('bulkAdd.gate.skippedFields')} {missingFields.join(', ')}
                </li>
              ))}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.failed')}
          count={buckets.failed.length}
          tone="error"
          renderBody={() => (
            <ul>
              {buckets.failed.map(({ row, error }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {error}
                </li>
              ))}
            </ul>
          )}
        />

        <footer className="pre-submit-gate__footer">
          <p>{t('bulkAdd.gate.willCreate').replace('{n}', String(rowIdsToCreate.length))}</p>
          <div>
            <button onClick={onCancel}>{t('common.cancel')}</button>
            <button
              className="pre-submit-gate__confirm"
              disabled={rowIdsToCreate.length === 0}
              onClick={() => onConfirm({ rowIdsToCreate, duplicateChoices })}
            >
              {t('bulkAdd.gate.confirm')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({
  label, count, tone, renderBody,
}: {
  label: string; count: number; tone: 'ready' | 'warn' | 'error' | 'info';
  renderBody?: () => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={`pre-submit-gate__section pre-submit-gate__section--${tone}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        {label} <span className="pre-submit-gate__count">({count})</span>
      </summary>
      {renderBody && count > 0 && <div className="pre-submit-gate__body">{renderBody()}</div>}
    </details>
  );
}
