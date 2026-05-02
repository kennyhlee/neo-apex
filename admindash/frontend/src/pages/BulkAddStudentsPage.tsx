// admindash/frontend/src/pages/BulkAddStudentsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModel } from '../contexts/ModelContext.tsx';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { Phase, BulkRow, BatchMode, ColumnMapping } from '../types/bulkAdd.ts';
import { newBatchId } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import type { CsvParseResult } from '../types/bulkAdd.ts';
import BulkModeSelector from '../components/BulkModeSelector.tsx';
import BulkDocumentDropzone from '../components/BulkDocumentDropzone.tsx';
import BulkCsvDropzone from '../components/BulkCsvDropzone.tsx';
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

  useEffect(() => {
    let cancelled = false;
    getModel(tenant, 'student')
      .then((def) => { if (!cancelled) setModelDef(def); })
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [tenant, getModel]);

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
          onSelect={(files) => {
            // Phase 6 wires extractStudentBatch here. For this commit, log + stay
            // in uploading so the page is testable end-to-end.
            console.log('Documents picked:', files.map((f) => f.name));
          }}
          onCancel={() => {
            setPhase('mode_select');
            setMode(null);
          }}
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

      {/* batchId, rows, setRows, columnMapping, setColumnMapping, csvParsed referenced by later phases */}
      <div hidden>
        {String(batchId)} {String(rows.length)} {String(setRows)}
        {String(columnMapping)} {String(setColumnMapping)} {String(csvParsed)}
      </div>
    </div>
  );
}
