// admindash/frontend/src/components/BulkCsvDropzone.tsx
import { useRef, useState } from 'react';
import { BULK_ADD_CSV_ROW_CAP } from '../config.ts';
import { parseCsvForBulk } from '../utils/csvParse.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { CsvParseResult } from '../types/bulkAdd.ts';
import './BulkCsvDropzone.css';

interface Props {
  onParsed: (parsed: CsvParseResult) => void;
  onCancel: () => void;
}

export default function BulkCsvDropzone({ onParsed, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const outcome = await parseCsvForBulk(file);
      if (!outcome.ok) {
        setError(outcome.error.message);
      } else {
        onParsed(outcome.result);
        // Reset input value so the same filename can be picked again to retrigger.
        if (inputRef.current) inputRef.current.value = '';
      }
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="bulk-csv-dropzone-wrapper">
      <div
        className={`bulk-csv-dropzone ${dragging ? 'bulk-csv-dropzone--dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <p className="bulk-csv-dropzone__title">{t('bulkAdd.dropzone.csvTitle')}</p>
        <p className="bulk-csv-dropzone__hint">
          {t('bulkAdd.dropzone.csvHint').replace('{cap}', String(BULK_ADD_CSV_ROW_CAP))}
        </p>
        {parsing && <p className="bulk-csv-dropzone__parsing">{t('common.loading')}</p>}
      </div>
      {error && <div className="bulk-csv-dropzone__error">{error}</div>}
      <div className="bulk-csv-dropzone__actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
