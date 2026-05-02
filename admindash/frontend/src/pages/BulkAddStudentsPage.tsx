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
import { applyMapping } from '../utils/csvMapping.ts';
import { extractStudentBatch } from '../api/bulkAddOrchestrators.ts';
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

  useEffect(() => {
    let cancelled = false;
    getModel(tenant, 'student')
      .then((def) => { if (!cancelled) setModelDef(def); })
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [tenant, getModel]);

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
            setRows((prev) => prev.filter((r) => r.id !== rowId));
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
