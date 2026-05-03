// admindash/frontend/src/pages/BulkAddStudentsPage.tsx
import { useEffect, useRef, useState } from 'react';
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
import { extractStudentBatch, bulkCreateStudents } from '../api/bulkAddOrchestrators.ts';
import { saveDraft, deleteDraft, findActiveDraftsForTenant, buildDraftId } from '../db/bulkAddDrafts.ts';
import PreSubmitGate, { type GateConfirmation } from '../components/PreSubmitGate.tsx';
import PostSubmitSummary from '../components/PostSubmitSummary.tsx';
import CreatedStudentsDisclosure from '../components/CreatedStudentsDisclosure.tsx';
import type { BatchDraft } from '../types/bulkAdd.ts';
import './BulkAddStudentsPage.css';

interface BulkAddStudentsPageProps {
  tenant: string;
}

export default function BulkAddStudentsPage({ tenant }: BulkAddStudentsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getModel } = useModel();

  const createdAtRef = useRef<string | null>(null);

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
  const [gateOpen, setGateOpen] = useState(false);

  const successRows = rows.filter((r) => r.status === 'created');
  const failedRows = rows.filter((r) => r.status === 'failed');
  const allDone = phase === 'post_submit' && failedRows.length === 0;
  const drawerRows = phase === 'post_submit' ? failedRows : rows;

  const handleRetryFailed = () => {
    // Re-route through the gate against just the failed rows.
    const failedIds = failedRows.map((r) => r.id);
    setRows((prev) =>
      prev.map((r) => (failedIds.includes(r.id) ? { ...r, status: 'pending', error: undefined } : r)),
    );
    setPhase('review');
    setGateOpen(true);
  };

  const handleDone = () => {
    if (allDone) {
      void deleteDraft(buildDraftId(tenant, batchId));
    }
    navigate('/students');
  };

  useEffect(() => {
    let cancelled = false;
    getModel(tenant, 'student')
      .then((def) => { if (!cancelled) setModelDef(def); })
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [tenant, getModel]);

  // Task 8.1 + Bug fix: Persist to IndexedDB during review/submitting/post_submit.
  // When ALL rows are 'created' (a fully-successful batch), instead of saving,
  // actively delete any existing draft so the resume prompt does not surface
  // a finished batch on next page load.
  useEffect(() => {
    if (phase !== 'review' && phase !== 'submitting' && phase !== 'post_submit') return;
    if (mode == null) return;

    const allCreated =
      phase === 'post_submit' &&
      rows.length > 0 &&
      rows.every((r) => r.status === 'created');

    if (allCreated) {
      void deleteDraft(buildDraftId(tenant, batchId));
      return;
    }

    const handle = window.setTimeout(() => {
      if (createdAtRef.current == null) {
        createdAtRef.current = new Date().toISOString();
      }
      const createdAt = createdAtRef.current;
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
        createdAt,
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

  const handleCreateAll = () => {
    if (rows.length === 0) return;
    setGateOpen(true);
  };

  const submitFromGate = async (c: GateConfirmation) => {
    setGateOpen(false);
    setPhase('submitting');

    const creating = c.rowIdsToCreate;
    setRows((prev) =>
      prev.map((r) => (creating.includes(r.id) ? { ...r, status: 'creating' } : r)),
    );

    // Build payloads — strip empty student_id (matches AddStudentModal:89 behavior).
    const baseFieldNames = new Set(modelDef!.base_fields.map((f) => f.name));
    const customFieldNames = new Set(modelDef!.custom_fields.map((f) => f.name));
    const payloads = creating
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is BulkRow => r != null)
      .map((r) => {
        const baseData: Record<string, unknown> = {};
        const customFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r.values)) {
          if (k === 'student_id') {
            // Documents mode: always strip — backend auto-assigns the next ID.
            // The LLM may extract a junk value (e.g., a reference number from the
            // application form) into student_id which would otherwise be used as
            // the literal value. Matches AddStudentModal.tsx:89's behavior.
            if (mode === 'documents') continue;
            // CSV mode: respect explicit student_id from the CSV; skip empty.
            if (v == null || String(v).trim() === '') continue;
          }
          if (baseFieldNames.has(k)) baseData[k] = v;
          else if (customFieldNames.has(k)) customFields[k] = v;
        }
        return { rowId: r.id, baseData, customFields };
      });

    await bulkCreateStudents({
      tenantId: tenant,
      payloads,
      onRowResult: (rowId, outcome) => {
        if (outcome.kind === 'created') {
          updateRow(rowId, {
            status: 'created',
            assignedStudentId: outcome.assignedStudentId,
            error: undefined,
          });
        } else {
          updateRow(rowId, {
            status: 'failed',
            error: { source: 'create', message: outcome.error },
          });
        }
      },
    });

    setPhase('post_submit');
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
      <h1>{t('bulkAdd.title')}</h1>

      {resumeDrafts && (
        <ResumeBatchPrompt
          drafts={resumeDrafts}
          onCancel={() => setResumeDrafts(null)}
          onResume={(draft) => {
            createdAtRef.current = draft.createdAt;
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
            setResumeDrafts((prev) => {
              if (prev) {
                void Promise.all(prev.map((d) => deleteDraft(d.id)));
              }
              return null;
            });
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

      <div className="bulk-add-page__toolbar">
        {phase === 'review' && (
          <button
            className="bulk-add-page__btn-primary"
            disabled={rows.length === 0}
            title={rows.length === 0 ? t('bulkAdd.toolbar.noRows') : undefined}
            onClick={handleCreateAll}
          >
            {t('bulkAdd.toolbar.createAll').replace('{n}', String(rows.length))}
          </button>
        )}

        <div className="bulk-add-page__toolbar-spacer" />

        {(phase === 'mode_select' || phase === 'uploading' || phase === 'extracting') && (
          <button
            className="bulk-add-page__btn-secondary"
            onClick={() => navigate('/students')}
          >
            {t('common.cancel')}
          </button>
        )}
        {(phase === 'review' || phase === 'post_submit') && (
          <button
            className="bulk-add-page__btn-secondary"
            onClick={() => {
              if (window.confirm(t('bulkAdd.discardConfirm'))) {
                void deleteDraft(buildDraftId(tenant, batchId));
                navigate('/students');
              }
            }}
          >
            {t('bulkAdd.discardBatch')}
          </button>
        )}
        {phase === 'submitting' && (
          <button className="bulk-add-page__btn-secondary" disabled>
            {t('bulkAdd.submittingDisabled')}
          </button>
        )}
      </div>

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

      {phase === 'post_submit' && (
        <>
          <PostSubmitSummary
            successCount={successRows.length}
            failedCount={failedRows.length}
            onRetryFailed={handleRetryFailed}
            onDone={handleDone}
          />
          {failedRows.length > 0 && (
            <BulkReviewTable
              rows={failedRows}
              modelDef={modelDef}
              onEditRow={(rowId) => {
                const idx = failedRows.findIndex((r) => r.id === rowId);
                if (idx >= 0) setActiveDrawerIndex(idx);
              }}
              onDeleteRow={(rowId) => {
                const deletedIdx = failedRows.findIndex((r) => r.id === rowId);
                setRows((prev) => prev.filter((r) => r.id !== rowId));
                if (activeDrawerIndex != null && deletedIdx >= 0) {
                  if (deletedIdx === activeDrawerIndex) {
                    setActiveDrawerIndex(null);
                  } else if (deletedIdx < activeDrawerIndex) {
                    setActiveDrawerIndex(activeDrawerIndex - 1);
                  }
                }
              }}
              onRetryExtract={() => { /* not applicable in post_submit */ }}
            />
          )}
          <CreatedStudentsDisclosure rows={successRows} defaultOpen={allDone} />
        </>
      )}

      {gateOpen && (
        <PreSubmitGate
          rows={rows.filter((r) =>
            r.status === 'ready' || r.status === 'has_errors' ||
            r.status === 'failed' || r.status === 'pending'
          )}
          modelDef={modelDef}
          tenantId={tenant}
          onCancel={() => setGateOpen(false)}
          onConfirm={(c) => { void submitFromGate(c); }}
          onCancelAndEdit={(rowId) => {
            setGateOpen(false);
            const idx = rows.findIndex((r) => r.id === rowId);
            if (idx >= 0) setActiveDrawerIndex(idx);
          }}
        />
      )}

      {activeDrawerIndex != null && drawerRows[activeDrawerIndex] && (
        <BulkRowDrawer
          rows={drawerRows}
          activeRowIndex={activeDrawerIndex}
          modelDef={modelDef}
          onSaveRow={(rowId, baseData, customFields) => {
            const target = rows.find((r) => r.id === rowId);
            if (!target || target.status === 'created') return; // refuse to mutate created rows
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

    </div>
  );
}
