// admindash/frontend/src/pages/BulkAddStudentsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModel } from '../contexts/ModelContext.tsx';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { Phase, BulkRow, BatchMode, ColumnMapping, CsvParseResult } from '../types/bulkAdd.ts';
import { newBatchId, newRowId } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import BulkModeSelector from '../components/BulkModeSelector.tsx';
import BulkDocumentDropzone from '../components/BulkDocumentDropzone.tsx';
import BulkCsvDropzone from '../components/BulkCsvDropzone.tsx';
import CsvMappingStep from '../components/CsvMappingStep.tsx';
import ExtractionProgressBar from '../components/ExtractionProgressBar.tsx';
import BulkReviewTable from '../components/BulkReviewTable.tsx';
import BulkRowDrawer from '../components/BulkRowDrawer.tsx';
import ResumeBatchPrompt from '../components/ResumeBatchPrompt.tsx';
import { applyMapping } from '../utils/csvMapping.ts';
import { extractStudentBatch } from '../api/bulkAddOrchestrators.ts';
import { saveDraft, deleteDraft, findActiveDraftsForTenant, buildDraftId } from '../db/bulkAddDrafts.ts';
import type { BatchDraft } from '../types/bulkAdd.ts';
import './BulkAddStudentsPage.css';

interface BulkAddStudentsPageProps {
  tenant: string;
}

export default function BulkAddStudentsPage({ tenant }: BulkAddStudentsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getModel } = useModel();

  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('mode_select');
  const [mode, setMode] = useState<BatchMode | null>(null);
  const [batchId] = useState<string>(() => newBatchId());
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
  const [csvParsed, setCsvParsed] = useState<CsvParseResult | null>(null);
  const [activeDrawerIndex, setActiveDrawerIndex] = useState<number | null>(null);
  const [resumeDrafts, setResumeDrafts] = useState<BatchDraft[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModel(tenant, 'student')
      .then((def) => { if (!cancelled) setModelDef(def); })
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [tenant, getModel]);

  // Task 8.1: Debounced persistence to IndexedDB once review phase begins.
  useEffect(() => {
    // Skip persistence before review phase.
    if (phase !== 'review' && phase !== 'submitting' && phase !== 'post_submit') return;
    if (mode == null) return;

    const handle = window.setTimeout(() => {
      const draft: BatchDraft = {
        id: buildDraftId(tenant, batchId),
        tenantId: tenant,
        batchId,
        mode,
        rows: rows.map((r) => ({
          ...r,
          // Files cannot be persisted; strip the File handle.
          file: undefined,
        })),
        columnMapping: columnMapping ?? undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      void saveDraft(draft);
    }, 500);

    return () => window.clearTimeout(handle);
  }, [phase, mode, rows, columnMapping, tenant, batchId]);

  // Task 8.3: Load active drafts for resume prompt on mount.
  useEffect(() => {
    let cancelled = false;
    findActiveDraftsForTenant(tenant)
      .then((drafts) => {
        if (!cancelled && drafts.length > 0) setResumeDrafts(drafts);
      })
      .catch(() => { /* IndexedDB unavailable — ignore */ });
    return () => { cancelled = true; };
  }, [tenant]);

  // Task 8.4: Beforeunload warning during ephemeral phases.
  useEffect(() => {
    const ephemeral = phase === 'uploading' || phase === 'extracting';
    if (!ephemeral) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  const updateRow = (rowId: string, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  const startDocumentExtraction = async (files: File[]) => {
    const seeded: BulkRow[] = files.map((f) => ({
      id: newRowId(),
      source: f.name,
      file: f,
      values: {},
      status: 'extracting',
    }));
    setRows(seeded);
    setPhase('extracting');

    const items = seeded.map((r) => ({ rowId: r.id, file: r.file as File }));
    await extractStudentBatch({
      tenantId: tenant,
      files: items,
      onRowResult: (rowId, result) => {
        if (result.error) {
          updateRow(rowId, { status: 'extract_failed', error: result.error });
        } else if (result.fields) {
          updateRow(rowId, { status: 'ready', values: { ...result.fields } });
        }
      },
    });

    setPhase('review');
  };

  const retryExtract = async (rowId: string) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !row.file) return;
    updateRow(rowId, { status: 'extracting', error: undefined });
    await extractStudentBatch({
      tenantId: tenant,
      files: [{ rowId, file: row.file }],
      onRowResult: (id, result) => {
        if (result.error) {
          updateRow(id, { status: 'extract_failed', error: result.error });
        } else if (result.fields) {
          updateRow(id, { status: 'ready', values: { ...result.fields } });
        }
      },
    });
  };

  // Task 8.3: Rebuild rows against the current model on resume (drops orphaned values).
  function rebuildRowsForCurrentModel(draftRows: BulkRow[], def: ModelDefinition): BulkRow[] {
    const allFieldNames = new Set([
      ...def.base_fields.map((f) => f.name),
      ...def.custom_fields.map((f) => f.name),
    ]);
    return draftRows.map((r) => {
      const filteredValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.values)) {
        if (allFieldNames.has(k)) filteredValues[k] = v;
      }
      return {
        ...r,
        values: filteredValues,
        file: undefined,
        status: r.status === 'extracting' || r.status === 'creating' ? 'ready' : r.status,
      };
    });
  }

  if (modelError != null) {
    return (
      <div className="bulk-add-page bulk-add-page--error">
        <h1>{t('bulkAdd.title')}</h1>
        <div className="bulk-add-page__no-model">
          <p>{t('bulkAdd.noModelConfigured')}</p>
          <button
            className="bulk-add-page__btn-primary"
            onClick={() => navigate('/students')}
          >
            {t('bulkAdd.backToStudents')}
          </button>
        </div>
      </div>
    );
  }

  if (modelDef == null) {
    return (
      <div className="bulk-add-page">
        <h1>{t('bulkAdd.title')}</h1>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="bulk-add-page">
      <header className="bulk-add-page__header">
        <h1>{t('bulkAdd.title')}</h1>
        <button
          className="bulk-add-page__btn-secondary"
          onClick={() => navigate('/students')}
        >
          {t('common.cancel')}
        </button>
      </header>

      {resumeDrafts && (
        <ResumeBatchPrompt
          drafts={resumeDrafts}
          onCancel={() => setResumeDrafts(null)}
          onResume={(draft) => {
            setRows(rebuildRowsForCurrentModel(draft.rows, modelDef));
            setMode(draft.mode);
            setColumnMapping(draft.columnMapping ?? null);
            setPhase('review');
            setResumeDrafts(null);
          }}
          onDiscardOne={(draft) => {
            void deleteDraft(draft.id);
            setResumeDrafts((prev) => prev?.filter((d) => d.id !== draft.id) ?? null);
          }}
          onDiscardAll={() => {
            const ids = resumeDrafts.map((d) => d.id);
            void Promise.all(ids.map((id) => deleteDraft(id)));
            setResumeDrafts(null);
          }}
        />
      )}

      {phase === 'mode_select' && (
        <BulkModeSelector
          onPick={(picked) => {
            setMode(picked);
            setPhase('uploading');
          }}
        />
      )}

      {phase === 'uploading' && mode === 'documents' && (
        <BulkDocumentDropzone
          onSelect={(files) => { void startDocumentExtraction(files); }}
          onCancel={() => {
            setPhase('mode_select');
            setMode(null);
          }}
        />
      )}

      {phase === 'extracting' && (
        <ExtractionProgressBar
          total={rows.length}
          done={rows.filter((r) => r.status === 'ready' || r.status === 'extract_failed').length}
          failed={rows.filter((r) => r.status === 'extract_failed').length}
        />
      )}

      {(phase === 'extracting' || phase === 'review') && rows.length > 0 && (
        <BulkReviewTable
          rows={rows}
          modelDef={modelDef}
          onEditRow={(rowId) => {
            const idx = rows.findIndex((r) => r.id === rowId);
            if (idx >= 0) setActiveDrawerIndex(idx);
          }}
          onDeleteRow={(rowId) => {
            const deletedIdx = rows.findIndex((r) => r.id === rowId);
            setRows((prev) => prev.filter((r) => r.id !== rowId));
            if (activeDrawerIndex != null && deletedIdx >= 0) {
              if (deletedIdx === activeDrawerIndex) {
                setActiveDrawerIndex(null);
              } else if (deletedIdx < activeDrawerIndex) {
                setActiveDrawerIndex(activeDrawerIndex - 1);
              }
            }
          }}
          onRetryExtract={(rowId) => { void retryExtract(rowId); }}
        />
      )}

      {activeDrawerIndex != null && rows[activeDrawerIndex] && (
        <BulkRowDrawer
          rows={rows}
          activeRowIndex={activeDrawerIndex}
          modelDef={modelDef}
          onSaveRow={(rowId, baseData, customFields) => {
            const merged = { ...baseData, ...customFields };
            updateRow(rowId, { values: merged, status: 'ready', error: undefined });
          }}
          onClose={() => setActiveDrawerIndex(null)}
          onNavigate={(newIndex) => setActiveDrawerIndex(newIndex)}
        />
      )}

      {phase === 'uploading' && mode === 'csv' && (
        <BulkCsvDropzone
          onParsed={(parsed) => {
            setCsvParsed(parsed);
            setPhase('mapping');
          }}
          onCancel={() => {
            setPhase('mode_select');
            setMode(null);
          }}
        />
      )}

      {phase === 'mapping' && mode === 'csv' && csvParsed && (
        <CsvMappingStep
          headers={csvParsed.headers}
          modelDef={modelDef}
          onApply={(mapping) => {
            const mappedRows = applyMapping(csvParsed.rows, csvParsed.headers, mapping, modelDef);
            const newRows: BulkRow[] = mappedRows.map((values, i) => ({
              id: newRowId(),
              source: `CSV row ${i + 2}`, // +2: header is row 1, first data row is row 2
              values,
              status: 'ready',
            }));
            setRows(newRows);
            setColumnMapping(mapping);
            setPhase('review');
          }}
          onCancel={() => {
            setCsvParsed(null);
            setPhase('uploading');
          }}
        />
      )}

      {/* batchId, columnMapping referenced by later phases */}
      <div hidden>
        {String(batchId)} {String(columnMapping)}
      </div>
    </div>
  );
}
