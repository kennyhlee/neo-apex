// admindash/frontend/src/components/BulkDocumentDropzone.tsx
import { useRef, useState } from 'react';
import { BULK_ADD_DOCUMENT_CAP } from '../config.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './BulkDocumentDropzone.css';

const ACCEPTED_EXTS = ['.pdf', '.docx', '.txt'];

interface Props {
  onSelect: (files: File[]) => void;
  onCancel: () => void;
}

export default function BulkDocumentDropzone({ onSelect, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const validateAndPick = (files: File[]) => {
    setError(null);
    if (files.length === 0) return;
    if (files.length > BULK_ADD_DOCUMENT_CAP) {
      setError(
        t('bulkAdd.errors.tooManyDocuments').replace('{cap}', String(BULK_ADD_DOCUMENT_CAP)),
      );
      return;
    }
    const valid: File[] = [];
    const invalid: string[] = [];
    for (const f of files) {
      const ext = '.' + (f.name.split('.').pop()?.toLowerCase() ?? '');
      if (ACCEPTED_EXTS.includes(ext)) valid.push(f);
      else invalid.push(f.name);
    }
    if (invalid.length > 0) {
      setError(t('bulkAdd.errors.unsupportedFiles').replace('{names}', invalid.join(', ')));
    }
    if (valid.length > 0) onSelect(valid);
    // Reset input value so the same filename can be picked again to retrigger.
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    validateAndPick(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="bulk-doc-dropzone-wrapper">
      <div
        className={`bulk-doc-dropzone ${dragging ? 'bulk-doc-dropzone--dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTS.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => validateAndPick(Array.from(e.target.files ?? []))}
        />
        <p className="bulk-doc-dropzone__title">{t('bulkAdd.dropzone.docsTitle')}</p>
        <p className="bulk-doc-dropzone__hint">
          {t('bulkAdd.dropzone.docsHint').replace('{cap}', String(BULK_ADD_DOCUMENT_CAP))}
        </p>
      </div>
      {error && <div className="bulk-doc-dropzone__error">{error}</div>}
      <div className="bulk-doc-dropzone__actions">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
